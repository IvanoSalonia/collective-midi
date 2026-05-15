// Shared FX bus: one reverb + one delay, fed by per-channel sends.
//
// Audio graph:
//   engine -> ChannelStrip.input
//                 ├── dry  -> dryDest
//                 ├── revSend -> reverbBus.input -> convolver -> wet -> dryDest
//                 └── delSend -> delayBus.input -> delay+feedback -> dryDest
//
// dryDest is whatever the consumer hands us (in this app, the master low-pass
// driven by phone tilt). FX outputs feed the same dryDest so tilt also
// shapes the wet signal — wanted, since the audience filter is the "voice"
// each phone has on the whole sound.

// --- Reverb impulse response ----------------------------------------------
// Procedural IR: stereo noise with exponential decay. Cheap, no asset to
// ship. ~2.5s tail is enough body without dominating short notes.
function makeReverbIR(ctx, durationSec = 2.5, decay = 4) {
  const len = Math.floor(ctx.sampleRate * durationSec);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = ir.getChannelData(c);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
    }
  }
  return ir;
}

// Subdivision of a quarter note (60/bpm seconds) → seconds per delay tap.
const STEP_FACTORS = {
  '1/4': 1.0,
  '1/8': 0.5,
  '1/8d': 0.75,   // dotted eighth
  '1/16': 0.25
};

export class FXBus {
  constructor(ctx, output) {
    this.ctx = ctx;
    this.output = output;

    // --- Reverb ---
    this.reverbInput = ctx.createGain();
    this.reverbInput.gain.value = 1.0;
    const convolver = ctx.createConvolver();
    convolver.buffer = makeReverbIR(ctx);
    this.reverbWet = ctx.createGain();
    this.reverbWet.gain.value = 0.9;
    this.reverbInput.connect(convolver).connect(this.reverbWet).connect(output);

    // --- Delay (mono) ---
    this.delayInput = ctx.createGain();
    this.delayInput.gain.value = 1.0;
    this.delay = ctx.createDelay(2.0);
    this.delay.delayTime.value = 0.25;
    this.feedback = ctx.createGain();
    this.feedback.gain.value = 0.4;
    this.delayInput.connect(this.delay);
    this.delay.connect(this.feedback).connect(this.delay);
    this.delay.connect(output);

    this._bpm = 120;
    this._step = '1/8';
  }

  setBpm(bpm) {
    this._bpm = Math.max(20, Math.min(300, bpm));
    this._applyDelayTime();
  }
  setDelayStep(step) {
    if (STEP_FACTORS[step] !== undefined) {
      this._step = step;
      this._applyDelayTime();
    }
  }
  setDelayFeedback(v) {
    const clamped = Math.max(0, Math.min(0.9, v));
    this.feedback.gain.setTargetAtTime(clamped, this.ctx.currentTime, 0.05);
  }
  setReverbWet(v) {
    const clamped = Math.max(0, Math.min(1, v));
    this.reverbWet.gain.setTargetAtTime(clamped, this.ctx.currentTime, 0.05);
  }

  _applyDelayTime() {
    const beat = 60 / this._bpm;
    const t = beat * (STEP_FACTORS[this._step] ?? 0.5);
    this.delay.delayTime.setTargetAtTime(t, this.ctx.currentTime, 0.05);
  }
}

// Per-channel routing: dry + reverb send + delay send. Engines connect to
// strip.input; consumer wires strip output destinations to fx bus inputs.
export class ChannelStrip {
  constructor(ctx, dryDest, reverbDest, delayDest) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.input.gain.value = 1.0;

    this.dry = ctx.createGain();
    this.rev = ctx.createGain();
    this.del = ctx.createGain();
    this.dry.gain.value = 1.0;
    this.rev.gain.value = 0.0;
    this.del.gain.value = 0.0;

    this.input.connect(this.dry).connect(dryDest);
    this.input.connect(this.rev).connect(reverbDest);
    this.input.connect(this.del).connect(delayDest);
  }
  setReverbSend(v) {
    this.rev.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), this.ctx.currentTime, 0.03);
  }
  setDelaySend(v) {
    this.del.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), this.ctx.currentTime, 0.03);
  }
}
