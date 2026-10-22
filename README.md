# StudioX

An AI co-viewer for video podcasts on Fire TV, built with React Native for **Vega OS**.
You watch an episode; StudioX watches with you and, when you pause or ask, lays out dossiers on the
people, a timeline, claims with context, routines and concepts, each tied to the moment in the
episode. The remote is the controller; a phone is optional, for uploads and gesture control.
See the [product brief](docs/product/studiox-product-brief.md) and the
[design language](docs/product/design-language.md).

Submitted to the Amazon Devices hackathon: Fire TV track, AWS Builder mini challenge.

## Status

Phase 1 (details in [docs/product/phase-1.md](docs/product/phase-1.md)):

- A placeholder opening sting, then the library: two demo episode slots, **Upload your own** and
  **Connect phone camera**.
- QR pairing screens backed by the companion server in `companion/`, with phone pages for upload and
  camera permission.
- The debug build passes; Virtual Device and hardware runs of Phase 1 are still to do.

Not built yet: video playback and the demo episodes, gesture recognition, transcription and the
co-viewing layers, and AWS hosting.

## Quick start

Prerequisites: Ubuntu 20.04+ (x86_64) or macOS, Node.js 22.14+, KVM for the emulator, and about 20 GB
of free disk. Full instructions, including the Linux-specific steps, are in
[docs/development/getting-started.md](docs/development/getting-started.md).

```bash
source ~/vega/env          # load the Vega CLI (after installing the Vega SDK)
npm install
npm run build:debug        # produces build/x86_64-debug/studiox_x86_64.vpkg
npm run vvd:start          # start the Vega Virtual Device
npm run run:vvd            # install and launch StudioX on it
```

Emulator keys: arrows move focus, Enter selects, Esc goes back, F1 is Home, F4 is Play/Pause.

On a machine with 8 GB of RAM or less, do not build while the emulator is running. Use
`npm run rebuild`, which stops the emulator, builds, then restarts it and relaunches the app.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run build:debug` / `build:release` | Build the `.vpkg` packages (x86_64, aarch64, armv7) |
| `npm run vvd:start` / `vvd:stop` | Start or stop the Vega Virtual Device |
| `npm run run:vvd` | Install and launch the debug build on the virtual device |
| `npm run rebuild` | Memory-safe stop, build, restart and relaunch |
| `npm test` | Run the Jest tests |
| `npm run typecheck` | TypeScript check without emitting files |
| `npm run lint` | ESLint (`lint:fix` to auto-fix) |

## Repository layout

```
.
├── src/
│   ├── App.tsx            Root component registered by index.js
│   ├── screens/           Full-screen views (Playground, HelloVega)
│   ├── components/        Reusable UI (Tile)
│   ├── data/              Static data
│   └── assets/            Images
├── test/                  Jest tests, mirroring src/
├── scripts/               Setup and rebuild helpers
├── docs/
│   ├── product/           Product brief
│   └── development/       Setup guide and troubleshooting
├── manifest.toml          Vega app manifest (package id, components, OS version)
├── index.js               React Native entry point
└── package.json
```

`docs/local/` is for private working notes and is not part of the repository.

## Working with AI agents

[AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md) describe the repository for coding agents, including
the Amazon Devices Builder Tools MCP setup this project uses.

## License

MIT. See [LICENSE](LICENSE).
