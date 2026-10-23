# StudioX opening sequence

## Current visual revision — v5

The current revision is the 10-second 1080p60 v5 proof. Distributed digital
fragments replace v4's curtain-like aperture. The finished word holds briefly,
vibration builds from 3.45 seconds, and the impact now occurs at 4.25 seconds.
Opposing rigid glass panes visibly break the letter alignment; a restrained cool
shadow adds depth. The v4 reference-assisted glass plate is retained. Overlapping
letter fades leave the crimson X visible briefly at the end. Source, timing and
rebuild instructions are in [README-v5](../../scripts/intro/README-v5.md).
Earlier media versions remain intact.

The current audio audition uses a separately composed, entirely synthesized
StudioX cue synchronized to the v5 picture. Its source, six stems and rebuild
instructions are described in
[README-original-audio-v1](../../scripts/intro/README-original-audio-v1.md).
The older exports retain downloaded reference audio for historical comparison;
permission to use that audio has not been established. The new soundtrack does
not clear the reference-derived v4/v5 glass artwork. Independently designed
fracture artwork or appropriate permission is still recommended before submission.

**The app now opens with this render.** On a cold start
[`Intro.tsx`](../../src/screens/Intro.tsx) plays the silent v5 export itself (1920×1080,
60 fps, H.264, 10 s, 789,553 bytes, no audio track), full screen on black, then goes to
Home. The file ships in the package; see
[In-app intro](#in-app-intro-the-v5-render-with-a-native-fallback) below. The Vega
options are documented in [intro-rendering-options](intro-rendering-options.md). The
video is the first in-app screen; it is not the OS splash.

The sections below retain the original production setup and timing history.

The active production is a custom 10-second Blender animation based on the user's
selected [Black Mirror title sequence](https://www.youtube.com/watch?v=pxjy1vahZnU).
The missing FedyaL After Effects template is no longer a dependency.

The first full render is complete: 1920×1080, 30 fps, 300 frames, exactly 10
seconds, with retimed reference audio. Export validation passes, including exact
black opening/end samples and no full-scale audio clipping. Visual review covered
the reveal, clean hold and crack progression. This is a reconstruction, not a
claim of frame-for-frame equivalence to the reference.

## Accepted direction

On 20 October 2026 the user specified a brief pitch-black opening, the reference's
fragmented title reveal using StudioX, a stable title hold, then a shallow diagonal
glass crack travelling from bottom right to top left. The earlier red-X direction
is retained. The render uses uppercase STUDIOX to follow the reference's typography.
The user also requested the same audio sequence, synchronized to the shorter edit.

## Timeline

| Time | Picture |
| --- | --- |
| 0–0.35 s | Pitch black |
| 0.35–3.45 s | Reflected letter fragments resolve into STUDIOX |
| 3.45–5.43 s | Clean, steady title |
| 5.43–5.7 s | Glass fracture and brief displacement |
| 5.7–8.3 s | Fractured title holds |
| 8.3–9.7 s | Fade to black |
| 9.7–10 s | Black tail |

Audio is extracted from the supplied reference, trimmed and retimed with pitch
preservation so the source impact near 10.8 seconds matches 5.43 seconds in this edit.
This is reference audio, not an original StudioX soundtrack. Its reuse permissions
have not been established; outputs remain in the ignored local production folder.
The uploader is Just The Titles, whose description attributes the content to
Channel 4 / Netflix / Black Mirror; the upload is not verified as an official source.

## Production setup

See [the rendering setup](../../scripts/intro/README.md) for dependencies, a complete
rebuild command, output files and editable parameters. The visual source is
[`build_scene.py`](../../scripts/intro/build_scene.py); the end-to-end renderer is
[`render.sh`](../../scripts/intro/render.sh).

The old `scripts/customize-studiox-intro.jsx` is retained only as an unused template
adapter. It does not participate in this production.

## In-app intro: the v5 render, with a native fallback

[`src/screens/Intro.tsx`](../../src/screens/Intro.tsx) plays the rendered v5 sequence, so
its fracture, panes and timing are the render's, not a re-creation.

- **File:** `assets/raw/studiox-intro-v5.mp4`, a byte-identical copy of
  `docs/local/intro/v5/studiox-intro-v5-silent.mp4` (not re-encoded). The build copies
  the root `assets/` folder into the package, and the app plays it from
  `/pkg/assets/raw/studiox-intro-v5.mp4`. This is the path Amazon gave on the developer forum
  ([thread 27642](https://community.amazondeveloper.com/t/proper-uri-handling-for-local-assets-in-kepler-toastkepler-and-w3c-media-video/27642)):
  media that the asset APIs do not yet resolve goes in `assets/raw/`, and `/pkg` is a stable path.
  It works offline at cold start. Episode media still never goes in `assets/`.
- **Player:** one W3C `VideoPlayer` in URL mode on a full-screen `KeplerVideoSurfaceView`,
  muted, autoplay. URL mode, which fails for HTTP episodes on the VVD (F-45), plays this
  local file. MSE is not needed. The player waits for any earlier player's teardown and
  queues its own release (pause, clear surface, `deinitialize`) on the same chain as the
  episode player (`useVideoPlayer.ts`).
- **Ending:** one idempotent `finish` reaches Home exactly once. It runs on natural
  `ended`, on SELECT/ENTER/PLAY (on key-up, so the release cannot press Home's focused
  Play), on an error after the first frame, on background (KeplerAppStateManager), and at
  a 12 s safety timeout (re-armed when playback starts). BACK is routed by `App.tsx`. The
  intro plays on a cold start only.
- **Fallback:** if the video errors before its first frame, or has not started within
  3 s, the native cut below (`IntroNative.tsx`) plays instead and then goes Home. The
  timeout was planned at 1.5 s and raised to 3 s after measurement: on the VVD,
  `playing` arrived 0.77–1.8 s after mount, and the 1.5 s bound switched one launch to the
  fallback even though the video started 0.3 s later.
- **Verified on the Vega Virtual Device (debug build, 23 Oct 2026):**
  - Recorded cold launches show the launcher cutting straight to black (no grey frame or
    loading bar), then the full v5 sequence: fragment decode, fracture with rigid panes,
    and fades. Home follows.
  - A fractured frame from the VVD matches the same frame of the source file
    (`docs/local/intro/v5/vvd-check/`, local only).
  - Logs from nine cold launches that played to the end: `finish: ended` 10.5–11.3 s
    after mount. Across all launches, the player
    released in 240–590 ms.
  - ENTER, PLAY/PAUSE and BACK skips land on Home. An episode started after the intro
    reached `canplay`, so the intro's decoder was released.
  - The start-timeout fallback ran once (log line `native fallback: start timeout`, then
    `finish: native done`).
- **Not verified:** background during the intro. On the VVD, `inputd-cli` KEY_HOME went to
  the app as a key and did not background it, so the background path is covered only by
  unit tests. Also unmeasured: hardware start-up latency, frame pacing and PSS. The VVD
  logged 168 MB PSS during one intro, which is not a hardware figure.
- **Package size:** debug `studiox_x86_64.vpkg` grew from 1,766,301 to 2,514,573 bytes
  (+748,272) with the file added.

### Fallback: native cut of v5

[`src/screens/IntroNative.tsx`](../../src/screens/IntroNative.tsx) is a native cut of v5,
about 3.9 seconds long. It is drawn with views, not played as a video:

| Step | Duration | Picture |
| --- | --- | --- |
| Black | 150 ms | Pitch black |
| Fragment decode | 1.1 s | 65 clipped tiles of v5's own glyph masks resolve into STUDIOX |
| Hold | 350 ms | Clean title |
| Tremor | 350 ms | Vibration builds |
| Impact | 140 ms | A 0.08 white flash; the fracture is revealed right to left in four pieces |
| Fractured | 800 ms | Rigid panes per letter, offset by ±3 dp |
| Fades | 420 ms + 480 ms | Overlapping letter fades, the crimson X last |
| Tail | 150 ms | Black |

Then the app goes to Home. The glyph masks are
`src/assets/intro/glyph-0.png` to `glyph-6.png`, rasterized from Arial Bold by
[`render_v4.py`](../../scripts/intro/render_v4.py). The fracture line is drawn
independently and is not traced from the reference plate. Each letter is split into two
panes with react-native-svg `ClipPath`.

- Motion is opacity and transform on the native driver only. No video decoder or media
  surface is created at launch.
- No audio. The reference audio rights are not cleared, and synchronized audio would need a
  media player.
- SELECT or PLAY skips the intro; BACK goes to Home.
- Verified on the Vega Virtual Device by screen recording, first as the main intro and
  on 23 Oct 2026 as the fallback after a start timeout. Frame pacing and memory have not
  been measured on hardware.
- Licence caveat to confirm: the glyph masks are rasterized from Arial Bold, so the font
  licence for a raster title in a shipped app still needs checking.

The 10-second rendered video and its production files remain the reference. The silent
export is what the app plays at startup (above).
