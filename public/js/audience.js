// Audience client — runs on each phone.
//
// Responsibilities:
//   1. Connect to the server, declare ourselves as audience, receive group + color.
//   2. On first tap: unlock AudioContext, request iOS DeviceOrientation permission.
//   3. On note-on/off events from the server: trigger the right audio engine.
//   4. Continuously map device tilt → master low-pass filter (cutoff + Q).
//   5. Render the visual: one centered dot, breathing when idle, pulsing on note.

import { Ch1Voice } from '/js/audio/ch1-voice.js';
import { Ch2Sample } from '/js/audio/ch2-sample.js';
import { Ch3Noise } from '/js/audio/ch3-noise.js';
import { Ch4Slicer } from '/js/audio/ch4-slicer.js';

const socket = io();

// --- State -----------------------------------------------------------------

let audioCtx = null;
let masterFilter = null;   // shared low-pass driven by device tilt
let masterGain = null;
let engines = null;        // { 0: Ch1Voice, 1: Ch2Sample, 2: Ch3Noise, 3: Ch4Slicer }
let myGroup = null;
let myColor = '#ffffff';
let activeNotes = 0;       // count of currently-held notes (for visual pulse)
let lastTriggerTime = 0;   // ms timestamp of most recent note-on

// Tilt state (raw beta/gamma in degrees). Smoothed for filter to avoid clicks.
let beta = 0;
let gamma = 0;
let smoothedCutoff = 1000;
let smoothedQ = 1;

// --- Socket wiring ---------------------------------------------------------

socket.on('connect', () => {
  socket.emit('hello', { role: 'audience' });
});

socket.on('assigned', ({ group, color }) => {
  myGroup = group;
  myColor = color;
  document.documentElement.style.setProperty('--group-color', color);
  // Update the start overlay to hint which group they're in.
  const sub = document.getElementById('start-sub');
  if (sub) sub.textContent = `Group ${group + 1}`;
});

socket.on('note-on', ({ channel, note, velocity }) => {
  if (!engines) return;
  const engine = engines[channel];
  if (!engine) return;
  engine.noteOn(note, velocity ?? 100);
  activeNotes++;
  lastTriggerTime = performance.now();
});

socket.on('note-off', ({ channel, note }) => {
  if (!engines) return;
  const engine = engines[channel];
  if (!engine) return;
  engine.noteOff(note);
  activeNotes = Math.max(0, activeNotes - 1);
});

// --- Start tap (unlock audio + ask for tilt permission) --------------------

const overlay = document.getElementById('start-overlay');
overlay.addEventListener('click', async () => {
  await startEverything();
  overlay.classList.add('hidden');
}, { once: true });

async function startEverything() {
  // 1. Audio context
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  masterFilter = audioCtx.createBiquadFilter();
  masterFilter.type = 'lowpass';
  masterFilter.frequency.value = 1500;
  masterFilter.Q.value = 1;

  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.7;

  masterFilter.connect(masterGain).connect(audioCtx.destination);

  // 2. Engines — each gets the filter as its destination
  engines = {
    0: new Ch1Voice(audioCtx, masterFilter),
    1: new Ch2Sample(audioCtx, masterFilter),
    2: new Ch3Noise(audioCtx, masterFilter),
    3: new Ch4Slicer(audioCtx, masterFilter)
  };

  // Sample-based engines load asynchronously; failures (missing files) just
  // mute that channel rather than crashing the whole experience.
  // Note: filenames refer to source files in /samples; the channel they feed
  // is decided here, not by the filename. ch4-instrument.mp3 is the short hit
  // used as ch2's pitched instrument; ch2-instrument.mp3 is the longer source
  // sliced across ch4's note range.
  engines[1].load('/samples/ch4-instrument.mp3').catch((e) =>
    console.warn('ch2 sample failed to load:', e.message));
  engines[3].load('/samples/ch2-instrument.mp3').catch((e) =>
    console.warn('ch4 sample failed to load:', e.message));

  // 3. Device orientation — iOS gates this behind a permission prompt
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const result = await DeviceOrientationEvent.requestPermission();
      if (result === 'granted') {
        window.addEventListener('deviceorientation', onTilt);
      }
    } catch (e) {
      console.warn('orientation permission denied:', e);
    }
  } else {
    window.addEventListener('deviceorientation', onTilt);
  }

  // 4. Start render loop
  requestAnimationFrame(render);
}

function onTilt(e) {
  // beta: front-back tilt, -180..180 (positive = top tilted away from user)
  // gamma: left-right tilt, -90..90 (positive = right edge down)
  if (e.beta !== null) beta = e.beta;
  if (e.gamma !== null) gamma = e.gamma;
}

// --- Render loop -----------------------------------------------------------

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
let dpr = window.devicePixelRatio || 1;

function resizeCanvas() {
  dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function render(now) {
  // Update master filter from tilt. Map beta (-90..90 useful range) → 200Hz..8000Hz log,
  // gamma (-90..90) → Q 0.5..20.
  const betaClamped = Math.max(-90, Math.min(90, beta));
  const gammaClamped = Math.max(-90, Math.min(90, gamma));
  const betaNorm = (betaClamped + 90) / 180; // 0..1
  const gammaNorm = Math.abs(gammaClamped) / 90; // 0..1 (we use absolute tilt for resonance)
  const targetCutoff = 200 * Math.pow(40, betaNorm); // 200..8000 Hz log
  const targetQ = 0.5 + gammaNorm * 19.5;            // 0.5..20

  // Smooth toward targets so changes don't click.
  smoothedCutoff += (targetCutoff - smoothedCutoff) * 0.08;
  smoothedQ += (targetQ - smoothedQ) * 0.08;

  if (masterFilter) {
    masterFilter.frequency.setTargetAtTime(smoothedCutoff, audioCtx.currentTime, 0.02);
    masterFilter.Q.setTargetAtTime(smoothedQ, audioCtx.currentTime, 0.02);
  }

  // Visual: black background, single centered dot.
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const margin = 30 * dpr;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const maxRadius = Math.min(canvas.width, canvas.height) / 2 - margin;

  // Idle breathing: slow sine in [0.55, 0.7] of maxRadius.
  const breath = 0.625 + 0.075 * Math.sin(now * 0.0015);
  // Pulse on recent note-on: short attack-decay envelope.
  const since = now - lastTriggerTime;
  const pulse = activeNotes > 0 || since < 600
    ? Math.exp(-since / 400) * 0.35
    : 0;
  const radius = maxRadius * Math.min(1, breath + pulse);

  // Brightness also reacts: brighter when active.
  const baseAlpha = 0.55;
  const activeAlpha = Math.min(1, baseAlpha + pulse * 1.5);
  ctx.fillStyle = withAlpha(myColor, activeAlpha);
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  // Subtle outer glow when active.
  if (pulse > 0.05) {
    const grad = ctx.createRadialGradient(cx, cy, radius, cx, cy, radius * 1.6);
    grad.addColorStop(0, withAlpha(myColor, pulse * 0.4));
    grad.addColorStop(1, withAlpha(myColor, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  requestAnimationFrame(render);
}

// Convert "#RRGGBB" to "rgba(r,g,b,a)".
function withAlpha(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}
