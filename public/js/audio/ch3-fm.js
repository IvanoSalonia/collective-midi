// Channel 3 — 2-operator FM synth (Volca FM-inspired character).
//
// Per voice:
//   modulator (sine, freq = carrierFreq × ratio)
//      → modGain (gain in Hz = modIndex × modFreq, sets peak frequency deviation)
//      → carrier.frequency  (additive AudioParam modulation)
//   carrier (sine) → ADSR amp envelope → destination
//
//   per-voice LFO (sine) → lfoScale (gain = lfoDepth × modFreq)
//      → modGain.gain  (sums with the static base, modulating the index)
//
// We use a per-voice LFO rather than a shared channel-level one because
// the mod amount must be scaled by each voice's own modFreq — a single
// shared LFO signal can't be pre-scaled to work for every note. The cost
// is one extra oscillator per voice, which is fine at typical polyphony.
//
// "Peak Hz deviation = index × modFreq" is the FM convention: modIndex is
// the dimensionless ratio (peak deviation) / (modulator frequency). With
// modIndex = 0 the carrier is a pure sine; higher values add sidebands
// and at large values the signal becomes noisy / metallic.

const NOTE_TO_HZ = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class Ch3FM {
  constructor(ctx, destination, settings) {
    this.ctx = ctx;
    this.destination = destination;
    this.s = settings;
    this.voices = new Map();
  }

  updateSettings(s) { this.s = s; }

  noteOn(note, velocity) {
    const t = this.ctx.currentTime;
    const carrierFreq = NOTE_TO_HZ(note);
    const ratio = Math.max(0.01, this.s.ratio ?? 2);
    const modFreq = carrierFreq * ratio;
    const baseIndex = Math.max(0, this.s.modIndex ?? 3);
    const lfoRate = Math.max(0.01, this.s.lfoRate ?? 3);
    const lfoDepth = Math.max(0, this.s.lfoDepth ?? 0);
    const v = Math.min(1, velocity / 127);
    const peak = 0.22 * v;

    // Carrier — the heard tone.
    const carrier = this.ctx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.value = carrierFreq;

    // Modulator — shapes the carrier by FM.
    const modOsc = this.ctx.createOscillator();
    modOsc.type = 'sine';
    modOsc.frequency.value = modFreq;

    // Mod amount in Hz: peak deviation = modIndex * modFreq.
    const modGain = this.ctx.createGain();
    modGain.gain.value = baseIndex * modFreq;

    // LFO modulating the mod index (additive Hz deviation).
    const lfo = this.ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = lfoRate;
    const lfoScale = this.ctx.createGain();
    lfoScale.gain.value = lfoDepth * modFreq;

    // ADSR amp envelope.
    const amp = this.ctx.createGain();
    const a = Math.max(0.001, this.s.attack ?? 0.005);
    const d = Math.max(0.001, this.s.decay ?? 0.3);
    const sustainLevel = Math.max(0, Math.min(1, this.s.sustain ?? 0.2));
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + a);
    amp.gain.linearRampToValueAtTime(peak * sustainLevel, t + a + d);

    // Wire FM graph.
    modOsc.connect(modGain).connect(carrier.frequency);
    lfo.connect(lfoScale).connect(modGain.gain);
    carrier.connect(amp).connect(this.destination);

    carrier.start(t);
    modOsc.start(t);
    lfo.start(t);

    const existing = this.voices.get(note);
    if (existing) this._release(existing, t);
    this.voices.set(note, { carrier, modOsc, lfo, modGain, lfoScale, amp, stopped: false });
  }

  noteOff(note) {
    const voice = this.voices.get(note);
    if (!voice || voice.stopped) return;
    this._release(voice, this.ctx.currentTime);
    this.voices.delete(note);
  }

  _release(voice, t) {
    voice.stopped = true;
    const r = Math.max(0.005, this.s.release ?? 0.3);
    voice.amp.gain.cancelScheduledValues(t);
    voice.amp.gain.setValueAtTime(voice.amp.gain.value, t);
    voice.amp.gain.linearRampToValueAtTime(0, t + r);
    const stopAt = t + r + 0.05;
    voice.carrier.stop(stopAt);
    voice.modOsc.stop(stopAt);
    voice.lfo.stop(stopAt);
  }
}
