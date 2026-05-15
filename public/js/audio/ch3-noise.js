// Channel 3 — synthesized noise/texture.
//
// White noise → bandpass filter centered on the note's frequency, swept by
// an LFO → amp envelope. Different notes produce different filter centers,
// so the texture has pitched character without being a tone.

const NOTE_TO_HZ = (n) => 440 * Math.pow(2, (n - 69) / 12);

// Reusable noise buffer so each voice doesn't re-allocate.
let sharedNoiseBuffer = null;
function makeNoiseBuffer(ctx) {
  if (sharedNoiseBuffer) return sharedNoiseBuffer;
  const seconds = 4;
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  sharedNoiseBuffer = buf;
  return buf;
}

export class Ch3Noise {
  constructor(ctx, destination) {
    this.ctx = ctx;
    this.destination = destination;
    this.voices = new Map(); // note -> { source, lfo, lfoGain, filter, amp, stopped }
  }

  noteOn(note, velocity) {
    const t = this.ctx.currentTime;
    const freq = NOTE_TO_HZ(note);
    const v = Math.min(1, velocity / 127);

    const source = this.ctx.createBufferSource();
    source.buffer = makeNoiseBuffer(this.ctx);
    source.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = 12;

    // LFO modulating the bandpass center for shimmer.
    const lfo = this.ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 3.5;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = freq * 0.15;
    lfo.connect(lfoGain).connect(filter.frequency);

    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(0.25 * v, t + 0.04);
    amp.gain.linearRampToValueAtTime(0.18 * v, t + 0.5);

    source.connect(filter).connect(amp).connect(this.destination);
    source.start(t);
    lfo.start(t);

    const existing = this.voices.get(note);
    if (existing) this._release(existing, t);

    this.voices.set(note, { source, lfo, lfoGain, filter, amp, stopped: false });
  }

  noteOff(note) {
    const voice = this.voices.get(note);
    if (!voice || voice.stopped) return;
    this._release(voice, this.ctx.currentTime);
    this.voices.delete(note);
  }

  _release(voice, t) {
    voice.stopped = true;
    const release = 0.6;
    voice.amp.gain.cancelScheduledValues(t);
    voice.amp.gain.setValueAtTime(voice.amp.gain.value, t);
    voice.amp.gain.linearRampToValueAtTime(0, t + release);
    voice.source.stop(t + release + 0.05);
    voice.lfo.stop(t + release + 0.05);
  }
}
