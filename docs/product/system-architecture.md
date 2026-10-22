# StudioX system architecture (v3): flows, agents, screen grammar

Status: **design for review**, 21 October 2026, 23:00 IST. It supersedes §4–§5 of
[aws-backend.md](aws-backend.md) (layout and agents) and §3–§4 of
[coviewer-plan.md](coviewer-plan.md) (rail layout and widget list). The rest of those documents
stands: the AWS Builder rubric, the hooks, the evaluations and the judging verdict. Region:
us-east-1. Time estimates are **estimates until measured**.

## 0. Four surfaces, kept separate

| Surface | What it is | Talks to | Never does |
| --- | --- | --- | --- |
| **Phone web app** ("Link") | A static PWA on CloudFront: pair, upload, thread, ask | The AWS API only | Talk to the TV directly |
| **AWS backend** | The ingest pipeline, the agents, the API | — | Render UI |
| **TV app** (Vega `.vpkg`) | Plays, composes, renders | The AWS API and CloudFront only | Upload, transcode or analyse |
| **Lens Lab** (web) | Judges paste a transcript and see the agents work | The AWS API | Store anything |

The TV and the phone meet only through the backend: shared media, thread messages and send-to-phone
items. The Vega app never handles an upload.

**Today:** the phone side is the local `companion/` server, which has one-shot QR links, a single
upload to local disk and a camera-permission page. **There is no thread yet.** The thread and AWS
uploads described here are new work (§7).

## 1. Flow A: upload from the phone

```
Phone PWA ─ POST /v1/uploads {name, size, type} ──▶ API ─▶ DynamoDB MEDIA#<id> status=UPLOADING
          ◀── {mediaId, uploadId, presigned part URLs (16 MB parts)} ──
Phone PWA ─ PUT parts, 4 in parallel, straight to S3 (resumable; progress on the phone) ──▶ S3 uploads/
Phone PWA ─ POST /v1/uploads/<id>/complete ─▶ API: CompleteMultipartUpload ─▶ EventBridge ─▶ Flow B
Thread:   "Video sent · uploading 64%" → "Preparing" → "Ready to watch · analysing 3/17" (phone and TV)
```

**Do you have to wait for the upload to finish before watching? Yes, for an uploaded file.**

- An S3 multipart object does not exist until `CompleteMultipartUpload`.
- A phone MP4 often keeps its index (`moov`) at the end, so a part of the file cannot be played.
- iPhones usually record HEVC, so the file must be transcoded to H.264/AAC before the Vega player
  can be assumed to play it.

Watching *while* the phone is still sending would need the phone to live-stream playable segments
(an Amazon IVS–style live path). That is a different product, and it is out of scope.

**What you do not wait for is the analysis.** Playback starts as soon as the transcode finishes, and
the analysis keeps going ahead of the playhead (Flow B).

## 2. Flow B: preparation and progressive analysis

### 2.1 Why progressive analysis works for this product

The co-viewer only ever uses what was said **before** the playhead; that is the no-spoiler rule.
So the analysis does not need the whole episode. It needs to stay *ahead* of the viewer. The
transcript is therefore cut into 5-minute chunks, the chunks are processed in order, and a new
**package version** is published as each one finishes. The TV knows the **analysis horizon** (for
example "analysed up to 24:10"). If the playhead gets close to it, the rail says `ANALYSING AHEAD`
instead of showing nothing.

### 2.2 State machines

```
MediaPrep (Step Functions, on upload complete)
 ├─ MediaConvert: H.264/AAC MP4 (faststart) + fragmented MP4 (MSE fallback) + AAC audio
 ├─ ChunkAudio (Lambda + ffmpeg layer, stream copy, 5-min chunks with 10 s overlap)
 ├─ Map(chunks, max 6): Transcribe batch job per chunk → Normalise (shift timestamps, trim overlap)
 │     each finished chunk ─▶ starts EpisodeAnalysis(chunk k)
 └─ DynamoDB: playable=true when the MP4 exists; transcriptHorizon advances per chunk

   A supplied transcript (the 81-min test transcript) skips MediaConvert and Transcribe:
   Normalise parses "text / m:ss" lines into the same chunk format.

EpisodeAnalysis (Step Functions Express or Standard, one per chunk, in chunk order)
 1 Segment      analyst/Segmenter extends the segment list and the episode brief (domain, lexicon)
 2 Lenses       Map(new segments): analyst lens agents (agents as tools)            ─┐
 3 Specialists  in parallel: factcheck Graph (claims) · studio/Dossier (people) ·     │ per segment
                studio/DataAnalyst (numbers → charts) · studio/MotionDirector         │
 4 Verify       Lambda: schemas, Guardrails grounding → confidence, rules → keep/drop ─┘
 5 Continuity   analyst/Continuity: rolling cast, timeline, conflicts, questions (so far)
 6 Showrunner   studio/Showrunner: screen plans for these segments (§4)
 7 Package      Lambda: package v<k> → S3/CloudFront; horizon → DynamoDB; thread status
```

