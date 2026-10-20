# Getting started

Verified on Ubuntu 26.04 (x86_64), Node.js 22.22, Vega SDK 0.24.12112, Vega CLI 1.4.5,
with 7 GB of RAM and a slow, unreliable network. Steps below are the ones that worked.

## 1. System prerequisites (Ubuntu)

```bash
sudo apt install -y gawk lz4 watchman curl     # curl must be the apt build, not the snap
```

- **KVM** must be available (`ls -l /dev/kvm`, and your user in the `kvm` group). The emulator needs it.
- **Node.js 22.14+** (`.nvmrc` pins 22).
- Roughly 20 GB of free disk. The SDK is about 4 GB on disk and the emulator image is extra.

macOS needs Homebrew packages instead; see Amazon's
[install guide](https://developer.amazon.com/docs/vega/0.24/install-vega-sdk.html).

## 2. Install the Vega SDK

```bash
curl -fsSL https://sdk-installer.vega.labcollab.net/get_vvm.sh | bash && source ~/vega/env
vega --version
```

The bootstrap installs the `vega` CLI and then downloads the SDK (about 1.2 GB) followed by a
second **Simulator** package (about 850 MB). Both are required: without the Simulator package the
emulator fails with `Vega Virtual Device not found at .../vvd/images/tv`.

If a download fails or stalls (the CLI cannot resume), use the retrying wrapper:

```bash
scripts/install-vega-sdk.sh            # optional argument: SDK version
```

It restarts the install when progress freezes for two minutes and keeps the download on disk
instead of in RAM-backed `/tmp`.

Add `source ~/vega/env` to your shell profile so `vega` is on the path in new terminals.

## 3. Build and run

```bash
npm install
npm run build:debug          # build/x86_64-debug/studiox_x86_64.vpkg
npm run vvd:start            # first start creates the emulator instance
npm run run:vvd              # installs and launches com.studiox.app.main
```

Low on memory? Start the emulator in a lighter mode:

```bash
vega virtual-device start --no-gl-accel --display-res=1280,720
```

On 8 GB machines, stop the emulator before building: `npm run rebuild` does this for you.

## 4. Emulator controls

| Remote button | Keyboard |
| --- | --- |
| Select | Enter |
| Up / Down / Left / Right | Arrow keys |
| Back | Esc |
| Home | F1 |
| Menu | F2 |
| Rewind / Play-Pause / Fast Forward | F3 / F4 / F5 |

## 5. Tests and checks

```bash
npm test
npm run typecheck
npm run lint
```

## Recording a demo

The emulator window contains the TV screen and an on-screen remote, and has no full-screen or
hide-remote option. To record only the TV picture, crop the screen recording to the left pane, or
demo on a physical Fire TV. See [troubleshooting](troubleshooting.md).
