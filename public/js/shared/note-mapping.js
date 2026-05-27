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

// Default (state A) color per group. Each channel actually has THREE colors
// (one per orientation state) defined in default-settings.js; the audience
// interpolates between them as the phone tilts. These defaults are what the
// conductor's group cells show and what a freshly joined phone sees before
// it receives the full settings.
const GROUP_COLORS = [
  '#42EA33', // CH1 synth voice
  '#DD1414', // CH2 sampler
  '#FFFFFF', // CH3 FM synth
  '#1417DD'  // CH4 slicer
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