`ChunkAudio` needs an ffmpeg Lambda layer, which is a dependency. For the deadline, if it costs
time: send the whole file to Transcribe and run the same `EpisodeAnalysis` per segment afterwards.
That is not progressive, but the path is identical.

### 2.3 How long (estimates; measured numbers replace them)

| Step | For the two 37 s clips | For an 81-minute upload | What dominates |
| --- | --- | --- | --- |
| Upload | — (preloaded) | File size ÷ phone uplink | The network |
| MediaConvert | Seconds | Minutes (*unverified*; AWS publishes no fixed rate) | Resolution and queue |
| Transcribe, first chunk | Under a minute (*estimate*) | A few minutes for the first 5-minute chunk (*estimate*) | Job start-up + audio length |
| Analysis per segment | About 1–3 min (*estimate*: several model calls, searches) | The same per segment, segments in parallel | Fact-check searches |
| First package (horizon ≈ 5 min) | All of it | About 5–10 min after the upload completes (*estimate*) | — |

The requirement that matters is **analysis faster than real time**: each 5-minute chunk must be
analysed in under 5 minutes. Parallel segments and `BudgetGuard` make that possible. Measure it on
the 81-minute test transcript first.

## 3. Flow C: watching

```
TV opens episode ─ GET /v1/episodes/<id> ─▶ package URL (latest version), horizon, playable
   ─ POST /v1/sessions {mediaId, viewerId} ─▶ coviewer session warmed (transcript + package cached)
Playing:   VTTCue per moment entry → screen plan for that moment, composed ON THE TV (ms)
           correction banner if the moment holds a DISPUTED/DEBUNKED claim (§4.4)
           every 60 s while the horizon < duration: refetch the package version (cheap, cached)
RIGHT:     the Stage opens the rail with the current screen plan (video keeps playing)
PAUSE:     the Deep rail; POST /v1/refine {sessionId, t} → maybe one new card (1–3 s, est.)
ASK:       chip (precomputed answer) or a phone question → POST /v1/ask
SEND:      POST /v1/share → thread message on the phone + system toast on the TV
```

## 4. The screen grammar: how the dynamic UI is built

The agents decide **what** appears, **what it is called** and **which visual form it takes**. The
TV has a fixed set of zones and renderers and enforces the density rules in code. This replaces the
earlier "up to three widgets in a column".

### 4.1 Zones of the rail

```
┌ 02 // RIGHT NOW ───────────────────────┐
│  (◉)  (◉)  (◉)   +2                    │  RIBBON   people active near now, as circles
│  Dr. Julian  Ronaldo  Littlehales      │           (portrait or monogram; max 5)
│ ┌───────────────────────────────────┐  │
│ │                                   │  │  PRIMARY  exactly one card, or none.
│ │     (the one thing worth seeing)  │  │           Its form is chosen by the agent (§4.3)
│ │                                   │  │
│ └───────────────────────────────────┘  │
│  [ PROTOCOLS 3 ]  [ TIMELINE ]          │  LENSES   buttons only for lenses that have content;
│  [ CATCH ME UP ]  [ ASK ]               │           labels written by the agents (§4.2)
└────────────────────────────────────────┘
```

- SELECT on a circle shows **only** that person's dossier in the rail.
- SELECT on a lens button shows **only** that view: the protocol list, the timeline, the recap, or
  Ask.
- BACK returns to the zones.

### 4.2 Rules, enforced in the TV composer

| Rule | Value |
| --- | --- |
| Ribbon | Up to 5 people active in [t − 60 s, t]; `+n` for more; hidden if empty |
| Primary | At most one. Priority: correction claim > technique > chart > burst list > claim > protocol > nothing |
| Lens buttons | Only lenses with content up to `t`. At most 4, ordered by salience and this viewer's habits |
| Timeline | **A button only**. It becomes the primary card only when there is no other primary, it has ≥ 3 events, and something dated was said in the window |
| Catch me up | Shown only on pause **and** when at least 8 min have passed since the start or the last recap (*starting value*) |
| Labels | Each lens has a default (`PROTOCOLS`, `TIMELINE`, `PEOPLE`, `CATCH ME UP`). The Segmenter's **domain lexicon** may rename it per episode or segment (science `PROTOCOLS`, finance `PLAYBOOK`, cooking `RECIPE`, fitness `ROUTINE`, crime `CASE FILE`). A label is ≤ 14 uppercase characters, validated, and falls back to the default |
| Interruptions | Nothing pops up during playback **except** the correction banner (§4.4) |

