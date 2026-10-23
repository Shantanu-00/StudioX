# Phase 1 — shell, pairing and companion

> **Historical design note.** Written during the build (20–22 Oct 2026) and kept for the record.
> Statements such as "proposal", "nothing is deployed" or "not built yet" describe the state at the
> time. The current product and the deployed system are described in the [README](../../README.md),
> [ARCHITECTURE.md](../ARCHITECTURE.md) and [aws-builder.md](../aws-builder.md).

Status as of 20 October 2026. "Implemented" means code exists and unit tests pass; it does not mean
tested on the Virtual Device or a Fire TV unless stated.

## Scope

| Item | State |
| --- | --- |
| Placeholder opening sting (`src/screens/Intro.tsx`) | Implemented. SELECT skips; plays on cold start only |
| Library home: 2 demo episode slots, Upload your own, Connect phone camera (`src/screens/Home.tsx`) | Implemented. Episodes say `NO SIGNAL` until media is added |
| Pairing screen with styled QR, status, countdown, fallback code (`src/screens/Pairing.tsx`) | Implemented |
| Companion server: sessions, phone join, upload, camera state (`companion/server.mjs`) | Implemented; API exercised with curl |
| Phone pages: upload with progress, camera permission and preview, code entry (`companion/public/`) | Implemented; not yet tried on a phone |
| Vega debug build | Passes (`npm run build:debug`), manifest validates |
| Run on Virtual Device | Run by the user on 20 Oct. **Home is cut off below the episode cards**: sizes assume 1920 × 1080 while the canvas is 960 × 540 dp. See [tv-experience.md](tv-experience.md#1-why-the-bottom-of-the-home-screen-was-cut-off) |

## Not in Phase 1

- Video playback and the two real demo episodes (needs the podcast files and the W3C media player).
- Gesture recognition on the phone and the command relay (WebSocket).
- Transcription, layer generation and the co-viewing panel.
- HTTPS hosting.

## Try it

```bash
node companion/server.mjs            # prints the phone URL host it will put in QR codes
npm run build:debug
npm run vvd:start && npm run run:vvd # after confirming emulator memory, see AGENTS.md
```

Set `COMPANION_API_URL` in `src/config.ts` to an address the TV can reach, and keep that host in
`manifest.toml` `[network-traffic-policy.cleartext]` while it is plain HTTP.

Remote map: D-pad moves focus; SELECT opens; BACK leaves pairing or skips the intro, and exits from
the library.

## TV build, 21 October

Implemented, unit-tested (21 tests) and built (`npm run build:debug`, manifest 0 errors); **not yet
run on the Virtual Device**:

- 960 × 540 dp layout; top bar with WATCH / INBOX / LINK (dwell-to-switch, SELECT to open).
- WATCH: cross-fading hero backdrop (scrim baked into the JPEG), episode row, "Send from phone".
- Player: W3C `VideoPlayer` in URL mode with Vega Media Controls focus; Vega UI `SeekBar` with AI
  segment break markers, genre colours and segment labels; captions drawn from the transcript
  (the demo clips are silent); "new insight" chip; release on background, resume on return.
- Co-viewer panel (Reanimated slide, right 40%) opens on pause: composer picks up to three widgets
  for [t − 15 s, t + 4 s]; SELECT on a row seeks to its evidence; timeline events ahead of the
  viewer are locked behind a focus-trapped spoiler gate.
- Analysis is a hand-authored demo fixture in the agent schema, labelled on screen, until the AWS
  pipeline produces it.
- Media is served by `companion/server.mjs` at `/media/<file>` with byte ranges.

## Superseded by

The pairing model (one-shot links per action) and screen structure are replaced by the proposals
in [architecture.md](architecture.md) (AWS, 30-day phone tokens, the Link thread) and
[tv-experience.md](tv-experience.md) (top bar, WATCH / INBOX / LINK, remote map).

## Next phase candidates

1. Add the two demo podcast videos and a single-instance player; play/pause/seek with the remote.
2. WebSocket relay plus MediaPipe gestures on the phone page (pause/resume, open layer).
3. Transcript pipeline and the first layers: Dossier, Timeline, Catch-up.
