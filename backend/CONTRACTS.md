# Backend contracts (deadline build)

Fixed on 22 Oct 2026 so several builders can work in parallel. Change this file only by agreement;
when you do, say so in your report. Region: us-east-1. Read with [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).

**Deadline scope: the "Know" layer.** The pipeline produces the widget schema the TV already renders
(`src/analysis/schema.ts`: `EpisodeAnalysis` with segments, moments and widgets). Two things come
later, if time remains: the A2UI-shaped surfaces (system-architecture §9) and playable moments
(`src/playables/`, behind a flag).

## 1. Storage keys (S3 bucket from StudioXCore; served by CloudFront)

| Key | Content |
| --- | --- |
| `media/<mediaId>.mp4`, `media/<mediaId>.frag.mp4` | H.264/AAC playback files. CloudFront URL `https://<cf>/media/<mediaId>.mp4` |
| `uploads/<mediaId>/<name>` | Phone uploads (raw) |
| `transcripts/<mediaId>.json` | Normalised transcript (§2) |
| `packages/<mediaId>/latest.json` and `packages/<mediaId>/v<n>.json` | Episode package (§3). The TV loads `https://<cf>/packages/<mediaId>/latest.json` |
| `runs/<mediaId>/<executionName>/...` | Intermediate pipeline outputs (debug; not public) |

The demo media IDs are `science-ep42` and `crime-case104`, the same IDs the TV app uses.

## 2. Transcript `transcripts/<mediaId>.json`

```json
{"mediaId": "science-ep42", "durationSec": 37.28, "source": "transcribe" | "supplied",
 "speakers": {"spk_0": "Dr. Julian", "spk_1": "Elena"},
 "sentences": [{"t0": 0.0, "t1": 3.1, "speaker": "spk_0", "text": "Look at how Cristiano Ronaldo optimizes his recovery."}],
 "speech": {"words": 92, "speechSeconds": 33.5}}
```

Times are in seconds. `sentences` is required; word-level timing is optional.

## 3. Episode package `packages/<mediaId>/latest.json`

The exact `EpisodeAnalysis` shape from `src/analysis/schema.ts` (segments, moments, widgets with
`evidence: [{t0, t1}]`), plus these fields:

```json
{"provenance": "pipeline", "version": 3, "generatedAt": "2026-10-22T18:00:00Z",
 "models": {"segment": "us.anthropic.claude-sonnet-5-5", "lenses": "…", "curate": "…"},
 "funnel": {"candidates": 41, "kept": 17, "shown": 12, "byLens": {"claims": {"candidates": 6, "kept": 2}}},
 "rejected": [{"lens": "claims", "text": "…", "reason": "common knowledge"}],
 "answers": [{"question": "Is the 37% from a real study?", "t": 11, "text": "…", "cites": [5], "sources": [{"title": "…", "url": "https://…"}]}]}
```

Every widget must pass the TV's `validateWidget`; the packager drops any that fail and records the
reason in `rejected`. `answers` are precomputed answers to suggested questions, used in demo mode.

## 4. AgentCore runtimes: invocation payloads (JSON in, JSON out)

The **`analyst`** runtime:

| `mode` | Request | Response |
| --- | --- | --- |
| `segment` | `{mode, mediaId, transcriptKey}` | `{segments: Segment[], speakers: {spk_0: name}, genre}` |
| `lenses` | `{mode, mediaId, transcriptKey, segment: Segment, brief: {cast: [...], recaps: [...]}}` | `{candidates: [{lens, widget, salience, reason}], recap}`, where `widget` is a TV widget |
| `curate` | `{mediaId, mode, transcriptKey, segments, candidates}` (verified) | `{moments: Moment[], widgetIds: string[], questions: [{t, question}]}` |
| `map` | `{mode, mediaId, transcriptKey, segments, candidates, widgetIds, labels, moments, questions, pinned}` (added 23 Oct, section 9) | `{explore, problems, questions: [{t, question, mapNode}]}`: the curator's questions plus the map's |
| `answer` | `{mode, mediaId, transcriptKey, t, question}` | `{text, cites: number[], sources: [{title, url}]}` (used to precompute `answers`) |

The **`coviewer`** runtime:

| `action` | Request | Response |
| --- | --- | --- |
| `refine` | `{action, sessionId, mediaId, t}` | `{caption, widget?}`. At most one new widget, which must pass `validateWidget` |
| `ask` | `{action, sessionId, viewerId, mediaId, t, question}` | `{text, cites, sources}` |

**Rules, enforced in code inside the agents:**

- Never read transcript after `t` for `refine`, `ask` or `answer` (no spoilers).
- Every cited URL must be one a search tool actually returned.
- Every verdict comes from the rule table.
- Bounded searches and tool calls per call.

## 5. SSM parameters