### 4.3 Primary-card forms (renderers the agents choose from)

| Form | Chosen when | What it looks like | Built with |
| --- | --- | --- | --- |
| **Verdict stamp** | A checked claim | The quote, a stamped verdict (`DEBUNKED` in crimson), two or three source lines with dates | Views + SVG stamp |
| **Name list** ("what did he just say") | ≥ 3 named items in about 20 s | Names spelled correctly, one line each: what it is, for whom, the dose as said | Views |
| **Steps** | A recommended sequence | The agent's label (`PROTOCOL`, `PLAYBOOK`), numbered steps with timestamps | Views |
| **Chart** | Numbers that support a comparison or trend: in the transcript ("10,000–50,000 lux outdoors vs 500–1,000 indoors") or sourced data (finance) | A bar or line chart drawn in with a stroke animation, with source and date under it | SVG + Reanimated |
| **Motion rig: breathing figure** | A breathing practice | A line-drawn **figure** whose chest and shoulders rise on the inhale, with air particles flowing in through the nose. On the hold the particles stop and a ring fills; the exhale reverses it. `INHALE 4` / `HOLD 4` captions, cycle counter. Timing comes from the agent's spec | SVG parts + Reanimated on the UI thread |
| **Motion rig: day clock** | Time-of-day rules ("sunlight within an hour of waking", "no caffeine after 10 a.m.", "no bright light 11 p.m.–4 a.m.") | A 24-hour dial: the sun moves around it, and the rule bands light up as the hand passes them | SVG + Reanimated |
| **Motion rig: timer** | A timed practice (NSDR for 10–30 min, a cold exposure) | A ring timer with phase labels | SVG + Reanimated |
| **Dossier** (expanded only) | A circle is selected | Portrait, role, three facts with `[12:41]` or a source, licence credit | Views + Image |
| **Timeline** (expanded) | The button is selected | A rail of dated events; conflicts marked crimson | SVG |
| **Recap** (expanded) | Catch me up | 3–5 lines, each with its timestamp | Views |

**Why the figure is a rig, not a generated video or code:** a generated clip (Nova Reel, for
example) takes minutes, cannot hold exact 4-4-4-4 timing, and would need a second video decoder on
a 1 GB device. AI-written drawing code cannot run on the TV. A **rig** is drawn once, in the StudioX
style. The agent animates it with data: phases, seconds, cycles, captions, and which body motion
each phase uses. Any breathing pattern the speakers describe (4-7-8, box, physiological sigh) plays
with exact timing. New rigs are added the same way as new renderers. Each rig costs about 3–4 h to
draw well, so the deadline build has the **breathing figure and the day clock**. The timer is a
cheap third.

### 4.4 The only interruption: the correction banner

When playback enters a moment holding a claim whose verdict is `DEBUNKED` or `DISPUTED`, a small
banner appears for 6 s, bottom left, with the video still playing:
`⚠ CHECK THIS · "up to 400 times the dose" · DISPUTED · ▶ to see why`. At most one every 2 minutes,
enforced in code. RIGHT opens the rail with that claim as the primary card.

`UNVERIFIED` claims do **not** interrupt. "We could not check this" is not a correction, and
interrupting for it would be noise. They stay in the rail. *Owner decision:* the owner asked for a
pop-up on unverified facts; the recommendation is to interrupt only for `DISPUTED` and `DEBUNKED`.

### 4.5 The screen plan: what the Showrunner writes for each moment

The plan below is the Showrunner's intermediate decision. What reaches the TV is the same
decision expressed as A2UI-shaped surfaces (§9): components plus a data model.

```json
{"t0": 5, "t1": 13,
 "ribbon": ["p:julian", "p:ronaldo"],
 "primary": {"card": "c:siesta-37pct", "form": "verdict"},
 "lenses": [{"lens": "protocol", "label": "PROTOCOLS", "count": 3},
            {"lens": "timeline", "label": "TIMELINE", "count": 4},
            {"lens": "ask", "label": "ASK"}],
 "banner": null,
 "catchUpAt": true,
 "chips": ["Is the 37% from a real study?", "Who is Nick Littlehales?"]}
```

The TV checks every plan against the rules in §4.2, so a plan that breaks one is corrected, not
rendered as written. The package also carries every card that a plan references.

## 5. The agents

Eleven model-backed agents in four AgentCore runtimes. Everything that must be exact is code.

