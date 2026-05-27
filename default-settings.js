// Server-side defaults for sound-design settings.
// Sent to every client on connect; the conductor mutates them via socket events.
//
// Channels are indexed 0..3 (matching MIDI channel 0..3 / Keystep ch1..4).

const DEFAULT_SETTINGS = {
  bpm: 120,
  delay: {
    step: '1/8',          // '1/4' | '1/8' | '1/8d' | '1/16'
    feedback: 0.4         // 0..0.9
  },
  reverb: {
    wet: 0.9              // 0..1, master wet level on the reverb bus output
  },
  channels: [
    // ch1 — synth voice
    {
      osc: 'sawtooth',
      detune: 8,          // cents (osc2 vs osc1)
      cutoff: 1500,       // Hz, static low-pass
      lfoRate: 5,         // Hz, tremolo
      lfoDepth: 0,        // 0..1, tremolo depth (0 = off)
      attack: 0.005,
      decay: 0.18,
      sustain: 0.6,       // 0..1, level held during sustain phase
      release: 0.35,
      reverbSend: 0.0,
      delaySend: 0.0
    },
    // ch2 — sampler (drag & drop sample, pitched + ADSR)
    {
      volume: 0.6,        // 0..1
      transpose: 0,       // semitones (-24..+24), applied on top of note pitch
      attack: 0.02,
      decay: 0.2,
      sustain: 0.7,
      release: 0.4,
      reverbSend: 0.0,
      delaySend: 0.0
    },
    // ch3 — 2-op FM synth (Volca FM inspired character)
    {
      ratio: 2,           // modulator freq / carrier freq
      modIndex: 3,        // dimensionless; peak Hz deviation = modIndex * modFreq
      lfoRate: 3,         // Hz, LFO modulating the mod index
      lfoDepth: 0.5,      // adds ± this much to the index, scaled by modFreq
      attack: 0.005,
      decay: 0.3,
      sustain: 0.2,
      release: 0.3,
      reverbSend: 0.0,
      delaySend: 0.0
    },
    // ch4 — slicer
    {
      volume: 0.6,
      startPoint: 0,      // 0..1 normalized offset into buffer where slice grid begins
      loop: false,        // if true, slice loops between its bounds until note-off
      sliceCount: 36,     // number of slices in the usable region
      reverbSend: 0.0,
      delaySend: 0.0
    }
  ],
  samples: {
    // Updated by the upload endpoint when the conductor drops a new file.
    ch2: '/samples/ch4-instrument.mp3',
    ch4: '/samples/ch2-instrument.mp3'
  }
};

module.exports = { DEFAULT_SETTINGS };
