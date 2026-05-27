// Channel 3 — synthesized noise/texture, parametrized.
//
// Noise (white/pink/brown) → static low-pass at user cutoff → ADSR amp env
// → destination. No per-note pitch tracking; the noise type and cutoff are
// the character. Re-uses cached noise buffers per type to avoid per-voice
// allocations.
//
// Envelope phases match Ch1: attack 0->peak, decay peak->peak*sustain,
// sustain holds until note-off, release ramps from current value to 0.

const noiseBuffers = new Map(); // type -> AudioBuffer (per AudioContext lifetime)

function getNoiseBuffer(ctx, type) {
  const key = `${type}@${ctx.sampleRate}`;
  if (noiseBuffers.has(key)) return noiseBuffers.get(key);
  const seconds = 4;
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buf.getChannelData(0);
  if (type === 'white') {
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  } else if (type === 'pink') {
    // Paul Kellet's economy pink noise approximation.
    let b0=0, b1=0, b2=0, b3=0, b4=0, b5=0, b6=0;
    for (let i = 0; i < data.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  } else if (type === 'brown') {
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      data[i] = last * 3.5; // compensate level
    }
  }
  noiseBuffers.set(key, buf);
  return buf;
}

export class Ch3Noise {
  constructor(ctx, destination, settings) {
    this.ctx = ctx;
    this.destination = destination;
    this.s = settings;
    this.voices = new Map();
  }

  updateSettings(s) { this.s = s; }

  noteOn(note, velocity) {
    const t = this.ctx.currentTime;
    const v = Math.min(1, velocity / 127);
    const peak = 0.25 * v;

    const source = this.ctx.createBufferSource();
    source.buffer = getNoiseBuffer(this.ctx, this.s.noise);
    source.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = this.s.cutoff;
    filter.Q.value = 1.5;

    const amp = this.ctx.createGain();
    const a = Math.max(0.001, this.s.attack);
    const d = Math.max(0.001, this.s.decay);
    const sustainLevel = Math.max(0, Math.min(1, this.s.sustain ?? 0.6));
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + a);
    amp.gain.linearRampToValueAtTime(peak * sustainLevel, t + a + d);

    source.connect(filter).connect(amp).connect(this.destination);
    source.start(t);

    const existing = this.voices.get(note);
    if (existing) this._release(existing, t);
    this.voices.set(note, { source, filter, amp, stopped: false });
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
    voice.source.stop(t + r + 0.05);
  }
}
