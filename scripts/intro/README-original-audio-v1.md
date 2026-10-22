# StudioX original sound — first composed mix

The new ten-second cue replaces the reference soundtrack in a separate review
video. V5's visual bitstream and all earlier exports remain unchanged.

Every sound is synthesized: a warm low bed, small crystalline fragments, a short
title-lock tone, growing tension, a brittle impact and ringing decay. The glass
impact begins at 4.25 seconds. Quiet overlapping partials accompany the lingering X.
There are no sampled recordings, downloaded effects, external impulse responses,
transcribed themes or external music-generation services.

## Deliverables

In `docs/local/intro/original-audio-v1/`:

- `studiox-original-master.wav`: 48 kHz, stereo, 24-bit final master.
- `studiox-original-preview.mp3`: convenient audio audition.
- `studiox-v5-original-audio.mp4`: unchanged V5 picture with the new soundtrack.
- `stems/`: six separate layers before the final 2.45 dB master gain.
- `score-and-provenance.json`: synthesis methods and event times.
- `mastering-verification.json`: measured loudness, peaks, mono compatibility,
  silence and unchanged-picture checks.

The audio-only setup archive contains the audio, sources, stems and documentation.
It deliberately does not bundle the old reference soundtrack or visual plate.

## Rebuild

Requires Python 3, NumPy and FFmpeg. From the extracted archive or repository root:

```bash
OPENBLAS_NUM_THREADS=1 python3 scripts/intro/compose_original_audio_v1.py
OPENBLAS_NUM_THREADS=1 python3 scripts/intro/master_original_audio_v1.py --audio-only
```

To also mux the existing V5 silent movie, omit `--audio-only`. That movie must be
present at `docs/local/intro/v5/studiox-intro-v5-silent.mp4`. Mastering applies a
2.45 dB linear gain, with no compression or time stretching.

## Review status

The cue has been composed and signal-checked. The impact has headroom, the stereo
mix retains its content in mono, and the low bed includes upper harmonics intended
to remain audible on TV speakers. These measurements do not substitute for
listening on a television. Whether it sounds better than the reference is an
artistic judgment for the audition, not a result a numerical test can prove.

The source/process records document an independently synthesized audio cue; they
are not a legal opinion or guarantee of exclusive copyright. The current V5 glass
artwork remains reference-derived. This new soundtrack does not clear those
visuals. The separate rights review records the submission implications.
