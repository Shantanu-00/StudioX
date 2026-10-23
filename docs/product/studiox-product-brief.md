# StudioX — product brief

> **Historical design note.** Written during the build (20–22 Oct 2026) and kept for the record.
> Statements such as "proposal", "nothing is deployed" or "not built yet" describe the state at the
> time. The current product and the deployed system are described in the [README](../../README.md),
> [ARCHITECTURE.md](../ARCHITECTURE.md) and [aws-builder.md](../aws-builder.md).

Status: revised 20 October 2026. StudioX is now **only a podcast co-viewing app**. The earlier
boxing-practice and music-notes ideas are dropped, not deferred. This brief records the product
intent; it does not claim features are implemented. What exists today is listed in
[phase-1.md](phase-1.md).

## Product definition

StudioX is an AI co-viewer for video podcasts on Fire TV (Vega OS). You watch an episode on the TV;
StudioX watches with you and, when you want it, lays out what the episode is talking about: who the
people are, what they claim, the timeline of events they mention, the routines they describe, and the
concepts behind the jargon.

The TV is the screen and the remote is the controller. A phone is optional. Paired once with a code
(and remembered for 30 days), it shares a private, iMessage-style thread with the TV, the **Link**.
Through it the phone can send messages, links and its own videos to the TV, and it can act as a
camera for hands-free gestures (pause, open a layer). Shared items stay on the TV's Shared shelf.
The backend runs on AWS ([architecture.md](architecture.md)).

## Experience

1. Open StudioX. A short opening sting plays, then the library.
2. Choose one of the two prebuilt demo episodes, or **Upload your own** (scan a QR code, send a video
   from your phone).
3. Watch. While playing, StudioX stays out of the picture: at most a quiet marker on the timeline
   when a new layer becomes available.
4. Pause, or ask, and the co-viewer opens: dossiers, timeline, claims, routines, concepts, catch-up.
   Every item links to the moment in the episode that supports it.
5. Optional: **Connect phone camera** for gesture control. Frames are processed on the phone; only
   small commands reach the TV.

## Co-viewing layers

Each layer has one job. All are generated from a timestamped transcript and are tied to the moment
that supports them. A multi-agent pipeline on AWS prepares them per segment of the episode. On
pause, a live composer picks what fits the last 15 seconds (genre-aware: a crime episode gets a
timeline and a people graph; a health episode gets an animated technique and a list of named
protocols or medicines). Technically each layer is a typed widget
([architecture.md](architecture.md#4-the-agentic-system)). The visual concepts are in
[design-language.md](design-language.md).

| Layer | What it shows | Grounding rule |
| --- | --- | --- |
| Dossier | Bio, role, and relevant background for each person mentioned or speaking | Episode statements cite a timestamp; outside facts cite a source |
| Timeline | Events the conversation refers to, placed in order | Each event cites when it was mentioned |
| Claims | A claim made in the episode, with context and, where available, a sourced counterpoint | Speaker's claim, added context and disagreement are labelled separately |
| Routine | Step-by-step practices described (a morning routine, a breathing drill) with a timer | Steps must come from the transcript |
| Concept | Plain-language explanation of a term or idea, with a small relationship diagram | Distinguish what was said from the explanation added |
| Catch-up | What has happened so far, up to the current position only | Built only from transcript before the playhead |

The eight viewer questions these layers answer, and how each maps to Vega and AWS, are in
[coviewer-plan.md](coviewer-plan.md).

The co-viewer is an AI companion discussing the episode. It must never imply that the podcast's
hosts or guests are speaking, and must not attribute generated statements to them.

## Constraints that shape the product

- **TV hardware.** Baseline 1 GB RAM device; project budget < 250 MiB PSS foreground. Heavy work
  (transcription, model calls, layer generation) runs in the backend; the TV renders small cards.
  See [architecture.md](architecture.md).
- **Remote first.** Every flow works with the D-pad, SELECT and BACK. The phone is never required.
- **No invented facts.** Charts need real data with source and date; numbers are never made up.
  If a layer has no support in the transcript, it is not shown.

## Potential AWS contribution

Candidates, not a committed stack:

- **Amazon Transcribe** for a timestamped transcript of uploaded episodes.
  [How Transcribe works](https://docs.aws.amazon.com/transcribe/latest/dg/how-it-works.html)
- **Amazon Bedrock** for generating layers from transcript passages, with application-level
  grounding and source attribution.
  [Bedrock overview](https://docs.aws.amazon.com/bedrock/latest/userguide/what-is-bedrock.html)
- **S3, CloudFront, API Gateway (HTTP and WebSocket), Lambda, DynamoDB, MediaConvert and Step
  Functions** for the web app, pairing, the Link thread, uploads and playback.

## Decisions still to make

- Which two podcast videos ship as demo episodes, and their licence to be shown.
- Upload limits (format, duration, size) once playback is verified on Vega.
- Which layers are in the demo build (proposal: Dossier, Timeline, Catch-up first).
- Which gestures, and when they are active.
- AWS region, model, and hosting for the companion.
