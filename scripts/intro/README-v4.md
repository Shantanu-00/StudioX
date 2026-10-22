# StudioX v4 — reference-shaped glass fracture

This revision replaces the v3 liquid-looking displacement with the fracture layout
from the user's 1594×651 screenshot. Earlier versions remain untouched.

The main diagonal, uneven lower fork, central splinter fan and smaller right-side
chip cluster are traced as editable paths. A glass-only plate made with the built-in
imagegen tool supplies fine edge texture. Its prompt and original output are saved
in `docs/local/intro/v4/optical-assets/`. It is a reference-assisted reconstruction,
not a claim of pixel-identical extraction from the source film.

The title is displaced by small **constant offsets inside polygonal regions**.
There is no rounded lens profile, sine-wave bulge or filled translucent ribbon.
The continuous 60 fps reveal, gentle full-frame tremor, overlapping perceptual fade,
brief lingering X and ten-second reference soundtrack are retained.

## Rebuild

Requires Python 3, NumPy, Pillow, FFmpeg, and the Arial Bold font path specified in
the script. Keep the included reference plate in its original workspace-relative
location; it is an input to the renderer.

```bash
OPENBLAS_NUM_THREADS=1 python3 scripts/intro/render_v4.py --stills --render
python3 scripts/intro/verify_v3.py docs/local/intro/v4/studiox-intro-v4-60fps.mp4
```

The v3 verifier works for any 10-second 1080p60 export; it is intentionally reused.
`--audio /absolute/path/to/sound.wav` chooses another local soundtrack. The bundled
WAV is the same third-party reference soundtrack used in v1/v2/v3.

Outputs are under `docs/local/intro/v4/`:

- `studiox-intro-v4-60fps.mp4` and the silent alternative.
- `optical-assets/reference-fracture-plate.png`: generated glass-only source, black background.
- `optical-assets/reference-fracture-prompt.txt`: exact imagegen prompt and provenance.
- `optical-assets/fracture-trace.json`: path vertices and rigid shard offsets.
- `optical-assets/fracture-paths.svg`: editable vector trace for a native prototype.
- `frames/`: atomic full-frame checkpoints, keyed to renderer and plate hashes.
- `verification.json`: encoded timing, audio, black-level and motion measurements.

The unchanged reveal prefix may be reused from v3 only after pixel equality checks;
`reused-reveal-check.json` records the checks used for this run. Never reuse frames
after changing their source or plate without confirming equivalence. The renderer
rejects a mismatched cache hash.

## Runtime status

This is the visual master/proof. No startup integration, package change, Vega build
or device performance claim is included. See
[the Vega implementation assessment](../../docs/product/intro-rendering-options.md)
for the distinction between the OS splash, native-driven compositing and native
video playback. The source plate is composited additively in this proof; using it
as a normal opaque Image view would cover the title. A native prototype must bake
appropriate alpha layers or use the supported vector masks and cropped wordmark
regions, then test the result on Vega.
