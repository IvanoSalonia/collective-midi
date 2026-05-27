// Channel 4 — sample slicer.
//
// One long user-supplied sample. A "usable region" starts at `startPoint`
// (0..1 fraction of the buffer) and extends to the end; that region is
// divided into `sliceCount` equal slices. Notes (C3..B5) map linearly
// across the slice count, so with sliceCount==36 it's 1:1.
//
// Loop on → slice plays through and loops between its bounds until note-off.
// Loop off → slice plays once start-to-end with short fades (the original
// behavior).
//
// User controls: volume, transpose (no — this engine plays at native
// pitch to preserve the sample's character), startPoint, loop, sliceCount.

const NOTE_MIN = 48; // C3
const NOTE_MAX = 83; // B5
const NOTE_RANGE = NOTE_MAX - NOTE_MIN + 1; // 36

export class Ch4Slicer {
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

  // Returns { offset, duration } in seconds for the slice triggered by `note`.
  _computeSlice(note) {
    if (!this.buffer) return null;
    const sliceCount = Math.max(1, Math.floor(this.s.sliceCount ?? 36));
    const startPoint = Math.max(0, Math.min(0.99, this.s.startPoint ?? 0));
    const startSec = startPoint * this.buffer.duration;
    const usableSec = Math.max(0.01, this.buffer.duration - startSec);
    const sliceDur = usableSec / sliceCount;
    const noteOffset = Math.max(0, Math.min(NOTE_RANGE - 1, note - NOTE_MIN));
    const idx = Math.min(sliceCount - 1, Math.floor(noteOffset / NOTE_RANGE * sliceCount));
    return { offset: startSec + idx * sliceDur, duration: sliceDur };
  }

  noteOn(note, velocity) {
    if (!this.buffer) return;
    const slice = this._computeSlice(note);
    if (!slice) return;

    const t = this.ctx.currentTime;
    const v = Math.min(1, velocity / 127);
    const volume = Math.max(0, Math.min(1, this.s.volume ?? 0.6));
    const peak = volume * v;
    const looping = !!this.s.loop;

    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer;
    if (looping) {
      source.loop = true;
      source.loopStart = slice.offset;
      source.loopEnd = slice.offset + slice.duration;
    }

    const amp = this.ctx.createGain();
    const fade = Math.min(0.02, slice.duration * 0.1);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + fade);
    if (looping) {
      // Hold at peak; release on noteOff.
      amp.gain.setValueAtTime(peak, t + fade);
    } else {
      // One-shot: fade out at end of slice.
      amp.gain.setValueAtTime(peak, t + slice.duration - fade);
      amp.gain.linearRampToValueAtTime(0, t + slice.duration);
    }

    source.connect(amp).connect(this.destination);
    if (looping) {
      source.start(t, slice.offset);
    } else {
      source.start(t, slice.offset, slice.duration);
    }

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
