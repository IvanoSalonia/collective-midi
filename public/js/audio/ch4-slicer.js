// Channel 4 — sample slicer.
//
// One long user-supplied sample, divided into 36 equal segments (one per
// note in C3..B5). Each note plays its slice from start to end at native
// pitch with short fades to avoid clicks. No synth params.

const NOTE_MIN = 48;
const NOTE_MAX = 83;
const SLICE_COUNT = NOTE_MAX - NOTE_MIN + 1;

export class Ch4Slicer {
  constructor(ctx, destination /*, settings */) {
    this.ctx = ctx;
    this.destination = destination;
    this.buffer = null;
    this.sliceDuration = 0;
    this.voices = new Map();
  }

  updateSettings(_s) { /* no synth params */ }

  async load(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${url} failed: ${res.status}`);
    const arrayBuf = await res.arrayBuffer();
    this.buffer = await this.ctx.decodeAudioData(arrayBuf);
    this.sliceDuration = this.buffer.duration / SLICE_COUNT;
  }

  noteOn(note, velocity) {
    if (!this.buffer) return;
    const idx = note - NOTE_MIN;
    if (idx < 0 || idx >= SLICE_COUNT) return;

    const t = this.ctx.currentTime;
    const v = Math.min(1, velocity / 127);
    const offset = idx * this.sliceDuration;
    const duration = this.sliceDuration;

    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer;

    const amp = this.ctx.createGain();
    const fade = Math.min(0.02, duration * 0.1);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(0.6 * v, t + fade);
    amp.gain.setValueAtTime(0.6 * v, t + duration - fade);
    amp.gain.linearRampToValueAtTime(0, t + duration);

    source.connect(amp).connect(this.destination);
    source.start(t, offset, duration);

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
    const t = this.ctx.currentTime;
    voice.stopped = true;
    voice.amp.gain.cancelScheduledValues(t);
    voice.amp.gain.setValueAtTime(voice.amp.gain.value, t);
    voice.amp.gain.linearRampToValueAtTime(0, t + 0.08);
    try { voice.source.stop(t + 0.1); } catch {}
    this.voices.delete(note);
  }

  _release(voice, t) {
    voice.stopped = true;
    voice.amp.gain.cancelScheduledValues(t);
    voice.amp.gain.setValueAtTime(voice.amp.gain.value, t);
    voice.amp.gain.linearRampToValueAtTime(0, t + 0.05);
    try { voice.source.stop(t + 0.06); } catch {}
  }
}
