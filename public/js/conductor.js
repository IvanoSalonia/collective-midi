// Conductor client.
//
// 1. Connects as 'conductor', receives groupCount/colors/roster/settings.
// 2. WebMIDI: lets the user pick a MIDI input, forwards note events to the server.
// 3. Renders the group overview (audience counts, flash on note).
// 4. Renders the sound-design panel with A/B/C tabs per channel. Sliders
//    read/write whichever state's tab is currently selected for that channel.
//    Settings patches are wrapped as { channels: [{ <state>: {field: value} }] }.
// 5. Rehearsal mode: when toggled, instantiates a local audio stack on the
//    laptop. Each channel's currently-selected tab determines which state
//    that channel plays through, so the user can audition sound design
//    changes per orientation.
// 6. Step sequencer (in sequencer.js) shares the same socket + local stack.

import { createAudioStack } from '/js/audio/audio-stack.js';

const socket = io();

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function noteName(midi) {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

// --- DOM refs -------------------------------------------------------------

const statusEl = document.getElementById('status');
const totalEl = document.getElementById('total');
const groupsEl = document.getElementById('groups');
const logEl = document.getElementById('log');
const midiSelectEl = document.getElementById('midi-input');
const rehearsalToggleEl = document.getElementById('rehearsal-toggle');
const bpmInputEl = document.getElementById('bpm-input');
const delayStepEl = document.getElementById('delay-step');
const delayFeedbackEl = document.getElementById('delay-feedback');
const reverbWetEl = document.getElementById('reverb-wet');

let groupCells = [];
let groupColors = [];
const chCells = [...document.querySelectorAll('.ch-meter .ch')];

// Active-note counters per group / per channel (visual stays lit while count > 0).
const groupActiveCount = [];
const chActiveCount = [0, 0, 0, 0];

// Which orientation state ('A'|'B'|'C') is currently shown/edited for each
// channel. Defaults to A. Also drives the local rehearsal stack: each
// channel plays the sound of its currently-selected tab.
const selectedState = ['A', 'A', 'A', 'A'];

let currentSettings = null;
let suppressApply = false;
let appliedLocalSamples = { ch2: null, ch4: null };

// --- Local audio stack (for rehearsal mode) ------------------------------

let localAudioCtx = null;
let localStack = null;

async function ensureLocalStack() {
  if (localStack) {
    if (localAudioCtx?.state === 'suspended') await localAudioCtx.resume();
    return localStack;
  }
  if (!currentSettings) return null;
  try {
    localAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (localAudioCtx.state === 'suspended') await localAudioCtx.resume();
    localStack = createAudioStack(localAudioCtx, currentSettings);
    appliedLocalSamples.ch2 = currentSettings.samples.ch2;
    appliedLocalSamples.ch4 = currentSettings.samples.ch4;
    // Pin each channel to its currently-selected tab.
    for (let i = 0; i < 4; i++) localStack.setChannelState(i, selectedState[i]);
    appendLog(`local audio ready (state: ${localAudioCtx.state})`);
    return localStack;
  } catch (e) {
    appendLog(`local audio init failed: ${e.message}`);
    console.error(e);
    return null;
  }
}

function isRehearsalOn() { return !!rehearsalToggleEl?.checked; }

// --- Socket flow ----------------------------------------------------------

socket.on('connect', () => {
  statusEl.textContent = 'connected';
  socket.emit('hello', { role: 'conductor' });
});
socket.on('disconnect', () => { statusEl.textContent = 'disconnected'; });
socket.on('replaced', () => { statusEl.textContent = 'replaced by another conductor'; });

socket.on('conductor-ready', ({ groupCount, colors, roster, settings }) => {
  groupColors = colors;
  buildGroupGrid(groupCount, colors);
  applyRoster(roster);
  currentSettings = settings;
  populateSettingsUI(settings);
  if (localStack) {
    localStack.applySettings(settings);
    for (let i = 0; i < 4; i++) localStack.setChannelState(i, selectedState[i]);
  }
});

socket.on('settings', (settings) => {
  currentSettings = settings;
  populateSettingsUI(settings);
  if (localStack) {
    localStack.applySettings(settings);
    // Re-apply each channel's selected state — engine settings would
    // otherwise be stale after applySettings rebuilds the FX bus snapshot.
    for (let i = 0; i < 4; i++) localStack.setChannelState(i, selectedState[i]);
    if (settings.samples.ch2 !== appliedLocalSamples.ch2) {
      localStack.reloadSample(1, settings.samples.ch2).catch(() => {});
      appliedLocalSamples.ch2 = settings.samples.ch2;
    }
    if (settings.samples.ch4 !== appliedLocalSamples.ch4) {
      localStack.reloadSample(3, settings.samples.ch4).catch(() => {});
      appliedLocalSamples.ch4 = settings.samples.ch4;
    }
  }
});

socket.on('roster', applyRoster);

socket.on('note-echo', ({ note, group, kind }) => {
  setGroupActive(group, kind === 'on');
  if (kind === 'on') appendNoteLog(note, group);
});

function applyRoster({ total, perGroup }) {
  totalEl.textContent = `${total} connected`;
  perGroup.forEach((count, idx) => {
    const cell = groupCells[idx];
    if (!cell) return;
    cell.querySelector('.count').textContent = count;
  });
}

function buildGroupGrid(n, colors) {
  groupsEl.innerHTML = '';
  groupCells = [];
  for (let i = 0; i < n; i++) {
    const cell = document.createElement('div');
    cell.className = 'group-cell';
    cell.style.setProperty('--c', colors[i]);
    cell.innerHTML = `
      <div class="dot"></div>
      <div class="meta">
        <div class="name">Group ${i + 1}</div>
        <div class="count">0</div>
      </div>
    `;
    groupsEl.appendChild(cell);
    groupCells.push(cell);
  }
}

function setGroupActive(idx, on) {
  groupActiveCount[idx] = groupActiveCount[idx] || 0;
  if (on) groupActiveCount[idx]++;
  else groupActiveCount[idx] = Math.max(0, groupActiveCount[idx] - 1);
  const cell = groupCells[idx];
  if (!cell) return;
  if (groupActiveCount[idx] > 0) cell.classList.add('flash');
  else cell.classList.remove('flash');
}

function setChannelActive(ch, on) {
  if (on) chActiveCount[ch]++;
  else chActiveCount[ch] = Math.max(0, chActiveCount[ch] - 1);
  const cell = chCells[ch];
  if (!cell) return;
  if (chActiveCount[ch] > 0) cell.classList.add('active');
  else cell.classList.remove('active');
}

// Up to 10 entries, one per column in the log grid.
const MAX_LOG = 10;

// Plain status entries (errors, MIDI messages, rehearsal toggle, etc.).
// One cell, monospace, single-line ellipsised.
function appendLog(text) {
  const entry = document.createElement('div');
  entry.className = 'log-entry log-text';
  entry.textContent = text;
  logEl.prepend(entry);
  pruneLog();
}

// Note entries: note name in white, "group N" in the group's color.
function appendNoteLog(note, group) {
  const entry = document.createElement('div');
  entry.className = 'log-entry log-note';
  const n = document.createElement('div');
  n.className = 'log-note-name';
  n.textContent = noteName(note);
  const g = document.createElement('div');
  g.className = 'log-note-group';
  g.style.color = groupColors[group] || '#aaa';
  g.textContent = `group ${group + 1}`;
  entry.appendChild(n);
  entry.appendChild(g);
  logEl.prepend(entry);
  pruneLog();
}

function pruneLog() {
  while (logEl.childElementCount > MAX_LOG) logEl.lastChild.remove();
}

// --- Sound-design panel: bind UI <-> settings -----------------------------

function pushSettings(patch) {
  if (suppressApply) return;
  socket.emit('settings-update', patch);
}

// Wrap a single channel's field changes in the right orientation state.
//   channelStatePatch(2, 'B', { reverbSend: 0.5 })
//     → { channels: [undef, undef, { B: { reverbSend: 0.5 } }, undef] }
function channelStatePatch(ch, stateKey, fields) {
  const arr = [];
  for (let i = 0; i < 4; i++) arr.push(i === ch ? { [stateKey]: fields } : undefined);
  return { channels: arr };
}

function setIfNotActive(el, value) {
  if (document.activeElement === el) return;
  el.value = value;
}

// Reflect settings into the FX bus controls + each strip's currently-selected
// state. Filename labels read from the top-level samples object.
function populateSettingsUI(s) {
  if (!s) return;
  suppressApply = true;
  setIfNotActive(bpmInputEl, s.bpm);
  setIfNotActive(delayStepEl, s.delay.step);
  setIfNotActive(delayFeedbackEl, s.delay.feedback);
  setIfNotActive(reverbWetEl, s.reverb.wet);
  document.querySelectorAll('.sd-strip').forEach((stripEl) => {
    const ch = Number(stripEl.dataset.ch);
    populateStripState(stripEl, ch, selectedState[ch]);
  });
  suppressApply = false;
}

function populateStripState(stripEl, ch, stateKey) {
  if (!currentSettings) return;
  const channel = currentSettings.channels[ch];
  if (!channel) return;
  const state = channel[stateKey];
  if (!state) return;
  stripEl.querySelectorAll('[data-bind]').forEach((el) => {
    const key = el.dataset.bind;
    if (key === 'filename') {
      const url = ch === 1 ? currentSettings.samples.ch2 : ch === 3 ? currentSettings.samples.ch4 : null;
      if (url) el.textContent = url.split('/').pop().split('?')[0];
      return;
    }
    if (state[key] === undefined) return;
    if (el.type === 'checkbox') {
      if (document.activeElement !== el) el.checked = !!state[key];
    } else if (el.tagName === 'SELECT' || el.type === 'range' || el.type === 'number') {
      setIfNotActive(el, state[key]);
    }
  });
}

// FX bus + BPM controls.
bpmInputEl.addEventListener('input', () => {
  const bpm = Number(bpmInputEl.value);
  if (!Number.isFinite(bpm)) return;
  pushSettings({ bpm });
});
delayStepEl.addEventListener('change', () => pushSettings({ delay: { step: delayStepEl.value } }));
delayFeedbackEl.addEventListener('input', () => pushSettings({ delay: { feedback: Number(delayFeedbackEl.value) } }));
reverbWetEl.addEventListener('input', () => pushSettings({ reverb: { wet: Number(reverbWetEl.value) } }));

// Wire each strip's sliders + A/B/C tabs.
document.querySelectorAll('.sd-strip').forEach((stripEl) => {
  const ch = Number(stripEl.dataset.ch);

  // Tab switching — change which state's params are visible/editable.
  stripEl.querySelectorAll('.sd-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const newState = btn.dataset.state;
      selectedState[ch] = newState;
      stripEl.querySelectorAll('.sd-tab').forEach((b) =>
        b.classList.toggle('active', b === btn));
      populateStripState(stripEl, ch, newState);
      // Update local stack so the user can hear changes in the new state
      // if rehearsal is on.
      if (localStack) localStack.setChannelState(ch, newState);
    });
  });

  // Sliders / selects / checkboxes — push wrapped in the currently-selected state.
  stripEl.querySelectorAll('[data-bind]').forEach((el) => {
    const key = el.dataset.bind;
    if (key === 'filename') return; // display only
    const evtName = (el.tagName === 'SELECT' || el.type === 'checkbox') ? 'change' : 'input';
    el.addEventListener(evtName, () => {
      let value;
      if (el.type === 'checkbox') value = el.checked;
      else if (el.type === 'range' || el.type === 'number') value = Number(el.value);
      else value = el.value;
      pushSettings(channelStatePatch(ch, selectedState[ch], { [key]: value }));
    });
  });
});

