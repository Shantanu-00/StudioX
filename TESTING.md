# Testing StudioX

Three ways in, from the quickest to the most complete. None of them needs an AWS account.
The demo build makes no live AI calls. It plays the two demo episodes from our CloudFront
distribution and shows the episode packages our AWS pipeline published.

| Path | Time | Needs |
| --- | --- | --- |
| [A. Run the tests](#a-run-the-tests-no-device) | ~5 min | Node 22, `uv` (for the Python tests) |
| [B. Build and run on the Vega Virtual Device](#b-build-and-run-on-the-vega-virtual-device) | 30–60 min the first time (SDK download) | Ubuntu 20.04+ x86_64 or macOS, KVM on Linux, ~20 GB disk |
| [C. Walk the demo with the remote](#c-what-to-try-with-the-remote) | 5 min | Path B |

What has been verified, and where: everything below has run on the **Vega Virtual Device**
(SDK 0.24.12112, x86_64). **No physical Fire TV was used.** Hardware performance and memory are
not measured. "Alexa, pause" is untested, because the Virtual Device has no voice.

## A. Run the tests (no device)

```bash
npm install
npm test              # Jest: TV screens, focus order, widgets, the Map, the player, the API client
npm run typecheck     # tsc --noEmit
npm run lint          # ESLint with the Vega plugin

# Backend (Python 3.13 via uv). Agent tests replay recorded Bedrock calls, so they run offline.
uv run --python 3.13 --with pytest pytest backend/shared/tests -q
uv run --python 3.13 --with pytest pytest backend/functions/pipeline/tests -q
(cd backend/functions/api && uv run --python 3.13 --with pytest pytest -q)
uv run --python 3.13 --with pytest --with strands-agents --with bedrock-agentcore pytest backend/agents/tests -q

# Infrastructure (no AWS calls)
(cd backend/infra && npm install && npx cdk synth -q)
```

Last results (23 Oct 2026): Jest 203 tests in 23 suites, and Python 137 tests (shared 78,
pipeline 17, API 18, agents 24). All passed.

> On a machine with 8 GB of RAM or less, run Jest with `npx jest --maxWorkers=1` and not while the
> Virtual Device is running.

## B. Build and run on the Vega Virtual Device

Full setup, including the Linux-specific steps that cost us time, is in
[docs/development/getting-started.md](docs/development/getting-started.md). The short version:

```bash
# 1. Vega SDK (installs the `vega` CLI, the SDK and the Simulator package)
curl -fsSL https://sdk-installer.vega.labcollab.net/get_vvm.sh | bash
source ~/vega/env                      # in every new shell

# 2. Build
npm install
npm run build:debug                    # -> build/x86_64-debug/studiox_x86_64.vpkg
                                       #    (build:release for x86_64, aarch64 and armv7)

# 3. Run
npm run vvd:start                      # Vega Virtual Device
npm run run:vvd                        # install and launch com.studiox.app.main
```

If `run:vvd` says `Couldn't find device 'VirtualDevice'` right after "Virtual device ready", wait
20 seconds and run it again (friction log F-66). On low-memory machines, use `npm run rebuild`. It
stops the emulator, builds, then restarts the emulator and relaunches the app.

**Remote keys on the Virtual Device:**

| Remote | Keyboard |
| --- | --- |
| D-pad | Arrow keys |
| Select | Enter |
| Back | Esc |
| Home / Menu | F1 / F2 |
| Rewind / Play-Pause / Fast forward | F3 / F4 / F5 |

On a real Fire TV running Vega OS, install `build/aarch64-release/studiox_aarch64.vpkg` (or armv7,
depending on the device) with `vega run-app <vpkg> com.studiox.app.main -d <device>` (not tested
by us).

## C. What to try with the remote

Each step lists what you should see.

1. **Launch.** A short title sting, then Home. Focus starts on **Play** for the first episode.
   Every focusable item shows a white focus ring.
2. **Play** *The Human Blueprint, Ep. 42* (a science and health clip). The video streams from
   CloudFront through Vega's W3C Media Source Extensions. Captions are under the video. The
   SeekBar shows the AI chapter markers.
3. **Press Play/Pause (F4).** The co-viewer panel slides in beside the paused frame, with cards for
   what has been said *up to the playhead* (no spoilers). There is a fact check with its verdict
   and sources, a dossier on the person named (portrait with licence credit), and the steps of the
   routine.
4. **Select the person or a card** to open its detail. **LEFT** or **Back** returns to the panel.
   Press **Back** again to close the panel, and once more to leave the player.
5. **Map.** From Home, choose **Map** (or **Show the map** in the player). The conversation is
   drawn as one picture. Choose **Play story** for a step-by-step walk, or **Try it** for a
   playable simulation (the night of sleep cycles, or compound growth in the money example).
6. **More maps.** Home → **More maps**: finance, tech and history examples, written by StudioX
   from sample transcripts and run through the same pipeline.
7. **The crime episode** (*Shadow Files, Case 104*): pause at about 0:20. The timeline sets the
   suspect's alibi against his phone records.
8. **Optional: phone link.** Home → **Link a phone** shows a QR code for the phone web app on
   CloudFront. Pairing goes through the deployed API (CloudFront → API Gateway → Lambda →
   DynamoDB). Uploads and live AI answers are switched off unless the owner turns on live mode
   (cost control). The rest of the app does not depend on the phone.

## Troubleshooting

[docs/development/troubleshooting.md](docs/development/troubleshooting.md) lists every problem we
hit with its fix. The [friction log](FRICTION_LOG.md) has the full story, with exact errors.