| Runtime | Agent | Model (starting choice) | Tools | Produces | Why it is an agent and not code |
| --- | --- | --- | --- | --- | --- |
| `analyst` | **Segmenter** | Sonnet 5.5 | — | Topic segments, speaker names, **domain + lexicon** (labels) | Topic boundaries and naming need understanding |
| `analyst` | **People Scout** | Sonnet 5.5 | `wikidata_search` | Mentions, pronouns resolved, Wikidata IDs | Coreference ("he", "my colleague") |
| `analyst` | **Claim Spotter** | Sonnet 5.5 | — | Checkable + surprising statements | Judging surprise needs a model |
| `analyst` | **Name Burst** | Haiku 5.5 | `web_search` (spelling) | Rapid lists: names, what, for whom, dose as said | Spelling from speech is fuzzy |
| `analyst` | **Routine Finder** | Haiku 5.5 | — | Recommended steps, time-of-day rules, durations | Spotting a recommendation among anecdotes |
| `analyst` | **Number Miner** | Haiku 5.5 | — | Quantities and comparisons with evidence spans | Numbers in speech are scattered |
| `analyst` | **Continuity** | Sonnet 5.5 | `transcript_search` | Cast merge, timeline, contradictions, suggested questions | Cross-segment reasoning |
| `factcheck` | **Fact-check Graph**: Query Writer → search → Stance Judge → (refine ≤ 2) → **verdict rules (code)** | Sonnet 5.5 (judge), Haiku (queries) | `web_search` (domain-filtered) | Verdict + sources + quotes | Bounded iteration; stance needs reading |
| `studio` | **Dossier Builder** | Haiku 5.5 | `wikidata_facts`, `wikipedia_summary`, `commons_image` | Bio, facts "as of", licensed portrait | Choosing the relevant facts |
| `studio` | **Data Analyst** | Sonnet 5.5 | **AgentCore Code Interpreter**, `web_search` | Chart spec: series, units, sources | It decides whether numbers are chartable; **the arithmetic runs in Code Interpreter, never in the model** |
| `studio` | **Motion Director** | Haiku 5.5 | — | Rig choice + phases, seconds, cycles, captions | Mapping speech to a practice spec |
| `studio` | **Showrunner** (curator) | Sonnet 5.5 | `get_cards` | Screen plans, labels, chips, banner choices | Editorial judgement per moment |
| `coviewer` | **Live co-viewer** | Haiku 5.5; Nova 2 Lite grounding | `transcript_window/search`, `get_cards`, `web_search`; Memory | Refine (novelty → one card), Ask answers | Open-ended questions |

**Deterministic Lambdas** (no model): Normalise, ChunkAudio, Verify (schemas, Guardrails scores,
keep/drop rules, rejection log), Layout (timeline order, date arithmetic, chart axis bounds),
Package, API, Quota.

**Why four runtimes:**

- **Different scaling.** Fact-checking is slow and search-heavy, so many run in parallel.
- **Different permissions.** Only `studio` gets Code Interpreter. Only `coviewer` faces viewer
  input, so it gets the least privilege (Policy, stretch).
- **Different timeouts and models.**
- **Independent deploys.**

All four share one Gateway, one Memory and one Observability view.

**Shapes, stated in the write-up:**

- Step Functions DAG for ingest.
- Agents-as-tools inside `analyst`.
- A Graph with a bounded loop for fact-checks.
- Specialists in `studio` called in parallel.
- A single latency-first agent for the pause.

Hooks (`SpoilerGuard`, `CitationGuard`, `BudgetGuard`, `InjectionGuard`) are as in aws-backend §14.

## 6. AWS map

```
                      CloudFront (one domain)
   /link/*  phone PWA ─┐   /lab/*  Lens Lab ─┐   /packages /images /media /share  ── S3
                       ▼                     ▼
                  API Gateway (HTTP) ─ Lambda api ── DynamoDB (studiox table)
                       │   uploads, thread, sessions, refine, ask, share, lab, jobs
                       │
   S3 uploads/ ─ EventBridge ─▶ Step Functions MediaPrep ─ MediaConvert · ChunkAudio · Transcribe
                                       │ per chunk
                                       ▼
                               Step Functions EpisodeAnalysis
                                       │ invoke (Lambda invoker, 1 attempt, long timeout)
            ┌──────────────────────────┼──────────────────────────┬───────────────────────┐
     AgentCore Runtime          AgentCore Runtime           AgentCore Runtime       AgentCore Runtime
       analyst                    factcheck                   studio                  coviewer
            └────────── AgentCore Gateway (MCP) ─ Web Search Tool · knowledge-tools λ · episode-tools λ
                        AgentCore Code Interpreter (studio) · AgentCore Memory (coviewer)
                        Bedrock: Sonnet 5.5 · Haiku 5.5 · Nova 2 Lite │ Guardrails │ Observability
```

## 7. What gets built by the deadline, and what stays designed

About 49 hours remain. The rule from the winning entries applies: say exactly what is live and what
is designed.

