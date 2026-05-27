// Shared note → group mapping.
//
// 4 MIDI channels, 1 group per channel = 4 groups total. Every note on
// channel N routes to group N. The 1:1 mapping makes the routing trivial,
// but we keep the lookup table structure so future variants (e.g. multi-
// group-per-channel) can swap it in without touching the server logic.
//
// Group N is owned by channel N and uses channel N's sound engine on the
// audience side.

const CHANNEL_COUNT = 4;
const GROUPS_PER_CHANNEL = 1;
const GROUP_COUNT = CHANNEL_COUNT * GROUPS_PER_CHANNEL; // 4
const NOTE_MIN = 48; // C3
const NOTE_MAX = 83; // B5

const GROUP_COLORS = [
  '#00FF44', // 1 Green   — Ch1 synth voice
  '#FF6600', // 2 Orange  — Ch2 sampler
  '#FFCC00', // 3 Yellow  — Ch3 noise/texture
  '#FF0000'  // 4 Red     — Ch4 slicer
];

// noteMap[channel][note] = globalGroupIndex (0..3).
// With 1 group per channel, group == channel.
function buildNoteMap() {
  const map = {};
  for (let ch = 0; ch < CHANNEL_COUNT; ch++) {
    map[ch] = {};
    for (let n = NOTE_MIN; n <= NOTE_MAX; n++) {
      map[ch][n] = ch;
    }
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
