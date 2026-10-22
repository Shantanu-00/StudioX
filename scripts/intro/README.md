# StudioX title production

A local, editable 10-second reconstruction guided by the user's selected
[Black Mirror title sequence](https://www.youtube.com/watch?v=pxjy1vahZnU).
This is a new visual render, not the unavailable After Effects template.

## Creative setup

- Pitch-black opening for approximately 0.35 seconds.
- Uppercase **STUDIOX**, matching the reference's uppercase treatment. Cool-white
  letters with a crimson X, carrying forward the user's requested red accent.
- Reflected, compressed letter fragments resolve into the title by 3.45 seconds.
- An intact, steady title holds until the glass impact at approximately 5.43 seconds.
- A shallow diagonal crack travels from bottom right to top left. Hairline
  branches and a split image suggest a broken pane; fragments stay in place.
- The fractured title holds, then fades from 8.3 seconds to black by 9.7 seconds.
- Final black frames complete exactly 10 seconds.

The title, glass curves, slivers, emission materials, and animation keys are
editable Blender objects. The title reveal and glass pattern are reconstructed;
they are not an exact copy of the original animation.

## Audio

At the user's request, the preview uses audio extracted from the supplied
reference. Source seconds 3.4–17.461 are shortened with FFmpeg `atempo` by
1.4570984456, retaining pitch, then delayed by 0.35 seconds. This maps the source
impact near 10.8 seconds to output time 5.43 seconds. Very short boundary fades
prevent clicks. There is no replacement music or synthesized crack mixed in.

The reference uploader is **Just The Titles**, not an official studio account.
Its description attributes the content to Channel 4 / Netflix / Black Mirror.
The soundtrack is third-party reference audio, not an original or licensed
StudioX asset. Keep this reference-audio version local; its reuse permissions
have not been established. A silent export is supplied for later audio replacement.

## Rebuild

Requires Blender 5.x, FFmpeg, Python 3, and Arial Bold or Nimbus Sans Bold. The
source code uses Blender's Python runtime, with no extra Python packages.

```bash
cd /home/xspace/StudioX
bash scripts/intro/render.sh
```

The default input is `docs/local/intro/reference/reference.mp4`. To use a local
copy stored elsewhere:

```bash
bash scripts/intro/render.sh /absolute/path/to/reference.mp4
```

Outputs are under `docs/local/intro/render/` (gitignored):

- `studiox-intro-10s.mp4`: 1920×1080, 30 fps, H.264, stereo AAC; reference audio.
- `studiox-intro-10s-silent.mp4`: the same video without audio.
- `studiox-intro.blend`: editable scene and animation, with a soundtrack strip
  referencing the adjacent WAV. Keep these two files together.
- `studiox-reference-soundtrack.wav`: retimed 48 kHz stereo, 24-bit soundtrack.
- `frames/`: lossless individual PNG frames.
- `media-info.json`: exported media properties.
- `blender-render.log`: rendering diagnostics.

Check the encoded deliverable:

```bash
python3 scripts/intro/verify.py
```

This verifies dimensions, frame count, duration, black opening/end frames, stereo
audio, initial silence, and absence of full-scale audio clipping. It does not
replace visual review or testing on the TV.

Set `STUDIOX_INTRO_OUTPUT` to select a different output directory. Rerunning
overwrites files with these names in that output directory.

For quick composition checks:

```bash
blender -b -t 2 --factory-startup --python scripts/intro/build_scene.py -- \
  --output docs/local/intro/preview --width 960 --height 540 --samples 4 --stills
```

## Performance and app handoff

Rendering is limited to four CPU threads. Stop the emulator before rendering or
building the app; do not run another build at the same time.

The deliverable is a rendered intro and its production setup. App startup
integration is separate: the existing `src/App.tsx` has not been changed. For
integration, preload the clip locally, keep the first surface black, allow a
remote-control skip, and hand focus to the home screen on completion. Actual
Vega playback, device color reproduction and startup latency remain to be tested.