| Item | Deadline status | Why |
| --- | --- | --- |
| Supplied-transcript path (81-min test) + the two clips through EpisodeAnalysis | **Build** | This produces everything the demo and judges see |
| The four runtimes, Gateway (search + wiki + episode tools), Code Interpreter for charts, Memory, hooks | **Build** | The AWS Builder core |
| Screen grammar on the TV: ribbon, primary, lens buttons, expanded views, correction banner, dynamic labels | **Build** | The design core |
| Forms: verdict stamp, name list, steps, chart, **breathing figure**, **day clock**, dossier, timeline, recap | **Build** (timer if time) | The creative core |
| Lens Lab | **Build** (P1) | The judges' try-it |
| MediaPrep with Transcribe for the two clips (whole file) | **Build** | It is quick for 37 s clips, and it makes Transcribe real |
| Progressive chunked analysis with package versions and the horizon | **Build only if time**; otherwise designed | The ffmpeg layer and versioning take hours |
| Phone PWA on AWS: multipart upload, the thread, send-to-phone, Ask | **Minimal**: pair, upload with progress, receive sent items, ask. **The full iMessage-style thread is designed only** | 4–6 h for the minimal version |
| Watching during an upload | **Not planned** | Needs live streaming from the phone |

Testing with the 81-minute podcast stays local. Its transcript (and any video of it) is never in
the repository, the video or the Lens Lab examples.

## 8. Schema additions

Changes to `src/analysis/schema.ts` and the shared JSON Schema:

- **UI messages** (§9): `createSurface`, `updateComponents`, `updateDataModel`, `deleteSurface`
  per moment and surface. They replace `PanelCard`; the screen plan (§4.5) is the Showrunner's
  intermediate.
- **Lexicon:** `{lens: label}` per episode or segment.
- **`chart`:** `kind: 'bar' | 'line'`, `series[{label, points[{x, y, evidence? | source?}]}]`,
  `unit`, `computedBy: 'code-interpreter' | 'transcript'`. Validation: every point has evidence or a
  source.
- **`technique`:**
  - `rig: 'breathing_figure' | 'day_clock' | 'timer'`;
  - `phases[{label, seconds, motion: 'inhale' | 'hold' | 'exhale' | 'hold_empty'}]`;
  - `cycles`;
  - for the day clock, `bands[{from: 'HH:MM', to: 'HH:MM', label, kind: 'do' | 'avoid'}]`.
- **`claim`:** add `verdictRules: 'v1'` and a `banner` flag (set by the Showrunner, checked by
  the TV).
- **Package:** `version`, `horizon`, `complete`.

## 9. What the agents output and how Vega draws it

### 9.1 Neither "a trivial JSON" nor code: a UI language

The agents output **UI as data**: a tree of components from a fixed catalog, with their data,
actions and motion. The TV app contains the catalog (precompiled native components) and a renderer
that draws any tree. A web browser works the same way. It ships with a fixed engine and a fixed set
of elements, and it draws pages that did not exist when it was installed. The variety comes from
**composition**: about 25 primitives × nesting × data × motion presets give far more screens than
anyone could list, and none of them has to be anticipated in the app.

