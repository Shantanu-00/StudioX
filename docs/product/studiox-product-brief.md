# StudioX — product brief

Status: initial concept captured on 19 October 2026. This document records the user's vision and labels implementation proposals separately. It does not claim that the application or its analysis capabilities have been implemented.

## Product definition

StudioX is an AI-enhanced viewing and practice application for Fire TV, targeting Vega OS. It turns uploaded videos into experiences in which viewers can understand, ask questions, and practise what they watch.

The TV is the main viewing and feedback screen. The remote is the standard controller. A paired mobile phone can provide uploads, a camera for practice analysis and deliberate gesture controls, and potentially voice-question input.

Video analysis is an underlying capability. The product's user-facing purpose is enhanced viewing and guided participation.

## Hackathon focus

| Area | User's intended experience | Scope position |
| --- | --- | --- |
| Boxing | Analyse footage; practise alongside a reference; review movements, slow down, and understand improvement opportunities | Main feature |
| Podcast enhancement | Understand discussion topics; pause for catch-up/context; ask voice questions; explore relevant interactive material | Main feature |
| Music notes | Display notes that someone can follow while playing an instrument, using a friend's existing GitHub project | Stretch goal, deferred until the repository is supplied and time permits |

Primary track: Fire TV. Target OS: Vega OS. Selected mini challenge: AWS Builder. Open Source is not currently targeted.

## Shared user journey

1. Open StudioX on the TV.
2. Add a video and choose the appropriate experience, with automatic suggestions possible later.
3. Watch the video and access timestamp-linked enhancements.
4. Optionally pair a phone to enable camera-based practice, gestures, or voice input.
5. Review the resulting insights and return to the relevant video moments.

Proposed upload/pairing UX: the TV displays a QR code and fallback pairing code; a phone or computer opens the companion page to upload a video to that TV session. This avoids requiring a TV file picker. File types, size limits, processing delays, playback compatibility, session expiry, and access boundaries must be defined during implementation.

A phone is optional for remote-controlled uploaded-video viewing. Live camera analysis requires an appropriate camera source; the intended first source is the paired phone.

## Boxing

### Uploaded footage has two possible roles

- **Reference footage:** a demonstration the user wants to study and follow.
- **My practice:** a recording of the user's own movements to review.

Proposed UX: let the user specify the role instead of assuming every uploaded boxing video is a correct reference or every upload is the user's performance.

### Video-review experience

- Play, pause, slow down, replay, and loop a selected movement segment.
- Highlight relevant moments on the timeline.
- Where tracking is reliable, show a body-landmark overlay and measured movement observations.
- Present a short analysis report linked to the moments supporting each observation.

### Live-practice experience

1. The viewer selects a short reference drill.
2. The phone pairs with the TV session and is positioned to capture the user's movement.
3. The system checks that the necessary body landmarks are visible.
4. The TV displays the reference alongside the user's preview or pose representation.
5. The user completes the drill.
6. The system offers a brief review with relevant comparisons and replay controls.

Showing a live preview or skeleton is separate from recording the practice. Recorded slow-motion replay of the user's session requires explicit recording/storage functionality; otherwise only the uploaded/reference video is available for replay.

### Feasibility and first implementation proposal

This is feasible as a focused demonstration. Pose estimation can supply body landmarks from recorded or live video, but does not itself supply boxing expertise or validated technique scoring. Google documents these pose inputs/outputs in its [Pose Landmarker guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker).

Start with one person performing one specified drill, such as a jab–cross sequence, in a defined camera view. Candidate observations to test include approximate repetition count, movement timing, consistency between repetitions, and whether the tracked hand returns to a defined guard region. These are hypotheses to validate on test footage, not guaranteed capabilities.

Reference comparison should account for body proportions, camera view, handedness, and movement phase. Comparing two people at identical video timestamps is not sufficient.

Fast punches, gloves, motion blur, hidden limbs, camera changes, and overlapping people complicate tracking. The first version should report low-confidence tracking rather than invent a precise score. Punch force, impact accuracy, comprehensive coaching, and reliable interpretation of arbitrary fight footage are outside the proposed MVP.

AI-generated explanations should describe measured observations; a language model should not invent measurements from the video.

## Podcast enhancement

### Content understanding

Analyse the transcript and label discussion segments with topics such as motivation, science, finance/business, or education. These can overlap and change throughout an episode. Here, the user's word "framework" means the discussion's subject or structure, rather than a software framework.

### Pause-time experience

When the viewer pauses, offer relevant actions:

