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

The video is a visual proof, not an integrated startup implementation. The Vega
options and recommended native-compositing route are documented in
[intro-rendering-options](intro-rendering-options.md). Native video playback is also
supported as a first in-app screen; it differs from the OS splash mechanism.

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

## In-app placeholder

Until the rendered intro is integrated, the app plays a short code-drawn sting
(`src/screens/Intro.tsx`, about 2.8 seconds): black, a glitching STUDIO reveal, the
crimson X, a hairline crack and flash, then the tagline. It uses only Animated
opacity and transforms on the native driver, so no video decoder or surface is
created at launch. SELECT skips it; it plays on cold start only.

The current scope of the rendered video is the video and its editable production files. App
startup playback, lifecycle handling, remote skip and handoff to Home require
separate Vega integration and on-device verification.
