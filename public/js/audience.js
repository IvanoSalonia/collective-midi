// Audience client — runs on each phone.
//
// Visual: a single dot floating on a black canvas. The dot is a small physics
// object — accelerometer impulses push it, then it drifts and bounces off the
// edges with heavy damping. Its position controls the master low-pass filter
// (X = cutoff, Y = resonance), so each phone shapes its sound by being moved.
// Brightness tracks note state: spikes on note-on, holds while a note is held,
// fades on note-off.

import { createAudioStack } from '/js/audio/audio-stack.js';

const socket = io();

// --- Settings / connection state -----------------------------------------

let audioCtx = null;
let stack = null;
let pendingSettings = null;
let appliedSamples = { ch2: null, ch4: null };
let myGroup = null;
let myColor = '#ffffff';

// Note state — how many notes are currently held for this phone's group.
let activeNotes = 0;

// --- Physics dot ---------------------------------------------------------
// Impulse accumulator: motion events between frames sum into here, then the
// render loop applies them as one impulse and clears. Avoids both
// per-frame integration drift and event-rate dependence.
const pendingImpulse = { x: 0, y: 0 };

const dot = { x: 0, y: 0, vx: 0, vy: 0, initialized: false };

// Tunables. Calibrated against typical iPhone DeviceMotion readings
// (~30Hz event rate; flick ≈ 5-30 m/s², still phone ≈ 0.05-0.15 m/s²).
const PHYSICS = {
  noiseFloor: 0.25,   // m/s² — readings below this are treated as zero
  impulseScale: 0.45, // px-of-velocity per (m/s² · dpr)
  damping: 0.985,     // velocity multiplier per frame (~60fps)
  bounce: 0.6,        // velocity retained on edge bounce
  margin: 30          // px from each edge (matches original spec)
};

const FILTER = {
  cutoffMin: 200, cutoffMax: 8000,  // Hz, log-mapped
  qMin: 0.5, qMax: 10,              // resonance, linear
  smoothing: 0.05                    // smoothing factor per frame for filter param
};

const BRIGHTNESS = {
  base: 0.35,           // alpha when no notes have ever played
  attack: 0.35,         // smoothing when activeNotes > 0
  release: 0.06         // smoothing when activeNotes == 0 (slow fade)
};

let smoothedCutoff = 1500;
let smoothedQ = 1;
let visualBrightness = 0;

// --- Socket wiring -------------------------------------------------------

socket.on('connect', () => socket.emit('hello', { role: 'audience' }));

socket.on('assigned', ({ group, color, settings }) => {
  myGroup = group;
  myColor = color;
  document.documentElement.style.setProperty('--group-color', color);
  pendingSettings = settings;
  const sub = document.getElementById('start-sub');
  if (sub) sub.textContent = `Group ${group + 1}`;
});

socket.on('settings', (settings) => {
  if (!stack) { pendingSettings = settings; return; }
  applyIncomingSettings(settings);
});

socket.on('note-on', ({ channel, note, velocity }) => {
  if (!stack) return;
  stack.noteOn(channel, note, velocity ?? 100);
  activeNotes++;
});

socket.on('note-off', ({ channel, note }) => {
  if (!stack) return;
  stack.noteOff(channel, note);
  activeNotes = Math.max(0, activeNotes - 1);
});

function applyIncomingSettings(settings) {
  stack.applySettings(settings);
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

// --- Start tap (unlock audio + ask for motion permission) ----------------

const overlay = document.getElementById('start-overlay');
overlay.addEventListener('click', async () => {
  await startEverything();
  overlay.classList.add('hidden');
}, { once: true });

async function startEverything() {
  // Try to enter fullscreen. Works on Android Chrome, iPad, and desktop.
  // iPhone Safari doesn't support requestFullscreen on arbitrary elements
  // and will throw — caught and ignored. (For iPhone the path is "Add to
  // Home Screen", which uses the manifest + apple-mobile-web-app-capable
  // meta tag to open standalone.)
  try {
    const root = document.documentElement;
    if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' });
    else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen();
  } catch { /* iPhone Safari, user denied, etc. */ }

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  const settings = pendingSettings || await waitForSettings();

  stack = createAudioStack(audioCtx, settings);
  appliedSamples.ch2 = settings.samples.ch2;
  appliedSamples.ch4 = settings.samples.ch4;

  // iOS 13+ requires explicit permission for DeviceMotion (and gates the
  // sensor entirely without it). Non-iOS browsers just attach.
  if (typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function') {
    try {
      const result = await DeviceMotionEvent.requestPermission();
      if (result === 'granted') window.addEventListener('devicemotion', onMotion);
    } catch (e) {
      console.warn('motion permission denied:', e);
    }
  } else {
    window.addEventListener('devicemotion', onMotion);
  }

  // Keep the screen awake during the performance. Requires HTTPS, which
  // Railway provides. Supported on iOS 16.4+ and Chrome on Android.
  // The OS releases the lock when the tab goes to background — we re-request
  // it on visibilitychange below.
  await requestWakeLock();

  maybeShowAddToHomeScreenPrompt();

  requestAnimationFrame(render);
}

// iPhone Safari can't be put into fullscreen via JS — the only way to hide
// browser chrome there is for the user to "Add to Home Screen" and open
// from the icon (which uses the standalone meta tags + manifest). Show a
// small dismissible prompt only on iPhone Safari, only when not already
// running standalone, and remember dismissal so we don't nag.
function maybeShowAddToHomeScreenPrompt() {
  const isIPhone = /iPhone|iPod/.test(navigator.userAgent);
  const isStandalone =
    window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
  let dismissed = false;
  try { dismissed = localStorage.getItem('a2hs-dismissed') === '1'; } catch {}
  if (!isIPhone || isStandalone || dismissed) return;

  const prompt = document.getElementById('a2hs-prompt');
  if (!prompt) return;
  prompt.classList.remove('hidden');
  prompt.querySelector('.a2hs-dismiss')?.addEventListener('click', () => {
    prompt.classList.add('hidden');
    try { localStorage.setItem('a2hs-dismissed', '1'); } catch {}
  }, { once: true });
}

let wakeLock = null;

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (e) {
    console.warn('wake lock failed:', e.message);
  }
}

