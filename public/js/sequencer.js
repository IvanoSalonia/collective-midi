// 16-step sequencer for the conductor.
//
// Four parallel per-channel patterns (one per MIDI channel) play in sync to
// the global BPM; each step holds up to 3 notes (chords). Notes fire through
// the same socket.io path as live MIDI, so audience phones and the local
// rehearsal stack respond identically.

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function noteName(midi) {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

// Channel colors — must match the per-channel group colors (default/state A)
// in default-settings.js and note-mapping.js.
const CH_COLORS = ['#42EA33', '#DD1414', '#FFFFFF', '#1417DD'];
const NUM_STEPS = 16;
const NUM_CHANNELS = 4;
const MAX_NOTES_PER_STEP = 3;
// Keyboard shows 1.5 octaves = 11 white keys (C up to F an octave-and-a-half
// higher). The octave arrows shift this window across the C3..B5 range.
const KEYBOARD_WHITE_KEYS = 11;
const NOTE_MIN = 48; // C3, start of the routable range (see note-mapping.js)
const NOTE_MAX = 83; // B5
const DEFAULT_KEYBOARD_BASE = 48;

// Semitone offset (within an octave) of each successive white key, and a
// helper to get the semitone offset of the i-th white key from a base C.
const WHITE_OFFSETS = [0, 2, 4, 5, 7, 9, 11];
function whiteKeyOffset(i) {
  return Math.floor(i / 7) * 12 + WHITE_OFFSETS[i % 7];
}
// Semitone offsets of white notes that have a black key immediately above:
// C, D, F, G, A.
const HAS_SHARP_AFTER = new Set([0, 2, 5, 7, 9]);

export function createSequencer({
  socket,
  getBpm,
  getLocalStack,
  isRehearsalOn,
  ensureLocalStack,
  flashChannel,
  appendLog
}) {
  const patterns = Array.from({ length: NUM_CHANNELS }, () =>
    Array.from({ length: NUM_STEPS }, () => []));
  let selectedChannel = 0;
  let selectedNote = 60; // C4
  let keyboardBase = DEFAULT_KEYBOARD_BASE;
  let playing = false;
  let currentStep = -1;
  let timer = null;
  // Bumped on stop/play so stale note-off timeouts from a previous run
  // don't cut off notes belonging to a new run.
  let playGen = 0;

  const channelsEl = document.getElementById('seq-channels');
  const stepsEl = document.getElementById('seq-steps');
  const keyboardEl = document.getElementById('seq-keyboard');
  const playBtn = document.getElementById('seq-play');
  const clearBtn = document.getElementById('seq-clear');
  const octDownBtn = document.getElementById('seq-oct-down');
  const octUpBtn = document.getElementById('seq-oct-up');

  if (!channelsEl || !stepsEl || !keyboardEl || !playBtn) {
    console.warn('sequencer: required DOM not found, skipping init');
    return;
  }

  buildChannels();
  buildSteps();
  buildKeyboard();

  playBtn.addEventListener('click', () => { playing ? stop() : play(); });
  clearBtn?.addEventListener('click', () => {
    patterns[selectedChannel] = Array.from({ length: NUM_STEPS }, () => []);
    renderSteps();
  });
  octDownBtn?.addEventListener('click', () => shiftOctave(-12));
  octUpBtn?.addEventListener('click', () => shiftOctave(+12));

  // --- UI builders --------------------------------------------------------

  function buildChannels() {
    channelsEl.innerHTML = '';
    for (let ch = 0; ch < NUM_CHANNELS; ch++) {
      const btn = document.createElement('button');
      btn.className = 'seq-ch';
      btn.dataset.ch = ch;
      btn.style.setProperty('--ch-color', CH_COLORS[ch]);
      btn.textContent = `Ch ${ch + 1}`;
      if (ch === selectedChannel) btn.classList.add('active');
      btn.addEventListener('click', () => selectChannel(ch));
      channelsEl.appendChild(btn);
    }
  }

  function buildSteps() {
    stepsEl.innerHTML = '';
    for (let i = 0; i < NUM_STEPS; i++) {
      const btn = document.createElement('button');
      btn.className = 'seq-step';
      btn.dataset.step = i;
      btn.addEventListener('click', () => toggleStep(i));
      stepsEl.appendChild(btn);
    }
    renderSteps();
  }

  function buildKeyboard() {
    keyboardEl.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'seq-keys';

    const whitePct = 100 / KEYBOARD_WHITE_KEYS;
    const blackPct = whitePct * 0.6;

    // White keys (flex row). Every C gets an octave label.
    const whiteMidis = [];
    for (let i = 0; i < KEYBOARD_WHITE_KEYS; i++) {
      const midi = keyboardBase + whiteKeyOffset(i);
      whiteMidis.push(midi);
      const w = document.createElement('button');
      w.className = 'seq-key seq-key-white';
      w.dataset.note = midi;
      w.title = noteName(midi);
      if (midi % 12 === 0) {
        const label = document.createElement('span');
        label.className = 'seq-key-label';
        label.textContent = `C${Math.floor(midi / 12) - 1}`;
        w.appendChild(label);
      }
      w.addEventListener('click', () => selectNote(midi));
      wrapper.appendChild(w);
    }

    // Black keys sit between consecutive white keys where the lower white
    // note has a sharp above it. The trailing position past the last white
    // key is skipped so we don't render a half-off black key at the edge.
    for (let i = 0; i < KEYBOARD_WHITE_KEYS - 1; i++) {
      const noteInOct = ((whiteMidis[i] % 12) + 12) % 12;
      if (!HAS_SHARP_AFTER.has(noteInOct)) continue;
      const blackMidi = whiteMidis[i] + 1;
      const b = document.createElement('button');
      b.className = 'seq-key seq-key-black';
      b.dataset.note = blackMidi;
      b.title = noteName(blackMidi);
      b.style.left = `${(i + 1) * whitePct - blackPct / 2}%`;
      b.style.width = `${blackPct}%`;
      b.addEventListener('click', (e) => { e.stopPropagation(); selectNote(blackMidi); });
      wrapper.appendChild(b);
    }

    keyboardEl.appendChild(wrapper);
    highlightSelectedKey();
  }

  // --- Selection ----------------------------------------------------------

  function selectChannel(ch) {
    selectedChannel = ch;
    channelsEl.querySelectorAll('.seq-ch').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.ch) === ch);
    });
    renderSteps();
  }

  function selectNote(midi) {
    selectedNote = midi;
    highlightSelectedKey();
  }

  function highlightSelectedKey() {
    keyboardEl.querySelectorAll('.seq-key').forEach((k) => {
      k.classList.toggle('selected', Number(k.dataset.note) === selectedNote);
    });
  }

  function shiftOctave(delta) {
    const lowest = NOTE_MIN;
    // Keep the highest white key within the routable range.
    const highest = NOTE_MAX - whiteKeyOffset(KEYBOARD_WHITE_KEYS - 1);
    const next = Math.max(lowest, Math.min(highest, keyboardBase + delta));
    if (next === keyboardBase) return;
    keyboardBase = next;
    buildKeyboard();
  }

  // --- Pattern editing ----------------------------------------------------

  function toggleStep(stepIdx) {
    const arr = patterns[selectedChannel][stepIdx];
    const at = arr.indexOf(selectedNote);
    if (at !== -1) {
      arr.splice(at, 1);
    } else if (arr.length < MAX_NOTES_PER_STEP) {
      arr.push(selectedNote);
      arr.sort((a, b) => a - b);
    }
    renderSteps();
  }

  function renderSteps() {
    stepsEl.querySelectorAll('.seq-step').forEach((cell, i) => {
      const notes = patterns[selectedChannel][i];
      cell.style.setProperty('--ch-color', CH_COLORS[selectedChannel]);
      cell.classList.toggle('filled', notes.length > 0);
      cell.textContent = notes.length ? notes.map(noteName).join('\n') : '';
      cell.classList.toggle('playing', playing && i === currentStep);
    });
  }

  function updatePlayhead() {
    stepsEl.querySelectorAll('.seq-step').forEach((cell, i) => {
      cell.classList.toggle('playing', playing && i === currentStep);
    });
  }

  // --- Transport ----------------------------------------------------------

  async function play() {
    if (playing) return;
    // Resume / lazy-build local audio if the user has rehearsal on.
    if (isRehearsalOn?.() && ensureLocalStack) {
      try { await ensureLocalStack(); } catch (e) { console.warn('seq ensure stack:', e); }
    }
    playGen++;
    playing = true;
    currentStep = -1;
    playBtn.textContent = '■ Stop';
    playBtn.classList.add('playing');
    appendLog?.('sequencer: play');
    tick();
  }

  function stop() {
    playGen++;
    playing = false;
    clearTimeout(timer);
    timer = null;
    currentStep = -1;
    playBtn.textContent = '▶ Play';
    playBtn.classList.remove('playing');
    renderSteps();
    appendLog?.('sequencer: stop');
  }

  function tick() {
    if (!playing) return;
    currentStep = (currentStep + 1) % NUM_STEPS;
    const bpm = Math.max(20, Math.min(300, Number(getBpm?.()) || 120));
    const stepMs = (60 / bpm) * 1000 / 4; // 16th-note step

    for (let ch = 0; ch < NUM_CHANNELS; ch++) {
      const notes = patterns[ch][currentStep];
      if (!notes.length) continue;
      flashChannel?.(ch);
      for (const note of notes) triggerNote(ch, note, stepMs * 0.85);
    }

    updatePlayhead();
    timer = setTimeout(tick, stepMs);
  }

  function triggerNote(channel, note, holdMs) {
    const myGen = playGen;
    socket.emit('note-on', { channel, note, velocity: 100 });
    const onStack = isRehearsalOn?.() && getLocalStack?.();
    if (onStack) {
      try { onStack.noteOn(channel, note, 100); } catch (e) { console.warn('seq local on:', e); }
    }
    setTimeout(() => {
      // If the sequencer was stopped/restarted, this off belongs to a stale
      // run — the server still gets it (harmless) but skip local to avoid
      // cutting a fresh note short.
      socket.emit('note-off', { channel, note });
      if (myGen !== playGen) return;
      const offStack = isRehearsalOn?.() && getLocalStack?.();
      if (offStack) {
        try { offStack.noteOff(channel, note); } catch (e) { console.warn('seq local off:', e); }
      }
    }, holdMs);
  }
}
