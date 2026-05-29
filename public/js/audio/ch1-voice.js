// Channel 1 — synthesized voice, parametrized.
//
// Per voice: two oscillators (osc type configurable) detuned in cents →
// static low-pass at user cutoff → ADSR amp envelope → channel-level
// tremolo gain → destination.
//
// The tremolo is *not* per-voice. A single LFO + ConstantSource pair
// modulates one channel-level gain node so all voices share the same
// modulation phase. Web Audio sums multiple AudioParam inputs:
//   tremGain.gain = bias.offset + (lfo.sin * lfoDepthScale.gain)
// We pick bias = 1 − depth/2 and lfoScale = depth/2, so the gain swings
// in [1 − depth, 1]. depth=0 leaves it at 1 (no modulation).
//
// Envelope: Attack 0→peak, Decay peak→peak·sustain, Sustain held, Release
// from current value to 0 (captures whatever the amp is at on note-off
// so short notes don't click).

const NOTE_TO_HZ = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class Ch1Voice {
  constructor(ctx, destination, settings) {
    this.ctx = ctx;
    this.destination = destination;
    this.s = settings;

    // Channel-level tremolo chain: voices → tremGain → destination.
    this.tremGain = ctx.createGain();
    this.tremGain.gain.value = 1;
    this.tremGain.connect(destination);

    this.lfoBias = ctx.createConstantSource();
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'sine';
    this.lfoDepthScale = ctx.createGain();
    this.lfoBias.connect(this.tremGain.gain);
    this.lfo.connect(this.lfoDepthScale).connect(this.tremGain.gain);
    this.lfoBias.start();
    this.lfo.start();

    this._applyLfoParams();

    this.voices = new Map();
  }

  _applyLfoParams() {
    const rate = Math.max(0.01, this.s.lfoRate ?? 5);
    const depth = Math.max(0, Math.min(1, this.s.lfoDepth ?? 0));
    const t = this.ctx.currentTime;
    this.lfo.frequency.setTargetAtTime(rate, t, 0.05);
    this.lfoDepthScale.gain.setTargetAtTime(depth * 0.5, t, 0.05);
    this.lfoBias.offset.setTargetAtTime(1 - depth * 0.5, t, 0.05);
  }

  updateSettings(s) {
    this.s = s;
    this._applyLfoParams();
  }

  noteOn(note, velocity) {
    const t = this.ctx.currentTime;
    const freq = NOTE_TO_HZ(note);
    const v = Math.min(1, velocity / 127);
    const volume = Math.max(0, Math.min(1, this.s.volume ?? 1));
    const peak = volume * 0.18 * v;

    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    osc1.type = this.s.osc;
    osc2.type = this.s.osc;
    osc1.frequency.value = freq;
    osc2.frequency.value = freq;
    osc2.detune.value = this.s.detune ?? 8;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = this.s.cutoff;
    filter.Q.value = 2;

    const amp = this.ctx.createGain();
    const a = Math.max(0.001, this.s.attack);
    const d = Math.max(0.001, this.s.decay);
    const sustainLevel = Math.max(0, Math.min(1, this.s.sustain ?? 0.6));
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + a);
    amp.gain.linearRampToValueAtTime(peak * sustainLevel, t + a + d);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(amp).connect(this.tremGain);

    osc1.start(t);
    osc2.start(t);

    const existing = this.voices.get(note);
    if (existing) this._release(existing, t);
    this.voices.set(note, { osc1, osc2, filter, amp, stopped: false });
  }

  noteOff(note) {
    const voice = this.voices.get(note);
    if (!voice || voice.stopped) return;
    this._release(voice, this.ctx.currentTime);
    this.voices.delete(note);
  }

  _release(voice, t) {
    voice.stopped = true;
    const r = Math.max(0.005, this.s.release);
    voice.amp.gain.cancelScheduledValues(t);
    voice.amp.gain.setValueAtTime(voice.amp.gain.value, t);
    voice.amp.gain.linearRampToValueAtTime(0, t + r);
    voice.osc1.stop(t + r + 0.05);
    voice.osc2.stop(t + r + 0.05);
  }
}