| Name | Value |
| --- | --- |
| `/studiox/domain` | CloudFront domain (exists) |
| `/studiox/agents/analyst/arn`, `/studiox/agents/coviewer/arn` | AgentCore runtime ARNs (written after `agentcore deploy`) |
| `/studiox/guardrail/id`, `/studiox/guardrail/version` | Bedrock Guardrail (contextual grounding + prompt attack) |
| `/studiox/live` | `on` / `off`. When `off`, the live routes return 503 `LIVE_OFF` |
| `/studiox/access-code` | Shared code for the live routes (TV builds in `live` mode send `x-studiox-access`) |

## 6. API additions (same Lambda `api`, same auth rules as API contract v1)

| Method & path | Caller | Response |
| --- | --- | --- |
| `GET /v1/episodes` | Anyone | `{episodes: [{mediaId, title, status, mediaUrl, packageUrl?}]}` |
| `GET /v1/episodes/{mediaId}` | Anyone | One of the above |
| `POST /v1/sessions {mediaId}` | TV | `{sessionId}` (≥ 33 characters; warms `coviewer`) |
| `POST /v1/refine {sessionId, mediaId, t}` | TV | The `coviewer` refine response. Cached in DynamoDB per (mediaId, 5 s bucket) |
| `POST /v1/ask {sessionId, mediaId, t, question}` | TV or phone | The `coviewer` ask response |

A phone message with `kind: "question"` is answered automatically: the Lambda calls `ask` using the
link's now-playing state and posts an `answer` message from `ai`. Live routes check `/studiox/live`,
a daily quota (DynamoDB `QUOTA#<date>`) and the access code (TV only).

## 7. Pipeline progress and statuses

`MEDIA#<id>/META.status` goes `UPLOADING` → `PROCESSING` → `ANALYSING` → `READY`, or
`NOT_A_FIT` / `FAILED`.

- `progress` is a number from 0 to 1.
- Each Step Functions state that changes these writes a `status` message to the owner's link
  thread, if there is an owner. Demo seeding has no owner.
- `NOT_A_FIT` comes from the eligibility gate: speech under 30% of the duration, or fewer than
  40 words per minute. The thread line reads `NOT A FIT · <n>% SPEECH`.

## 8. Uploads you can watch, and the TV inbox (added 22 Oct, 23:00)

**Playback preparation.**

- A new Step Functions state **`Prepare playback`** runs in a **Parallel** branch beside
  `Transcribe speech`, for uploads (`mediaKey` present).
- It is a Lambda with a static ffmpeg layer. H.264/AAC input is remuxed (`-c copy`); anything else is
  transcoded (libx264 veryfast, ≤ 720p, AAC). The output is a fragmented MP4 at
  **`media/<mediaId>.frag.mp4`** (`-movflags frag_keyframe+empty_moov+default_base_moof`).
- Then `MEDIA#<id>/META` gets `playable = true` and
  `mediaUrl = https://<domain>/media/<mediaId>.frag.mp4`.
- On failure, `playable` stays false with a reason, and the analysis branch still runs.

**`MEDIA#<id>/META` fields the TV reads:** `title` (the file name without extension, ≤ 60
characters), `status`, `progress`, `playable`, `mediaUrl`, `packageUrl` (when READY), `createdAt`,
`linkId`.

**New route:**

| Method & path | Caller | Response |
| --- | --- | --- |
| `GET /v1/links/{linkId}/media` | TV (device) or phone (cookie), members of the link only | `{media: [{mediaId, title, status, progress, playable, mediaUrl, packageUrl, createdAt}]}`, newest first, at most 20 |

**TV inbox.**

- The TV's "Shared with you" section shows the link's thread (`GET /v1/links/{id}/messages`, polled
  every 4 s while the section is visible) and its uploads (`GET /v1/links/{id}/media`).
- SELECT on a playable upload opens the Player with a dynamic episode: `{id: mediaId, title,
  mediaUrl, packageUrl}`, with no bundled fallback. Until READY, it shows `ANALYSING…`.

## 9. Map (the interactive visualiser), added 23 Oct

An optional `explore` block in the episode package (§3). The **Map author** agent writes it after
`curate`; code validates and bounds it. The TV draws it with native layouts.

**What it's for:** an episode with a connected structure (a routine, a case, an argument, a
history, a trend) gets a **Map** button. Pressing it turns the whole conversation so far into one
navigable picture. Every piece is one SELECT from the moment it was said. Some nodes open a small
simulation the viewer drives with the remote.

```json
"explore": {
  "eligible": true,
  "reason": "A sleep routine with four connected steps",
  "category": "health",
  "layout": "flow",
  "title": "The sleep routine",
  "summary": "What the guest recommends, in order, and how it connects",
  "groups": [{"id": "g1", "title": "At night"}],
  "nodes": [{"id": "n1", "group": "g1", "kind": "step", "label": "Sleep in 90-minute blocks",
             "detail": "Five cycles of 90 minutes, about 7 h 30 min.", "t": 5, "t1": 11,
             "when": null, "value": null, "verdict": null, "refs": ["protocol-s1-1"], "sim": "night"}],
  "edges": [{"from": "n1", "to": "n2", "kind": "then", "label": null}],
  "sims": [{"id": "night", "engine": "night", "title": "Plan your night",
            "params": {"cycleMinutes": 90, "cycles": 5, "bedtime": 1380, "quote": "Five ninety-minute cycles.", "quoteT": 5}}],
  "questions": [{"nodeId": "n3", "t": 13, "question": "Does a cool room really help?"}]
}
```

