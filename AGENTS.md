# AGENTS.md

Guidance for coding agents working in this repository. Read this first, then [CLAUDE.md](CLAUDE.md)
(Amazon Devices Builder Tools MCP session setup and the hackathon logging duty).

## What this is

StudioX: a **podcast co-viewing** app for Fire TV on **Vega OS** (React Native), plus a small
companion server and phone web pages in `companion/`. Package id `com.studiox.app`, component
`com.studiox.app.main`, React Native 0.83, `@amazon-devices/react-native-kepler` 4.x.
Platform for all Builder Tools calls is `vega_os` (see `.adbt-config.json`).

## Repository map

| Path | Contents |
| --- | --- |
| `index.js` | React Native entry; registers `src/App.tsx` |
| `src/App.tsx` | Root: routes (intro → browse → player), module-scope resume state, the BACK chain |
| `src/screens/` | `Intro`, `Browse` (top bar + `sections/` WATCH / INBOX / LINK), `Player` |
| `src/player/` | `useVideoPlayer` (W3C VideoPlayer lifecycle), playback store, co-viewer panel, spoiler gate |
| `src/analysis/` | Widget schema + validation (the agent → TV contract), demo fixtures, pause-time composer |
| `src/widgets/` | One renderer per widget type (dossier, timeline, graph, compounds, routine, technique, claim) |
| `src/components/` | `FocusFrame` (the focus treatment), `TopBar`, `Backdrop`, `QrGlyph`, `Wordmark` |
| `src/hooks/`, `src/services/` | Pairing-session polling and the companion API client |
| `src/theme.ts`, `src/config.ts` | Design tokens on the 960 × 540 dp canvas; companion and media URLs |
| `src/data/` | `episodes.ts`: the two demo episodes (media URLs, posters) |
| `media/` | Demo episode sources and TV encodes (git-ignored, large). Never put media in `assets/`: the build packs it into the .vpkg. The one exception is the bundled intro video, `assets/raw/studiox-intro-v5.mp4` (790 KB) |
| `companion/` | Node 22 pairing/upload server (`server.mjs`) and phone pages (`public/`); see its README |
| `src/assets/` | Images (use `require('../assets/...')`) |
| `test/` | Jest tests mirroring `src/` (`*.spec.tsx`) |
| `manifest.toml` | Vega manifest: package id, OS version, components |
| `scripts/` | `install-vega-sdk.sh` (retrying SDK install), `rebuild-and-run.sh` (memory-safe rebuild) |
| `docs/product/` | Product brief, design language, architecture, phase status |
| `docs/development/` | Setup guide and troubleshooting |
| `docs/local/` | Private notes, friction log, install evidence. Git-ignored; never commit or publish |

## Commands

```bash
source ~/vega/env           # required in each new shell before any `vega` command
npm install
npm test                    # Jest
npm run typecheck           # tsc --noEmit
npm run lint                # ESLint
npm run build:debug         # -> build/x86_64-debug/studiox_x86_64.vpkg
npm run vvd:start           # Vega Virtual Device (stop with npm run vvd:stop)
npm run run:vvd             # install + launch on the emulator
npm run rebuild             # stop emulator, build, restart, relaunch (use on low RAM)
node companion/server.mjs   # pairing/upload server for the QR flows (port 8787)
```

## Conventions

- TypeScript, 2-space indent, single quotes, `.editorconfig` and `.prettierrc` apply.
- Remote and focus: use `Pressable` with `onFocus`, `hasTVPreferredFocus`, and `TVFocusGuideView`;
  read keys with `useTVEventHandler`. All imported from `@amazon-devices/react-native-kepler`.
- New screens go in `src/screens/` with a matching test in `test/screens/`. Give interactive
  elements a `testID` and an `accessibilityLabel`.
- Do not bundle React or React Native; the Vega system provides them.
- Keep dependencies minimal; the development network is slow, so avoid adding packages without need.
- Follow `docs/product/design-language.md`: black field, one crimson accent, mono for system text,
  `FocusFrame` for every focusable element. Avoid nested `Text` (see `index.js`).

## Constraints and cautions

- **Memory is tight (about 7 GB).** Do not build while the emulator runs. Do not run two installs or
  builds at once. Check `free -h` before heavy work.
- The `vega` CLI reference must be read before running `vega` commands (see CLAUDE.md workflow rules).
- `vega exec vda` screenshots do not work on the virtual device. The emulator console does: connect to
  `localhost:5554`, `auth` with `~/.emulator_console_auth_token`, then `screenrecord screenshot <dir>`
  (or `screenrecord start/stop` for video). Keys: `vega exec vda -s emulator-5554 shell "inputd-cli button_press KEY_RIGHT"`.
- Run Jest with `--maxWorkers=1`: the default worker count beside the VVD crashed the workstation.
- Never commit `build/`, `node_modules/`, `buildinfo.json`, `generated/`, `.env*`, `.aws/`, or `docs/local/`.
- Do not push to the remote or publish anything without the owner's explicit approval.
- Log real friction, redundant steps and feature requests as described in CLAUDE.md.
- When you use, configure or measure an AWS service or a Strands feature, append it in the same
  session to `submission/aws-builder-log.md` (local, git-ignored): update its inventory status
  (LIVE / DESIGNED / DROPPED), fill in measurements with their source, and add a dated finding.
  The Devpost write-up is built from that file.
- **Write to the scorebook as you go.** Anything that could score points (a platform primitive put to
  use, a measured number, a working flow, a screenshot-worthy moment) goes into
  `submission/scorebook.md` in the same session: the claim, its status (SHOWN / LIVE / BUILT /
  DESIGNED / DROPPED), the evidence (command, log line, trace, screenshot path), the device (VVD or
  Fire TV) and the shot that will show it. Numbers must be measured. Comparisons need both sides
  measured or a cited source. Never estimate a competitor's number. Vega platform primitives are the
  heroes of the write-up.
