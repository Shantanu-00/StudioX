# StudioX v5 — digital fragments and broken alignment

This is the separate ten-second revision requested after v4. The title assembles
from locally displaced raster fragments across its full width. Randomized but
deterministic overlapping timings avoid a curtain, directional wipe or flipping
letter. Fragment translations use fractional pixels and motion is sampled twice
per output frame during the entrance and impact.

The final word retains v4's exact letter masks and crimson X. A soft offset blue
echo and restrained halo provide depth. The v4 reference-assisted glass plate is
preserved. Opposing rigid pane translations/rotations and small central shards
break the word's baseline when the glass fractures; no swelling lens is used.

## Timing

| Time | Picture |
| --- | --- |
| 0–0.28 s | Pure black |
| 0.28–2.35 s | Scattered luminous fragments progressively decode |
| 2.35–3.04 s | Fragments converge into the clean word |
| 3.04–3.45 s | Short readable hold |
| 3.45–4.25 s | Small screen vibration builds |
| 4.25–4.60 s | Impact, right-to-left fracture and opposing pane displacement |
| 4.60–7.18 s | Fractured title holds |
| 7.18–9.68 s | Overlapping letter fades, X lingering briefly |
| 9.70–10 s | Pure black |

The approximate source glass sound onset at 10.775 s is mapped to 4.25 s. The
source segment from 10.68–11.17 s remains at original speed; surrounding music is
retimed with pitch preservation and short crossfades. The glass travels across
the title about 50–70 ms after that onset. Audio begins at 0.28 s and ends at
9.75 s. This is the same reference soundtrack, not an original StudioX score.

## Rebuild

Requires Python 3, NumPy, Pillow and FFmpeg. No new application dependency or host
font installation is required: the saved glyph masks are the typography source.
The archive preserves repository-relative paths; extract it into a working folder
and run commands from that folder. Keep the included `optical-assets` directory
and `layout.json` at their supplied paths.

```bash
# Optional: recreate the supplied retimed WAV from the included local reference.
OPENBLAS_NUM_THREADS=1 python3 scripts/intro/retime_audio_v5.py

# Render 600 frames, with atomic checkpoints for an interrupted run.
OPENBLAS_NUM_THREADS=1 python3 scripts/intro/render_v5.py --stills --render

# Verify the actual encoded output.
OPENBLAS_NUM_THREADS=1 python3 scripts/intro/verify_v5.py \
  docs/local/intro/v5/studiox-intro-v5-60fps.mp4
```

Outputs live in `docs/local/intro/v5/`. The video is 1920×1080 at 60 fps, H.264,
with stereo 48 kHz AAC audio. A silent alternative is included. `--audio` selects
a different local WAV; that file must already be synchronized to the v5 timing.

The checkpoint identity includes the renderer, fracture plate, letter masks and
layout. A changed identity is rejected: render to a fresh `--output` directory
after changing animation sources. The visual source assets still load from the
supplied v5 optical-assets path. Earlier revision directories are protected.

## Review and limits

`verification.json` records encoded frame count, timestamps, black frames, audio
levels, and motion measurements. `audio-timing.json` records retiming and unchanged
transient checks. `review/continuity-check.json` checks the fragment handoff and
fade cutoff; contact sheets show selected visual moments. These are technical and
sampled visual checks, not proof of subjective approval or TV hardware playback.

The setup is the visual master only. No Vega runtime screen, app dependency or
navigation has been changed. Native startup integration and device performance
validation remain separate work, described in
`docs/product/intro-rendering-options.md`.

V1–V4 sources and exports remain intact. The local reference and plate provenance
are included for reproducibility; nothing has been published.
