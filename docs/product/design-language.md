# StudioX design language — "Cold Signal"

> Typography, layout and focus rules are now in [tv-ui-guidelines.md](tv-ui-guidelines.md),
> which supersedes the type and layout notes below. The mood and colour rules here still apply.

The brief: Black Mirror, not "AI app". StudioX should feel like a piece of quietly sinister
consumer technology from that show: black glass, clinical type, one red light that means
*something is watching*. It must never look like a generic AI product (purple gradients,
glowing orbs, sparkle icons, chat bubbles, frosted-glass cards, rounded everything).

## Principles

1. **The screen is black glass.** Pure black field (`#000`). Panels are only a shade lighter
   (`#07080A`, `#0E1013`). No gradients, no blur, no drop shadows. On a TV this also avoids overdraw.
2. **One accent, and it means "live".** Crimson (`#E0182D`) is reserved for the X in the wordmark,
   live states, the focus tick and section indices. If everything is red, nothing is.
3. **Two voices of type.** A heavy uppercase sans (Amazon Ember, Vega's default) with wide tracking
   for titles. A monospace (Vega's Droid Sans Mono) for system speech: status lines, timestamps,
   codes, indices. Mono text is the machine talking; sans is the content.
4. **Interfaces that look like instruments.** Hairline rules, corner brackets, crop marks, numbered
   sections (`01 LIBRARY`), status lines with a blinking block cursor. Information is laid out like
   a dossier or a terminal, not like a social feed.
5. **Motion is rare and deliberate.** Effects happen at transitions only: a glitch on reveal, a
   crack, a scan line while waiting. Nothing loops in the background during playback. All motion
   uses opacity and transforms on the native driver.
6. **Focus is a targeting reticle.** The focused element gets a bone border, a 4% lift and four
   corner brackets with a crimson tick. Shape and size change, not just colour.
7. **Say exactly what is true.** Copy is short, declarative and slightly cold: `AWAITING DEVICE`,
   `LINK SELF-DESTRUCTS IN 09:41`, `NO SIGNAL`. Empty or unfinished states say so plainly.

Tokens live in [`src/theme.ts`](../../src/theme.ts). The focus treatment is
[`FocusFrame`](../../src/components/FocusFrame.tsx).

## Signature moments (Phase 1)

- **Opening sting.** Black, then STUDIO resolves with a crimson ghost jitter, the X slams in, a
  hairline crack and flash cross the frame, then the tagline. About 2.8 s; SELECT skips. A cheap
  placeholder for the rendered intro ([opening-sequence.md](opening-sequence.md)).
- **The QR plate.** A bone-white plate (scanners need dark-on-light) with dot-matrix modules, solid
  finder eyes with crimson pupils, bone targeting brackets and a slow crimson scan line. Beside it, a
  status line with a blinking cursor, a self-destruct countdown and a fallback code. When the phone
  links, the plate fades to a ghost with `LINKED` over it.
- **The phone page.** The same language on mobile: black, mono status chip (`LINKED TO TV`), one
  bone action button that turns crimson when pressed, a grayscale mirrored camera preview with a
  scan line.

## Co-viewing layer concepts

Layers appear when the viewer pauses or asks. During playback, the only visible sign is a crimson
notch on a 2 px timeline rail at the bottom edge. The layer panel occupies the right 40% of the
screen so faces stay visible on the left; the video dims, it does not blur.

| Layer | Concept | Visual idea |
| --- | --- | --- |
| Dossier | A personnel file on each person | Redacted-file card: name in heavy caps, role line in mono, three facts that "declassify" (black bars wipe away) on open. Each fact carries a `[12:41]` stamp or a source tag. |
| Timeline | The events the episode refers to | A horizontal rail with year ticks; events are crimson notches; the focused event opens a short card. D-pad left/right walks the rail. |
| Claims | Claim, context, counterpoint | A three-row "evidence board": `CLAIM` (speaker, quoted, timestamp), `CONTEXT` (sourced), `COUNTER` (sourced, or `NONE FOUND`). Never a verdict score. |
| Routine | A practice described in the episode | A step sequencer: numbered steps in mono, the current step in bone, with a countdown ring drawn in SVG. SELECT starts or advances. |
| Concept | Jargon explained | A small node graph (SVG lines and labelled nodes, at most 7 nodes) next to a two-sentence plain-language explanation. |
| Catch-up | What you missed | A `PREVIOUSLY` cold open: three to five lines typed out in mono, each ending in its timestamp. Only uses the transcript before the playhead. |
| Ask | Voice question from the phone | The answer appears as a transcript-style log with cited moments; it is labelled as the AI companion, never as the hosts. |

All layers share one card system: a header in mono (`03 // CLAIMS`), bounded text (no card grows
past its slot; long AI output is cut at a sentence boundary with `…MORE`), and an explicit
empty state (`NO CLAIMS DETECTED IN THIS SEGMENT`).

## Why not a component kit or heavy effects library

The TV budget favours a few hand-built primitives over a UI kit: View borders and transforms,
one SVG path for the QR, and SVG for diagrams. Supported options exist when needed:
`@amazon-devices/react-native-svg` (in use), `lottie-react-native` (pre-rendered motion, e.g. a
final intro), `react-native-reanimated`, and `react-linear-gradient` (avoid: gradients fight the
black-glass look). Every addition must pass the dependency checks in `CLAUDE.md`.