- **Catch me up:** explain the important points up to the current playback position, without including future sections by default.
- **Explain this:** clarify a term, argument, or example from the current segment.
- **Try it:** open an appropriate small interactive aid, such as a timer for a breathing exercise discussed in the episode.
- **Explore context:** display a relevant chart, cited background information, or a sourced counterpoint when suitable data is available.
- **Ask a question:** accept a voice question and answer using the relevant transcript passages, with timestamp links.

The question-answering interface is an AI companion discussing the episode. It must not imply that the actual podcasters are responding or attribute generated statements to them.

### Charts and additional sources

For financial discussion, a graph needs an identified instrument/metric and time range. An episode's historical claim and today's market are different contexts. Charts should show their source, date range, and data freshness. Proposed interpretation: help viewers inspect the speaker's claim; do not silently treat it as a trade recommendation or generate invented market values.

For scientific or educational discussion, distinguish:

- What the episode says, supported by a transcript timestamp.
- Additional external context, supported by a source.
- A possible disagreement, supported by evidence and clearly attributed.

External retrieval is a separate capability from transcript summarisation. The MVP need not support open-ended fact-checking for every subject.

### First implementation proposal

Ship timestamped transcript processing, segment-topic labels, Catch me up, and transcript-grounded questions first. Add one contextual interactive card if time permits. Treat comprehensive live market data and broad external fact-checking as later expansions.

Voice questions are in the intended experience. A paired phone microphone is a candidate first input; direct TV-remote microphone access requires platform-specific verification.

## Remote, phone, and gesture controls

The remote should provide the complete base playback and navigation flow. Phone camera analysis has two distinct purposes:

1. Track body movement during boxing practice.
2. Recognise intentional gestures that control playback/navigation.

Do not interpret boxing movements as TV commands. Proposed approach: an explicit gesture-control mode, deliberate gesture holds, cooldowns, visible command confirmation, and the remote as a fallback. Start with a small command set such as pause/resume and opening/closing the insight panel.

Gesture-recognition models provide building blocks; they still need validation with the actual phone, camera view, and session latency. [Google's Gesture Recognizer guide](https://developers.google.com/edge/mediapipe/solutions/vision/gesture_recognizer) describes supported recognition tasks.

Processing camera frames on the phone and sending pose/command data is an initial design option. It is not yet a selected or benchmarked architecture. Streaming a live preview and storing a replay require additional media transport/storage decisions.

## Potential AWS contribution

Candidates to evaluate, not a committed stack:

- **Amazon Transcribe:** produce a timestamped podcast transcript. AWS documents both uploaded-file and streaming transcription. [How Transcribe works](https://docs.aws.amazon.com/transcribe/latest/dg/how-it-works.html)
- **Amazon Bedrock:** generate summaries, contextual explanations, and transcript-grounded answers from supplied material. Grounding and source attribution must be implemented by the application. [Bedrock overview](https://docs.aws.amazon.com/bedrock/latest/userguide/what-is-bedrock.html)
- Supporting storage/backend services if needed once the actual video/session architecture is selected.

ADBT supports development; the application still needs its own content processing and session implementation. Document qualifying AWS usage and include product feedback for the services actually used.

## Proposed hackathon demonstration

One TV application with two working modes and a shared phone companion:

1. **Boxing:** a short supported drill, reference playback, paired-phone tracking, measurable session observations, and useful review.
2. **Podcast:** an episode segment, pause-time Catch me up, a voice question, and a timestamp-supported answer.
3. **Shared interaction:** a working remote flow and a small, deliberate gesture-control demonstration.

Music remains optional after these flows work. This priority order is a scope proposal, not a change to the user's longer-term vision.

## Decisions still to make

- Which boxing drill and camera angle are supported first?
- Is the first boxing upload a reference, the user's recording, or both through a role selector?
- Which measurable observations are reliable on representative footage?
- Is recording the live practice included in the first build, or deferred?
- Which podcast segment and contextual card form the first demo?
- Which upload formats/durations and processing times are acceptable?
- Which phone browsers/devices and media/session transport are supported?
- Which gesture commands are included, and when are they enabled?
- Which AWS services and model are actually selected?
- What is the friend's music repository, its license, and its integration requirement?

## First proof points

Before expanding features, verify: a video plays on Vega; a phone pairs to the intended session; a small gesture triggers one intentional command; the chosen boxing drill yields credible measurements; and a podcast answer links back to a real transcript moment. These establish the key product risks without claiming universal video understanding.
