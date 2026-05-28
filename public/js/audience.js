// Audience client — runs on each phone.
//
// Visual: a single full-screen colored div on top of a black body. When a
// note is held for this phone's channel, the div is opaque and shows the
// current interpolated color. When the last note releases, the div fades
// to invisible over 0.2s, revealing black.
//
// Audio + color reactivity: each channel has THREE orientation states
// (A/B/C) of sound design + color. The device's DeviceOrientationEvent
// gamma (left/right tilt) drives an A/B/C weight vector via an explicit
// breakpoint table (see ORIENTATION_BREAKPOINTS); both the audio engine
// settings and the fill color blend smoothly as the phone tilts.
//
//   gamma 55..90  → pure A (portrait)
//   gamma 55→35   → A crossfades to B
//   gamma -55→-35 → A crossfades to C
//
// The raw gamma is low-passed (GAMMA_LERP) to remove sensor jitter.

import { createAudioStack } from '/js/audio/audio-stack.js';

const socket = io();

// --- State ---------------------------------------------------------------

let audioCtx = null;
let stack = null;
let pendingSettings = null;
let appliedSamples = { ch2: null, ch4: null };
let myGroup = null;  // 0..3
let activeNotes = 0;

// Orientation weights (sum to 1). Default to A.
let weights = { A: 1, B: 0, C: 0 };

let rawGamma = 90;       // latest DeviceOrientation gamma (default to portrait/A)
let smoothedGamma = 90;  // low-pass smoothed for stable interpolation

// Low-pass factor for the gamma input — each frame moves this fraction toward
// the raw reading. Lower = smoother but laggier. 0.1 kills sensor jitter
// without feeling sluggish.
const GAMMA_LERP = 0.1;

// Explicit angle → orientation-weight breakpoints (left/right tilt via gamma).
// Per the spec:
//   A (portrait) ≈ 90°, pure A across 55..90
//   A→B crossfade between 55° (A) and 35° (B)
//   A→C crossfade between -55° (A) and -35° (C)
// Weights interpolate linearly between adjacent breakpoints. The middle band
// (-35..35) is a B↔C crossfade (not separately specified; this is the
// continuous fill between "full B at 35" and "full C at -35"). Tweak the
// numbers here to retune.
const ORIENTATION_BREAKPOINTS = [
  { g:  90, A: 1, B: 0, C: 0 },
  { g:  55, A: 1, B: 0, C: 0 },
  { g:  35, A: 0, B: 1, C: 0 },
  { g: -35, A: 0, B: 0, C: 1 },
  { g: -55, A: 1, B: 0, C: 0 },
  { g: -90, A: 1, B: 0, C: 0 }
];

function weightsFromGamma(g) {
  const bp = ORIENTATION_BREAKPOINTS;
  if (g >= bp[0].g) return { A: bp[0].A, B: bp[0].B, C: bp[0].C };
  const last = bp[bp.length - 1];
  if (g <= last.g) return { A: last.A, B: last.B, C: last.C };
  for (let i = 0; i < bp.length - 1; i++) {
    const hi = bp[i], lo = bp[i + 1];
    if (g <= hi.g && g >= lo.g) {
      const t = (hi.g - g) / (hi.g - lo.g); // 0 at hi, 1 at lo
      return {
        A: hi.A + (lo.A - hi.A) * t,
        B: hi.B + (lo.B - hi.B) * t,
        C: hi.C + (lo.C - hi.C) * t
      };
    }
  }
  return { A: 1, B: 0, C: 0 };
}

// Shake-to-mute state. Audio is muted locally (master gain ramped to 0);
// previousMasterGain holds the value we restore on tap. The overlay button
// is the only way to unmute — shaking again does nothing while muted.
let muted = false;
let previousMasterGain = 0.7;

const fillEl = document.getElementById('color-fill');
const muteOverlayEl = document.getElementById('mute-overlay');
const muteReactivateEl = document.getElementById('mute-reactivate');
const groupBadgeEl = document.getElementById('group-badge');
const gammaReadoutEl = document.getElementById('gamma-readout');

