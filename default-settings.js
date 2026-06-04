// Server-side defaults for sound-design settings.
//
// These are the values the server uses on every fresh start (and what every
// audience client receives on join, until the conductor pushes updates).
// Baked from the 2026-06-02 conductor preset; tweak by exporting a new
// preset and copying its values here, or just by editing in place.
//
// Each channel has THREE orientation states (A/B/C) — the audience phone
// blends between them as it tilts. Channel index 0..3 maps to MIDI ch 1..4
// / Keystep ch1..4.

const DEFAULT_SETTINGS = {
  bpm: 50,
  delay: {
    step: '1/8',           // '1/4' | '1/8' | '1/8d' | '1/16'
    feedback: 0.4
  },
  reverb: {
    wet: 0.9
  },
  channels: [
    // -----------------------------------------------------------------
    // CH1 — synth voice
    // -----------------------------------------------------------------
    {
      A: {
        color: '#42EA33',
        volume: 1.0, osc: 'sine', detune: 0, cutoff: 3612,
        lfoRate: 0.1, lfoDepth: 0,
        attack: 0.001, decay: 0.38, sustain: 0.17, release: 0.88,
        reverbSend: 0.16, delaySend: 0.0
      },
      B: {
        color: '#02C9DF',
        volume: 1.0, osc: 'sine', detune: 0, cutoff: 5624,
        lfoRate: 4.08, lfoDepth: 0.65,
        attack: 0.1, decay: 0.91, sustain: 0.45, release: 0.61,
        reverbSend: 0.55, delaySend: 0.10
      },
      C: {
        color: '#0739FF',
        volume: 1.0, osc: 'sine', detune: 0, cutoff: 6798,
        lfoRate: 12.04, lfoDepth: 0.15,
        attack: 0.001, decay: 0.09, sustain: 0.01, release: 0.09,
        reverbSend: 0.30, delaySend: 0.79
      }
    },

    // -----------------------------------------------------------------
    // CH2 — sampler (low-pass filtered)
    // -----------------------------------------------------------------
    {
      A: {
        color: '#DD1414',
        volume: 1.0, cutoff: 505,
        attack: 0.012, decay: 0.39, sustain: 0.22, release: 0.83,
        reverbSend: 0.08, delaySend: 0.06
      },
      B: {
        color: '#FF8307',
        volume: 0.95, cutoff: 2690,
        attack: 0.012, decay: 1.42, sustain: 0.68, release: 2.64,
        reverbSend: 0.58, delaySend: 0.08
      },
      C: {
        color: '#FF07B5',
        volume: 0.99, cutoff: 7660,
        attack: 0.001, decay: 0.23, sustain: 0.07, release: 0.35,
        reverbSend: 0.00, delaySend: 0.64
      }
    },

    // -----------------------------------------------------------------
    // CH3 — 2-op FM synth
    // -----------------------------------------------------------------
    {
      A: {
        color: '#FFFFFF',
        volume: 0.95, ratio: 13.5, modIndex: 1.8,
        lfoRate: 6.6, lfoDepth: 0.55,
        attack: 0.001, decay: 0.58, sustain: 0.22, release: 0.89,
        reverbSend: 0.00, delaySend: 0.00
      },
      B: {
        color: '#A57EE8',
        volume: 0.62, ratio: 11.6, modIndex: 2,
        lfoRate: 4.2, lfoDepth: 0.35,
        attack: 0.036, decay: 1.65, sustain: 0.45, release: 0.97,
        reverbSend: 0.28, delaySend: 0.35
      },
      C: {
        color: '#619CD3',
        volume: 1.0, ratio: 4.75, modIndex: 2.8,
        lfoRate: 1.4, lfoDepth: 0.36,
        attack: 0.001, decay: 0.17, sustain: 0.01, release: 0.48,
        reverbSend: 0.42, delaySend: 0.71
      }
    },

    // -----------------------------------------------------------------
    // CH4 — slicer
    // -----------------------------------------------------------------
    {
      A: {
        color: '#1417DD',
        volume: 0.57, startPoint: 0.09, sliceCount: 36, loop: true,
        reverbSend: 0.03, delaySend: 0.35
      },
      B: {
        color: '#4DDE9F',
        volume: 0.58, startPoint: 0.00, sliceCount: 30, loop: true,
        reverbSend: 0.42, delaySend: 0.08
      },
      C: {
        color: '#D178F4',
        volume: 0.95, startPoint: 0.61, sliceCount: 10, loop: false,
        reverbSend: 0.00, delaySend: 0.79
      }
    }
  ],
  samples: {
    // Updated by the upload endpoint when the conductor drops a new file.
    ch2: '/samples/sampler.mp3',
    ch4: '/samples/slicer.mp3'
  }
};

module.exports = { DEFAULT_SETTINGS };
