# AGENTS.md

Guidance for coding agents working in this repository. Read this first, then [CLAUDE.md](CLAUDE.md)
(Amazon Devices Builder Tools MCP session setup and the hackathon logging duty).

## What this is

StudioX: a React Native for **Vega OS** app (Fire TV). Package id `com.studiox.app`, component
`com.studiox.app.main`, React Native 0.83, `@amazon-devices/react-native-kepler` 4.x.
Platform for all Builder Tools calls is `vega_os` (see `.adbt-config.json`).

## Repository map

| Path | Contents |
| --- | --- |
| `index.js` | React Native entry; registers `src/App.tsx` |
| `src/App.tsx` | Root component; chooses the active screen |
| `src/screens/` | Full-screen views: `Playground.tsx` (current root), `HelloVega.tsx` (template reference) |
| `src/components/` | Reusable UI such as `Tile.tsx` |
| `src/data/` | Static data |
| `src/assets/` | Images (use `require('../assets/...')`) |
| `test/` | Jest tests mirroring `src/` (`*.spec.tsx`) |
| `manifest.toml` | Vega manifest: package id, OS version, components |
| `scripts/` | `install-vega-sdk.sh` (retrying SDK install), `rebuild-and-run.sh` (memory-safe rebuild) |
| `docs/product/` | Product brief (vision, not a feature list) |
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
```

## Conventions

- TypeScript, 2-space indent, single quotes, `.editorconfig` and `.prettierrc` apply.
- Remote and focus: use `Pressable` with `onFocus`, `hasTVPreferredFocus`, and `TVFocusGuideView`;
  read keys with `useTVEventHandler`. All imported from `@amazon-devices/react-native-kepler`.
- New screens go in `src/screens/` with a matching test in `test/screens/`. Give interactive
  elements a `testID` and an `accessibilityLabel`.
- Do not bundle React or React Native; the Vega system provides them.
- Keep dependencies minimal; the development network is slow, so avoid adding packages without need.

## Constraints and cautions

- **Memory is tight (about 7 GB).** Do not build while the emulator runs. Do not run two installs or
  builds at once. Check `free -h` before heavy work.
- The `vega` CLI reference must be read before running `vega` commands (see CLAUDE.md workflow rules).
- `vega exec vda` screenshots do not work on the virtual device.
- Never commit `build/`, `node_modules/`, `buildinfo.json`, `generated/`, `.env*`, `.aws/`, or `docs/local/`.
- Do not push to the remote or publish anything without the owner's explicit approval.
- Log real friction, redundant steps and feature requests as described in CLAUDE.md.