// --- Drag & drop sample upload --------------------------------------------

document.querySelectorAll('.sd-drop').forEach((drop) => {
  const channel = drop.dataset.channel; // 'ch2' | 'ch4'
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
  drop.addEventListener('drop', async (e) => {
    e.preventDefault();
    drop.classList.remove('drag');
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    appendLog(`uploading ${file.name} → ${channel}…`);
    try {
      const res = await fetch(`/upload/${channel}`, {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-Filename': file.name
        },
        body: file
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.statusText);
      appendLog(`uploaded → ${json.url}`);
    } catch (err) {
      appendLog(`upload failed: ${err.message}`);
    }
  });
  drop.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) drop.dispatchEvent(new DragEvent('drop', {
        dataTransfer: (() => { const dt = new DataTransfer(); dt.items.add(file); return dt; })()
      }));
    };
    input.click();
  });
});

// --- Preset export / import -----------------------------------------------
// Server settings live in memory and reset to defaults on every Node restart
// (including Railway redeploys). Export downloads the current settings as
// JSON; Import applies a JSON file as a settings patch (server deep-merges
// and broadcasts), so a tuned config survives across deploys.

const presetExportBtn = document.getElementById('preset-export');
const presetImportBtn = document.getElementById('preset-import');
const presetImportFile = document.getElementById('preset-import-file');

