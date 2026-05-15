# Collective MIDI Performance

A live performance instrument where the audience *is* the instrument.

The performer plays a MIDI controller (developed against an Arturia **Keystep Pro**, but any 4-channel MIDI source works) connected to their laptop via WebMIDI. Each note routes to a subset of audience phones, which the audience joined by scanning a QR code. Each phone holds one piece of the composition: it plays the note's sound, lights up its color, and lets its holder shape the sound by tilting the phone.

The room becomes a distributed instrument.

---

## How it works

- **8 groups**, derived from 4 MIDI channels × 2 groups per channel.
- Each channel's 36 notes (C3–B5) are split semi-randomly between that channel's two groups using a fixed deterministic seed — the split is the same every time the server starts.
- Each audience phone is assigned a group **round-robin** when it connects, and stays in that group for the session.
- Each channel has a different sound engine running on the phone:
  - **Ch 1** — synthesized modular-style voice (Web Audio, no sample)
  - **Ch 2** — sampled instrument with low attack (one user-supplied sample, C4 reference)
  - **Ch 3** — synthesized noise/texture (LFO-modulated bandpass)
  - **Ch 4** — sample slicer (one long user-supplied sample, sliced into 36)
- Each phone runs a master low-pass filter shaped by **device tilt**: front-back tilt (`beta`) sweeps cutoff, left-right tilt (`gamma`) sweeps resonance.
- Visuals: black screen, one centered dot in the group's color, breathing when idle, pulsing on note.

---

## Running locally

Requires Node.js ≥ 18.

```bash
npm install
npm start
```

Then open:

- **Conductor (your laptop):** http://localhost:3000/conductor — connect your MIDI controller, pick it from the dropdown.
- **Audience (your phone, on the same Wi-Fi):** http://`<your-laptop-LAN-ip>`:3000/ — tap "Tap to join".

> WebMIDI requires Chrome (or another Chromium-based browser) on desktop. The conductor view will not work in Safari or Firefox.

> DeviceOrientation requires HTTPS on iOS. Locally it will fall back to the start-tap working without tilt control. For the real performance, use the Railway deployment below.

### Add your samples

Drop your two source files into `samples/`:

- `samples/ch2-instrument.wav`
- `samples/ch4-texture.wav`

See [samples/README.md](samples/README.md) for guidance.

---

## Deploying on Railway

1. Push this repo to GitHub.
2. On [Railway](https://railway.app/), create a new project from your GitHub repo.
3. Railway auto-detects Node from `package.json` and runs `npm start`. The server reads `process.env.PORT` automatically.
4. After the first deploy, open **Settings → Networking → Generate Domain** to get a public HTTPS URL (e.g. `your-project.up.railway.app`).
5. Generate a QR code pointing at that URL — that's the audience link.
6. Open `https://your-project.up.railway.app/conductor` on your laptop, connect the Keystep Pro, and play.

Notes for production:
- Samples are committed to the repo and deployed with the rest of the static files. Keep them under a few MB each so first load is fast on phones.
- Railway's free tier is fine for small audiences; for larger crowds, give it a paid plan with more bandwidth.

---

## Architecture

```
Keystep Pro
    │ MIDI (USB)
    ▼
Conductor browser (Chrome, /conductor)
    │ Socket.io (note-on / note-off + channel)
    ▼
Node.js server (server.js)
    │ Looks up (channel, note) → group via shared/note-mapping.js
    │ Forwards event to that group's room
    ▼
Audience browsers (each in one group)
    │ Audio engines per channel + tilt-controlled filter
    ▼
Sound + light in the room
```

Source layout:

| Path | Purpose |
|---|---|
| [server.js](server.js) | Express + Socket.io server, group assignment, note routing |
| [public/js/shared/note-mapping.js](public/js/shared/note-mapping.js) | Deterministic (channel, note) → group mapping |
| [public/index.html](public/index.html) + [public/js/audience.js](public/js/audience.js) | Audience client |
| [public/js/audio/](public/js/audio/) | One file per channel's audio engine |
| [public/conductor.html](public/conductor.html) + [public/js/conductor.js](public/js/conductor.js) | Conductor client (WebMIDI + overview) |
| [public/css/styles.css](public/css/styles.css) | All styles |
| [samples/](samples/) | Drop your two WAVs here |

---

## License

MIT — see [LICENSE](LICENSE).
