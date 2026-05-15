# Samples

The audio engines for channels 2 and 4 expect the following files in this directory:

- **`ch2-instrument.wav`** — a single instrument hit. The pitch you record will be treated as **C4** (middle C). Played notes pitch-shift the sample relative to that reference. A clean note with a low/soft attack works best (the engine adds its own short fade-in to avoid clicks).
- **`ch4-texture.wav`** — a long texture. The engine slices it into **36 equal segments** corresponding to notes C3..B5. Notes trigger their corresponding slice from start to end. Anything works — drones, field recordings, granular pads.

WAV is preferred for fast decode. MP3/OGG also work but you'll need to update the file extensions in [audience.js](../public/js/audience.js).

If a file is missing, that channel is silently skipped (the rest of the performance is unaffected).