The format follows **A2UI** ([a2ui.org](https://a2ui.org/)), Google's open protocol for exactly this
(Apache 2.0, v0.9 current production release). The agent sends a "declarative data format, not
executable code". Clients "render using their own native widgets", and agents "can only use
pre-approved components from your catalog". The messages keep A2UI's shape:

- `createSurface`, `updateComponents` (a **flat list of components with IDs**, containers referring
  to children by ID), `updateDataModel` (values at JSON Pointer paths), `deleteSurface`.
- Actions that either send an **event** to the server or run a **local function**.

Claim: StudioX is **A2UI-shaped**. It claims conformance only if a conformance check is actually run.
There is no published React Native for Vega renderer. Building one is our candidate for the Open
Source mini challenge (§9.6).

### 9.2 The StudioX catalog (`studiox-tv/v1`), compiled into the app

| Group | Components | Notes |
| --- | --- | --- |
| Layout | `Column`, `Row`, `Grid`, `Spacer`, `Divider` | Gaps and sizes only from tokens (`xs`–`xl`), so every layout fits the 960 × 540 dp canvas |
| Text | `Text` (role: `title`, `body`, `mono`, `quote`, `caption`), `Stamp` (the verdict stamp) | Lengths clamped; `…MORE` at a sentence boundary |
| People and media | `Avatar` (circle: portrait or monogram), `Image` (CloudFront URLs only), `Credit` | Licensed images only, credit required |
| Data | `Stat` (big number + label + source), `Chip`, `List` (with an item template), `Chart` (`bar`, `line`), `TimelineRail`, `DayClock` | Every number carries evidence or a source, or the component is dropped |
| Motion | `Rig` (`breathing_figure`, `day_clock`, `timer`), `Reveal` (enter presets: `fade`, `stamp`, `draw`, `type`, `declassify`) | Driven by Reanimated on the UI thread; presets only |
| Interaction | `Button` (focusable), `Focusable` wrapper | Each focusable gets `FocusFrame`, an `aria-label` and a place in the D-pad order |
| Surfaces | `rail`, `deep`, `banner`, `view:<name>` | Each surface is a `TVFocusGuideView` |

**Actions:**

| Kind | Actions | Why |
| --- | --- | --- |
| Local functions | `expand(view)`, `back`, `seek(t)`, `startRig(id)`, `focus(id)` | Run on the TV without the network, so the remote stays instant |
| Server events | `ask(question)`, `share(cardId)`, `refine(t)` | Go to the API |

A new **primitive** needs an app update. A new **kind of card** does not. It is a new composition of
primitives, and that is what the agents produce.

### 9.3 Three moments, three screens, one renderer

**Fact check during the science clip:**

```json
{"updateComponents": {"surfaceId": "rail", "components": [
  {"id": "root", "component": "Column", "children": ["ribbon", "primary", "lenses"]},
  {"id": "ribbon", "component": "Row", "children": ["a1", "a2"]},
  {"id": "a1", "component": "Avatar", "person": {"path": "/people/julian"}, "action": {"functionCall": "expand", "args": {"view": "person:julian"}}},
  {"id": "a2", "component": "Avatar", "person": {"path": "/people/ronaldo"}, "action": {"functionCall": "expand", "args": {"view": "person:ronaldo"}}},
  {"id": "primary", "component": "Column", "reveal": "stamp", "children": ["q", "stamp", "src"]},
  {"id": "q", "component": "Text", "role": "quote", "text": {"path": "/claims/siesta/quote"}},
  {"id": "stamp", "component": "Stamp", "verdict": {"path": "/claims/siesta/verdict"}},
  {"id": "src", "component": "List", "items": {"path": "/claims/siesta/sources"}, "template": "sourceLine"},
  {"id": "lenses", "component": "Row", "children": ["b1", "b2"]},
  {"id": "b1", "component": "Button", "label": "PROTOCOLS 4", "action": {"functionCall": "expand", "args": {"view": "protocols"}}},
  {"id": "b2", "component": "Button", "label": "ASK", "action": {"functionCall": "expand", "args": {"view": "ask"}}}]}}
```

```
 (◉) (◉)                                  ← Avatar ×2
 "Midday sleep cuts cardiovascular strain by 37 percent."
            ╔═══════════╗
            ║  NUANCED  ║                 ← Stamp, revealed with the "stamp" preset
            ╚═══════════╝
 · Arch Intern Med 2007 — observational; coronary deaths, not "strain"
 [ PROTOCOLS 4 ]  [ ASK ]
```

**A comparison of numbers (the test transcript's lux figures).** The same renderer, different
components:

```
 Row[ Stat("10,000–50,000 lux", "outdoors, overcast", [31:47]),
      Stat("500–1,000 lux", "indoor light", [36:07]) ]
 Chart(bar, series=/numbers/lux, reveal=draw)  · source: the episode at 31:47 and 36:07
 Text(mono, "WHY THIS: a comparison the speaker relies on · 2 figures")
```

**A breathing practice on pause:**

```
 Rig(breathing_figure, phases=/techniques/box/phases, cycles=4)   ← the figure inhales, holds, exhales
 Row[ Button("TRY IT", startRig), Button("SEND TO PHONE", share) ]
```

"Ronaldo by the numbers" would be `Grid[Stat, Stat, Stat] + Avatar + Credit`, and a comparison of two
supplements would be `Row[Column[Text, List], Column[Text, List]]`. Neither needs app code.

### 9.4 Who writes what

| Producer | Writes | When |
| --- | --- | --- |
| Lens and specialist agents | **Content**: claims, people, numbers, steps, technique specs, each with evidence. This goes in the **data model** (`updateDataModel`) | Ingest |
| **Showrunner** | **Composition**: for each moment, the `rail` and `deep` surfaces (`updateComponents`), choosing primitives, order, labels and reveals. It can use **patterns**: named subtrees such as `verdict_card` and `name_list`, defined server-side as A2UI data, so new patterns also ship without an app update | Ingest |
| Live co-viewer | **Deltas**: `updateComponents`/`updateDataModel` adding one card, or the `ask` view with an answer | Pause / Ask |
| TV composer (code) | Picks the moment's surfaces, applies the density rules (§4.2), the banner budget and this viewer's lens order | Every moment, in milliseconds |

Every message is produced with **Strands structured output**: the Pydantic models of the catalog are
handed to the model as a tool, and validation errors go back to the model to fix. A **steering
handler** (§10) checks the design rules. The packager validates again, and the TV validates a last
time. Unknown components, broken references, trees deeper than 6 or more than 60 components per
surface, and numbers without evidence are dropped, not drawn.

### 9.5 Rendering on Vega

```tsx
// Sketch. One registry, one recursive renderer; the components use only RN for Vega primitives.
const CATALOG = {Column, Row, Grid, Text, Stamp, Avatar, Image, Stat, Chip, List, Chart,
                 TimelineRail, DayClock, Rig, Button, Spacer, Divider, Credit};
function Node({id, surface}: {id: string; surface: Surface}) {
  const c = surface.components[id];
  const C = c && CATALOG[c.component];
  if (!C) return null;                                  // unknown → skipped, never guessed
  return <C {...resolve(c, surface.data)}               // JSON Pointer bindings → props
            onAction={a => runAction(a, surface)}>      // local function or server event
           {c.children?.map(k => <Node key={k} id={k} surface={surface} />)}
         </C>;
}
```

- **Keyed by component ID,** so a delta re-renders only the nodes that changed. Focus stays on a
  component whose ID survives an update.
- **Motion presets** run on the UI thread (Reanimated). Layout is plain flexbox with tokens.
- **Bounded:** at most 60 components per surface, 6 images decoded at once, lazy surfaces.

### 9.6 Options considered (verdict, 21 Oct)

The essentials, from first principles:

1. One schema shared by the agents (Python) and the TV (TypeScript).
2. Validation on both sides.
3. A renderer that maps types to native, focus-aware components.
4. Data binding and actions.
5. Prompt material, so the model knows the catalog.

Any format that gives these works.

| Option | What it is | Fit for StudioX on Vega | Verdict |
| --- | --- | --- | --- |
| **Our own renderer, A2UI-shaped subset** | Flat components with IDs, children by ID, data paths, local/server actions; the catalog in §9.2 | No new dependency. We write the TV components anyway (focus, tokens, rigs) | **Chosen.** Do not claim A2UI conformance |
| A2UI, full v0.9 | Google's open protocol; renderers for Angular, Flutter, Lit, Markdown; none for React or React Native found | Best "standard" story, but more spec machinery (surfaces, data-model streaming, catalogs) and no renderer to reuse | Shape adopted, full spec not |
| json-render (Vercel Labs) | Zod catalog → generated prompt; flat `root` + elements spec; `@json-render/react-native` 0.21.1, Apache-2.0, depends only on its core and `zod ^4` | Pure JS on paper, but pre-1.0, its own (non-standard) format, Zod 4 under Hermes *unverified*, the agent side is Python, and it does nothing for D-pad focus | Not adopted; a reasonable post-hackathon alternative |
| Adaptive Cards (`adaptivecards-reactnative` 3.0.0, community) | A mature card format | Depends on `react-native-video`, pickers, a date-time picker and deprecated prop types: native modules Vega does not provide | **Rejected** |
| MCP Apps / MCP-UI, or model-generated HTML | HTML in an iframe or WebView | A WebView on a 1 GB device; loses native focus; looks like a web page | **Rejected** |
| Downloaded or generated JS (OTA bundles, `eval`) | Code at runtime | Breaks the engineering contract; cannot be validated | **Rejected** |
| Server-rendered card images | PNGs drawn in the cloud | Not focusable, not animated, heavy to decode | **Rejected** |
| Fixed widget types only (today's `schema.ts`) | One renderer per card type | Works, but the agents cannot invent layouts | Kept as **patterns** on top of the primitives |

**The project does not depend on the Open Source mini challenge.** The renderer lives inside the
StudioX app either way. Publishing it separately would only copy it to a second repository.

### 9.7 Open Source mini challenge (optional; default is skip)

**`a2ui-vega`** (named "A2UI-inspired" unless a conformance check is run): a separate MIT
repository with the StudioX renderer for React Native for Vega, extracted. It would include the basic catalog plus D-pad focus, `FocusFrame`-style focus treatment,
TV tokens and tests. That matches the rules' "creative" example: "new integration pattern (e.g.,
adding Vega support to a popular React Native library)". **Default: skip.** Only one mini-challenge prize can be won. AWS Builder is the stronger fit, and a
thin open-source entry scores nothing. Do it only if the core is frozen by 23 Oct 12:00. It costs
about 2–3 h for the extraction, licence, README, tests and the Devpost description.

## 10. Strands and AWS primitives, each with its job

Rule (from the winning entries): use a feature only for a reason we can state, and say why we did
not use the others.

### 10.1 Strands Agents SDK (Python)

| Primitive | Where | Job |
| --- | --- | --- |
| **Structured output** (Pydantic schema → a tool, automatic validation retries) | Every lens, the Showrunner, the co-viewer | Content and A2UI messages that always parse |
| **Agents as tools** | `analyst` orchestrator | It picks the lenses each segment needs |
| **Graph** (conditional edges, bounded cycle) | `factcheck` | search → stance → refine ≤ 2 → verdict |
| **Concurrent tool executor** | `analyst`, `studio` | Lenses and specialists run in parallel within an invocation |
| **Hooks** (hook events reference) | All runtimes | `SpoilerGuard`, `CitationGuard`, `BudgetGuard`, `InjectionGuard` (aws-backend §14) |
| **Steering** (plugins with context providers such as the tool ledger) | Showrunner; FactChecker | The **design system as steering**: after a draft screen, a handler checks the density rules (one primary, at most 4 lenses, label length, banner budget) and returns targeted feedback, instead of a 2,000-word prompt. For the FactChecker: "you cited a source you did not fetch" |
| **Middleware** (`ExecuteToolStage`, `InvokeModelStage`) | All | A **search cache** across lenses in one episode (the same query twice costs once; report the hit rate), retry with backoff on throttling, short-circuit when `BudgetGuard` says stop |
| **Bedrock prompt caching** (cache points) | Lenses, co-viewer | The episode brief and transcript chunk are cached across the many lens calls |
| **Context management / ContextOffloader** | Continuity, Data Analyst | Large search results are offloaded, not carried in context |
| **Agent state and invocation state** | co-viewer | Playhead `t` and viewer ID go to hooks and tools without going through the prompt (so `SpoilerGuard` reads `t` from state, not from text) |
| **Metrics on `AgentResult`** (tokens, latency, tool calls, cycles) | Every call | The cost and latency tables in the write-up come from here |
| **OpenTelemetry traces** | Every call | Exported to AgentCore Observability |
| **Strands Evals SDK** (evaluators, detectors, **red teaming**, simulators, `ExperimentGenerator`) | `backend/eval/` | Spoiler red-teaming, injection attacks, simulated viewer questions, verdict scoring |
| Not used: **Swarm** | — | No autonomous handoffs needed; the flow is known |
| Not used: **A2A** | — | No agent keeps secrets from another |
| Not used: **Interrupts** / human-in-the-loop | — | No step needs a human approval; the viewer is never asked to approve the AI |

### 10.2 Amazon Bedrock AgentCore

| Primitive | Job | Not used, and why |
| --- | --- | --- |
| **Runtime** (4 runtimes; session per viewing in `coviewer`) | Hosting, isolation, warm sessions | — |
| **Gateway** (MCP; Lambda targets; **Web Search Tool** connector with domain and date filters) | One tool plane for all agents | Semantic tool search: too few tools to need it |
| **Code Interpreter** | Data Analyst computes chart series, ratios and units in a sandbox | — |
| **Memory** (short-term events; **user-preference** strategy per viewer; summary strategy per session) | Ask continuity, lens order per viewer | Not used for the card store, which is auditable product data and belongs in DynamoDB (the radar entry's lesson) |
| **Observability** (CloudWatch Transaction Search, GenAI dashboard) | Traces as evidence | — |
| **Evaluations** (online evaluation on co-viewer traces with built-in evaluators; dataset evaluation of verdicts) | Quality numbers | — |
| **Policy** (Cedar on Gateway) | `coviewer`, which faces viewer input, may call only read-only tools and filtered search | — |
| **Identity** | Gateway auth for the runtimes (whatever `agentcore add gateway` configures) | — |
| Not used: **Browser** | — | The Web Search Tool returns relevant snippets; driving pages is slower and costlier |
| Not used: **Harness** | — | We need Strands-level control (hooks, steering, Graph) |

### 10.3 Other services

| Service | Primitive | Job |
| --- | --- | --- |
| Bedrock models | Claude Sonnet 5.5, Claude Haiku 5.5, Nova 2 Lite with `nova_grounding` | The model chosen per job (§5) |
| Bedrock Guardrails | `ApplyGuardrail`: contextual grounding + prompt-attack filter | `confidence` scores; viewer-question screening |
| Step Functions | Map state, SDK integrations (DynamoDB, Transcribe, MediaConvert) | Ingest DAG with progress |
| Transcribe | Batch jobs, speaker labels, custom vocabulary | Timestamps |
| MediaConvert | H.264 MP4 + fragmented MP4 | Playable uploads |
| EventBridge | S3 object-created rule | Starts ingest |
| DynamoDB | Single table, TTL caches, conditional writes (idempotency) | Product data |
| S3 + CloudFront | OAC, cache policies | Packages, media, images, Lens Lab, PWA |
| API Gateway (HTTP) | Throttling, Lambda authorizer | `/v1/*` |
| SSM Parameter Store | Flags and ARNs | The `live` switch |
| CloudWatch | Embedded metric format, dashboard, alarms | Per-lens cost and latency |
| AWS Budgets | Alert | Cost guard |
| CDK | Stacks | Everything as code |
