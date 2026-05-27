// Builds the full per-client audio graph: 4 engines → 4 channel strips →
// (dry + reverb bus + delay bus) → master low-pass → master gain → output.
//
// Single entry point used both by the audience client (one stack per phone)
// and by the conductor in rehearsal mode (one stack on the laptop).

import { Ch1Voice } from '/js/audio/ch1-voice.js';
import { Ch2Sample } from '/js/audio/ch2-sample.js';
import { Ch3FM } from '/js/audio/ch3-fm.js';
import { Ch4Slicer } from '/js/audio/ch4-slicer.js';
import { FXBus, ChannelStrip } from '/js/audio/fx-bus.js';

export function createAudioStack(ctx, settings) {
  // Master chain: low-pass (driven by tilt on phones, untouched on conductor)
  // -> gain -> destination.
  const masterFilter = ctx.createBiquadFilter();
  masterFilter.type = 'lowpass';
  masterFilter.frequency.value = 8000; // wide open by default
  masterFilter.Q.value = 1;

  const masterGain = ctx.createGain();
  masterGain.gain.value = 0.7;

  masterFilter.connect(masterGain).connect(ctx.destination);

  // FX bus outputs into masterFilter (so wet signal also gets the tilt
  // filter — intentional: each phone shapes the whole sound it produces).
  const fxBus = new FXBus(ctx, masterFilter);

  // Per-channel strips: dry → masterFilter, reverb send → fxBus.reverbInput,
  // delay send → fxBus.delayInput.
  const strips = [];
  const engines = [];
  for (let i = 0; i < 4; i++) {
    const strip = new ChannelStrip(ctx, masterFilter, fxBus.reverbInput, fxBus.delayInput);
    strips.push(strip);
  }
  engines.push(new Ch1Voice(ctx, strips[0].input, settings.channels[0]));
  engines.push(new Ch2Sample(ctx, strips[1].input));
  engines.push(new Ch3FM(ctx, strips[2].input, settings.channels[2]));
  engines.push(new Ch4Slicer(ctx, strips[3].input));

  // Apply initial settings (sends, FX params).
  applySettings(settings);

  // Load samples (fire and forget; missing files just mute that channel).
  engines[1].load(settings.samples.ch2).catch((e) =>
    console.warn('ch2 sample failed to load:', e.message));
  engines[3].load(settings.samples.ch4).catch((e) =>
    console.warn('ch4 sample failed to load:', e.message));

  function applySettings(s) {
    settings = s;
    fxBus.setBpm(s.bpm);
    fxBus.setDelayStep(s.delay.step);
    fxBus.setDelayFeedback(s.delay.feedback);
    fxBus.setReverbWet(s.reverb.wet);
    for (let i = 0; i < 4; i++) {
      const c = s.channels[i];
      strips[i].setReverbSend(c.reverbSend);
      strips[i].setDelaySend(c.delaySend);
      engines[i].updateSettings(c);
    }
  }

  // Reload a single channel's sample (called when admin uploads a new file).
  async function reloadSample(channel, url) {
    if (channel === 1) await engines[1].load(url);
    else if (channel === 3) await engines[3].load(url);
  }

  // Trigger a note on a specific MIDI channel.
  function noteOn(channel, note, velocity) {
    const e = engines[channel];
    if (e) e.noteOn(note, velocity);
  }
  function noteOff(channel, note) {
    const e = engines[channel];
    if (e) e.noteOff(note);
  }

  return {
    masterFilter,
    masterGain,
    applySettings,
    reloadSample,
    noteOn,
    noteOff
  };
}