// --- Socket wiring -------------------------------------------------------

socket.on('connect', () => socket.emit('hello', { role: 'audience' }));

socket.on('assigned', ({ group, color, settings }) => {
  myGroup = group;
  pendingSettings = settings;
  document.documentElement.style.setProperty('--group-color', color);
  const sub = document.getElementById('start-sub');
  if (sub) sub.textContent = `Group ${group + 1}`;
  if (groupBadgeEl) groupBadgeEl.textContent = `Group ${group + 1}`;
});

socket.on('settings', (settings) => {
  if (!stack) { pendingSettings = settings; return; }
  applyIncomingSettings(settings);
});

socket.on('note-on', ({ channel, note, velocity }) => {
  if (!stack) return;
  stack.noteOn(channel, note, velocity ?? 100);
  activeNotes++;
  // Snap fill to current interpolated color and reveal.
  if (myGroup !== null) {
    fillEl.style.backgroundColor = stack.getInterpolatedColor(myGroup, weights);
  }
  fillEl.classList.add('lit');
});

socket.on('note-off', ({ channel, note }) => {
  if (!stack) return;
  stack.noteOff(channel, note);
  activeNotes = Math.max(0, activeNotes - 1);
  if (activeNotes === 0) {
    fillEl.classList.remove('lit'); // CSS transitions opacity to 0 over 0.2s
  }
});

function applyIncomingSettings(settings) {
  stack.applySettings(settings);
  // Re-apply orientation so engines pick up the new per-state values.
  stack.setOrientation(weights);
  if (settings.samples.ch2 !== appliedSamples.ch2) {
    stack.reloadSample(1, settings.samples.ch2).catch((e) =>
      console.warn('ch2 reload failed:', e.message));
    appliedSamples.ch2 = settings.samples.ch2;
  }
  if (settings.samples.ch4 !== appliedSamples.ch4) {
    stack.reloadSample(3, settings.samples.ch4).catch((e) =>
      console.warn('ch4 reload failed:', e.message));
    appliedSamples.ch4 = settings.samples.ch4;
  }
}

// --- Start tap: unlock audio, request permissions, go fullscreen --------

const overlay = document.getElementById('start-overlay');
overlay.addEventListener('click', async () => {
  await startEverything();
  overlay.classList.add('hidden');
}, { once: true });

async function startEverything() {
  // CRITICAL: request sensor permission FIRST, before any other await.
  // iOS only honors DeviceOrientation/DeviceMotion requestPermission() while
  // the tap's transient activation is live. Awaiting fullscreen / audio /
  // settings beforehand spends that activation, so requestPermission() then
  // rejects with no prompt and the listeners never attach — which is exactly
  // what froze gamma at its default. Doing it first keeps the gesture valid.
  await requestSensorPermissions();

  // Fullscreen — works on Android/iPad/desktop. iPhone Safari throws (no
  // fullscreen API for arbitrary pages), caught and ignored.
  try {
    const root = document.documentElement;
    if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' });
    else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen();
  } catch { /* iPhone Safari etc. */ }

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') await audioCtx.resume();

  const settings = pendingSettings || await waitForSettings();
  stack = createAudioStack(audioCtx, settings);
  appliedSamples.ch2 = settings.samples.ch2;
  appliedSamples.ch4 = settings.samples.ch4;
  stack.setOrientation(weights);

  muteReactivateEl?.addEventListener('click', reactivate);

  await requestWakeLock();
  maybeShowAddToHomeScreenPrompt();
  requestAnimationFrame(render);
}

// Orientation drives the A/B/C color/sound interpolation; motion drives
// shake-to-mute. On iOS 13+ both are gated behind requestPermission(), which
// must run inside the tap gesture — hence this is the first thing called.
async function requestSensorPermissions() {
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r === 'granted') window.addEventListener('deviceorientation', onOrientation);
    } catch (e) { console.warn('orientation permission:', e); }
  } else {
    window.addEventListener('deviceorientation', onOrientation);
  }

  if (typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function') {
    try {
      const r = await DeviceMotionEvent.requestPermission();
      if (r === 'granted') window.addEventListener('devicemotion', onMotion);
    } catch (e) { console.warn('motion permission:', e); }
  } else {
    window.addEventListener('devicemotion', onMotion);
  }
}

