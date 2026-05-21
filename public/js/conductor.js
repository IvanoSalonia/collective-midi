// Conductor client.
//
// 1. Connects as 'conductor', receives groupCount/colors/roster/settings.
// 2. WebMIDI: lets the user pick a MIDI input, forwards note events to the server.
// 3. Renders the group overview (audience counts, flash on note).
// 4. Renders the sound-design panel and pushes 'settings-update' patches when the
//    user changes any control or drops a sample.
// 5. Rehearsal mode: when toggled, instantiates a local audio stack on the laptop
//    and plays every channel's note locally (regardless of group routing).

import { createAudioStack } from '/js/audio/audio-stack.js';
import { createSequencer } from '/js/sequencer.js';

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
const sdPanelEl = document.getElementById('sd-panel');
const bpmInputEl = document.getElementById('bpm-input');
const delayStepEl = document.getElementById('delay-step');
const delayFeedbackEl = document.getElementById('delay-feedback');
const reverbWetEl = document.getElementById('reverb-wet');

let groupCells = [];
let groupColors = [];
const chCells = [...document.querySelectorAll('.ch-meter .ch')];
const chFlashTimers = new Map();

// Local copy of server settings, used to populate UI on first load and when
// the server pushes updates. We avoid echoing our own changes back to the UI
// while the user is dragging a slider (suppressApply guard).
let currentSettings = null;
let suppressApply = false;
// Last sample URLs we've handed to the local rehearsal stack. We only
// re-fetch + re-decode when the URL actually changes (the server re-broadcasts
// the full settings on every slider tick — without this guard we'd thrash
// the audio context with one decode per tick).
let appliedLocalSamples = { ch2: null, ch4: null };

// --- Local audio stack (for rehearsal mode) ------------------------------
// Built lazily on the first user gesture (browser autoplay policy).
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
  if (localStack) localStack.applySettings(settings);
});

socket.on('settings', (settings) => {
  currentSettings = settings;
  populateSettingsUI(settings);
  if (localStack) {
    localStack.applySettings(settings);
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
  flashGroup(group);
  if (kind === 'on') appendLog(`${noteName(note)} → group ${group + 1}`);
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

const flashTimers = new Map();
function flashGroup(idx) {
  const cell = groupCells[idx];
  if (!cell) return;
  cell.classList.add('flash');
  clearTimeout(flashTimers.get(idx));
  flashTimers.set(idx, setTimeout(() => cell.classList.remove('flash'), 220));
}

function flashChannel(ch) {
  const cell = chCells[ch];
  if (!cell) return;
  cell.classList.add('active');
  clearTimeout(chFlashTimers.get(ch));
  chFlashTimers.set(ch, setTimeout(() => cell.classList.remove('active'), 140));
}

const MAX_LOG = 40;
function appendLog(text) {
  const line = document.createElement('div');
  line.textContent = text;
  logEl.prepend(line);
  while (logEl.childElementCount > MAX_LOG) logEl.lastChild.remove();
}

// --- Sound-design panel: bind UI <-> settings -----------------------------

// Push a partial settings patch to the server.
function pushSettings(patch) {
  if (suppressApply) return;
  socket.emit('settings-update', patch);
}

// Build the channels[] array for a single-channel patch.
function channelPatch(ch, fields) {
  const arr = [];
  for (let i = 0; i < 4; i++) arr.push(i === ch ? fields : undefined);
  return { channels: arr };
}

// Don't overwrite the value of the input the user is currently interacting
// with — otherwise dragging a slider fights with the echo-back from the
// server and feels frozen.
function setIfNotActive(el, value) {
  if (document.activeElement === el) return;
  el.value = value;
}

// Read incoming settings and reflect them into the UI controls.
function populateSettingsUI(s) {
  suppressApply = true;
  setIfNotActive(bpmInputEl, s.bpm);
  setIfNotActive(delayStepEl, s.delay.step);
  setIfNotActive(delayFeedbackEl, s.delay.feedback);
  setIfNotActive(reverbWetEl, s.reverb.wet);
  document.querySelectorAll('.sd-strip').forEach((stripEl) => {
    const ch = Number(stripEl.dataset.ch);
    const c = s.channels[ch];
    stripEl.querySelectorAll('[data-bind]').forEach((el) => {
      const key = el.dataset.bind;
      if (key === 'filename') {
        const url = ch === 1 ? s.samples.ch2 : ch === 3 ? s.samples.ch4 : null;
        if (url) el.textContent = url.split('/').pop().split('?')[0];
        return;
      }
      if (c[key] === undefined) return;
      if (el.tagName === 'SELECT' || el.type === 'range' || el.type === 'number') {
        setIfNotActive(el, c[key]);
      }
    });
  });
  suppressApply = false;
}

// Wire FX bus + BPM controls.
bpmInputEl.addEventListener('input', () => {
  const bpm = Number(bpmInputEl.value);
  if (!Number.isFinite(bpm)) return;
  pushSettings({ bpm });
});
delayStepEl.addEventListener('change', () => pushSettings({ delay: { step: delayStepEl.value } }));
delayFeedbackEl.addEventListener('input', () => pushSettings({ delay: { feedback: Number(delayFeedbackEl.value) } }));
reverbWetEl.addEventListener('input', () => pushSettings({ reverb: { wet: Number(reverbWetEl.value) } }));

// Wire each channel strip's controls.
document.querySelectorAll('.sd-strip').forEach((stripEl) => {
  const ch = Number(stripEl.dataset.ch);
  stripEl.querySelectorAll('[data-bind]').forEach((el) => {
    const key = el.dataset.bind;
    if (key === 'filename') return; // display only
    const evtName = (el.tagName === 'SELECT') ? 'change' : 'input';
    el.addEventListener(evtName, () => {
      const raw = el.value;
      const value = (el.type === 'range' || el.type === 'number') ? Number(raw) : raw;
      pushSettings(channelPatch(ch, { [key]: value }));
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
      // Server will broadcast 'settings' which updates currentSettings, UI,
      // and reloads the local stack's sample if rehearsal is on.
    } catch (err) {
      appendLog(`upload failed: ${err.message}`);
    }
  });
  // Click-to-pick fallback (handy on machines without easy DnD).
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

// --- Rehearsal toggle -----------------------------------------------------

rehearsalToggleEl.addEventListener('change', async () => {
  if (rehearsalToggleEl.checked) {
    const stack = await ensureLocalStack();
    if (!stack) {
      // Settings haven't arrived yet — un-toggle.
      rehearsalToggleEl.checked = false;
      appendLog('rehearsal: waiting for settings');
      return;
    }
    appendLog('rehearsal mode: on (all 8 groups locally)');
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
    flashChannel(channel);
    socket.emit('note-on', { channel, note: d1, velocity: d2 });
    if (isRehearsalOn() && localStack) {
      try { localStack.noteOn(channel, d1, d2); }
      catch (e) { appendLog(`ch${channel + 1} note-on err: ${e.message}`); console.error(e); }
    }
  } else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) {
    socket.emit('note-off', { channel, note: d1 });
    if (isRehearsalOn() && localStack) {
      try { localStack.noteOff(channel, d1); }
      catch (e) { console.error(e); }
    }
  }
}

initMidi();

// --- Step sequencer -------------------------------------------------------
// Lives on the conductor page, shares the same note-on/off socket path and
// the same local rehearsal stack as live MIDI input.
createSequencer({
  socket,
  getBpm: () => currentSettings?.bpm ?? 120,
  getLocalStack: () => localStack,
  isRehearsalOn,
  ensureLocalStack,
  flashChannel,
  appendLog
});
