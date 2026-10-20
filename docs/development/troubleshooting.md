# Troubleshooting

Problems hit while setting StudioX up, with what fixed them.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `vega: command not found` | The Vega environment is not loaded in this shell | `source ~/vega/env`; add it to your shell profile |
| `Vega Virtual Device not found at .../vvd/images/tv` | The **Simulator** package was never installed. A manual install from the SDK archive skips it | Run the official `vega sdk install <version>` to completion, or `scripts/install-vega-sdk.sh` |
| SDK download freezes, or ends with `connection reset by peer` | The CLI cannot resume and has no stall timeout; the error text suggests permissions or disk space, which is misleading | `scripts/install-vega-sdk.sh` retries automatically |
| Machine runs out of memory during install | The CLI downloads into `/tmp`, which is RAM-backed on Ubuntu | The helper script sets `TMPDIR` to a disk location. Do not run two installs at once |
| Desktop freezes or the build is killed | Build plus emulator exceeds RAM on small machines | `npm run rebuild`, or start the emulator with `--no-gl-accel --display-res=1280,720` |
| Screenshot command fails | `vega exec vda` screenshot works only on physical devices | Capture the emulator window with the desktop screenshot tool |
| Emulator window is not full screen and shows a remote panel | The emulator has no full-screen or hide-remote option | Crop the recording to the TV pane, or use a physical Fire TV |
| Builder Tools MCP returns `PROJECT_CONTEXT_REQUIRED` | The server lost its project context | Call `set_project_context` again with the contents of `.adbt-config.json` |
| `vega sdk install` reports the version is already installed | A previous (possibly linked) install exists | `vega sdk uninstall <version>`, then install again |

## Useful checks

```bash
vega sdk list-installed            # installed SDK versions
vega virtual-device status         # whether the emulator is running
vega exec vda devices              # connected devices (the emulator is emulator-5554)
free -h                            # keep roughly 1 GB available while the emulator runs
```
