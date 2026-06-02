// Collective MIDI Performance — server
//
// Routes MIDI note events from one "conductor" (the performer) to many
// "audience" clients (phones), and keeps a single source of truth for
// sound-design settings (synth params, FX sends, BPM, sample URLs).
//
// Settings flow:
//   - server holds DEFAULT_SETTINGS (mutable in memory, not persisted).
//   - on connect, both audience and conductor receive the full settings.
//   - conductor sends partial 'settings-update' payloads (deep-merged here),
//     and the merged result is broadcast to everyone.
//   - sample uploads go through POST /upload/:channel (ch2 or ch4 only),
//     which writes to samples/uploaded/ and updates settings.samples.

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { buildNoteMap, GROUP_COUNT, GROUP_COLORS } = require('./public/js/shared/note-mapping');
const { DEFAULT_SETTINGS } = require('./default-settings');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  // Bump the upload limit so audio file payloads don't get rejected if they
  // ever come through socket.io (currently they go through HTTP, but harmless).
  maxHttpBufferSize: 50 * 1024 * 1024
});

const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'samples', 'uploaded');
const UPLOAD_LIMIT = 25 * 1024 * 1024; // 25 MB per file
const ALLOWED_UPLOAD_CHANNELS = new Set(['ch2', 'ch4']);

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Static + sample serving.
app.use(express.static(path.join(__dirname, 'public')));
app.use('/samples', express.static(path.join(__dirname, 'samples')));

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/conductor', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'conductor.html')));

// --- Sample upload (raw body) ---------------------------------------------
// Conductor POSTs the file bytes with X-Filename header (so we can keep the
// extension). We accept ch2 or ch4 only — the other two channels are
// fully synthesized.
app.post('/upload/:channel',
  express.raw({ type: '*/*', limit: UPLOAD_LIMIT }),
  (req, res) => {
    const channel = req.params.channel;
    if (!ALLOWED_UPLOAD_CHANNELS.has(channel)) {
      return res.status(400).json({ error: 'channel must be ch2 or ch4' });
    }
    if (!req.body || !req.body.length) {
      return res.status(400).json({ error: 'empty body' });
    }
    const filename = req.headers['x-filename'] || 'upload.bin';
    const safeExt = (path.extname(filename).match(/^\.[A-Za-z0-9]{1,8}$/) || ['.bin'])[0];
    // Write deterministic name per channel; old upload is overwritten so we
    // don't accumulate junk on disk.
    const outPath = path.join(UPLOAD_DIR, `${channel}${safeExt}`);
    fs.writeFile(outPath, req.body, (err) => {
      if (err) return res.status(500).json({ error: err.message });
      // URL the audience clients will fetch from. Add a cache-buster so every
      // upload forces a fresh decode even if the path didn't change.
      const url = `/samples/uploaded/${channel}${safeExt}?v=${Date.now()}`;
      currentSettings.samples[channel] = url;
      io.emit('settings', currentSettings);
      res.json({ ok: true, url });
    });
  });

// --- Note routing ---------------------------------------------------------

const noteMap = buildNoteMap();
const audience = new Map(); // socketId -> { group }
let nextGroupCursor = 0;
let conductorId = null;

// Settings live here. Modified by 'settings-update' from the conductor and
// by sample uploads. Reset to defaults if the server restarts.
const currentSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

function audienceCountsByGroup() {
  const counts = new Array(GROUP_COUNT).fill(0);
  for (const { group } of audience.values()) counts[group]++;
  return counts;
}

function broadcastRoster() {
  if (!conductorId) return;
  io.to(conductorId).emit('roster', {
    total: audience.size,
    perGroup: audienceCountsByGroup()
  });
}

// Deep-merge a partial settings patch into the current settings. Arrays are
// merged element-wise so the conductor can patch a single channel by index.
// Null/undefined items are treated as "leave existing value alone" — important
// because JSON.stringify converts `undefined` array slots to `null` in transit,
// and we don't want a single-channel patch to wipe out the others.
function mergeSettings(target, patch) {
  for (const k of Object.keys(patch)) {
    const pv = patch[k];
    if (pv === null || pv === undefined) continue;
    if (Array.isArray(pv)) {
      if (!Array.isArray(target[k])) target[k] = [];
      pv.forEach((item, i) => {
        if (item === null || item === undefined) return;
        if (typeof item === 'object' && !Array.isArray(item)) {
          target[k][i] = target[k][i] || {};
          mergeSettings(target[k][i], item);
        } else {
          target[k][i] = item;
        }
      });
    } else if (typeof pv === 'object') {
      target[k] = target[k] || {};
      mergeSettings(target[k], pv);
    } else {
      target[k] = pv;
    }
  }
  return target;
}

io.on('connection', (socket) => {
  socket.on('hello', ({ role, group: requestedGroup }) => {
    if (role === 'conductor') {
      if (conductorId && conductorId !== socket.id) {
        io.to(conductorId).emit('replaced');
      }
      conductorId = socket.id;
      socket.emit('conductor-ready', {
        groupCount: GROUP_COUNT,
        colors: GROUP_COLORS,
        roster: { total: audience.size, perGroup: audienceCountsByGroup() },
        settings: currentSettings
      });
      return;
    }

    // Audience. The phone picks a group on the start overlay and sends it
    // in `hello`. If it's missing or invalid we fall back to round-robin
    // (safety net for non-UI clients or bugs).
    let group;
    if (Number.isInteger(requestedGroup) &&
        requestedGroup >= 0 && requestedGroup < GROUP_COUNT) {
      group = requestedGroup;
    } else {
      group = nextGroupCursor % GROUP_COUNT;
      nextGroupCursor++;
    }
    audience.set(socket.id, { group });
    socket.join(`group:${group}`);
    socket.emit('assigned', {
      group,
      color: GROUP_COLORS[group],
      groupCount: GROUP_COUNT,
      settings: currentSettings
    });
    broadcastRoster();
  });

  // Conductor pushes a (possibly partial) settings change. Server merges,
  // then broadcasts the full new settings to everyone.
  socket.on('settings-update', (patch) => {
    if (socket.id !== conductorId) return;
    if (!patch || typeof patch !== 'object') return;
    mergeSettings(currentSettings, patch);
    io.emit('settings', currentSettings);
  });

  socket.on('note-on', ({ channel, note, velocity }) => {
    if (socket.id !== conductorId) return;
    if (!Number.isInteger(channel) || !Number.isInteger(note)) return;
    const group = noteMap[channel]?.[note];
    if (group === undefined) return;
    io.to(`group:${group}`).emit('note-on', { channel, note, velocity });
    socket.emit('note-echo', { channel, note, velocity, group, kind: 'on' });
  });

  socket.on('note-off', ({ channel, note }) => {
    if (socket.id !== conductorId) return;
    if (!Number.isInteger(channel) || !Number.isInteger(note)) return;
    const group = noteMap[channel]?.[note];
    if (group === undefined) return;
    io.to(`group:${group}`).emit('note-off', { channel, note });
    socket.emit('note-echo', { channel, note, group, kind: 'off' });
  });

  socket.on('disconnect', () => {
    if (socket.id === conductorId) {
      conductorId = null;
      return;
    }
    if (audience.has(socket.id)) {
      audience.delete(socket.id);
      broadcastRoster();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Collective MIDI server listening on http://localhost:${PORT}`);
  console.log(`  Audience:  http://localhost:${PORT}/`);
  console.log(`  Conductor: http://localhost:${PORT}/conductor`);
});