**Fields:**

- `category`: health · crime · finance · history · tech · motivation · scifi · other.
- `layout`:
  - `flow`: ordered steps or ideas with connectors (routines, how-tos, arguments);
  - `timeline`: events on a time axis (cases, histories);
  - `compare`: two or more options or values side by side (finance, tech choices);
  - `cluster`: topics with their ideas (everything else).
- `kind`: idea · step · claim · event · person · number.
- **Limits:** label ≤ 44, detail ≤ 200, when ≤ 16, title ≤ 48, summary ≤ 120, reason ≤ 120,
  group title ≤ 32.
- **Counts:** groups 1–5, nodes 3–12, edges ≤ 16, sims ≤ 2, questions ≤ 4.
- `t` and `t1` are seconds within the episode, taken from the evidence of the source cards.
- `verdict` is copied from a referenced claim, never invented.
- `value` is `{n, unit}` for `compare` nodes, and only when the episode states the number.
- `edges.kind`: then · because · supports · contradicts. The label is ≤ 24 characters.

**Simulation engines.** The catalog is compiled into the TV, so the AI chooses an engine and its
parameters, never code. **The maths runs on the TV in code.**

| `engine` | Params (bounded) | What the viewer does |
| --- | --- | --- |
| `night` | cycleMinutes 60–120, cycles 3–6, bedtime 1200–1560 (minutes after midnight, wraps at 1440), quote, quoteT | Moves bedtime and cycles; the wake time snaps to a cycle end |
| `growth` | start ≥ 0, monthly ≥ 0, ratePct 0–30, years 1–50, laterYears 0–30 (optional comparison start), currency (3-letter code), quote, quoteT | Moves years, monthly amount and start delay; two curves redraw |

**Eligibility, enforced in code after the agent:**

- `eligible: true` needs at least 3 valid nodes, plus at least 2 valid edges (`flow`, `cluster`)
  or at least 3 nodes with `when` or a distinct `t` (`timeline`).
- Otherwise the package carries `eligible: false` with the reason, and the TV shows no Map
  button.
- Each sim's params are clamped to the bounds above; an unknown engine is dropped.
- `questions` are answered by the analyst `answer` mode (spoiler-safe at their `t`) and stored in
  `answers` with `mapNode` set.

**Spoiler rule on the TV:** nodes with `t` after the playhead plus 4 s are drawn **locked**
(label hidden, "Keep watching") until playback passes them. Edges into locked nodes are drawn
dimmed.

## 10. Map v2: genre scenes (added 23 Oct, 11:00). Additive to §9

**New optional fields.** The TV ignores unknown values and validates bounds.

| Where | Field | Meaning |
| --- | --- | --- |
| `explore` | `suspense: boolean` | Spoiler locks are drawn **only** when `category == "crime"` or `suspense == true`. The mapper sets it for crime, thriller and mystery. Code forces it to false for health, finance, tech, history and motivation |
| node | `icon` | One of `tv, phone, wifi, router, server, cloud, database, chip, lock, globe, moon, sun, pill, thermometer, clock, money, chart, person, document, rocket, flag, camera, footprint`. The TV draws these as built-in SVG glyphs |
| node | `image: {url, credit}` | **https** only, licence-checked Wikimedia Commons (CC0 / PD / CC BY / CC BY-SA), mainly history and person nodes. Use `upload.wikimedia.org` thumbnail URLs at a standard width (e.g. 330px; non-standard widths return 400). The demo packages bundle theirs on the TV (`src/map/images.ts`). The credit is shown whenever the image is |
| node | `phase` | For health or routine flows: `day`, `evening`, `night`, `morning`. The night scene places steps along the sky by phase |
| node | `kind: "number"` | Figures the episode itself states or works out (examples, sums). **No verdict.** `value = {n, unit}` with a short unit ("USD", "%", "years") and an optional `label` |
| sim `growth` | `labels: [string, string]` | e.g. `["Start at 25", "Start at 35"]`, each ≤ 20 characters |
| sim `growth` | `startAges: [number, number]` | Optional, shown on the axis |
| sim `night` | `steps: [{label, offsetMin, icon}]` | Evening steps relative to bedtime (e.g. supplements at −30, room cooled at −60). At most 4 |

**Rules for the analyst `map` mode and code:**
- Never put a verdict on arithmetic or examples the speaker works through.
- `growth` params must match the stated numbers (for example monthly 300, 7%, 40 years, 10-year delay).
- Code checks each sim's numbers against the transcript text where it can, and drops the sim if
  they contradict it.

**Themes are drawn by the TV, by category** (`src/map/themes.ts`): crime = case board (black and
red), health = night sky (ink, moonlight, dawn gold), tech = signal (black, cyan, grid), finance =
ledger (black, green, gold), history = archive (warm charcoal, amber, photos), other and motivation
= neutral.
