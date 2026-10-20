# StudioX

AI-enhanced viewing and practice for Fire TV, built with React Native for **Vega OS**.
StudioX turns uploaded videos into experiences a viewer can understand, question and practise
along with. The TV is the main screen, the remote is the controller, and a paired phone is
planned for uploads, camera input and voice. See the [product brief](docs/product/studiox-product-brief.md).

Submitted to the Amazon Devices hackathon: Fire TV track, AWS Builder mini challenge.

## Status

Early development. What exists today:

- A Vega React Native app (`com.studiox.app`) that builds, installs and runs on the Vega Virtual Device.
- `Playground`, a remote-control sandbox: focusable cards, per-card counters, and a live display of
  the last remote key pressed. It is the current root screen.
- `HelloVega`, the unmodified helloWorld template screen, kept for reference.

Not built yet: video playback, the boxing and podcast experiences, the phone companion, and any AWS
integration. The product brief describes the intended direction; it does not describe shipped features.

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
