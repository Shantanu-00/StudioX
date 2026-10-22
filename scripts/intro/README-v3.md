# StudioX v3 — continuous motion and refractive glass study

This is a separate optical animation proof, built after the user rejected v2's
stepped reveal and flat crack. It is not integrated into the Vega app. Previous
versions are preserved.

## What changed

- One continuously expanding, feathered aperture per glyph, with a fractional
  mirrored optical echo that converges. No static stage swaps, animated flips,
  distant scaling or repeated frames inserted during the reveal.
- 60 time samples per second. Fast impact motion also averages two nearby time
  samples. Tremor is a restrained 6.2/8.1 Hz damped movement of the whole image.
- A narrow irregular glass sliver bends the underlying title through a
  displacement field. Bevel highlights, a dark fissure, fine branches and faint
  color separation supply the optical edge detail.
- Smooth fades are authored in display brightness, with overlapping letter
  envelopes and an approximately 0.2-second longer tail for X. The glow softens
  during the exit.
- Same 10-second soundtrack and 5.43-second impact as the previous edit.

This is an offline **composited refraction** effect, not a physical glass
simulation and not evidence of a supported Vega shader. Its PNG layers are
source material for a native prototype; those PNGs alone do not reproduce the
proof's animated displacement or blur.

## Reproduce

Requires Python 3 with NumPy and Pillow, FFmpeg, and Arial Bold at the path in
`render_v3.py`. No Blender dependency for this version. Run from the repository:

```bash
OPENBLAS_NUM_THREADS=1 python3 scripts/intro/render_v3.py --stills --render
python3 scripts/intro/verify_v3.py docs/local/intro/v3/studiox-intro-v3-60fps.mp4
```

An adjacent `studiox-reference-soundtrack.wav` is included in the setup archive.
The renderer can also use the existing v2 soundtrack. `--audio` accepts a different
local WAV. The soundtrack remains third-party reference audio, not an original
StudioX composition.

Full-frame PNG checkpoints let interrupted renders resume. The source hash must match;
if changing the renderer, use a fresh `--output` directory to avoid mixing versions.

Default outputs live in `docs/local/intro/v3/`:

- `studiox-intro-v3-60fps.mp4`: 1080p60 H.264, stereo AAC.
- `studiox-intro-v3-silent.mp4`: identical picture without audio.
- `optical-assets/`: glyph PNGs, fracture reflection, dark seam, lens mask and layout.
- `still-*.png`: key moments for comparison.
- `verification.json`: media properties and decoded motion/fade measurements.
- `audit/v2-motion-audit.md`: concrete causes of the old stepped appearance.

The verifier measures frame timing and changes in decoded pixels. Technical
success does not establish visual quality or on-device smoothness. Review the
video at normal speed; don't judge motion from the stills alone.

## Vega path

See [the platform assessment](../../docs/product/intro-rendering-options.md).
The recommended app route is a brief black OS splash, followed by a native-driven
composite using pre-rendered glow/glass layers and clipped displaced copies of the
wordmark. React configures the native animation graph; it need not rerender every
frame. Device verification remains required for masking, playback/audio sync,
skip, lifecycle cleanup and sustained frame pacing.
