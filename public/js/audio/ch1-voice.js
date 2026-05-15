// Channel 1 — synthesized "modular-style" voice.
//
// Two detuned sawtooth oscillators → resonant low-pass with envelope sweep
// → amp envelope → destination. Polyphonic: every noteOn allocates its own
// voice, every noteOff schedules release.

const NOTE_TO_HZ = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class Ch1Voice {
  constructor(ctx, destination) {
    this.ctx = ctx;
    this.destination = destination;
    this.voices = new Map(); // note -> { osc1, osc2, filter, amp, stopped }
  }

  noteOn(note, velocity) {
    const t = this.ctx.currentTime;
    const freq = NOTE_TO_HZ(note);
    const v = Math.min(1, velocity / 127);

    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc2.type = 'sawtooth';
    osc1.frequency.value = freq;
    osc2.frequency.value = freq * 1.005; // ~8 cents detune

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 8;
    // Filter envelope: snap open, decay back down.
    const fStart = Math.min(8000, freq * 12);
    const fEnd = Math.max(freq * 1.5, 200);
    filter.frequency.setValueAtTime(fEnd, t);
    filter.frequency.linearRampToValueAtTime(fStart, t + 0.01);
    filter.frequency.exponentialRampToValueAtTime(fEnd, t + 0.6);

    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(0.18 * v, t + 0.005); // fast attack
    amp.gain.linearRampToValueAtTime(0.12 * v, t + 0.15);  // decay to sustain

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(amp).connect(this.destination);

    osc1.start(t);
    osc2.start(t);

    // If the same note is retriggered, release the old voice first.
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
    const release = 0.35;
    voice.amp.gain.cancelScheduledValues(t);
    voice.amp.gain.setValueAtTime(voice.amp.gain.value, t);
    voice.amp.gain.linearRampToValueAtTime(0, t + release);
    voice.osc1.stop(t + release + 0.05);
    voice.osc2.stop(t + release + 0.05);
  }
}
