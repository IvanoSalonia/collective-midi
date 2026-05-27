// Server-side defaults for sound-design settings.
//
// Each channel has THREE states (A, B, C) that correspond to phone
// orientations:
//   A = portrait (default)
//   B = landscape right
//   C = landscape left
//
// The audience phone interpolates between these states continuously as the
// device tilts, producing a smooth crossfade of color AND every sound
// design parameter. The values below are the spec's percentages converted
// to engine-native units via each slider's min/max range.
//
// Channels are indexed 0..3 (matching MIDI channel 0..3 / Keystep ch1..4).

const DEFAULT_SETTINGS = {
  bpm: 120,
  delay: {
    step: '1/8',          // '1/4' | '1/8' | '1/8d' | '1/16'
    feedback: 0.4         // 0..0.9
  },
  reverb: {
    wet: 0.9              // 0..1
  },
  channels: [
    // -----------------------------------------------------------------
    // CH1 — synth voice
    // -----------------------------------------------------------------
    {
      A: {
        color: '#42EA33',
        osc: 'sine',
        detune: 7.5,      // cents (slider 0..50, 15%)
        cutoff: 3644,     // Hz   (slider 80..8000, 45%)
        lfoRate: 7.07,    // Hz   (slider 0.1..20, 35%)
        lfoDepth: 0.55,   //      (0..1, 55%)
        attack: 0.10,     // s    (slider 0.001..2, 5%)
        decay: 1.06,      // s    (slider 0.01..3, 35%)
        sustain: 0.5,     //      (0..1, 50%)
        release: 1.21,    // s    (slider 0.01..3, 40%)
        reverbSend: 0.40,
        delaySend: 0.25
      },
      B: {
        color: '#02C9DF',
        osc: 'sine',
        detune: 0,
        cutoff: 5624,     // 70%
        lfoRate: 4.08,    // 20%
        lfoDepth: 0.65,
        attack: 0.10,
        decay: 0.91,      // 30%
        sustain: 0.45,
        release: 0.61,    // 20%
        reverbSend: 0.55,
        delaySend: 0.10
      },
      C: {
        color: '#0739FF',
        osc: 'sine',
        detune: 20,       // 40%
        cutoff: 2456,     // 30%
        lfoRate: 12.04,   // 60%
        lfoDepth: 0.15,
        attack: 0.10,
        decay: 1.21,      // 40%
        sustain: 0.55,
        release: 1.36,    // 45%
        reverbSend: 0.30,
        delaySend: 0.10
      }
    },

    // -----------------------------------------------------------------
    // CH2 — sampler
    // -----------------------------------------------------------------
    {
      A: {
        color: '#DD1414',
        volume: 0.72,
        transpose: -1,    // (-24..24, 48%)
        attack: 0.08,     // 4%
        decay: 0.97,      // 32%
        sustain: 0.58,
        release: 0.55,    // 18%
        reverbSend: 0.08,
        delaySend: 0.06
      },
      B: {
        color: '#FF8307',
        volume: 0.95,
        transpose: 6,     // (62%)
        attack: 0.08,
        decay: 1.42,      // 47%
        sustain: 0.68,
        release: 2.64,    // 88%
        reverbSend: 0.12,
        delaySend: 0.08
      },
      C: {
        color: '#FF07B5',
        volume: 0.88,
        transpose: -4,    // (42%)
        attack: 0.08,
        decay: 0.85,      // 28%
        sustain: 0.52,
        release: 0.37,    // 12%
        reverbSend: 0.72,
        delaySend: 0.08
      }
    },

    // -----------------------------------------------------------------
    // CH3 — 2-op FM synth (Volca FM character)
    // -----------------------------------------------------------------
    {
      A: {
        color: '#FFFFFF',
        ratio: 10,        // (0.25..16, 62%)
        modIndex: 1.8,    // (0..10, 18%)
        lfoRate: 7.07,    // (0.1..20, 35%)
        lfoDepth: 2.04,   // (0..3, 68%)
        attack: 0.10,
        decay: 1.56,      // 52%
        sustain: 0.42,
        release: 1.15,    // 38%
        reverbSend: 0.35,
        delaySend: 0.08
      },
      B: {
        color: '#A57EE8',
        ratio: 11.6,      // 72%
        modIndex: 5.8,    // 58%
        lfoRate: 4.48,    // 22%
        lfoDepth: 2.94,   // 98%
        attack: 0.10,
        decay: 1.65,      // 55%
        sustain: 0.45,
        release: 0.97,    // 32%
        reverbSend: 0.28,
        delaySend: 0.35
      },
      C: {
        color: '#619CD3',
        ratio: 6.25,      // 38%
        modIndex: 2.8,    // 28%
        lfoRate: 13.63,   // 68%
        lfoDepth: 0.36,   // 12%
        attack: 0.10,
        decay: 1.27,      // 42%
        sustain: 0.38,
        release: 1.27,    // 42%
        reverbSend: 0.42,
        delaySend: 0.22
      }
    },

    // -----------------------------------------------------------------
    // CH4 — slicer
    // -----------------------------------------------------------------
    {
      A: {
        color: '#1417DD',
        volume: 0.72,
        startPoint: 0.28,
        sliceCount: 16,   // (4..72, 18%)
        loop: false,
        reverbSend: 0.68,
        delaySend: 0.35
      },
      B: {
        color: '#4DDE9F',
        volume: 0.95,
        startPoint: 0.18,
        sliceCount: 30,   // (38%)
        loop: true,
        reverbSend: 0.42,
        delaySend: 0.08
      },
      C: {
        color: '#D178F4',
        volume: 0.88,
        startPoint: 0.42,
        sliceCount: 16,
        loop: false,
        reverbSend: 0.68,
        delaySend: 0.35
      }
    }
  ],
  samples: {
    // Updated by the upload endpoint when the conductor drops a new file.
    ch2: '/samples/ch4-instrument.mp3',
    ch4: '/samples/ch2-instrument.mp3'
  }
};

module.exports = { DEFAULT_SETTINGS };
