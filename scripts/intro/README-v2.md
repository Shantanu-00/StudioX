# StudioX intro — iteration 2

Separate 10-second, 1920×1080, 30 fps production. Iteration 1 remains in
`docs/local/intro/render/`; its renderer and editable scene remain unchanged.

## Visual changes

- 0.00–0.35: pitch black.
- 0.37–1.20: paired, luminous triangular strokes at the final title height.
- 1.02–3.36: fixed-size mirrored glyph cuts overlap and dissolve into STUDIOX.
  No rotating letters, animated negative scaling, or distant zoom.
- 3.45–4.75: larger, steady cool-white title with crimson X. Blue-tinted optical
  bloom is composited in Blender and remains editable.
- 4.75–6.08: subtle shared camera vibration around the 5.43-second impact.
  Main fracture, secondary lens-shaped boundaries, reflective slivers and fine
  irregular fissures travel from bottom right toward top left.
- 8.10–9.70: overlapping, nonsequential glyph fades; a small secondary tremor
  accompanies the decay. X starts fading with the word and lingers faintly for
  about 0.2 seconds after its last white letter.
- 9.70–10.00: black.

The reconstruction follows the supplied screenshots; it is not a pixel-exact
replica of the reference film. Shapes, curves, materials, camera keys and the
compositor are editable in the Blender scene.

## Rebuild

Requires Blender 5.x, FFmpeg, Python 3 and Arial Bold (Nimbus Sans Bold fallback).
Run from the repository, with the emulator stopped:

```bash
bash scripts/intro/render_v2.sh
```

Pass an alternative local reference clip as the first argument. Default input:
`docs/local/intro/reference/reference.mp4`. Default output:
`docs/local/intro/v2/`. `STUDIOX_INTRO_OUTPUT` can select another directory;
rerunning overwrites iteration 2 in that directory.

```bash
python3 scripts/intro/verify.py docs/local/intro/v2/studiox-intro-10s.mp4
```

Outputs include the full MP4, silent MP4, lossless PNG frames, editable `.blend`,
48 kHz stereo WAV, media metadata and verification report. Keep the WAV next to
the `.blend` for its relative soundtrack link to work. In Blender, render the
camera; the sound strip exists for timing playback, and FFmpeg muxes the final
soundtrack. Use the script to reproduce the final encoding and black-level fix.

## Sound and handoff

Sound is the same retimed third-party reference audio as iteration 1, with the
impact synchronized at 5.43 seconds. It is not a newly composed or licensed
StudioX soundtrack. The silent export is available separately.

This change produces a local media asset. It does not change app startup code.
Vega playback, focus, lifecycle, device performance and TV color reproduction
have not been tested for this asset.

`v1-preservation.json` records SHA-256 hashes of the original sources and key
outputs before work began; `preservation-check.json` records the final check.
