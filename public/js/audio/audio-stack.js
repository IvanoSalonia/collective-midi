// Builds the full per-client audio graph: 4 engines → 4 channel strips →
// (dry + reverb bus + delay bus) → master low-pass → master gain → output.
//
// Each channel's settings has three orientation states (A/B/C). The stack
// exposes two ways to drive engines from those states:
//
//   setOrientation({ A, B, C })
//     — for the audience client. Computes a single interpolated state per
//       channel by linearly blending A/B/C by the supplied weights (which
//       should sum to 1). All channels share the same weights.
//
//   setChannelState(channel, stateKey)
//     — for the conductor's rehearsal mode. Each channel is pinned to one
//       of its three states (whatever the conductor's A/B/C tab is showing
//       for that channel).
//
// Color blending uses the same weights but is handled separately (the
// audience reads getInterpolatedColor() for its visual fill).

import { Ch1Voice } from '/js/audio/ch1-voice.js';
import { Ch2Sample } from '/js/audio/ch2-sample.js';
import { Ch3FM } from '/js/audio/ch3-fm.js';
import { Ch4Slicer } from '/js/audio/ch4-slicer.js';
import { FXBus, ChannelStrip } from '/js/audio/fx-bus.js';

// --- Blending helpers -----------------------------------------------------

// Linear blend of numeric channel-state fields. Non-numeric keys (osc type,
// booleans like `loop`) snap to the dominant state — interpolating "sine"
// halfway to "square" doesn't make sense, and a half-true boolean either.
// Color is a string but gets its own component-wise blend.
function blendStates(a, b, c, weights) {
  const out = {};
  const dominant = pickDominant(a, b, c, weights);
  const keys = new Set([
    ...Object.keys(a || {}),
    ...Object.keys(b || {}),
    ...Object.keys(c || {})
  ]);
  for (const k of keys) {
    if (k === 'color') {
      out.color = blendColor(a?.color, b?.color, c?.color, weights);
      continue;
    }
    const va = a?.[k];
    const vb = b?.[k];
    const vc = c?.[k];
    if (typeof va === 'number' || typeof vb === 'number' || typeof vc === 'number') {
      out[k] = (va || 0) * weights.A + (vb || 0) * weights.B + (vc || 0) * weights.C;
    } else {
      out[k] = dominant[k];
    }
  }
  return out;
}

function pickDominant(a, b, c, weights) {
  if (weights.A >= weights.B && weights.A >= weights.C) return a || {};
  if (weights.B >= weights.C) return b || {};
  return c || {};
}

function blendColor(a, b, c, weights) {
  // Each color is "#RRGGBB". Convert to RGB ints, blend, recombine.
  const pa = hexToRgb(a || '#000000');
  const pb = hexToRgb(b || '#000000');
  const pc = hexToRgb(c || '#000000');
  const r = Math.round(pa.r * weights.A + pb.r * weights.B + pc.r * weights.C);
  const g = Math.round(pa.g * weights.A + pb.g * weights.B + pc.g * weights.C);
  const bl = Math.round(pa.b * weights.A + pb.b * weights.B + pc.b * weights.C);
  return `rgb(${clamp8(r)}, ${clamp8(g)}, ${clamp8(bl)})`;
}
function hexToRgb(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16)
  };
}
function clamp8(v) { return Math.max(0, Math.min(255, v)); }

// --- Stack ----------------------------------------------------------------

