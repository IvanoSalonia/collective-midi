// Server-side defaults for sound-design settings.
// Sent to every client on connect; the conductor mutates them via socket events.

const DEFAULT_SETTINGS = {
  bpm: 120,
  delay: {
    step: '1/8',         // '1/4' | '1/8' | '1/8d' | '1/16'
    feedback: 0.4        // 0..0.9
  },
  reverb: {
    wet: 0.9             // 0..1, master wet level on the reverb bus output
  },
  // Channels are indexed 0..3 (matching MIDI channel 0..3 / Keystep ch1..4).
  channels: [
    // ch1 — synth voice. Full ADSR: attack/decay/sustain (0..1 level)/release.
    { osc: 'sawtooth', cutoff: 1500, attack: 0.005, decay: 0.18, sustain: 0.6, release: 0.35,
      reverbSend: 0.0, delaySend: 0.0 },
    // ch2 — pitched sample (no synth params, just send levels)
    { reverbSend: 0.0, delaySend: 0.0 },
    // ch3 — noise/texture. Full ADSR.
    { noise: 'white', cutoff: 800, attack: 0.04, decay: 0.4, sustain: 0.6, release: 0.5,
      reverbSend: 0.0, delaySend: 0.0 },
    // ch4 — sample slicer
    { reverbSend: 0.0, delaySend: 0.0 }
  ],
  samples: {
    // Updated by the upload endpoint when the conductor drops a new file.
    ch2: '/samples/ch4-instrument.mp3',
    ch4: '/samples/ch2-instrument.mp3'
  }
};

module.exports = { DEFAULT_SETTINGS };
