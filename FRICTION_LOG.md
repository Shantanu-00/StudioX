# StudioX friction log: Vega OS, Builder Tools MCP, Vega Virtual Device and AWS

> **For reviewers.** **48 friction entries** and **14 feature requests**, written *while* building
> StudioX for Fire TV on Vega OS, 19–23 October 2026. Severity: **2 Critical, 22 Major,
> 24 Minor**. Every entry records something that really happened, with the exact error text,
> command, tool version or file path. Where a cause is not confirmed, the entry says so.

Every entry has the six fields the hackathon rules ask for:

| Rule field | Where it is in each entry |
| --- | --- |
| Specific task attempted | **Task** |
| Steps taken | **Steps** |
| Expected vs. actual result | **Expected** / **Actual** (with exact output) |
| Severity rating | **Severity (normalised)**: Critical / Major / Minor, then the original note on impact |
| Workaround used | **Workaround** |
| Actionable suggestion | **Suggestion** (and a matching feature request where one helps) |

A few short entries (F-35, F-36) are research findings with fewer fields. They are marked as such.

**Environment:** Ubuntu 26.04.1 LTS (x86_64), 7 GiB RAM, a slow and unreliable network (about
0.3–1.1 MB/s), Node.js 22.22.1, Vega SDK 0.24.12112, Vega CLI 1.4.5, React Native 0.83,
`@amazon-devices/react-native-kepler` 4.0.1, `@amazon-devices/react-native-w3cmedia` 2.3.2, Amazon
Devices Builder Tools MCP (from Claude Code and Codex), Strands Agents 1.62, AWS CDK v2, us-east-1.

**What it cost:** about five hours from a clean machine to the first Hello World (mostly F-08 and
F-10). After the SDK and the Simulator package were installed, the first build and Virtual Device
launch worked the first time.

## Top five asks

1. **Make W3C URL-mode playback work on the Virtual Device, or document the raw-MSE fallback**
   (F-45, R-07). Our player failed with `MEDIA_ERR_SRC_NOT_SUPPORTED` before making any request. We
   shipped a raw `MediaSource` loader instead.
2. **A Virtual Device that looks like a TV and can be scripted**: 32-bit colour, GPU, 1:1 1080p,
   plus screenshot, key-press and log commands (F-44, F-14, F-63, R-05, R-08, R-14). AI agents
   cannot check a TV UI on their own without these.
3. **Docs and KB tables generated from the published RN 0.83 packages** (F-34, F-38, F-27, R-10).
4. **A Builder Tools MCP that agents can rely on**: context that survives a session, `init-context`
   that runs without prompts, and a `read_document` that can read every URI `search_documentation`
   returns (F-12, F-30, F-55, F-58, F-33).
5. **Reproducible, source-filtered web grounding in Bedrock** for fact checks (F-54, F-62, F-52,
   R-12, R-15).

Scope: only Amazon and AWS developer tools. Entries about third-party tools (renderers, browsers,
other AI clients) and our own code are left out. That is why some IDs are missing.


## Index

