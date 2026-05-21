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

const CH_COLORS = ['#FF0000', '#00FF44', '#0066FF', '#FF00AA'];
const NUM_STEPS = 16;
const NUM_CHANNELS = 4;
const MAX_NOTES_PER_STEP = 3;
const KEYBOARD_OCTAVES = 2;
const NOTE_MIN = 48; // C3, start of the routable range (see note-mapping.js)
const NOTE_MAX = 83; // B5
const DEFAULT_KEYBOARD_BASE = 48;

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

    const numWhite = 7 * KEYBOARD_OCTAVES;
    const whitePct = 100 / numWhite;
    const blackPct = whitePct * 0.6;
    const whiteSemitones = [0, 2, 4, 5, 7, 9, 11];
    const blackSemitones = [1, 3, 6, 8, 10];
    // For each black key in an octave: which white-key index it sits AFTER.
    const blackAfterWhite = [0, 1, 3, 4, 5];

    for (let oct = 0; oct < KEYBOARD_OCTAVES; oct++) {
      for (let i = 0; i < 7; i++) {
        const midi = keyboardBase + oct * 12 + whiteSemitones[i];
        const w = document.createElement('button');
        w.className = 'seq-key seq-key-white';
        w.dataset.note = midi;
        w.title = noteName(midi);
        if (whiteSemitones[i] === 0) {
          const label = document.createElement('span');
          label.className = 'seq-key-label';
          label.textContent = `C${Math.floor(midi / 12) - 1}`;
          w.appendChild(label);
        }
        w.addEventListener('click', () => selectNote(midi));
        wrapper.appendChild(w);
      }
    }

    // Black keys, absolutely positioned over the white-key boundaries.
    for (let oct = 0; oct < KEYBOARD_OCTAVES; oct++) {
      for (let i = 0; i < blackSemitones.length; i++) {
        const midi = keyboardBase + oct * 12 + blackSemitones[i];
        const b = document.createElement('button');
        b.className = 'seq-key seq-key-black';
        b.dataset.note = midi;
        b.title = noteName(midi);
        const idx = oct * 7 + blackAfterWhite[i];
        b.style.left = `${(idx + 1) * whitePct - blackPct / 2}%`;
        b.style.width = `${blackPct}%`;
        b.addEventListener('click', (e) => { e.stopPropagation(); selectNote(midi); });
        wrapper.appendChild(b);
      }
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
    const highest = NOTE_MAX - KEYBOARD_OCTAVES * 12 + 1;
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
