# StudioX original sound — v2, CC0 recordings plus synthesis

V1 was entirely synthesized. Its pitched grains, logo tone and sine-mode glass ring
read as toy-like, and its sections did not follow the reference's pacing. V2 keeps
V5's picture and replaces only the sound.

## What it is made of

Eleven CC0 (public-domain) Freesound recordings supply what synthesis could not
make convincing:

| Layer | Source |
| --- | --- |
| Glass snap and pre-failure tick | unfa, *Glass Screen Protector Breaking & Cracking* (610933) |
| Fracture crackle and brittle spread | karlis.stigis, *Ice Cracks* (168712) |
| Fracture body | Sanderboah, *Car windshield crack* (806423) |
| Secondary crack | 13FPanska_Cerny_Jan, *Crack_glass.wav* (379008) |
| Sub pressure bed | Woodingp, *Low Rumble New.2* (83517) |
| High static | kyles, *electric crackle buzz high tension powerline* (637511) |
| Electrical mid texture | Mikes-MultiMedia, *electric humming heavy* (349696) |
| Suspended cold buzz | Developer_Jake, *Fluorescent lightbulb hum buzz* (638895) |
| Surge texture, aftermath | lennartgreen, *Low Rumble - loopable ambiance* (638914) |
| Near-silence room | BrainClaim, *Bass Rumble In The Distance* (273805) |

CC0 was confirmed on each sound's own page on 22 October 2026.
`sources/sources-manifest.json` records page, licence and SHA-256 for each sound.
Code supplies the two D2 bass surges, a 72→38 Hz sub thump, all filtering,
envelopes, right-to-left panning of the crack, and the mix.

## Timing

Section times come from the V5 picture and a 50 ms band-energy analysis of the V5
timing reference. Only timing and level contour are taken from it. No reference
samples are mixed, and the tonal material deliberately differs. The surge is D2,
not the reference's ~89 Hz. The held tone is a 120 Hz-series ballast buzz,
not the reference's ~1 kHz tone.

| Time | Sound |
| --- | --- |
| 0–0.28 s | Silence |
| 0.28 s | Sub bed enters |
| 0.62 s | Powerline static |
| 0.86–2.79 s | Electrical hum grows |
| 1.70–2.785 s | First surge, hard stop |
| 2.70–4.225 s | Suspended buzz |
| 3.35–4.225 s | Second surge, tremor accelerating with the screen shake |
| 4.19–4.25 s | Low end pulled away, stress tick at 4.198 s |
| 4.250 s | Fracture attack (measured 4.25004 s) |
| 4.39 s | Brightest crackle, then collapse |
| 4.625 s | Hard gate to near silence |
| 5.0–7.5 s | Low aftermath swell, peak 7.5 s |
| 7.6–9.25 s | Recedes and fades; silent from 9.25 s |

Stem gains were matched once to the reference's band levels with `--fit`. The
fitted values are fixed in the script, so the build does not need the reference.

## Deliverables

In `docs/local/intro/original-audio-v2/`:

- `studiox-original-v2-master.wav`: 48 kHz, stereo, 24-bit, −21.5 LUFS, −2.0 dBTP.
- `studiox-original-v2-preview.mp3`: audition copy.
- `studiox-v5-original-audio-v2.mp4`: unchanged V5 picture with this sound.
- `stems/`: eight layers before mastering gain.
- `score-and-provenance.json`: sources, events, gains, contour difference from the reference.
- `mastering-verification.json`: loudness, true peak, fracture timing, silences,
  unchanged picture packets.

## Rebuild

Requires Python 3, NumPy and FFmpeg. From the repository root:

```bash
python3 scripts/intro/fetch_cc0_sources_v2.py
OPENBLAS_NUM_THREADS=1 python3 scripts/intro/compose_original_audio_v2.py
OPENBLAS_NUM_THREADS=1 python3 scripts/intro/master_original_audio_v2.py
```

The fetch step verifies every file by SHA-256. Add `--audio-only` to the master
step to skip muxing the V5 movie.

## Limits

Freesound original files need a login, so the sources are Freesound's 192 kbit/s
previews. They are adequate for filtered sound effects, but they are not lossless.
The measurements show timing, levels, peaks and mono compatibility. They do not
show whether the mix sounds right. That needs listening, including on a television.
The V5 glass artwork remains reference-derived. New sound does not clear those visuals.
