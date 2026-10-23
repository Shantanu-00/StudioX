# StudioX TV experience: layout, structure and remote map

> **Historical design note.** Written during the build (20–22 Oct 2026) and kept for the record.
> Statements such as "proposal", "nothing is deployed" or "not built yet" describe the state at the
> time. The current product and the deployed system are described in the [README](../../README.md),
> [ARCHITECTURE.md](../ARCHITECTURE.md) and [aws-builder.md](../aws-builder.md).

Status: **proposal for review**, 20 October 2026. It fixes the Phase 1 layout bug and
restructures the screens so the TV and the phone feel like one product.

## 1. Why the bottom of the home screen was cut off

Observed on the Vega Virtual Device ([screenshot](../../review/image.png)): only the header and
the two episode cards are visible. **Upload your own** and **Connect phone camera** are below the
bottom edge, and the screen does not scroll.

Cause: React Native 0.83 on Vega lays out in **density-independent pixels (dp)**, and the canvas
is **960 × 540 dp** (scale factor 2 on a 1080p display;
[Density-Independent Pixels](https://developer.amazon.com/docs/vega/0.24/rn-migration-dip.html)).
Phase 1 sizes were written as if the canvas were 1920 × 1080, so everything is drawn at twice the
intended size.

The screenshot confirms it. The 96 dp side margin renders as about 168 screen pixels, and the TV
pane is about 1590 px wide, so 1590 ÷ 1.66 ≈ 960 dp. The home column adds up to about 845 dp of
height:

| Block | dp |
| --- | ---: |
| Top padding | 54 |
| Header and rule | 65 |
| `01 LIBRARY` label | 84 |
| Episode cards | 330 |
| `02 INPUTS` label | 84 |
| Input tiles | 150 |
| Footer and bottom padding | 78 |
| **Total** | **845** (canvas is 540) |

The episode cards end at about 533 dp, which is exactly where the screenshot cuts off. The
emulator window is not cropping anything. The pairing screen has the same problem: a 440 dp QR plus
its fallback text needs about 590 dp. This is a Phase 1 implementation error: I assumed a
1920 × 1080 coordinate space, which the engineering contract warns against.

Remedies (all three apply):

1. **Design for the 960 × 540 dp canvas.** Halve the Phase 1 sizes and define tokens against the
   canvas (below).
2. **Use `useWindowDimensions()`, flexbox and percentages** for the big blocks, so a different
   canvas (Scalable UI can choose a larger one) does not break the layout.
3. **Never let primary actions sit below the fold.** The structure below puts every primary action
   in a fixed top bar or the first row.

### Size tokens for 960 × 540 dp

| Token | dp | Physical at 1080p |
| --- | ---: | ---: |
| Safe margin, horizontal / vertical | 48 / 27 | 96 / 54 px |
| Top bar height | 44 | 88 px |
| Body text / small mono | 15 / 11 | 30 / 22 px |
| Card title / screen title | 20 / 30 | 40 / 60 px |
| Library card (16:9) | 200 × 112 | 400 × 224 px |
| QR plate | 220 | 440 px |
| Focus border / bracket | 1.5 / 11 | 3 / 22 px |

Minimum text size is 11 dp, which is 22 px on a 1080p TV.

## 2. Why it felt disconnected, and the fix

In Phase 1, each part stood alone: a library of empty slots, two tiles that each open a one-off
QR, and a phone page that forgets you after one upload. Nothing showed that a phone was there or
what it had sent.

The fix is one organising idea: **the Link**. The TV always shows whether phones are linked. The
phone and TV share one thread, and anything the phone sends shows up on the TV where you would
look for it.

## 3. Structure

A persistent **top bar** plus three sections. The top bar is the only navigation; it is one
D-pad row, so nothing is ever hidden below the fold.

```
┌────────────────────────────────────────────────────────────── 960 × 540 dp ─┐
│ STUDIOX     WATCH    INBOX ·3    LINK                 ● 2 PHONES LINKED     │  top bar 44
│─────────────────────────────────────────────────────────────────────────────│
│                                                                             │
│  (section content)                                                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### WATCH (default)

```
│ EP.01                                              NO SIGNAL                │
│ Episode title, large                                                        │  hero: the focused
│ Host / Guest · 1 h 12 m · DOSSIERS · TIMELINE · CLAIMS                      │  card's details
│                                                                             │
│ 01 LIBRARY                                                                  │
│ [ EP.01 ] [ EP.02 ]                                                         │  row of 16:9 cards
│ 02 SHARED WITH YOU                                                          │
│ [ video from Ari ] [ link card ] [ link card ] [ + SEND FROM PHONE ]        │  newest first
```

- The hero updates with focus, so the page reads like a dossier on the selected item.
- **Shared with you** is fed by the Link thread: uploads and links, each with sender and state
  (`PROCESSING`, `READY`, `LINK ONLY`).
- The last card, **+ Send from phone**, opens LINK if no phone is paired. If a phone is paired, it
  shows a small hint: "Open studiox on your phone and tap Send".

### INBOX

The thread, read on the TV. The newest message is at the bottom, as on a phone. Phone bubbles are
on the right with the sender's name; TV and AI messages are on the left. UP/DOWN steps through
messages; SELECT on a video or link card opens it. The TV cannot type, so it replies only with
receipts and later quick reactions.

### LINK

```
│  PAIR A PHONE                         │  LINKED                              │
│  [ QR 220 ]   K7Q-4XZ                 │  ● Ari's iPhone      seen 2 min ago  │
│  studiox.app/p · expires 09:41        │  ● Mira's Pixel      seen 1 day ago  │
│                                       │  CAMERA  · off                       │
│                                       │  [ UNLINK ]                          │
```

Pairing happens here, once per phone. The QR stays live while the section is open and refreshes
on expiry. Upload and camera no longer need their own QR screens: once paired, the phone can send
a video or switch on the camera at any time, and the TV shows it.

### Player and AI panel

```
│                                             │ 03 // RIGHT NOW                │
│                                             │ "They are describing the night │
│        video (dims slightly when the        │  of the break-in." [41:02]     │
│        panel is open)                       │ ┌ TIMELINE ─────────────────┐  │
│                                             │ │ 1998 ── 2003 ── ●2004     │  │
│                                             │ └───────────────────────────┘  │
│                                             │ ┌ PEOPLE ───────────────────┐  │
│                                             │ │ (A)──brother──(B)         │  │
│                                             │ └───────────────────────────┘  │
│ ▮▮▮▮▮▮▮|▮▮▮▮▮|▮▮▮▮▮▮▮●▮▮▮|▮▮▮▮  41:02 / 1:12:40 │  SeekBar, AI chapters     │
```

- **SeekBar** (Vega UI Components): break markers at AI segment boundaries, `segmentColors` by
  genre. Cue notches light up as TimedMetadata cues enter.
- **Panel** (right 40%): at most three widgets, chosen by the live composer for the moment
  [t − 15 s, t + 4 s]. A fast card appears at once; the refined one replaces it in place
  (`aria-live`).
- **Widgets:** `timeline`, `relation_graph`, `technique` (Reanimated breathing/exercise animation
  with a phase countdown), `entity_list` (medicines and protocols, with a disclaimer), `concept`,
  `claim`, `recap`. See [architecture.md](architecture.md#41-contract-agents-produce-typed-widgets-the-tv-renders-them).
- SELECT on any item seeks the video to that item's evidence timestamp.

## 4. Remote button map

Buttons on the Fire TV remote (and the VVD remote panel): D-pad, SELECT (OK), BACK, HOME, MENU,
REWIND, PLAY/PAUSE, FAST-FORWARD. HOME and voice are left to the system. Transport keys in the
player arrive through **Vega Media Controls** (`KeplerMediaControlHandler`), so the same handler also
serves Alexa transport commands where the platform delivers them (*unverified for sideloaded apps*).

| Button | Top bar | WATCH / INBOX / LINK content | Player | Co-viewer panel open |
| --- | --- | --- | --- | --- |
| LEFT / RIGHT | Move between sections | Move along a row | Show controls; then seek ±10 s | Switch layer tab |
| UP / DOWN | DOWN enters content | Move between rows or messages; UP from the first row returns to the top bar | Show controls | Move between items |
| SELECT | Open section | Open or play the focused item | Play/pause | Jump the video to the item's timestamp |
| PLAY/PAUSE | — | Play the focused item | Play/pause; pausing peeks the panel | Close the panel and resume |
| REWIND / FAST-FORWARD | — | — | Seek −10 / +10 s (hold to repeat) | Previous / next item with a timestamp |
| MENU | — | Item options: details, remove from Shared, mark watched | Open the co-viewer panel | Close the panel |
| BACK | Exit the app (from WATCH) or go to WATCH | Return focus to the top bar | Close the panel if open; otherwise stop and return | Close the panel |

In the player, RIGHT now opens the Stage rail (the panel without pausing); see
[coviewer-plan.md](coviewer-plan.md#3-on-the-remote-glance-without-pausing-deep-on-pause).

BACK order follows the contract: dismiss the overlay, then go to the previous screen, then exit at
the root.

## 5. Focus rules

- **Initial focus:** the first library card on WATCH; the newest message on INBOX; the QR action
  (refresh) on LINK.
- **Restoration:** each section remembers its last focused item (in App state). Returning from
  the player restores focus to the card that opened it.
- **Top bar:** a `TVFocusGuideView` with `autoFocus`, so UP always lands on the active section.
  Each row is a `TVFocusGuideView` with `autoFocus` and `trapFocusLeft/Right`, so focus stops at
  the row ends instead of jumping rows.
- **Unmounts:** when a focused item disappears (a link is removed, a phone is unlinked), focus
  moves to its neighbour with `FocusManager.focus`.
- **Rapid input:** focus handlers only set an ID; the hero re-renders, but the rows do not.
- One focus look everywhere: `FocusFrame` (bone border, lift, corner brackets, crimson tick),
  scaled to the dp tokens.

## 6. Phone web app (PWA)

| Screen | Content |
| --- | --- |
| Pair | Shown only without a valid token: enter or confirm the code; name this phone |
| Thread | iMessage-style: your bubbles on the right (bone), TV and AI on the left (dark glass), mono timestamps; states `SENT → ON TV → WATCHED` |
| Composer | Text field, paste-link detection with a preview, **+** menu: Upload video, Camera mode |
| Camera mode | Full-screen mirrored grayscale preview, gesture status, big **Stop** |
| Settings | This phone's name, linked TV, Unlink |

It can be installed to the home screen (PWA manifest), so it opens like an app.