presetExportBtn?.addEventListener('click', () => {
  if (!currentSettings) {
    appendLog('preset export: settings not ready yet');
    return;
  }
  const json = JSON.stringify(currentSettings, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/T/, '_').slice(0, 19);
  const a = document.createElement('a');
  a.href = url;
  a.download = `collective-midi-preset-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  appendLog(`preset exported: ${a.download}`);
});

presetImportBtn?.addEventListener('click', () => presetImportFile?.click());
presetImportFile?.addEventListener('change', async () => {
  const file = presetImportFile.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not a settings object');
    }
    socket.emit('settings-update', parsed);
    appendLog(`preset imported: ${file.name}`);
  } catch (e) {
    appendLog(`preset import failed: ${e.message}`);
  }
  presetImportFile.value = ''; // allow re-importing the same file
});

// --- Rehearsal toggle -----------------------------------------------------

rehearsalToggleEl.addEventListener('change', async () => {
  if (rehearsalToggleEl.checked) {
    const stack = await ensureLocalStack();
    if (!stack) {
      rehearsalToggleEl.checked = false;
      appendLog('rehearsal: waiting for settings');
      return;
    }
    appendLog('rehearsal mode: on (all channels locally)');
  } else {
    appendLog('rehearsal mode: off');
  }
});

// --- WebMIDI --------------------------------------------------------------

let currentInput = null;

async function initMidi() {
  if (!navigator.requestMIDIAccess) {
    midiSelectEl.disabled = true;
    appendLog('WebMIDI not supported in this browser. Use Chrome on desktop.');
    return;
  }
  try {
    const access = await navigator.requestMIDIAccess({ sysex: false });
    populateInputs(access);
    access.onstatechange = () => populateInputs(access);
  } catch (e) {
    appendLog(`MIDI access denied: ${e.message}`);
  }
}

function populateInputs(access) {
  const inputs = [...access.inputs.values()];
  const previousId = currentInput?.id ?? '';
  midiSelectEl.innerHTML = '<option value="">— none —</option>';
  for (const input of inputs) {
    const opt = document.createElement('option');
    opt.value = input.id;
    opt.textContent = input.name;
    midiSelectEl.appendChild(opt);
  }
  if (!currentInput) {
    const keystep = inputs.find((i) => /keystep/i.test(i.name));
    if (keystep) {
      midiSelectEl.value = keystep.id;
      attachInput(keystep);
    }
  } else if (inputs.find((i) => i.id === previousId)) {
    midiSelectEl.value = previousId;
  } else {
    currentInput = null;
  }
}

midiSelectEl.addEventListener('change', () => {
  if (currentInput) {
    currentInput.onmidimessage = null;
    currentInput = null;
  }
  const id = midiSelectEl.value;
  if (!id) return;
  navigator.requestMIDIAccess().then((access) => {
    const input = [...access.inputs.values()].find((i) => i.id === id);
    if (input) attachInput(input);
  });
});

function attachInput(input) {
  currentInput = input;
  input.onmidimessage = onMidiMessage;
  appendLog(`MIDI input: ${input.name}`);
}

function onMidiMessage(e) {
  const [status, d1, d2] = e.data;
  const cmd = status & 0xf0;
  const channel = status & 0x0f;
  if (channel > 3) return;

  if (cmd === 0x90 && d2 > 0) {
    setChannelActive(channel, true);
    socket.emit('note-on', { channel, note: d1, velocity: d2 });
    if (isRehearsalOn() && localStack) {
      try { localStack.noteOn(channel, d1, d2); }
      catch (e) { appendLog(`ch${channel + 1} note-on err: ${e.message}`); console.error(e); }
    }
  } else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) {
    setChannelActive(channel, false);
    socket.emit('note-off', { channel, note: d1 });
    if (isRehearsalOn() && localStack) {
      try { localStack.noteOff(channel, d1); }
      catch (e) { console.error(e); }
    }
  }
}

initMidi();
