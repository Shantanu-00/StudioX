# StudioX opening sequence

The active production is a custom 10-second Blender animation based on the user's
selected [Black Mirror title sequence](https://www.youtube.com/watch?v=pxjy1vahZnU).
The missing FedyaL After Effects template is no longer a dependency.

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

The current scope is the rendered video and its editable production files. App
startup playback, lifecycle handling, remote skip and handoff to Playground require
separate Vega integration and on-device verification.
