// Channel 1 — synthesized voice, parametrized.
//
// Two detuned oscillators (osc type configurable) → static low-pass at the
// user-set cutoff → ADSR amp envelope → destination. Polyphonic.
//
// Envelope phases (per note):
//   attack:  0     -> peak                (over `attack` seconds)
//   decay:   peak  -> peak * sustain      (over `decay`  seconds)
//   sustain: held at peak * sustain       (until note-off)
//   release: current -> 0                 (over `release` seconds, from
//                                          whatever amp value is current
//                                          when note-off fires)

const NOTE_TO_HZ = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class Ch1Voice {
  constructor(ctx, destination, settings) {
    this.ctx = ctx;
    this.destination = destination;
    this.s = settings;       // mutable; updateSettings replaces
    this.voices = new Map(); // note -> voice
  }

  updateSettings(s) { this.s = s; }

  noteOn(note, velocity) {
    const t = this.ctx.currentTime;
    const freq = NOTE_TO_HZ(note);
    const v = Math.min(1, velocity / 127);
    const peak = 0.18 * v;

    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    osc1.type = this.s.osc;
    osc2.type = this.s.osc;
    osc1.frequency.value = freq;
    osc2.frequency.value = freq * 1.005; // ~8 cents detune

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = this.s.cutoff;
    filter.Q.value = 2;

    const amp = this.ctx.createGain();
    const a = Math.max(0.001, this.s.attack);
    const d = Math.max(0.001, this.s.decay);
    const sustainLevel = Math.max(0, Math.min(1, this.s.sustain ?? 0.6));
    // Attack: 0 -> peak. Decay: peak -> peak * sustain. Then sustained
    // (the last scheduled value persists) until _release schedules a ramp
    // to 0. Release captures the *current* amp value at note-off, so a
    // short note that is released mid-decay still ramps smoothly from
    // wherever the decay had reached.
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + a);
    amp.gain.linearRampToValueAtTime(peak * sustainLevel, t + a + d);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(amp).connect(this.destination);

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