export function createAudioStack(ctx, initialSettings) {
  let settings = initialSettings;

  // Master chain: low-pass (kept open by default — the original tilt-driven
  // master filter is gone now that color/sound interpolation is the
  // per-phone shaping; the node is still here in case we want to bring it
  // back) → gain → destination.
  const masterFilter = ctx.createBiquadFilter();
  masterFilter.type = 'lowpass';
  masterFilter.frequency.value = 20000;
  masterFilter.Q.value = 1;

  const masterGain = ctx.createGain();
  masterGain.gain.value = 0.7;

  masterFilter.connect(masterGain).connect(ctx.destination);

  const fxBus = new FXBus(ctx, masterFilter);

  const strips = [];
  const engines = [];
  for (let i = 0; i < 4; i++) {
    const strip = new ChannelStrip(ctx, masterFilter, fxBus.reverbInput, fxBus.delayInput);
    strips.push(strip);
  }
  // Engines get the state-A defaults to start; setOrientation / setChannelState
  // will overwrite shortly after construction.
  engines.push(new Ch1Voice(ctx,  strips[0].input, settings.channels[0].A));
  engines.push(new Ch2Sample(ctx, strips[1].input, settings.channels[1].A));
  engines.push(new Ch3FM(ctx,     strips[2].input, settings.channels[2].A));
  engines.push(new Ch4Slicer(ctx, strips[3].input, settings.channels[3].A));

  // Apply global FX params on construction (these don't depend on orientation).
  applyFxParams(settings);

  // Load samples (fire and forget; missing files just mute that channel).
  engines[1].load(settings.samples.ch2).catch((e) =>
    console.warn('ch2 sample failed to load:', e.message));
  engines[3].load(settings.samples.ch4).catch((e) =>
    console.warn('ch4 sample failed to load:', e.message));

  function applyFxParams(s) {
    fxBus.setBpm(s.bpm);
    fxBus.setDelayStep(s.delay.step);
    fxBus.setDelayFeedback(s.delay.feedback);
    fxBus.setReverbWet(s.reverb.wet);
  }

  // Pass a fully-formed state to one channel's strip + engine.
  function applyChannelState(channelIdx, state) {
    if (!state) return;
    if (typeof state.reverbSend === 'number') strips[channelIdx].setReverbSend(state.reverbSend);
    if (typeof state.delaySend  === 'number') strips[channelIdx].setDelaySend(state.delaySend);
    engines[channelIdx].updateSettings(state);
  }

  // Audience entry point: blend A/B/C for every channel and apply.
  function setOrientation(weights) {
    const w = normalizeWeights(weights);
    for (let i = 0; i < 4; i++) {
      const ch = settings.channels[i];
      const blended = blendStates(ch.A, ch.B, ch.C, w);
      applyChannelState(i, blended);
    }
  }

  // Conductor rehearsal entry point: pin one channel to a specific state.
  function setChannelState(channelIdx, stateKey) {
    const ch = settings.channels[channelIdx];
    if (!ch) return;
    const state = ch[stateKey] || ch.A;
    applyChannelState(channelIdx, state);
  }

  // Replace the full settings (called on every server broadcast). Re-applies
  // FX params and re-applies the last-known orientation (caller is expected
  // to call setOrientation/setChannelState after this).
  function applySettings(newSettings) {
    settings = newSettings;
    applyFxParams(settings);
  }

  async function reloadSample(channel, url) {
    if (channel === 1) await engines[1].load(url);
    else if (channel === 3) await engines[3].load(url);
  }

  function noteOn(channel, note, velocity) {
    const e = engines[channel];
    if (e) e.noteOn(note, velocity);
  }
  function noteOff(channel, note) {
    const e = engines[channel];
    if (e) e.noteOff(note);
  }

  // Returns the interpolated color string for the given channel under the
  // current orientation weights. Used by the audience to drive the
  // full-screen fill on note-on.
  function getInterpolatedColor(channelIdx, weights) {
    const w = normalizeWeights(weights);
    const ch = settings.channels[channelIdx];
    return blendColor(ch.A.color, ch.B.color, ch.C.color, w);
  }

  return {
    masterFilter,
    masterGain,
    applySettings,
    applyChannelState,
    setOrientation,
    setChannelState,
    reloadSample,
    noteOn,
    noteOff,
    getInterpolatedColor
  };
}

// Ensure weights sum to 1; default to all-A if zero/negative.
function normalizeWeights(w) {
  const a = Math.max(0, w?.A ?? 0);
  const b = Math.max(0, w?.B ?? 0);
  const c = Math.max(0, w?.C ?? 0);
  const sum = a + b + c;
  if (sum <= 0) return { A: 1, B: 0, C: 0 };
  return { A: a / sum, B: b / sum, C: c / sum };
}
