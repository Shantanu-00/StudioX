# Text sharpness and video playback: analysis

Date: 21 October 2026. Evidence comes from the Virtual Device (VVD) configuration, the companion server's
access log, the Vega 0.24 docs and the Vega community forum.

## 1. Why text looks soft or pixelated on the Virtual Device

### What the VVD is actually doing

From `~/vega/sdk/vega-sdk/main/0.24.12112/vvd/instances/<id>/hardware-qemu.ini` and
`virtual_device.log`:

| Setting | Value | Effect |
| --- | --- | --- |
| `hw.lcd.width/height` | 1920 × 1080 | The TV renders a full 1080p frame |
| `hw.lcd.density` | 320 | Scale factor 2 (960 × 540 dp canvas), as expected |
| **`hw.lcd.depth`** | **16** | **16-bit colour (RGB565).** Anti-aliased glyph edges and gradients are quantised to 32/64 levels per channel, so edges look jagged and fades band |
| Launch flag **`-gpu off`** | software rendering | Slower and lower-quality compositing than a real Fire TV GPU |
| Launch flag **`-skin tv-remote-skin1280x720`** | 1280 × 720 skin | The 1920 × 1080 frame is **downscaled to 1280 × 720**, then the window is stretched to its on-screen size (about 1586 px wide in the screenshots). Two resamples soften every glyph |

A real Fire TV renders 1080p in 32-bit colour on a hardware GPU straight to HDMI, with none of
these resamples. **The VVD window cannot be used to judge text sharpness.** It is a functional
emulator, not a reference display.

### What was ours, and is now fixed

| Cause in our code | Fix |
| --- | --- |
| Tile and button text sat inside views scaled by the focus animation. Scaled layers are resampled by the compositor, which softens text | Only artwork is scaled now (1.06). Captions sit below the art; buttons change fill, not size |
| Fractional letter-spacing (1.2 dp = 2.4 px) and wordmark tracking at size × 0.32 | Rounded to whole pixels |
| Hero art was 1280 × 720 stretched to 1080p (now 1920 × 1080, native) | Done in the previous pass |
| Wide-tracked monospace caps everywhere | Replaced by Amazon Ember (system font) and the TV type scale (`tv-ui-guidelines.md`) |
| Rail shade made of two flat bands (hard vertical edges) | One SVG `LinearGradient` fade, plus a light always-on shade behind the collapsed icons |

### How to judge visual quality

1. **Best:** a Fire TV Stick 4K Select (or any Vega device) on a 1080p TV.
2. On the VVD, keep the window at its native skin size rather than maximised, and remember the
   16-bit, `-gpu off` limits. `vega virtual-device start` documents `--display-res` and
   `--no-gl-accel` (friction entry F-14); whether `--display-res` removes the 1280 × 720 skin
   downscale, and whether the GPU can be enabled, is *unverified*. Check the CLI reference before
   trying it.

## 2. Why the videos did not play

### Evidence

- The player reported `MEDIA_ERR 4` (`MEDIA_ERR_SRC_NOT_SUPPORTED`).
- The companion server logs every media request. During the failing attempts it logged **no
  request from the TV**; only a local `curl` test appears. Pairing requests from the same TV did
  arrive, so the TV's network and plain-HTTP access work.
- The same failure is documented by another developer on Vega 0.24 / RN 0.83 / w3cmedia 2.3.2:
  URL mode fails with code 4 and "no HTTP request is ever issued". Amazon's own media samples also
  failed on that VVD. Their resolution was that **MSE playback of the same footage works**: the app
  fetches the bytes and appends them to a `MediaSource` attached via `srcObject`
  ([forum thread 29117](https://community.amazondeveloper.com/t/29117)).

### Root cause (as far as can be determined)

Vega URL mode (`player.src = url`) on the VVD rejects the source before its media pipeline is
engaged. This is a platform/emulator issue, not our file: our MP4 is H.264 High@4.1 + AAC-LC.

### Resolution implemented

| Step | Change |
| --- | --- |
| 1 | Re-muxed both episodes to **fragmented MP4** without re-encoding: `ffmpeg -i in.mp4 -c copy -movflags +frag_keyframe+empty_moov+default_base_moof out.frag.mp4` (`media/tv/*.frag.mp4`) |
| 2 | New `src/player/mseLoader.ts`: checks `MediaSource.isTypeSupported('video/mp4; codecs="avc1.640029, mp4a.40.2"')`, attaches a `MediaSource` through `player.srcObject`, fetches the file in 2 MB HTTP range requests, and appends each chunk after the previous `updateend`. Abortable on unmount or background |
| 3 | `useVideoPlayer` keeps the Vega lifecycle (`setMediaControlFocus` → `initialize` → listeners → surface → source) and swaps `src = url` for the MSE loader |
| 4 | Episodes point to `/media/*.frag.mp4`, served by the companion server with byte ranges |

MSE is the standard W3C path on Fire TV hardware too, so this is not an emulator-only workaround.

### How to verify (needs a VVD run)

1. Start the companion server: `node companion/server.mjs` (it logs `[media] GET … range=bytes=…`).
2. `npm run vvd:start`, then `npm run run:vvd:release`.
3. Play an episode. Expected: the server logs a series of 2 MB range requests from the TV, then
   playback starts.
4. If the server shows the range requests but there is still no picture, collect the device log
   around the attempt (`loggingctl`) and check for `W3CMEDIA` lines.

**Result (21 Oct, VVD):** the server logged `Kepler/1.2 (Linux; AQVV01P)` fetching both episodes in
sequential 2 MB ranges, and video played. Two follow-ups were fixed the same day:
- `Infinity:NaN` on the clock: MSE duration is `Infinity` until `endOfStream()`. We now set
  `mediaSource.duration` from the known episode length and accept only finite values.
- The second episode stuck on a still frame: the previous player's `deinitialize()` was not awaited
  before the next `initialize()`. Teardowns are now chained, and the SeekBar's static poster
  thumbnail is replaced by a text label.

Not yet verified on hardware.