| ID | Area | Title | Severity |
| --- | --- | --- | --- |
| [F-45](#vega-tooling) | Vega SDK | W3C URL-mode playback fails on the VVD before any request; MSE works | Critical |
| [F-10](#vega-tooling) | Vega SDK | The Virtual Device image is a separate "Simulator" package that nothing announces | Critical |
| [F-08](#vega-tooling) | Vega SDK | SDK download fails with little information, cannot resume, and has no stall timeout | Major |
| [F-44](#vega-tooling) | Vega SDK | Virtual Device renders in 16-bit colour, with GPU off, through a 1280×720 skin | Major |
| [F-42](#vega-tooling) | Vega SDK | Root `assets/` folder is packed into the .vpkg, and stale copies survive rebuilds | Major |
| [F-63](#vega-tooling) | Vega SDK | An AI agent cannot drive or observe the Virtual Device without Appium, and stalled twice trying | Major |
| [F-66](#vega-tooling) | Vega SDK | `vega virtual-device start` reports "Virtual device ready" but the next `vega run-app` cannot find the device | Major |
| [F-78](#vega-tooling) | Vega SDK | Perf CLI will not start without `libjpeg.so.62` | Major |
| [F-79](#vega-tooling) | Vega SDK | KPI Visualizer on the VVD cannot parse its own traces (`perfetto.protos.TraceSummaryArgs`) | Major |
| [F-14](#vega-tooling) | Vega SDK | Recording a demo from the Virtual Device | Major |
| [F-11](#vega-tooling) | Vega SDK | No supported way to install from an already-downloaded archive | Major |
| [F-09](#vega-tooling) | Vega SDK | SDK setup on a memory-constrained desktop, with reported freezes | Major |
| [F-03](#vega-tooling) | Vega SDK | The MCP's SDK install document only lists Homebrew commands | Major |
| [F-04](#vega-tooling) | Vega SDK | The bootstrap script supports unattended mode, but the MCP document says to run it by hand | Major |
| [F-41](#vega-tooling) | Vega SDK | `build-vega` rewrites the source manifest.toml | Minor |
| [F-13](#vega-tooling) | Vega SDK | CLI diagnostics are noisy | Minor |
| [F-31](#vega-apis) | Vega APIs | Phase 1 layout assumed a 1920 × 1080 coordinate space; the 960 × 540 dp canvas was only in the RN 0.83 migration docs | Major |
| [F-34](#vega-apis) | Vega APIs | Vega docs disagree with installed RN 0.83 packages and with each other | Major |
| [F-38](#vega-apis) | Vega APIs | Vega 0.24 media setup and API reference specify different package versions | Major |
| [F-28](#vega-apis) | Vega APIs | Kepler Jest preset: BackHandler mock lacks `default`, KeplerAppStateManager unmocked | Major |
| [F-27](#vega-apis) | Vega APIs | RN 0.83 AppState docs point to an API the installed runtime does not export | Minor |
| [F-49](#vega-apis) | Vega APIs | `useToastKepler` needs a manifest privilege that its typings do not mention | Minor |
| [F-35](#vega-apis) | Vega APIs | Headless JS service crashes on RN 0.83 | Major |
| [F-29](#vega-apis) | Vega APIs | Cleartext HTTP policy is documented only for WebView apps | Minor |
| [F-65](#vega-apis) | Vega APIs | `StyleSheet.flatten` under the Vega Jest preset returns the style array unchanged | Minor |
| [F-59](#vega-apis) | Vega APIs | Vega ESLint plugin prints a long "system distributed library" warning on every import | Minor |
| [F-60](#vega-apis) | Vega APIs | Jest output is flooded with `codegenNativeComponent` debug lines from react-native-kepler | Minor |
| [F-20](#vega-apis) | Vega APIs | Current Vega documentation redirect paths did not reliably return page content to the web reader | Minor |
| [F-40](#adbt) | Amazon Devices Builder Tools MCP (AI-assisted development) | Builder Tools MCP connection timed out, which blocked the mandatory session setup | Major |
| [F-55](#adbt) | Amazon Devices Builder Tools MCP (AI-assisted development) | Builder Tools `init-context` cannot run non-interactively, even with `--agent` | Minor |
| [F-58](#adbt) | Amazon Devices Builder Tools MCP (AI-assisted development) | Builder Tools `read_document` fails on a URL that `search_documentation` just returned | Minor |
| [F-33](#adbt) | Amazon Devices Builder Tools MCP (AI-assisted development) | Builder Tools MCP: oversized list result, invalid URL for a documented page, empty searches | Minor |
| [F-01](#adbt) | Amazon Devices Builder Tools MCP (AI-assisted development) | Builder Tools MCP tools were missing at session start | Major |
| [F-12](#adbt) | Amazon Devices Builder Tools MCP (AI-assisted development) | Builder Tools MCP asked for project context again mid-session | Minor |
| [F-30](#adbt) | Amazon Devices Builder Tools MCP (AI-assisted development) | Builder Tools MCP lost its project context between turns | Minor |
| [F-06](#adbt) | Amazon Devices Builder Tools MCP (AI-assisted development) | `list_documents` for `vega_os` returned Fire OS and unrelated workflows | Minor |
| [F-05](#adbt) | Amazon Devices Builder Tools MCP (AI-assisted development) | The get-started guide shows a `read_document` call shape the tool rejects | Minor |
| [F-02](#adbt) | Amazon Devices Builder Tools MCP (AI-assisted development) | Mandatory platform question even though the user had already named the platform | Minor |
| [F-07](#adbt) | Amazon Devices Builder Tools MCP (AI-assisted development) | Required reading is large relative to the task | Minor |
| [F-54](#aws) | AWS: Amazon Bedrock | Web-grounded fact checks can rest a strong verdict on commercial wellness pages | Major |
| [F-62](#aws) | AWS: Amazon Bedrock | Web-grounded verdicts change between identical runs | Major |
| [F-52](#aws) | AWS: Amazon Bedrock | Nova 2 Lite web grounding citations carry no page title | Major |
| [F-61](#aws) | AWS: Amazon Bedrock | Strands structured output fails a short answer with `MaxTokensReachedException` | Minor |
| [F-50](#aws) | AWS: Amazon Bedrock | Claude 5.5 on Bedrock rejects `temperature` | Minor |
| [F-51](#aws) | AWS: Amazon Bedrock | A stray `AWS_REGION` silently moved Bedrock calls to another region | Minor |
| [F-53](#aws) | AWS: Amazon Bedrock | Restricted profile cannot read the stack outputs the owner scripts depend on | Minor |
| [F-36](#aws) | AWS: Amazon Bedrock | AWS docs: title-only pages and a misspelt BDA URL | Minor |
| [F-48](#aws) | AWS: Amazon Bedrock | `cdk synth --all` prints "Unknown option(s): --all" | Minor |

<a id="vega-tooling"></a>

## A. Vega SDK, CLI and Vega Virtual Device

### F-45 W3C URL-mode playback fails on the VVD before any request; MSE works
- **Severity (normalised):** Critical
- **Tool:** `@amazon-devices/react-native-w3cmedia` 2.3.2 on the VVD (x86_64), RN 0.83.
- **Task:** Play a 1080p H.264/AAC MP4 served over LAN HTTP.
- **Steps:** `VideoPlayer` + `KeplerVideoSurfaceView`; `setMediaControlFocus` → `initialize` → `setSurfaceHandle` → `src = url`. The companion server logs every media request.
- **Expected:** Range requests from the TV, then playback.
- **Actual:** `MEDIA_ERR 4` (`MEDIA_ERR_SRC_NOT_SUPPORTED`), and no media request in the server log, although pairing requests from the same TV arrived. Matches community thread 29117 (same SDK/RN/w3cmedia), where Amazon's own media samples also failed.
- **Severity:** Blocker for playback on the VVD.
- **Workaround:** Fragmented MP4 played through raw `MediaSource` + `SourceBuffer`, attached via `srcObject`, fetched in 2 MB range requests (`src/player/mseLoader.ts`). Verified on the VVD: the companion server log shows `Kepler/1.2 (Linux; AQVV01P)` fetching the episode in sequential 2 MB ranges, and the video plays.
- **Suggestion:** Fix URL mode on the VVD; until then, document "if URL mode fails, try MSE" and add a raw-MSE (no Shaka) example. The current docs cover MSE only through Shaka, hls.js and dash.js.

### F-10 The Virtual Device image is a separate "Simulator" package that nothing announces
- **Severity (normalised):** Critical
- **Tool:** `vega virtual-device start`, `vega sdk install`, SDK 0.24.12112
- **Task:** Start the emulator to run the built Hello World app.
- **Steps:** Ran `vega virtual-device start --no-gl-accel --displayRes 1280,720 --timeout 180` after installing the SDK from the downloaded archive.
- **Expected:** The emulator starts. Amazon's install page says the SDK install includes the Vega Virtual Device.
- **Actual:** Exit code 1 with `Vega Virtual Device not found at .../vvd/images/tv, please verify the installation`. The `vvd` folder held only `bin/` and `instances/` (20 KB). The emulator's own log said `failed to read manifest at .../images/tv/image_files`, and the component registry listed only `vega-sdk`. The cause turned out to be that the official `vega sdk install` downloads a second package after the SDK, reported in its progress output as `packageName: "Simulator"` (853,170,183 bytes). Neither the installer log nor the CLI output says that the image is a separate download.
- **Severity:** High. It blocks running any app on the emulator.
- **Workaround:** Let the official `vega sdk install` finish both packages. Afterwards the emulator booted and the app installed and launched.
- **Suggestion:** Make the error name the missing component and the command that installs it, report the image status in `vega sdk list-installed` or `vega platform doctor`, and document the Simulator as a separate download.

### F-08 SDK download fails with little information, cannot resume, and has no stall timeout
- **Severity (normalised):** Major
- **Tool:** `get_vvm.sh` bootstrap and `vega sdk install` (CLI 1.4.5)
- **Task:** Install SDK 0.24.12112 (a 1,231,316,061-byte download).
- **Steps:** Ran the bootstrap several times and `vega sdk install 0.24.12112 --non-interactive` directly.
- **Expected:** A usable SDK, or a failure that says which stage failed and how to resume.
- **Actual:**
  - The first bootstrap run ended after about 15 minutes with `Vega sdk command exit code: 3` and `_060_install_sdk failed with status: 3`. The log did not include the underlying error.
  - A later `vega sdk install` froze at 982,656,888 of 1,231,316,061 bytes (79.8%) for more than ten minutes. The process stayed alive with an idle connection and never timed out.
  - Another attempt ran for 68 minutes and then failed with `failed to write downloaded data: read tcp <ip>:<port>-><ip>:443: read: connection reset by peer`, followed by `Please check file permissions and available disk space`. That advice does not match the cause, and the real error only appeared with `--verbose`.
  - Partial downloads are not kept or resumed, so every failure restarts from zero.
  - The CLI downloads into `/tmp`, which is RAM-backed (tmpfs, 3.5 GB here), so a stalled download also holds about 1 GB of memory.
- **Severity:** High on an unreliable connection; it caused most of the five hours.
- **Workaround:** A wrapper script that watches progress, kills an attempt when progress freezes for two minutes, restarts it, and points `TMPDIR` at disk. A separate `curl --continue-at` download also resumed successfully across several "operation too slow" timeouts.
- **Suggestion:** Resume partial downloads and verify them with the published SHA-256, add a stall timeout, honour `TMPDIR` or a cache directory, print the real error with network-specific advice, and report bytes retained and a concrete resume command.

### F-44 Virtual Device renders in 16-bit colour, with GPU off, through a 1280×720 skin
- **Severity (normalised):** Major
- **Tool:** Vega Virtual Device, SDK 0.24.12112.
- **Task:** Judge text sharpness and image quality of the TV UI.
- **Steps:** Ran the app on the VVD; text looked soft and jagged. Inspected `vvd/instances/<id>/hardware-qemu.ini` and `virtual_device.log`.
- **Expected:** A display representative of a 1080p Fire TV.
- **Actual:** `hw.lcd.depth = 16`; the emulator is launched with `-gpu off` and `-skin tv-remote-skin1280x720`, so the 1920×1080 frame is quantised to RGB565, software-composited, downscaled to 1280×720 and stretched to the window. The VVD documentation does not mention these limits.
- **Severity:** Moderate: hours spent on font changes that cannot fix emulator output; demo videos recorded from the VVD will look worse than the app is.
- **Workaround:** Fix only app-side causes (scaled text, fractional tracking), and judge visuals on hardware.
- **Suggestion:** Document the VVD display pipeline, and offer 32-bit, GPU-on and 1:1 1080p capture options for demo recording.

### F-42 Root `assets/` folder is packed into the .vpkg, and stale copies survive rebuilds
- **Severity (normalised):** Major
- **Tool:** Vega CLI 1.4.5 / `react-native build-vega` (SDK 0.24.12112).
- **Task:** Keep 146 MB of demo source video next to the project for encoding and local streaming.
- **Steps:** Put the clips in a root `assets/` folder; `npm run build:release`; later moved them to `media/` and rebuilt.
- **Expected:** Only assets referenced by the app (`require(...)`) are packaged; moving files out of `assets/` removes them from the next build.
- **Actual:** `build/x86_64-release/studiox_x86_64.vpkg` grew from about 3 MB to 172,792,438 bytes; the clips were copied to `build/private/vega/<arch>/<type>/assets/`. After moving them out, the next build was still 172,792,362 bytes because the staged copies were not cleaned. Only `rm -rf build` restored a 764,539-byte package. No build warning mentioned package size.
- **Severity:** Moderate: slow install, larger memory footprint risk, and time lost suspecting the app code for slowness.
- **Workaround:** Keep media in a non-packed `media/` folder and delete `build/` after moving assets.
- **Suggestion:** Clean the staged `assets/` on every build, and warn when a package exceeds a size threshold or contains large media files.

### F-63 An AI agent cannot drive or observe the Virtual Device without Appium, and stalled twice trying
- **Severity (normalised):** Major
- **Tool:** Vega Virtual Device (SDK 0.24.12112), `vega exec vda shell`, 23 Oct 2026.
- **Task:** End-to-end check of the Map feature with the D-pad: press keys, see the result, read app logs.
- **Steps:** A build agent tried to create a key-press/screenshot helper. The lead then tried `vega exec vda shell "loggingctl log --since '-5m'"` and `"timeout 8 loggingctl log | grep -i studiox"`.
- **Expected:** A scriptable way to press remote keys, capture the screen and read the app's logs.
- **Actual:** The agent stalled twice ("no progress for 600s"). Its last step was building that helper; the exact blocking command is unconfirmed. The `loggingctl` calls returned 0 lines while StudioX was running.
  - Amazon community thread 29258 documents the same gap. On the VVD the screenshot tool "writes a 0-byte file or hangs". `inputd-cli`, QEMU send-key and the emulator console "report success and never reach an app". Appium is the only documented path.
- **Severity:** Important for AI-assisted development: an agent cannot verify a TV UI on its own, so every visual check needs a person at the remote panel.
- **Workaround:** Component tests in Jest for focus order, lock states and visible text, plus a human walkthrough checklist on the VVD.
- **Suggestion:** `vega device press` and `vega device screenshot` for the VVD (as R-05 and the community thread ask), and a documented `loggingctl` filter by app ID.

### F-66 `vega virtual-device start` reports "Virtual device ready" but the next `vega run-app` cannot find the device
- **Severity (normalised):** Major
- **Tool:** Vega CLI, SDK 0.24.12112 (`kepler --v` reports 0.200.0), 23 Oct 2026, 12:38.
- **Task:** Memory-safe rebuild: stop the VVD, build debug, start the VVD, install and launch (`scripts/rebuild-and-run.sh`).
- **Steps:** `vega virtual-device start --timeout 300` printed "Launching virtual device. Waiting for virtual device to boot. Virtual device ready." Then `vega run-app build/x86_64-debug/studiox_x86_64.vpkg com.studiox.app.main -d VirtualDevice` ran immediately.
- **Expected:** "Ready" means the device accepts installs.
- **Actual:** `Vega operation FAILED due to an irrecoverable error: Couldn't find device 'VirtualDevice': Device not found: Cannot find an instance of Vega Virtual Device, launch the virtual device and try again.` (exit 254). The same command 20 s later installed and launched. The same script succeeded at 11:40 the same day, so the race is intermittent.
- **Severity:** Medium. A scripted rebuild fails after the slow step, and the error tells you to launch a device that is already running.
- **Workaround:** Wait about 20 s after "ready" (or retry `run-app` once) before installing.
- **Suggestion:** `virtual-device start` should return only once the device is installable, or `run-app` should wait or retry briefly when a VVD process exists. Also ship `vvman` or stop warning that it is missing on every start (`vvman command not found or failed`).

### F-14 Recording a demo from the Virtual Device
- **Severity (normalised):** Major
- **Tool:** Vega Virtual Device, `vega exec vda` screenshot tool
- **Task:** Produce a full-screen demo video and screenshots of the app.
- **Steps:** Started the emulator with default settings and measured its window under XWayland; read the screenshot tool's documentation and the `start` and `launch` help text.
- **Expected:** A full-screen mode, or a way to hide the on-screen remote, and a screenshot command that works on the emulator.
- **Actual:** The emulator is a normal window (about 1918x893 inside a 1968x980 frame on a 1920x1080 screen) that contains both the TV picture and a remote panel. The only documented start options are `--no-gui`, `--no-gl-accel` and `--display-res`; `launch` adds `--memory-mb`, `--cpu-cores`, `--audio-off` and `--writable-rootfs`. The screenshot tool's documentation says it "only works on physical Vega or Kepler devices. It does NOT work on virtual devices."
- **Severity:** Medium for a hackathon demo.
- **Workaround:** Crop a desktop screen recording to the TV pane, or demo on a physical Fire TV.
- **Suggestion:** See R-05 and R-06.

### F-11 No supported way to install from an already-downloaded archive
- **Severity (normalised):** Major
- **Tool:** `vega sdk install`, the SDK self-extracting installer, `vega sdk link`
- **Task:** Finish the install after the 1.2 GB archive had been downloaded and its SHA-256 verified.
- **Steps:** Read the installer header, ran it with `-d ~/kepler/sdk/0.24.12112`, then ran `vega sdk link --path` on that directory and `vega sdk use 0.24.12112`.
- **Expected:** `vega sdk install` can use an existing archive.
- **Actual:** It has no such option and would have restarted the download. The manual route worked (`vega --version` printed `Active SDK Version: 0.24.12112`), but it skipped the Simulator package (F-10), and the directory layout was a guess based on `vega sdk link --help`.
- **Severity:** Medium on a poor connection.
- **Workaround:** The manual steps above, followed later by the official install for the Simulator.
- **Suggestion:** Document this path, or add `vega sdk install --from-file <archive>` that verifies the checksum, registers the SDK and installs the Simulator.

### F-09 SDK setup on a memory-constrained desktop, with reported freezes
- **Severity (normalised):** Major
- **Tool:** Vega setup on Ubuntu 26.04.1
- **Task:** Retry SDK setup without making the desktop unresponsive.
- **Steps:** Checked `free -h`, `df -h`, memory pressure and the previous boot's kernel log.
- **Actual:** 7.0 GiB RAM total with 1.5 GiB available and 838 MiB swap in use at the start. The previous boot's kernel log contained `NVRM: nvCheckOkFailedNoLog: Check failed: Out of memory [NV_ERR_NO_MEMORY]`. Those are NVIDIA allocation errors; they do not prove a Linux out-of-memory kill or that Vega caused the desktop freezes the developer reported. No freeze was reproduced afterwards.
- **Severity:** High user impact (reported hangs); attribution unconfirmed.
- **Workaround:** Disk-backed `TMPDIR`, a single installer, lower CPU and I/O priority, and systemd limits (`MemoryHigh=768M`, `MemoryMax=1536M`). Later, the emulator is started with `--no-gl-accel` and a smaller `--display-res` on low memory, and is stopped before builds.
- **Suggestion:** Detect RAM-backed temporary storage and low memory before large downloads, state the expected disk and memory needs, and offer a bounded-resource install mode.

### F-03 The MCP's SDK install document only lists Homebrew commands
- **Severity (normalised):** Major
- **Tool:** `vega_sdk_installation.md` (Builder Tools MCP document)
- **Task:** Install system dependencies on Ubuntu.
- **Steps:** Read the document (it states "macOS 10.15+ or Ubuntu 20.04+"), reached the dependency check, and found it uses `brew list --formula`. The machine had no Homebrew.
- **Expected:** An Ubuntu path with apt package names.
- **Actual:** Only Homebrew commands (`binutils coreutils gawk findutils grep jq lz4 gnu-sed watchman`) and a macOS-only Rosetta check. Mapping them to apt was left to the reader. On Ubuntu only `gawk`, `lz4` and `watchman` were missing.
- **Note:** Amazon's public installation page does have a separate Ubuntu dependency section. This entry concerns the MCP document, not all Amazon documentation.
- **Severity:** Medium for Linux developers.
- **Workaround:** `sudo apt install gawk lz4 watchman`.
- **Suggestion:** Add a Linux branch to the MCP document, and state which Ubuntu versions were tested (26.04 is newer than the "20.04+" examples).

### F-04 The bootstrap script supports unattended mode, but the MCP document says to run it by hand
- **Severity (normalised):** Major
- **Tool:** `get_vvm.sh`, `vega_sdk_installation.md`
- **Task:** Let an AI agent install everything needed to start building.
- **Steps:** Read the MCP install document, then read the downloaded `get_vvm.sh`.
- **Expected:** One documented non-interactive path.
- **Actual:** The document says the bootstrap is interactive, that the agent must not run it, and that `vega sdk install --non-interactive` needs `vega` already on the PATH (circular on a fresh machine). The script itself reads `NONINTERACTIVE=true` and `SKIP_SDK_INSTALL=true`, which the document never mentions. Separately, `sudo apt install` needs a human for the password.
- **Severity:** Medium. Two manual hand-offs on every fresh setup.
- **Workaround:** The developer ran the commands in the session with the `!` prefix.
- **Suggestion:** Document the environment variables, and publish the Linux dependency list as one copy-paste line.

### F-41 `build-vega` rewrites the source manifest.toml
- **Severity (normalised):** Minor
- **Tool:** Vega CLI 1.4.5 / `react-native build-vega` (SDK 0.24.12112).
- **Task:** Build after adding w3cmedia, kepler-media-controls, Reanimated and Worklets.
- **Steps:** `npm run build:debug` with a hand-written `manifest.toml` containing comments.
- **Expected:** The build reads the manifest and writes any generated additions into the build output.
- **Actual:** The build edited the checked-in `manifest.toml`, inserting six `[[needs.module]]` entries (for example `/com.amazon.kepler.w3cmedia_2@IW3cmedia_3`, `/com.amazon.kepler.reanimated_4@IReanimated_0`) plus blank lines between an explanatory comment and the `[wants]` table it described. It reported "manifest validation found 0 errors".
- **Severity:** Minor; source-control noise and misplaced comments.
- **Workaround:** Accept the generated `needs` entries and move the comment back by hand.
- **Suggestion:** Write generated module needs to the build-output manifest, or print a diff and ask before changing source files.

### F-13 CLI diagnostics are noisy
- **Severity (normalised):** Minor
- **Tool:** `vega virtual-device status`, `vega platform doctor`
- **Task:** Check whether a virtual device exists and whether the platform is ready.
- **Actual:** `virtual-device status` printed `[WARN] vvman command not found` and `kepler command result: 0.200.0` before its real message (`cannot find virtual device instance: default_instance`). `platform doctor` began by printing the whole shell environment, including a very long `BRAZIL_BUILD_TOOLS` path and session variables. Only the first part of its output was read, so whether it ends with a clear pass or fail summary is not verified.
- **Severity:** Low. It wastes context and can expose environment variables when output is shared.
- **Workaround:** Filter the output and avoid pasting `doctor` output publicly.
- **Suggestion:** Put a pass or fail summary first, make the environment dump opt-in and redacted, and drop the legacy `vvman` and `kepler` fallback warnings.

<a id="vega-apis"></a>

### F-78 Vega perf CLI (KPI Visualizer) will not start: `libjpeg.so.62` missing on Ubuntu 26.04
- **Severity (normalised):** Major
- **Tool:** `vega exec perf doctor` / `kpi-visualizer`, KeplerPerfCLI 2.0.345.0 (SDK 0.24.12112), Vega CLI 1.4.5, Ubuntu 26.04.1 LTS, 23 Oct 2026.
- **Task:** Measure cold-start, warm-start and memory KPIs for the submission.
- **Steps:** `vega exec perf doctor --app-name=com.studiox.app.main`.
- **Expected:** The device check runs.
- **Actual:** Python traceback before any check: `…/KeplerPerfCLI/…/lib/PIL/Image.py … ImportError: libjpeg.so.62: cannot open shared object file: No such file or directory` (pulled in through `kpi_reporter.py` → `pdf_report_generator.py` → matplotlib → the bundled Pillow). The host only has `libjpeg.so.8`.
- **Severity:** Major. Every perf command fails, including the ones that need no PDF.
- **Workaround:** No root needed: `apt download libjpeg62 && dpkg -x libjpeg62_*.deb ~/.local/vega-libs`, then `export LD_LIBRARY_PATH=~/.local/vega-libs/usr/lib/x86_64-linux-gnu`. Doctor then ran.
- **Suggestion:** Bundle libjpeg with the bundled Pillow (or use a manylinux Pillow wheel), list it in the Linux prerequisites, and import the PDF reporter lazily so a missing image library cannot block KPI measurement.

### F-79 KPI Visualizer on the Virtual Device completes 3 iterations but cannot parse its own traces: `perfetto.protos.TraceSummaryArgs`
- **Severity (normalised):** Major
- **Tool:** `vega exec perf kpi-visualizer`, KeplerPerfCLI 2.0.345.0, VVD `vvrp-tv-x64-user OS 1.2 (TV Ship/102401320)`, 23 Oct 2026.
- **Task:** Cold-start TTFF/TTFD for StudioX, to show against Amazon's guidelines in the demo.
- **Steps:** (after the F-78 workaround) `vega exec perf kpi-visualizer --app-name=com.studiox.app.main --kpi cool-start-latency --output-dir …`.
- **Expected:** A KPI report with TTFF (and TTFD if the app reports fully drawn).
- **Actual:** All 3 iterations launched the app and downloaded traces (`iter_1_vs_trace`, 9.6 MB), then: `Failed to load and parse trace json file for iteration 1, exception = 'perfetto.protos.TraceSummaryArgs'` (the same for 2 and 3), `Data for this iteration will be ignored`. The report JSON has `"kpis": []`. `perf doctor` had only warnings (network not connected, Appium not installed).
- **Severity:** Major. No launch or memory KPI could be measured on the VVD before the deadline, so the demo shows only package-size figures.
- **Workaround:** None found in the time available. The raw traces are kept for later analysis.
- **Suggestion:** Pin the Perfetto Python and trace-processor versions together inside the CLI, print the full exception (not only the missing key), and add a `perf doctor` check that parses a sample trace.

## B. Vega APIs, packages and documentation

### F-31 Phase 1 layout assumed a 1920 × 1080 coordinate space; the 960 × 540 dp canvas was only in the RN 0.83 migration docs
- **Severity (normalised):** Major
- **Tool:** Vega 0.24 docs and Builder Tools KB; StudioX Phase 1 code (agent error).
- **Task:** Lay out the home and pairing screens for TV.
- **Steps:** Sized the screens with 1080p values (96 dp margins, 330 dp cards). The user ran the build on the Virtual Device and took a screenshot.
- **Expected:** The full home screen, including the Upload and Camera tiles, visible.
- **Actual:** The content needed about 845 dp of height on a 540 dp canvas; everything below the episode cards was off-screen. The canvas size ("The Vega canvas reference size is 960x540 dp") appears in the Density-Independent Pixels page under RN 0.83 Migration. The get-started, focus and UI-component KBs read for this work do not mention it. The engineering contract did warn against assuming 4K/1080 coordinates; the mistake was the agent's.
- **Severity:** Moderate; primary actions unreachable on the first VVD run.
- **Workaround:** Re-derive tokens for 960 × 540 dp and use `useWindowDimensions()` (see `docs/product/tv-experience.md`).
- **Suggestion:** State the default dp canvas in the React Native for Vega get-started KB and new-project template, not only in migration docs.

### F-34 Vega docs disagree with installed RN 0.83 packages and with each other
- **Severity (normalised):** Major
- **Tool:** Vega 0.24 docs, Builder Tools KB, `@amazon-devices/react-native-kepler` 4.0.1.
- **Task:** Choose package versions and APIs for media, carousel, focus and animation.
- **Actual (examples, from the research notes):** FocusManager KB shows `setNextFocus(source, direction, target)` and `await getFocused()`; installed 4.0.1 is `setNextFocus(fromTag, toTag, direction)` and synchronous `getFocused()`. Docs name `VegaMediaControlHandler` and `useVegaWindowDimensionsV2`; only `Kepler`-prefixed names are exported. Carousel KB says `kepler-ui-components ~2.0.0` / `vega-carousel ^0.1.0`; the upgrade guide requires 3.x / `~1.0.0`. FlashList KB says use upstream `@shopify/flash-list@2.1.0`; the official page lists the wrapped package. The headless page lists `w3cmedia ~4.0.0`, which is not on npm. Reanimated babel plugin path differs between the 0.24 page and vega-video-sample. The virtual keyboard KB says "On Vega (Android-based)".
- **Severity:** Moderate; each needs checking against the installed package or a sample.
- **Workaround:** Pin to the RN 0.83 `vega-video-sample` package set and verify exports in `node_modules`.
- **Suggestion:** Generate API names and version tables from the published packages.

### F-38 Vega 0.24 media setup and API reference specify different package versions
- **Severity (normalised):** Major
- **Date / status:** 2026-10-21 / Unresolved for integration; documented for planning
- **Tool:** Official Amazon Vega 0.24 documentation, retrieved through Codex `web.run` (version not exposed).
- **Task:** Confirm that a native media intro can be the first screen in an RN 0.83 app.
- **Steps:** Read `https://developer.amazon.com/docs/vega/0.24/media-player-setup` and `https://developer.amazon.com/docs/vega-api/0.24/README.amazon-devices_react-native-w3cmedia` in the same research session.
- **Expected:** Matching package and Babel setup guidance for the current SDK/RN version.
- **Actual:** The setup guide specifies `@amazon-devices/react-native-w3cmedia: ~2.1.80` and includes an RN 0.72 / `metro-react-native-babel-preset` example. The API reference specifies `~2.3.2`. Both URLs identify Vega 0.24. No player package was installed and neither version was runtime-tested in this task.
- **Severity:** Moderate; blindly copying either setup obscures compatibility and could overwrite a working RN 0.83 Babel configuration.
- **Workaround:** Recorded the inconsistency; retained the existing architecture's `~2.3.2` planning choice pending RN 0.83 sample/package verification and a playback smoke test.
- **Suggestion:** Provide RN-version tabs for media setup and generate its dependency/version guidance from the same source as the API reference.

### F-28 Kepler Jest preset: BackHandler mock lacks `default`, KeplerAppStateManager unmocked
- **Severity (normalised):** Major
- **Tool:** `@amazon-devices/react-native-kepler` 4.0.1 Jest preset (`jest/setup.js`, `jest/mocks/BackHandler.js`).
- **Task:** Unit-test screens that register a BACK handler and an app-state listener.
- **Steps:** Rendered `App` and `Pairing` with `@testing-library/react-native` under the preset.
- **Expected:** Preset mocks make `BackHandler` and `useKeplerAppStateManager` usable in tests.
- **Actual:** `TypeError: Cannot read properties of undefined (reading 'addEventListener')` at `BackHandler.addEventListener`: the mock uses `module.exports = {...}` but `index.js` reads `require('./Libraries/Utilities/BackHandler').default`. `useKeplerAppStateManager` failed with `TypeError: _KeplerAppStateManagerSpec.default.addEventListener is not a function`. A first attempt to override with `jest.mock('@amazon-devices/react-native-kepler/Libraries/...')` had no effect, because the package `exports` map resolves to the generic `.js` file rather than the `.kepler.js` file the preset resolves.
- **Severity:** Moderate; blocked tests for any screen with BACK handling until worked around.
- **Workaround:** A project `test/setup.ts` that mocks both modules by relative `node_modules` path.
- **Suggestion:** Export a `default` from the BackHandler mock and ship a KeplerAppStateManager mock in the preset.

### F-27 RN 0.83 AppState docs point to an API the installed runtime does not export
- **Severity (normalised):** Minor
- **Tool:** Vega 0.24 docs (React Native for Vega 0.83 AppState page) and Builder Tools KB `vega_app_state_api.md`; `@amazon-devices/react-native-kepler` 4.0.1+rn0.83.0.
- **Task:** Pause pairing-status polling when the TV app goes to the background.
- **Steps:** Searched the docs for app-state handling, read the RN 0.83 AppState page and the MCP KB, then inspected the installed package exports.
- **Expected:** One consistent recommendation that matches the installed package.
- **Actual:** The RN 0.83 page says AppState from `react-native` is "@deprecated. For App State support for React Native for Vega Interactive Applications, see VegaAppState. Do not use the AppState module provided through 'react-native'." The MCP KB still recommends `AppState` or `KeplerAppState` and links 0.72 pages. The installed `react-native-kepler` 4.0.1 exports `useKeplerAppStateManager`; no `VegaAppState` export was found.
- **Severity:** Minor; cost a detour to inspect type declarations.
- **Workaround:** Used `useKeplerAppStateManager().addAppStateListener('change', …)` from the installed package.
- **Suggestion:** Align the RN 0.83 page, the MCP KB and the package exports; if `VegaAppState` is planned, state which package version provides it.

### F-49 `useToastKepler` needs a manifest privilege that its typings do not mention
- **Severity (normalised):** Minor
- **Tool:** `@amazon-devices/react-native-kepler` 4.0.x (`Libraries/Components/ToastKepler/ToastKepler.d.ts`), Vega SDK 0.24, RN 0.83. 22 Oct 2026, Agent C.
- **Task:** Confirm "Send to phone" with the Vega system toast.
- **Steps:** 1. Read the `.d.ts` (exports `useToastKepler`, `ToastKeplerDuration`; `show({title, description, iconUri, ...})`). 2. Read `ToastKepler.kepler.js` (posts through the `NotificationManager` TurboModule, loaded with `getEnforcing`). 3. Searched the Builder Tools docs for "useToastKepler toast notification manifest privilege".
- **Expected:** The typings or JSDoc say what the manifest must declare.
- **Actual:** Only the docs page says it: "To use the hook, request the com.amazon.notification.privilege.post privilege in the app manifest.toml file." `iconUri` is required (an HTTP(S) URL or `file:///` path) and there is no default icon. Nothing in the package mentions the privilege.
- **Severity:** Minor. Found with one docs search. Without that search, the toast would silently not appear (unverified: what happens without the privilege was not tested).
- **Workaround:** The toast sits behind `FEATURES.systemToast` (off). The app shows an in-app "Sent to <phone>" line until the privilege is added to the manifest.
- **Suggestion:** Put the required privilege in the hook's JSDoc and `.d.ts`. Log a clear runtime warning when the privilege is missing. Make `iconUri` optional and default it to the app icon.

### F-35 Headless JS service crashes on RN 0.83
- **Severity (normalised):** Major
- **Tool:** Vega 0.24 headless tasks/services (reported in docs/forum; not reproduced by us).
- **Actual:** `ReferenceError: Property '__DEV_RUNTIME__' doesn't exist`; the documented workaround flag `"useSystemJsBundlesForHeadlessJs": false` must not ship to the Appstore. Status: UNVERIFIED locally.
- **Impact on StudioX:** dropped the headless playback service from the plan.
- **Suggestion:** Fix or clearly flag in the headless playback docs for RN 0.83.

### F-29 Cleartext HTTP policy is documented only for WebView apps
- **Severity (normalised):** Minor
- **Tool:** Vega 0.24 docs ("Build Web Apps with Vega WebView") and app-manifest docs.
- **Task:** Let the React Native TV app call a plain-HTTP development server on the LAN.
- **Steps:** Searched the docs for a network or cleartext privilege that applies to `fetch` in an RN app.
- **Expected:** A statement of whether RN `fetch`/media requests to `http://` are allowed, and how to allow them.
- **Actual:** `[network-traffic-policy.cleartext]` is documented only for WebView 4.0.2 (RN 0.83): "If no network-traffic-policy.cleartext section is present in the manifest, all HTTP requests are blocked." A community thread links a media URL-mode error 50004 to the same policy, so it may apply more widely. The manifest validator accepted the section (0 errors) in an RN app. Runtime effect on `fetch` is still unverified.
- **Severity:** Minor so far; uncertainty about whether development traffic will work.
- **Workaround:** Added a narrow `allowed-domains` list for the development hosts; production will use HTTPS.
- **Suggestion:** Document the policy's scope for RN `fetch`, WebSocket and media playback, and whether IP addresses are valid entries.

### F-65 `StyleSheet.flatten` under the Vega Jest preset returns the style array unchanged
- **Severity (normalised):** Minor
- **Tool:** `@amazon-devices/react-native-kepler` Jest preset (23 Oct 2026)
- **Task:** Assert that a focused portrait ring has `borderWidth: 2` and a white `borderColor` in `test/player/CoViewPanel.spec.tsx`.
- **Steps:** `StyleSheet.flatten(node.props.style)` on a `[base, focusedOverride]` style array, then `expect(...).toEqual(expect.objectContaining({...}))`.
- **Expected:** One merged style object, as in stock React Native.
- **Actual:** The assertion failed with `Received: [{"borderColor": "transparent", "borderRadius": 32, "borderWidth": 2}, {"borderColor": "#F5F5F7"}]`: the array came back unflattened. Cause not confirmed (the preset's StyleSheet mock versus the import path).
- **Severity:** Low. One extra test iteration.
- **Workaround:** Merge in the test: `Object.assign({}, ...[style].flat())`.
- **Suggestion:** Make the preset's `StyleSheet.flatten` match React Native, or document that it is a pass-through.

### F-59 Vega ESLint plugin prints a long "system distributed library" warning on every import
- **Severity (normalised):** Minor
- **Tool:** `@amazon-devices/eslint-plugin-kepler` ^0.1.4, rule `@amazon-devices/kepler/sdl-package-version-check-imports`, 22–23 Oct 2026.
- **Task:** Lint the TV app (`npx eslint src test --ext .ts,.tsx`) as a gate before every build.
- **Expected:** One notice about system-distributed libraries, or a per-project acknowledgement.
- **Actual:** Each import of react-native-kepler, reanimated, svg or w3cmedia produces a roughly 400-character warning: "… is a system distributed library. This is not an error. However, please see the React Native for Vega documentation …". The count grew from 7 to 34 as the app grew, and real warnings (such as `no-script-url`) were buried among them.
- **Severity:** Minor (noise). It slows review of real lint output, by people and by AI agents.
- **Workaround:** Filter the output for `error` and `problems`. The warning text says it can be turned off "once you understand the implications", but we did not find the switch quickly.
- **Suggestion:** Warn once per package per run, or offer a documented `acknowledgedSystemLibraries` option, and print a short message with a link.

### F-60 Jest output is flooded with `codegenNativeComponent` debug lines from react-native-kepler
- **Severity (normalised):** Minor
- **Tool:** `@amazon-devices/react-native-kepler` 4.x under Jest 29 (`test/setup.ts`), 22 Oct 2026.
- **Task:** Run unit tests for screens that use `@amazon-devices/react-native-svg` (CoViewPanel, NightScene, widgets).
- **Expected:** Quiet test output that shows only failures.
- **Actual:** Dozens of `console.debug` lines per suite, such as "RNSVGFeGaussianBlur is registered in codegenNativeComponent" / "RNSVGFilter is registered in codegenNativeComponent" `at debug (node_modules/@amazon-devices/react-native-kepler/Libraries/Utilities/codegenNativeComponent.js:82:11)`. A real assertion failure had to be found with grep.
- **Severity:** Minor (noise, wasted time).
- **Workaround:** Pipe the output through `grep -E "^Tests:|✕|●"`.
- **Suggestion:** Gate the debug log behind an environment flag, or keep it out of the Jest preset.

### F-20 Current Vega documentation redirect paths did not reliably return page content to the web reader
- **Severity (normalised):** Minor
- **Date / status:** 2026-10-19 / Partially worked around
- **Tool/API/SDK:** Codex web research reader and public Amazon Vega documentation; versions not exposed
- **Task attempted:** Verify current media-resource and memory guidance for scope planning.
- **Steps taken:** 1. Opened `/docs/vega/latest/measure-app-kpis` and `/docs/vega/latest/media-player-requirements`. 2. Followed their indicated 0.24 `.html` paths. 3. Tried the versioned media requirements page without `.html`.
- **Expected result:** Readable current documentation after redirect resolution.
- **Actual result:** Latest pages exposed a redirect title and iframe only. The `.html` reads returned `(400) Timeout fetching`; the versioned KPI page returned `Cache miss`. The versioned media requirements page without `.html` succeeded. This does not establish that the pages fail in an ordinary browser.
- **Severity:** Low. Added lookups and left the current KPI numeric target unverified.
- **Workaround:** Used the readable 0.24 media guidance; avoided treating an older indexed memory KPI as a current allocation guarantee.
- **Actionable suggestion:** Make canonical documentation URLs/redirects consistently readable by documentation retrieval clients.
- **Evidence:** Web reader results for the above paths; successful source `https://www.developer.amazon.com/docs/vega/0.24/media-player-requirements`.

<a id="adbt"></a>

## C. Amazon Devices Builder Tools MCP (AI-assisted development)

### F-40 Builder Tools MCP connection timed out, which blocked the mandatory session setup
- **Severity (normalised):** Major
- **Tool:** Amazon Devices Builder Tools MCP (in Claude Code), 21 Oct 2026, 14:40 IST.
- **Task:** Plan the co-viewer feature set against the Vega platform documentation.
- **Steps:** 1. Started a new agent session. 2. The project's setup rules require `set_project_context` and `read_document("react_native_for_vega_get_started.md")` before any other work.
- **Expected:** The MCP server connects and the documentation tools are available.
- **Actual:** `MCP server amazon-devices-buildertools-mcp connection timed out after 30000ms` (status `CONNECT_TIMEOUT`). None of the setup steps or documentation searches could run.
- **Severity:** Moderate. Planning continued from local notes taken the day before, but nothing new could be checked against the documentation.
- **Workaround:** Used the 20–21 Oct research notes, which were taken from the MCP and from developer.amazon.com 0.24 pages. Claims that could not be re-checked are marked unverified in the plan.
- **Suggestion:** An offline documentation bundle, or a fallback the setup workflow documents, for use when the server cannot be reached. See also R-03.

### F-55 Builder Tools `init-context` cannot run non-interactively, even with `--agent`
- **Severity (normalised):** Minor
- **Tool:** `@amazon-devices/amazon-devices-buildertools-mcp@latest init-context`, 22 Oct 2026.
- **Task:** Update the outdated project context the MCP itself reported (steering v7.0 → v9.0, 5 outdated skills, 1 new) from an AI agent's shell.
- **Steps:** `npx -y @amazon-devices/amazon-devices-buildertools-mcp@latest init-context --agent claude-code-cli --skip-mcp-config < /dev/null`
- **Expected:** With the agent and the skip flag given, the update runs without prompts.
- **Actual:** `❌ An unexpected error occurred during validation: readline was closed` … `Error [ERR_USE_AFTER_CLOSE]: readline was closed at ProjectContextInitializer.promptUser`. Nothing was updated.
- **Severity:** Minor: the owner must run it in an interactive terminal. It also blocks agents from acting on the MCP's own "your context is outdated" prompt.
- **Workaround:** The owner runs the command interactively. `CLAUDE.md` is backed up first, because the steering document shares that file with project rules.
- **Suggestion:** A `--yes` / non-interactive mode that takes defaults when the agent is given, and an option to update only a marked block of a shared steering file (so project rules in the same file are kept).

### F-58 Builder Tools `read_document` fails on a URL that `search_documentation` just returned
- **Severity (normalised):** Minor
- **Tool:** Amazon Devices Builder Tools MCP (`read_document`, `search_documentation`), 23 Oct 2026.
- **Task:** Read the official React Native for Vega architecture page to quote what Vega's design optimises (for the demo script).
- **Steps:** `search_documentation("React Native for Vega overview runtime built into the OS …", device_os ["vega_os"])` returned `https://developer.amazon.com/docs/vega/0.24/vega-rn-arch.html` with a snippet. Then `read_document(document_uri: "https://developer.amazon.com/docs/vega/0.24/vega-rn-arch.html")`.
- **Expected:** The full page, as `read_document` returned for `https://developer.amazon.com/docs/vega/0.24/measure-app-kpis.html` a minute earlier.
- **Actual:** `Failed to read document: https://developer.amazon.com/docs/vega/0.24/vega-rn-arch.html`. No reason given. The search results also list the same page under several URL shapes (`/docs/docs/vega/0.24/vega-rn-arch`, `/docs/vega/0.24/vega-rn-arch.html`).
- **Severity:** Low: the search snippet held the needed sentences ("bundling the entire React Native runtime into the Vega OS … reduces the app bundle size by over 10MB … pre-warm process pools"), so only the rest of the page was lost.
- **Workaround:** Quote only the snippet text; did not retry other URL shapes. *(Unverified whether the `/docs/docs/…` variant reads.)*
- **Suggestion:** Make every URI that `search_documentation` returns readable by `read_document`, return one canonical URI per page, and include the failure reason (404, fetch error, not indexed).

### F-33 Builder Tools MCP: oversized list result, invalid URL for a documented page, empty searches
- **Severity (normalised):** Minor
- **Tool:** Amazon Devices Builder Tools MCP (version not reported). Reported by a research subagent on 20–21 Oct.
- **Task:** Enumerate and read Vega 0.24 / RN 0.83 feature docs.
- **Actual:** `list_documents` with only `target_platform` failed: "Error: result (113,305 characters across 1 line) exceeds maximum allowed tokens." `read_document("https://developer.amazon.com/docs/vega/0.24/splashscreenmanager.html")` returned "Invalid URL" (the page lives under `/docs/react-native-vega/0.83/`). Searches for `AlexaManager` and `interactive toast notification useToastKepler` returned `[]`. Each fetched page starts with roughly 100 lines of site navigation.
- **Severity:** Minor–moderate; slower discovery and wasted context.
- **Workaround:** Filtered `list_documents` by `documentType`; WebFetch on the RN 0.83 path; inspected installed package exports.
- **Suggestion:** Paginate `list_documents`, strip site navigation from page reads, and index RN-for-Vega API pages for search.

### F-01 Builder Tools MCP tools were missing at session start
- **Severity (normalised):** Major
- **Tool:** Amazon Devices Builder Tools MCP
- **Task:** Confirm the MCP is connected and list its tools.
- **Steps:** Started a Claude Code session in a project whose `CLAUDE.md` references the MCP, then searched the tool list for "amazon devices builder vega".
- **Expected:** The tools are visible, or there is a clear message that the server is not connected.
- **Actual:** No tools and no diagnostic. They appeared only after the request was sent a second time, so the first answer ("not connected") was wrong. The cause is not confirmed (server start-up delay versus misconfiguration). In a second client (Codex) the MCP tools were not exposed at all, with no indication of why.
- **Severity:** Medium. One wasted round trip and a wrong conclusion.
- **Workaround:** Retry the request.
- **Suggestion:** Let the agent read the connection state (starting, failed, connected) and mention the start-up delay in the get-started docs. Document how to carry the MCP configuration between AI clients.

### F-12 Builder Tools MCP asked for project context again mid-session
- **Severity (normalised):** Minor
- **Tool:** Builder Tools MCP (`read_document`, `set_project_context`)
- **Task:** Read `vega_cli_commands_reference.md`.
- **Steps:** Called `read_document` after `set_project_context` had already succeeded earlier in the same session.
- **Expected:** The document is returned. The project's `CLAUDE.md` says to call `set_project_context` once.
- **Actual:** `PROJECT_CONTEXT_REQUIRED: You must call set_project_context before using any other tool`. The server had apparently lost its state (not confirmed), so the "call once" instruction and the server disagree.
- **Severity:** Low. One extra call, but the error is hard to anticipate from the instructions.
- **Workaround:** Call `set_project_context` again with the contents of `.adbt-config.json`.
- **Suggestion:** Persist the context across server restarts, or change the instruction to "call again if `PROJECT_CONTEXT_REQUIRED` is returned".

### F-30 Builder Tools MCP lost its project context between turns
- **Severity (normalised):** Minor
- **Tool:** Amazon Devices Builder Tools MCP (version not reported).
- **Task:** Read the Density-Independent Pixels doc while diagnosing the cut-off home screen.
- **Steps:** Called `read_document` in a later turn of the same conversation, after `set_project_context` had already succeeded earlier.
- **Expected:** The earlier project context still applies.
- **Actual:** `{"error":"PROJECT_CONTEXT_REQUIRED","message":"You must call set_project_context before using any other tool, prompt, or resource. ..."}` on both parallel calls; setup steps 1–6 had to be repeated.
- **Severity:** Minor; one round-trip and a repeated guide read.
- **Workaround:** Re-ran `set_project_context` and reloaded `react_native_for_vega_get_started.md`.
- **Suggestion:** Persist context per client session, or include the cached config in the error so the agent can resend it without rereading the guide.
- **Redundancy:** The full get-started guide was reloaded although its content had not changed.

### F-06 `list_documents` for `vega_os` returned Fire OS and unrelated workflows
- **Severity (normalised):** Minor
- **Tool:** Builder Tools MCP `list_documents`
- **Task:** List the Vega workflows.
- **Steps:** Called `list_documents(documentType: "WORKFLOW", target_platform: {device_os: ["vega_os"]})`.
- **Expected:** Only workflows relevant to Vega.
- **Actual:** About 100 entries in one response, including `port_tv_app_to_fos*`, `iap_fos_*`, `fos_*` and the EMBER catalog workflows. It is not verified whether some of these are tagged for both platforms.
- **Severity:** Low to medium. A lot of context for a setup check.
- **Workaround:** Ignore the entries that do not apply.
- **Suggestion:** Honour the platform filter, or add a search term and a result limit.

### F-05 The get-started guide shows a `read_document` call shape the tool rejects
- **Severity (normalised):** Minor
- **Tool:** `react_native_for_vega_get_started.md` and the MCP tool schema
- **Task:** Follow the guide's example tool calls.
- **Steps:** Compared the guide's example `read_document(document_name: ..., target_platform: ...)` with the tool schema and the project's `CLAUDE.md`.
- **Expected:** The documents agree.
- **Actual:** The tool accepts only `document_uri`. `CLAUDE.md` says so, but the guide's example uses `document_name` and `target_platform`.
- **Severity:** Low (the schema wins), but it invites failed calls.
- **Workaround:** Follow the tool schema.
- **Suggestion:** Correct the example in the guide.

### F-02 Mandatory platform question even though the user had already named the platform
- **Severity (normalised):** Minor
- **Tool:** Builder Tools session setup in `CLAUDE.md`, Step 3b
- **Task:** Start work on a project the user described as "targets Vega OS".
- **Steps:** Read `.adbt-config.json`, which contained only `project.identifier`, then checked the empty project root for `manifest.toml` and `package.json`.
- **Expected:** The platform stated in the user's first message is used.
- **Actual:** The rule is a "mechanical check" that ends in a mandatory question to the user. A config file without `platform` is treated as malformed, yet `set_project_context` accepted it without complaint.
- **Severity:** Low. A redundant question that one config line avoids.
- **Workaround:** Add `"platform": {"default": "vega_os"}` to `.adbt-config.json`.
- **Suggestion:** Accept an explicit platform from the user's message, or generate `.adbt-config.json` with `platform` when a project is created.

### F-07 Required reading is large relative to the task
- **Severity (normalised):** Minor
- **Tool:** Builder Tools session setup (Steps 1 to 6) and `react_native_for_vega_get_started.md`
- **Task:** A simple "is the environment ready?" check.
- **Actual:** Setup loads a guide of roughly 5,000 tokens whose first actionable item for this task is "run `which vega`". Most of it (WebView, migration, accessibility, crash analysis) does not apply to an environment check.
- **Severity:** Low. The cost is tokens and time.
- **Suggestion:** Run the cheap prerequisite check first and load guide sections on demand, or split the guide into a short index plus topic documents.

<a id="aws"></a>

## D. AWS: Amazon Bedrock, Strands Agents, AgentCore, CDK

### F-54 Web-grounded fact checks can rest a strong verdict on commercial wellness pages
- **Severity (normalised):** Major
- **Tool:** Amazon Nova 2 Lite web grounding (`nova_grounding`), via StudioX's fact-check loop, 22 Oct 2026.
- **Task:** Check the claim "50 mg of Apigenin quiets neural activity and improves sleep".
- **Expected:** Primary or authoritative sources for a claim later shown to viewers as DEBUNKED.
- **Actual:** The citations returned were sacredlotus.com, thesleepconsultant.com, ubiehealth.com and superpower.com. The model labelled two of them "contradicts", which met the v1 rule for DEBUNKED. Across later runs the same claim came out NUANCED or UNVERIFIED.
- **Severity:** Moderate: a wrong strong verdict about a real guest's claim.
- **Workaround:** Verdict rules v2 require at least 2 authoritative contradicting sources for DEBUNKED. Health claims should use the Gateway Web Search Tool's domain include list when it is available.
- **Suggestion:** A source-quality or domain filter option for `nova_grounding`, similar to the Web Search Tool's `domainFilter`.

### F-62 Web-grounded verdicts change between identical runs
- **Severity (normalised):** Major
- **Tool:** Amazon Nova 2 Lite web grounding (`nova_grounding`) as the fact-check search, 23 Oct 2026.
- **Task:** Regenerate the science package three times with the same transcript and code (map prompt tuning).
- **Expected:** Stable verdicts for the same claim.
- **Actual:** "Harvard clinical data shows midday sleep cuts cardiovascular strain by 37 percent" came back DEBUNKED in run 1 and NUANCED in runs 2 and 3; "Magnesium L-Threonate crosses the blood-brain barrier…" was DEBUNKED in run 2 and NUANCED in run 3 (and SUPPORTED in the earlier cloud package). The verdict table is deterministic; the search results it is fed are not.
- **Severity:** Medium for the demo: the verdict on screen depends on which run is seeded.
- **Workaround:** Record the run that is shown and keep its fixture (SX_RECORD); the voiceover quotes the seeded package, not a generic verdict.
- **Suggestion:** A cache or "same query, same results" option for grounding within a time window, or result ids that can be pinned.

### F-52 Nova 2 Lite web grounding citations carry no page title
- **Severity (normalised):** Major
- **Tool:** Bedrock Converse, `us.amazon.nova-2-lite-v1:0` with `systemTool nova_grounding`
- **Task:** Show fact-check sources on a TV card (title + URL).
- **Steps:** Parsed `citationsContent.citations[].location.web` from the response.
- **Expected:** Title (and ideally a quoted snippet) per cited page.
- **Actual:** Only `url` and `domain`; the source text itself comes back as `"[HIDDEN]"` in the tool result. The only text tied to a citation is the sentence Nova wrote before it.
- **Severity:** Medium for a citation UI: cards would read "harvard.edu" or must invent a title.
- **Workaround:** Title built from the URL slug + domain (e.g. "Sleeping your way to heart health · news.harvard.edu"); no `quote` is shown for Nova sources, since the text is Nova's, not the page's.
- **Suggestion:** Return the page title and the cited span in the citation location.

### F-61 Strands structured output fails a short answer with `MaxTokensReachedException`
- **Severity (normalised):** Minor
- **Tool:** Strands Agents 1.62 (`structured_output_model`) on Bedrock, Claude Haiku 5.5, 23 Oct 2026.
- **Task:** Precompute the answer to a map question for the `cameo-finance` package (`run_local.py package`).
- **Steps:** `coviewer.ask` runs one Agent with two tools and `AskOut` (text ≤ 600 characters) as the structured output, `max_tokens=1200`.
- **Expected:** A short structured answer, as for the other 20+ answers in the same session.
- **Actual:** `WARNING strands.event_loop._recover_message_on_max_tokens_reached: tool_name=<AskOut> | replacing with error message due to max_tokens truncation.` then `strands.types.exceptions.MaxTokensReachedException: Model stopped generating due to maximum token limit.` The question "What does Ana's extra $36,000 grow into?" lost its answer (first cameo-finance run at 04:48 IST; its log was overwritten by the rerun, the error text above is copied from it).
- **Severity:** Minor (one answer lost; the run continued because the call is wrapped).
- **Workaround:** `max_tokens` 2000 for `ask`; a map question whose answer failed is now dropped from the map in code, so the TV never offers a question without its answer.
- **Suggestion:** A documented retry-with-larger-budget option for structured output, or the token count at truncation in the exception.

### F-50 Claude 5.5 on Bedrock rejects `temperature`
- **Severity (normalised):** Minor
- **Tool:** Amazon Bedrock Converse (via Strands Agents 1.62 `BedrockModel`), `us.anthropic.claude-haiku-5-5`
- **Task:** Run the StudioX co-viewer `ask` agent locally (`backend/agents/run_local.py ask ...`).
- **Steps:** Created `BedrockModel(model_id=..., temperature=0.2, max_tokens=...)`, the usual pattern in Strands examples.
- **Expected:** The call succeeds (temperature is a standard inference parameter).
- **Actual:** `botocore.errorfactory.ValidationException: An error occurred (ValidationException) when calling the ConverseStream operation: The model returned the following errors: `temperature` is deprecated for this model.`
- **Severity:** Low. One failed run, fixed in a minute.
- **Workaround:** Do not pass `temperature` for Claude Sonnet/Haiku 5.5.
- **Suggestion:** Strands could drop or warn about unsupported inference parameters per model; Bedrock docs could list which parameters each model accepts.

### F-51 A stray `AWS_REGION` silently moved Bedrock calls to another region
- **Severity (normalised):** Minor
- **Tool:** Strands Agents `BedrockModel` region resolution
- **Task:** Call Bedrock in us-east-1 (the project's region) from a shell whose `~/.aws/config` says us-east-1.
- **Steps:** Ran the agent without `region_name`.
- **Expected:** us-east-1 from the profile, or a visible note of the region in use.
- **Actual:** The shell had `AWS_REGION=us-west-2` set; the region showed up only in the error note of the F-50 failure: `└ Bedrock region: us-west-2`.
- **Severity:** Low here (the models exist in both), but a silent cross-region move can break quotas, data residency or Gateway calls.
- **Workaround:** The agents read `SX_REGION` (default us-east-1) and pass `region_name` explicitly.
- **Suggestion:** Log the resolved region once at agent start-up.

### F-53 Restricted profile cannot read the stack outputs the owner scripts depend on
- **Severity (normalised):** Minor
- **Tool:** AWS CLI with the restricted `claude-code` IAM user; CloudFormation, SSM
- **Task:** Resolve the bucket name and CloudFront domain for `backend/scripts/upload_media.sh`.
- **Steps:** `aws cloudformation describe-stacks --stack-name StudioXCore --region us-east-1`, then `aws ssm get-parameter --name /studiox/domain`.
- **Expected:** Read-only access to stack outputs so scripts can be dry-checked.
- **Actual:** `AccessDenied ... cloudformation:DescribeStacks on resource: arn:aws:cloudformation:us-east-1:<account-id>:stack/StudioXCore/...` and `AccessDeniedException ... ssm:GetParameter on resource: .../parameter/studiox/domain`.
- **Severity:** Low. Intended restriction, but it means the cloud seed and media upload scripts cannot be tested by the builder agents.
- **Workaround:** Scripts are written for the owner and unverified end to end.
- **Suggestion:** Grant the restricted profile `cloudformation:DescribeStacks` and `ssm:GetParameter` on `/studiox/*` (read-only), or put the outputs in a local config file.
- **Evidence:** Output above, 22 Oct 2026.

### F-36 AWS docs: title-only pages and a misspelt BDA URL
- **Severity (normalised):** Minor
- **Tool:** docs.aws.amazon.com via WebFetch (research subagent, 20 Oct).
- **Actual:** `bda-video.html`, `bda-output-video.html`, `bda-regions.html`, `knowledge-base-setup-s3-vectors.html`, AppSync Events `direct-lambda-integration.html` and `data-sources.html` returned only the page title. The working BDA video-output page is spelt `bda-ouput-video.html`. Bedrock/Nova/Anthropic pricing tables did not render. The old Strands multi-agent URL returned "The server returned HTTP 404 Not Found."
- **Severity:** Minor; some details stay UNVERIFIED (BDA regions, AppSync Events data sources, model prices).
- **Note:** The title-only results may be a fetch-tool limitation with client-rendered pages rather than an AWS defect (unverified).
- **Recurred 21 Oct:** while looking for the AgentCore web search tool, WebFetch again returned only "Amazon Bedrock AgentCore" for `built-in-tools.html`, and for a guessed `web-search-tool.html`. Workaround: fetched `toc-contents.json` with curl, which listed the real page as `gateway-target-connector-web-search-tool.html`. That page was readable with curl. Discoverability is also part of the friction: the tool is documented as a Gateway target connector, not among the built-in tools (Browser, Code Interpreter).

### F-48 `cdk synth --all` prints "Unknown option(s): --all"
- **Severity (normalised):** Minor
- **Task:** synthesize both stacks (Agent B, pipeline build, 22 Oct).
- **Steps:** `cd backend/infra && npx cdk synth --all -q`.
- **Expected:** all stacks synthesized.
- **Actual:** `Unknown option(s): --all. These will be ignored. Run 'cdk --help' to learn more.` It still synthesized every stack (the app has only two).
- **Severity:** minor (cosmetic).
- **Workaround:** plain `npx cdk synth -q`.
- **Suggestion:** the `synth` command of this CLI version synthesizes all stacks by default; the flag is unnecessary.
- **Evidence:** command output above.

<a id="feature-requests"></a>

## E. Feature requests

| ID | Request | Priority |
| --- | --- | --- |
| R-07 | Raw MSE playback example and a "URL mode failed" troubleshooting step | Critical |
| R-08 | A representative display mode for the Virtual Device | Important |
| R-05 | Screenshots and screen recording for the Virtual Device | Important |
| R-14 | Screen capture and log access while the Virtual Device is not running | Important |
| R-09 | Package size report and stale-staging clean-up in `build-vega` | Important |
| R-10 | Versioned API tables generated from published packages | Important |
| R-01 | Agent-friendly environment doctor | Important |
| R-02 | Linux dependency handling in the installer | Important |
| R-04 | Resumable, resource-aware SDK installation | Important |
| R-06 | Full-screen, remote-panel-free mode for the Virtual Device | Important |
| R-03 | MCP connection status visible to the agent | Nice-to-have |
| R-11 | Region and parameter guardrails in Strands BedrockModel | Important |
| R-12 | Titles and cited spans in Nova grounding citations | Important |
| R-15 | Pin web-grounding results for reproducible fact checks | Nice to have |

### R-07 Raw MSE playback example and a "URL mode failed" troubleshooting step
- **Tool:** Vega media docs / `react-native-w3cmedia`
- **Requested:** A 20-line example of non-adaptive playback through `MediaSource` + `SourceBuffer` (fragmented MP4, `srcObject`), and a troubleshooting line: if URL mode fails, test the same content through MSE.
- **Why it matters:** URL mode failed on the Virtual Device with no request issued (F-45); MSE is documented only through Shaka, hls.js and dash.js.
- **Priority:** Critical
- **Workaround:** `src/player/mseLoader.ts`, written from a community thread.

### R-08 A representative display mode for the Virtual Device
- **Tool:** Vega Virtual Device
- **Requested:** 32-bit colour, GPU acceleration, and a 1:1 1920×1080 window or capture, so visual review and demo recording reflect a real Fire TV.
- **Why it matters:** The default 16-bit, `-gpu off`, 1280×720-skin pipeline made correct text look broken (F-44).
- **Priority:** Important

### R-05 Screenshots and screen recording for the Virtual Device
- **Tool:** `vega exec vda` screenshot tool and the Virtual Device
- **Requested:** Screenshot and screen-recording commands that work on the Virtual Device.
- **Why it matters:** The demo video and the submission screenshots are produced on the emulator (F-14).
- **Priority:** Important
- **Workaround:** Capture the emulator window with the desktop's tools.
- **Example outcome:** `vega virtual-device screenshot out.png` and a record command that scripts and agents can use.

### R-14 Screen capture and log access while the Virtual Device is not running
- **Tool:** Vega CLI / VVD, 23 Oct 2026.
- **Requested:** Persisted VVD logs that can be read after the emulator has stopped (`vega exec vda shell loggingctl` printed "vda: no devices/emulators found"), plus the screenshot command from R-05.
- **Why it matters:** The owner reported "the second video didn't play" after closing the emulator. Without its logs, the cause could not be read and had to be reproduced first.
- **Priority:** Important
- **Workaround:** Restart the VVD and reproduce.

### R-09 Package size report and stale-staging clean-up in `build-vega`
- **Tool:** Vega CLI
- **Requested:** Print the `.vpkg` size and its largest files, warn above a threshold, and clean `build/private/.../assets` on every build.
- **Why it matters:** A 172,792,438-byte package went unnoticed until install was slow (F-42).
- **Priority:** Important

### R-10 Versioned API tables generated from published packages
- **Tool:** Vega docs and ADBT knowledge base
- **Requested:** Generate package versions, exported names and signatures for each RN version from the npm packages.
- **Why it matters:** Several KB pages disagree with RN 0.83 packages (F-27, F-34, F-38).
- **Priority:** Important

### R-01 Agent-friendly environment doctor
- **Tool:** Vega CLI and Builder Tools MCP
- **Requested:** One read-only command or MCP tool (for example `vega doctor`) that reports the Node version, SDK presence, system dependencies for the host OS, `KEPLER_SDK_PATH` conflicts, the Simulator package, and device and emulator state as structured output.
- **Why it matters:** It replaced a series of manual shell checks (F-03, F-04, F-10).
- **Priority:** Important
- **Workaround:** Hand-written shell checks.
- **Example outcome:** A fresh machine gets an exact, copy-paste list of what to install.

### R-02 Linux dependency handling in the installer
- **Tool:** `get_vvm.sh`
- **Requested:** Detect Ubuntu or Debian and check for, or offer to install, the apt packages itself, as it does for Homebrew on macOS.
- **Why it matters:** It removes F-03 and half of F-04.
- **Priority:** Important
- **Workaround:** Manual `apt install`.
- **Example outcome:** One command from a fresh Ubuntu machine to a working `vega --version`.

### R-04 Resumable, resource-aware SDK installation
- **Tool:** Vega CLI and `get_vvm.sh`
- **Requested:** Keep partial downloads on disk and resume them with integrity checks. Show bytes, rate, retry reason and expected unpacked size. Offer memory and CPU limits, and detect tmpfs before downloading.
- **Why it matters:** Repeated setup attempts on an intermittently connected 7 GiB desktop (F-08, F-09).
- **Priority:** Important
- **Workaround:** A retrying wrapper script and a separate resumable `curl` download.
- **Example outcome:** An interrupted download resumes from verified cached data without reinstalling the launcher or exhausting the desktop.

### R-06 Full-screen, remote-panel-free mode for the Virtual Device
- **Tool:** `vega virtual-device start` and `launch`
- **Requested:** A `--fullscreen` or `--hide-remote` option, or a documented way to show only the TV screen, with keyboard input still working.
- **Why it matters:** The demo must show the app as a viewer would see it on a TV (F-14).
- **Priority:** Important
- **Workaround:** Crop the screen recording to the TV pane, or demo on a physical Fire TV.
- **Example outcome:** A clean 16:9 capture straight from the emulator.

### R-03 MCP connection status visible to the agent
- **Tool:** Builder Tools MCP
- **Requested:** A status the agent can read (connected, starting or failed, with a reason).
- **Why it matters:** It would have avoided the wrong diagnosis in F-01.
- **Priority:** Nice-to-have
- **Workaround:** Retry.

### R-11 Region and parameter guardrails in Strands BedrockModel
- Log the resolved region at start-up, and drop (with a warning) inference parameters the chosen model rejects (F-50, F-51).

### R-12 Titles and cited spans in Nova grounding citations
- `citationsContent` entries with `title` and the supporting source text, so apps can show real citations (F-52).

### R-15 Pin web-grounding results for reproducible fact checks
- **Tool:** Amazon Bedrock Nova web grounding.
- **Requested:** A way to reuse the exact sources of an earlier grounding call (see F-62).
- **Why it matters:** A published verdict should be reproducible from its sources when a package is regenerated.
- **Priority:** Nice to have
- **Workaround:** Record/replay in our own code (llm.py SX_RECORD).
