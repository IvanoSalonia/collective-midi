// Conductor client — runs on the performer's laptop browser.
//
// 1. Connects to the server as 'conductor'.
// 2. Requests WebMIDI access, lists inputs, lets the user pick one (Keystep Pro).
// 3. Forwards note-on / note-off MIDI events from the selected input to the server.
// 4. Renders an overview: 8 group cells with audience counts + flash on note,
//    plus a small live log of incoming notes.

const socket = io();

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function noteName(midi) {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

// --- DOM -------------------------------------------------------------------

const statusEl = document.getElementById('status');
const totalEl = document.getElementById('total');
const groupsEl = document.getElementById('groups');
const logEl = document.getElementById('log');
const midiSelectEl = document.getElementById('midi-input');

let groupCells = []; // [HTMLElement] indexed by group
let groupColors = [];
const chCells = [...document.querySelectorAll('.ch-meter .ch')];
const chFlashTimers = new Map();

// Brief visual flash on the per-channel activity indicator (channels 0..3).
function flashChannel(ch) {
  const cell = chCells[ch];
  if (!cell) return;
  cell.classList.add('active');
  clearTimeout(chFlashTimers.get(ch));
  chFlashTimers.set(ch, setTimeout(() => cell.classList.remove('active'), 140));
}

// --- Socket flow -----------------------------------------------------------

socket.on('connect', () => {
  statusEl.textContent = 'connected';
  socket.emit('hello', { role: 'conductor' });
});

socket.on('disconnect', () => {
  statusEl.textContent = 'disconnected';
});

socket.on('replaced', () => {
  statusEl.textContent = 'replaced by another conductor';
});

socket.on('conductor-ready', ({ groupCount, colors, roster }) => {
  groupColors = colors;
  buildGroupGrid(groupCount, colors);
  applyRoster(roster);
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

let flashTimers = new Map();
function flashGroup(idx) {
  const cell = groupCells[idx];
  if (!cell) return;
  cell.classList.add('flash');
  clearTimeout(flashTimers.get(idx));
  flashTimers.set(idx, setTimeout(() => cell.classList.remove('flash'), 220));
}

const MAX_LOG = 40;
function appendLog(text) {
  const line = document.createElement('div');
  line.textContent = text;
  logEl.prepend(line);
  while (logEl.childElementCount > MAX_LOG) logEl.lastChild.remove();
}

// --- WebMIDI ---------------------------------------------------------------

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
  // Auto-select Keystep if visible and nothing chosen yet.
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
  const channel = status & 0x0f; // 0..15
  if (channel > 3) return; // we only use channels 0..3 (Keystep ch1..4)

  if (cmd === 0x90 && d2 > 0) {
    flashChannel(channel);
    socket.emit('note-on', { channel, note: d1, velocity: d2 });
  } else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) {
    socket.emit('note-off', { channel, note: d1 });
  }
}

initMidi();