document.addEventListener('visibilitychange', () => {
  // Stack only exists after the tap-to-join, so this is a no-op until the
  // user has actually engaged with the page.
  if (document.visibilityState === 'visible' && !wakeLock && stack) {
    requestWakeLock();
  }
});

function waitForSettings() {
  return new Promise((resolve) => {
    const check = () => {
      if (pendingSettings) resolve(pendingSettings);
      else setTimeout(check, 50);
    };
    check();
  });
}

// Accumulate motion impulses between frames. `acceleration` excludes gravity,
// so a still phone reads ~0 (modulo small sensor noise filtered below).
function onMotion(e) {
  const a = e.acceleration;
  if (!a) return;
  const ax = (a.x != null && Math.abs(a.x) > PHYSICS.noiseFloor) ? a.x : 0;
  const ay = (a.y != null && Math.abs(a.y) > PHYSICS.noiseFloor) ? a.y : 0;
  pendingImpulse.x += ax;
  pendingImpulse.y += ay;
}

// --- Render loop ---------------------------------------------------------

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

function render() {
  const W = canvas.width;
  const H = canvas.height;
  const margin = PHYSICS.margin * dpr;

  if (!dot.initialized) {
    dot.x = W / 2;
    dot.y = H / 2;
    dot.initialized = true;
  }

  // 1. Apply pending impulse from motion events. Y is flipped because canvas
  //    Y grows downward but phone "up" is positive accel.y.
  dot.vx += pendingImpulse.x * PHYSICS.impulseScale * dpr;
  dot.vy += -pendingImpulse.y * PHYSICS.impulseScale * dpr;
  pendingImpulse.x = 0;
  pendingImpulse.y = 0;

  // 2. Damping (high viscosity).
  dot.vx *= PHYSICS.damping;
  dot.vy *= PHYSICS.damping;

  // 3. Integrate position.
  dot.x += dot.vx;
  dot.y += dot.vy;

  // 4. Bounce off edges.
  if (dot.x < margin)        { dot.x = margin;        dot.vx = -dot.vx * PHYSICS.bounce; }
  if (dot.x > W - margin)    { dot.x = W - margin;    dot.vx = -dot.vx * PHYSICS.bounce; }
  if (dot.y < margin)        { dot.y = margin;        dot.vy = -dot.vy * PHYSICS.bounce; }
  if (dot.y > H - margin)    { dot.y = H - margin;    dot.vy = -dot.vy * PHYSICS.bounce; }

  // 5. Map dot position → filter params (slow / smoothed).
  const usableW = Math.max(1, W - 2 * margin);
  const usableH = Math.max(1, H - 2 * margin);
  const xNorm = (dot.x - margin) / usableW; // 0..1
  const yNorm = (dot.y - margin) / usableH; // 0..1
  const targetCutoff = FILTER.cutoffMin * Math.pow(FILTER.cutoffMax / FILTER.cutoffMin, xNorm);
  const targetQ = FILTER.qMin + (1 - yNorm) * (FILTER.qMax - FILTER.qMin); // top of screen = high Q
  smoothedCutoff += (targetCutoff - smoothedCutoff) * FILTER.smoothing;
  smoothedQ += (targetQ - smoothedQ) * FILTER.smoothing;
  if (stack) {
    stack.masterFilter.frequency.setTargetAtTime(smoothedCutoff, audioCtx.currentTime, 0.05);
    stack.masterFilter.Q.setTargetAtTime(smoothedQ, audioCtx.currentTime, 0.05);
  }

  // 6. Brightness envelope — fast attack while notes are held, slow release.
  const target = activeNotes > 0 ? 1 : 0;
  const k = activeNotes > 0 ? BRIGHTNESS.attack : BRIGHTNESS.release;
  visualBrightness += (target - visualBrightness) * k;

  // 7. Draw.
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  const radius = Math.min(W, H) * 0.1;
  const alpha = BRIGHTNESS.base + visualBrightness * (1 - BRIGHTNESS.base);

  // Glow underneath, brightest when active.
  if (visualBrightness > 0.05) {
    const glow = ctx.createRadialGradient(dot.x, dot.y, radius, dot.x, dot.y, radius * 2.2);
    glow.addColorStop(0, withAlpha(myColor, visualBrightness * 0.45));
    glow.addColorStop(1, withAlpha(myColor, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, radius * 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = withAlpha(myColor, alpha);
  ctx.beginPath();
  ctx.arc(dot.x, dot.y, radius, 0, Math.PI * 2);
  ctx.fill();

  requestAnimationFrame(render);
}

function withAlpha(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}
