// Collective MIDI Performance — server
//
// Routes MIDI note events from one "conductor" (the performer) to many
// "audience" clients (phones). Each audience client is assigned to one of 8
// groups on join. Each (channel, note) pair maps to exactly one group; only
// audience clients in that group receive the event.

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { buildNoteMap, GROUP_COUNT, GROUP_COLORS } = require('./public/js/shared/note-mapping');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  // Allow connections from anywhere — this is a public performance app.
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

// Serve static client files.
app.use(express.static(path.join(__dirname, 'public')));
app.use('/samples', express.static(path.join(__dirname, 'samples')));

// Routes — explicit so /conductor returns the conductor page even without ".html".
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/conductor', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'conductor.html')));

// (channel 0..3, note 48..83) -> group 0..7. Same map for the whole server lifetime.
const noteMap = buildNoteMap();

// Track audience members. Map<socketId, { group: number }>
const audience = new Map();
// Round-robin counter so groups fill evenly as people join.
let nextGroupCursor = 0;
// Conductor socket id (only one conductor at a time).
let conductorId = null;

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

io.on('connection', (socket) => {
  // The first message a client sends declares its role.
  socket.on('hello', ({ role }) => {
    if (role === 'conductor') {
      // If a conductor was already connected, kick the previous one — last writer wins.
      if (conductorId && conductorId !== socket.id) {
        io.to(conductorId).emit('replaced');
      }
      conductorId = socket.id;
      socket.emit('conductor-ready', {
        groupCount: GROUP_COUNT,
        colors: GROUP_COLORS,
        roster: { total: audience.size, perGroup: audienceCountsByGroup() }
      });
      return;
    }

    // Default: audience member.
    const group = nextGroupCursor % GROUP_COUNT;
    nextGroupCursor++;
    audience.set(socket.id, { group });
    socket.join(`group:${group}`);
    socket.emit('assigned', {
      group,
      color: GROUP_COLORS[group],
      groupCount: GROUP_COUNT
    });
    broadcastRoster();
  });

  // Conductor sends note-on / note-off events. Only the registered conductor is honored.
  socket.on('note-on', ({ channel, note, velocity }) => {
    if (socket.id !== conductorId) return;
    if (!Number.isInteger(channel) || !Number.isInteger(note)) return;
    const group = noteMap[channel]?.[note];
    if (group === undefined) return; // out-of-range note, ignore
    io.to(`group:${group}`).emit('note-on', { channel, note, velocity });
    // Echo back to the conductor so its visualization can light the right group.
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