function waitForSettings() {
  return new Promise((resolve) => {
    const check = () => {
      if (pendingSettings) resolve(pendingSettings);
      else setTimeout(check, 50);
    };
    check();
  });
}

function onOrientation(e) {
  if (e.gamma !== null && e.gamma !== undefined) rawGamma = e.gamma;
}

// --- Shake-to-mute ------------------------------------------------------

// m/s² magnitude of `acceleration` (excludes gravity) that counts as a shake.
// A still phone reads ≈ 0; light handling reads 1–5; a flick 5–15; a
// deliberate shake exceeds 20.
const SHAKE_THRESHOLD = 22;

function onMotion(e) {
  if (muted) return; // already muted — ignore further shakes
  const a = e.acceleration; // gravity-excluded
  if (!a) return;
  const mag = Math.sqrt((a.x || 0) ** 2 + (a.y || 0) ** 2 + (a.z || 0) ** 2);
  if (mag > SHAKE_THRESHOLD) mute();
}

function mute() {
  if (muted || !stack) return;
  muted = true;
  // Save the master gain we'll restore on reactivate, then ramp to 0 fast
  // enough to feel instant but slow enough to avoid a click.
  previousMasterGain = stack.masterGain.gain.value;
  stack.masterGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.005);
  muteOverlayEl?.classList.remove('hidden');
}

function reactivate() {
  if (!muted || !stack) return;
  muted = false;
  stack.masterGain.gain.setTargetAtTime(previousMasterGain, audioCtx.currentTime, 0.01);
  muteOverlayEl?.classList.add('hidden');
}

// --- Wake Lock (carry over) ---------------------------------------------

let wakeLock = null;
async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (e) { console.warn('wake lock failed:', e.message); }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !wakeLock && stack) requestWakeLock();
});

// --- iPhone Safari A2HS hint --------------------------------------------

function maybeShowAddToHomeScreenPrompt() {
  const ua = navigator.userAgent;
  const isIPhone = /iPhone|iPod/.test(ua);
  const isThirdPartyIOSBrowser = /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  const isStandalone =
    window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
  let dismissed = false;
  try { dismissed = localStorage.getItem('a2hs-dismissed') === '1'; } catch {}
  if (!isIPhone || isThirdPartyIOSBrowser || isStandalone || dismissed) return;

  const prompt = document.getElementById('a2hs-prompt');
  if (!prompt) return;
  prompt.classList.remove('hidden');
  prompt.querySelector('.a2hs-dismiss')?.addEventListener('click', () => {
    prompt.classList.add('hidden');
    try { localStorage.setItem('a2hs-dismissed', '1'); } catch {}
  }, { once: true });
}

// --- Render loop --------------------------------------------------------

function render() {
  // Low-pass the raw gamma, then map through the explicit breakpoint table.
  smoothedGamma += (rawGamma - smoothedGamma) * GAMMA_LERP;
  weights = weightsFromGamma(smoothedGamma);

  if (stack) {
    stack.setOrientation(weights);
    // Update fill color live while notes are held so the audience sees the
    // crossfade in real time as they tilt the phone.
    if (activeNotes > 0 && myGroup !== null) {
      fillEl.style.backgroundColor = stack.getInterpolatedColor(myGroup, weights);
    }
  }

  // Calibration readout: live gamma + dominant orientation state.
  if (gammaReadoutEl) {
    const dom = weights.A >= weights.B && weights.A >= weights.C
      ? 'A' : (weights.B >= weights.C ? 'B' : 'C');
    gammaReadoutEl.textContent = `γ ${Math.round(smoothedGamma)}° · ${dom}`;
  }

  requestAnimationFrame(render);
}
