// Shared note → group mapping.
//
// 4 MIDI channels × 2 groups per channel = 8 groups.
// Notes C3..B5 (MIDI 48..83 inclusive, 36 notes) are split per channel
// between that channel's two groups using a deterministic pseudo-random
// shuffle. "Semi-random" per the brief: stable across runs, but mixed enough
// that adjacent notes don't always land in the same group.
//
// Channel index is 0-based (Keystep ch1 → channel 0). Group index is global 0..7,
// where channel c owns groups (c*2) and (c*2 + 1).
//
// Module is consumed by the Node server (CommonJS). Browsers do not need it —
// clients only react to events, they don't compute group membership.

const CHANNEL_COUNT = 4;
const GROUPS_PER_CHANNEL = 2;
const GROUP_COUNT = CHANNEL_COUNT * GROUPS_PER_CHANNEL; // 8
const NOTE_MIN = 48; // C3
const NOTE_MAX = 83; // B5

const GROUP_COLORS = [
  '#FF0000', // 1 Red
  '#FF6600', // 2 Orange
  '#FFCC00', // 3 Yellow
  '#00FF44', // 4 Green
  '#00FFFF', // 5 Cyan
  '#0066FF', // 6 Blue
  '#9900FF', // 7 Violet
  '#FF00AA'  // 8 Magenta
];

// Mulberry32 — small deterministic PRNG. Same seed → same sequence everywhere.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(array, rng) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Returns noteMap[channel][note] = globalGroupIndex (0..7).
// Channels not in 0..3 and notes outside 48..83 are simply absent.
function buildNoteMap(seed = 0xC0FFEE) {
  const map = {};
  const rng = mulberry32(seed);
  const allNotes = [];
  for (let n = NOTE_MIN; n <= NOTE_MAX; n++) allNotes.push(n);
  for (let ch = 0; ch < CHANNEL_COUNT; ch++) {
    const order = shuffled(allNotes, rng);
    const half = Math.floor(order.length / 2);
    const groupA = ch * GROUPS_PER_CHANNEL;
    const groupB = groupA + 1;
    map[ch] = {};
    order.forEach((note, idx) => {
      map[ch][note] = idx < half ? groupA : groupB;
    });
  }
  return map;
}

module.exports = {
  buildNoteMap,
  CHANNEL_COUNT,
  GROUPS_PER_CHANNEL,
  GROUP_COUNT,
  NOTE_MIN,
  NOTE_MAX,
  GROUP_COLORS
};
