# StudioX TV UI guidelines (10-foot)

Status: adopted 21 October 2026 after the first Virtual Device review. These rules replace the
web-style choices in Phase 1 (top tab bar, status chip, tracked monospace everywhere). Tokens live
in [`src/theme.ts`](../../src/theme.ts). The colour language and the Black Mirror mood in
[design-language.md](design-language.md) still apply; its typography and layout notes are
superseded by this page.

## 1. Canvas and safe area

- Vega RN 0.83 lays out on a **960 × 540 dp** canvas; 1 dp = 2 px on a 1080p TV. This is the same
  coordinate space as Android TV, so TV type and spacing conventions apply 1:1.
- Overscan-safe margins: **48 dp** left/right, **27 dp** top/bottom (5%). Only key art and video bleed
  past them.
- Page content starts at **x = 96 dp**, to the right of the collapsed nav rail (72 dp).
- Nothing primary below the fold. A screen must fit 540 dp without scrolling, or scroll by rows
  with focus.

## 2. Typography

Amazon Ember, the Vega system sans (no `fontFamily`). Weight and size carry the hierarchy, not
letter-spacing.

| Role | dp (px at 1080p) | Weight | Use |
| --- | --- | --- | --- |
| Display | 34 / line 40 (68 px) | Bold | Hero title |
| Title | 22 / 28 (44 px) | Bold | Page titles, dialog titles |
| Headline | 18 / 24 (36 px) | Semibold | Row titles, panel section |
| Body | 14 / 20 (28 px) | Regular | Synopsis, explanations |
| Body strong | 14 / 20 | Semibold | Tile titles, button labels (15) |
| Label | 13 / 18 | Semibold | Timestamps, chips |
| Caption | 12 / 16 (24 px) | Regular | Secondary metadata, hints. **Smallest size allowed** |
| Overline | 12, tracking 1.2 | Bold caps | One short label above a title (show name) |

- Sentence case for everything except overlines.
- Monospace only for timecodes and pairing codes.
- Text contrast ≥ 4.5:1 (bone, ash and smoke on black all pass).

## 3. Layout patterns

| Screen | Pattern |
| --- | --- |
| Home | Full-bleed key art; hero (overline, title, metadata, two-line synopsis, **Play**) at top-left; one row of 16:9 tiles (240 × 135 dp) at y ≈ 336 |
| Navigation | **Left nav rail**: icons only (72 dp); expands to 248 dp with labels and a dark scrim when focused |
| Player | Video full screen; controls on flat translucent top/bottom bands; Vega SeekBar at the bottom; captions above it |
| Co-viewer | Right panel, 384 dp (40%); video stays visible; cards on raised surfaces, at most three |
| Pairing | Code on a light plate on the left, numbered steps and the typed fallback on the right |
| Dialogs | Centred card 420 dp, focus trapped, BACK closes |

Avoid web patterns: top tab bars, hover states, status chips that do not act, thin outlined
buttons, dense mono text, links styled as text.

## 4. Focus

One visible focus language, always a shape change as well as a colour change:

| Element | Unfocused | Focused |
| --- | --- | --- |
| Tile | Art, 6 dp radius | Scale 1.08 + 2 dp bone border |
| Button | 14% white fill, bone label | Bone fill, black label, scale 1.04 |
| Rail item | Icon (active item: crimson bar + bone icon) | Bone pill, black icon and label |
| Panel row | Plain | 12% white highlight |

- Focus animations: **140 ms ease-out timing on the native driver.** No springs: a spring overshoots
  and visibly trails fast D-pad presses.
- Selection state (which section is open) never moves on its own: sections change on SELECT only, so
  the focus ring and the active marker cannot disagree.
- Initial focus is deterministic: Home → Play; Shared → Link a phone; Link → Get a new code;
  Player → SeekBar; co-viewer → first row.
- Focus enters the rail on the active item (`TVFocusGuideView destinations`).

## 5. Remote map

| Key | Home / Shared / Link | Rail | Player | Co-viewer panel | Dialog |
| --- | --- | --- | --- | --- | --- |
| D-pad | Move | Up/down between sections; Right back to page | Left/right scrub (see below); Down peeks the panel | Move rows; Left from a row on the panel's left edge hides the panel | Move buttons (trapped) |
| OK | Activate | Open section | Play/pause on the SeekBar | Jump video to the item | Activate |
| Back | To the rail's Home; exit at Home | Exit at Home | Close panel → leave player | Close panel | Close dialog |
| Play/Pause | — | — | Toggle; pausing opens the co-viewer | Resume and close | — |
| Rew / FF | — | — | Seek (Vega Media Controls) | — | — |
| Menu | — | — | Toggle the co-viewer | Close | — |

- **Hiding the panel:** LEFT from a row on the panel's left edge hides the panel. The video is
  full screen and stays paused; DOWN or Menu reopens the panel.
- **Scrubbing:** LEFT/RIGHT taps add up. One seek runs 600 ms after the last press, or at once
  on OK. While scrubbing only, a label above the thumb shows the target time on one line and
  nothing else. Step = duration / 20, clamped to 2–10 s; holding a key accelerates.

## 6. Motion, imagery and performance

- Motion is opacity/transform on the native driver, or Reanimated on the UI thread. Never animate
  layout with the JS driver. Never mix native and JS drivers on one view (fatal on RN 0.83).
- Key art is pre-rendered at the panel's physical size (hero 1920 × 1080, tiles 512 × 288) with the
  scrim baked in. No runtime gradients, blur or shadows.
- At most two hero images are mounted (during a cross-fade).
- Judge smoothness on a **Release** build. Debug builds and the Virtual Device are not representative.

## 7. Co-viewer panel

- Sections, each with an overline label (13 dp bold, tracking 1.2, upper case, tertiary text)
  and a short translucent rule (at most 120 dp, 14% white).
- Order: **Story map**, **People**, the card kind (or "This moment"), **Ask the co-viewer**.
- The Map entry is a row with a play mark and a one-line explanation.

## 8. Map, timeline and photos

- **Map links:** arrowheads only on sequence ("then") links; attachments are plain connectors.
  The story pulse follows the drawn connectors.
- **Timeline card:** rail markers differ by shape as well as words: ring = claim ("Claim, not
  proven"), dot = evidence ("Evidence"), accent dot = contradiction ("Contradicts the claim").
  Approximate times ("~") read as "About …".
- **Photos:** bundled and pre-cropped (square face crops for portraits, 4:3 scene crops), 64 dp
  thumbnails, one-line credit on the card. React Native has no focal point for `cover`, so
  crops are made offline.
- **Themes:** the finance theme is muted (accent `#5BBF8A`).
