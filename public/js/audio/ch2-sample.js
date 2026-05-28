// Channel 2 — general-purpose sampler.
//
// One user-supplied sample, C4 reference pitch. Each note plays the sample
// at a playbackRate computed from (note − C4), through a low-pass filter.
// User controls: volume, low-pass cutoff, and full ADSR.

const REFERENCE_NOTE = 60; // C4

export class Ch2Sample {
  constructor(ctx, destination, settings) {
    this.ctx = ctx;
    this.destination = destination;
    this.s = settings || {};
    this.buffer = null;
    this.voices = new Map();
  }

  updateSettings(s) { this.s = s; }

  async load(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${url} failed: ${res.status}`);
    const arrayBuf = await res.arrayBuffer();
    this.buffer = await this.ctx.decodeAudioData(arrayBuf);
  }

  noteOn(note, velocity) {
    if (!this.buffer) return;
    const t = this.ctx.currentTime;
    const v = Math.min(1, velocity / 127);
    const volume = Math.max(0, Math.min(1, this.s.volume ?? 0.6));
    const peak = volume * v;

    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer;
    source.playbackRate.value = Math.pow(2, (note - REFERENCE_NOTE) / 12);

    // Low-pass filter (replaces the old transpose control).
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = Math.max(80, Math.min(8000, this.s.cutoff ?? 8000));
    filter.Q.value = 1;

    const amp = this.ctx.createGain();
    const a = Math.max(0.001, this.s.attack ?? 0.02);
    const d = Math.max(0.001, this.s.decay ?? 0.2);
    const sustainLevel = Math.max(0, Math.min(1, this.s.sustain ?? 0.7));
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + a);
    amp.gain.linearRampToValueAtTime(peak * sustainLevel, t + a + d);

    source.connect(filter).connect(amp).connect(this.destination);
    source.start(t);

    const existing = this.voices.get(note);
    if (existing) this._release(existing, t);
    this.voices.set(note, { source, amp, stopped: false });

    source.onended = () => {
      try { source.disconnect(); filter.disconnect(); amp.disconnect(); } catch {}
      const cur = this.voices.get(note);
      if (cur && cur.source === source) this.voices.delete(note);
    };
  }

  noteOff(note) {
    const voice = this.voices.get(note);
    if (!voice || voice.stopped) return;
    this._release(voice, this.ctx.currentTime);
    this.voices.delete(note);
  }

  _release(voice, t) {
    voice.stopped = true;
    const r = Math.max(0.005, this.s.release ?? 0.4);
    voice.amp.gain.cancelScheduledValues(t);
    voice.amp.gain.setValueAtTime(voice.amp.gain.value, t);
    voice.amp.gain.linearRampToValueAtTime(0, t + r);
    try { voice.source.stop(t + r + 0.05); } catch {}
  }
}
