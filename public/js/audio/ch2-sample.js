// Channel 2 — pitched sample.
//
// One user-supplied sample (uploaded via admin), C4 reference. Each note
// plays the sample at the appropriate playbackRate. No synth params — the
// only controls are FX sends (handled at the channel-strip layer).

const REFERENCE_NOTE = 60; // C4

export class Ch2Sample {
  constructor(ctx, destination /*, settings */) {
    this.ctx = ctx;
    this.destination = destination;
    this.buffer = null;
    this.voices = new Map(); // note -> voice
  }

  updateSettings(_s) { /* no synth params for this channel */ }

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

    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer;
    source.playbackRate.value = Math.pow(2, (note - REFERENCE_NOTE) / 12);

    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(0.55 * v, t + 0.02);
    amp.gain.setValueAtTime(0.55 * v, t + 0.02);

    source.connect(amp).connect(this.destination);
    source.start(t);

    const existing = this.voices.get(note);
    if (existing) this._release(existing, t);
    this.voices.set(note, { source, amp, stopped: false });

    source.onended = () => {
      try { source.disconnect(); amp.disconnect(); } catch {}
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
    const release = 0.4;
    voice.amp.gain.cancelScheduledValues(t);
    voice.amp.gain.setValueAtTime(voice.amp.gain.value, t);
    voice.amp.gain.linearRampToValueAtTime(0, t + release);
    try { voice.source.stop(t + release + 0.05); } catch {}
  }
}
