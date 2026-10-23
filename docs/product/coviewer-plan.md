# StudioX co-viewer: how it works on Vega, and the plan to the deadline

> **Historical design note.** Written during the build (20–22 Oct 2026) and kept for the record.
> Statements such as "proposal", "nothing is deployed" or "not built yet" describe the state at the
> time. The current product and the deployed system are described in the [README](../../README.md),
> [ARCHITECTURE.md](../ARCHITECTURE.md) and [aws-builder.md](../aws-builder.md).

Status: **plan for review**, 21 October 2026, updated 19:45 IST. About 53 hours remain before submission
closes (24 Oct, 00:30 IST). This plan adds the owner's eight viewer questions, live web search, and
a no-pause "glance" mode to [architecture.md](architecture.md) (v2). Where the two documents
disagree, this one wins. Nothing here is implemented yet unless it says so. *Unverified* means
nobody has tested it and no official source confirms it. The Builder Tools MCP was unreachable while
this was written (friction F-40), so platform facts come from the 20–21 Oct notes in
`docs/reference/` (local).

## 1. Is this possible on Vega OS?

**Yes, as long as the TV is the renderer and nothing else.** A Fire TV on Vega can play the episode,
report the playhead precisely, react to the remote, animate on the UI thread and draw cards. It
cannot run the model or do web search inside a 250 MiB budget. It must not execute code an AI
wrote. It has no app-level speech recognition, and background JS services crash on RN 0.83 (F-35).
So every piece of reasoning runs on AWS, and the TV receives **typed, bounded JSON widgets** and
draws them with native components.

| Work | Where | Why |
| --- | --- | --- |
| Playback, playhead, pause/resume, cues | TV: W3C `VideoPlayer` | Vega's media pipeline; `pause` and `timeupdate` are standard events |
| Deciding *when* something is worth showing | TV (cheap rules) + AWS (agents) | The TV only matches the playhead against a precomputed moment index |
| Transcript, speakers, timestamps | AWS: Transcribe | Heavy; done once per episode |
| Who / claims / lists / protocols / timeline / recap | AWS: Strands agents on AgentCore Runtime | Multi-step, uses tools and search; minutes are acceptable offline |
| Web search, Wikipedia, image licences | AWS: AgentCore Gateway tools | Keys and rate limits stay off the TV |
| Answering a new question at the paused moment | AWS: live agent, streaming | 1–3 s target (estimate), never blocks the remote |
| Drawing cards, graphs, timelines, breathing animation | TV: RN views, SVG, Reanimated 4 | Native, focusable and bounded |

What Vega cannot do, and what we do instead:

| Not available | Instead |
| --- | --- |
| On-device LLM or search | AWS backend; the TV sends `{mediaId, t}` |
| Running generated UI code (JSX, HTML) | A widget grammar with native renderers (§4) |
| App-level speech-to-text | Suggested-question chips; the phone; system keyboard dictation on hardware (*unverified* on VVD) |
| Picture-in-picture | Panel over the video, or a squeeze-back of the video surface (§3, a spike) |
| Background agents on the TV | The server keeps the job state; the TV reconnects and catches up |

## 2. The eight viewer questions

Each question becomes a **layer**. A layer appears only when its trigger rule fires, so an episode
with no claims shows no claims tab. Most of the work is precomputed when the episode is ingested.
At pause time we look up what is already there and generate only what is new.

| # | Viewer thinks | Layer / widget | Trigger rule (when it appears) | Made by | Live or precomputed |
| --- | --- | --- | --- | --- | --- |
| 1 | "Wait, is that true?" | `claim` with a verdict | A checkable claim that sounds surprising: a number, a superlative, "studies show", a little-known fact | FactChecker agent + web search | Precomputed (search is too slow to do at pause) |
| 2 | "Who is that?" | `dossier`, plus the **People** roster | A person is named, or referred to as "he"/"she", in [t − 60 s, t + 4 s] | Archivist agent + Wikidata, Wikipedia, Commons | Precomputed; the roster covers the whole episode |
| 3 | "Catch me up" | `recap` | Always available | Recapper agent per segment + live stitch | Mixed: per-segment recaps offline, last partial segment live |
| 4 | "What did he just say?" | `entity_list` (burst) | ≥ 3 named items of one kind within about 20 s, or rare terms such as drug names | Lister agent | Precomputed |
| 5 | Protocols, "Try it" | `protocol` + `technique` | A sequence of steps a speaker recommends; "Try it" only when the steps can be done live (breathing, a stretch, timing) | Coach agent | Precomputed |
| 6 | Ask / "isn't he contradicting himself?" | `answer` + suggested questions | Always; precomputed contradictions surface as suggestions | Ask agent (+ Chronologist for conflicts) | Live, streaming |
| 7 | Timeline | `timeline` | ≥ 3 dated or ordered events | Chronologist agent | Precomputed |
| 8 | Send to phone | an action on any actionable widget | The widget has something to take away: steps, names, links, a place, a date | Composer adds `actions[]` | Live (one message) |

### 2.1 "Is that true?"

- **Gate:** the FactChecker scores each candidate statement for *checkable* (a specific, testable
  assertion) and *surprising* (not common knowledge). Only statements that pass both thresholds become
  claims. Expect about 1–3 per 10 minutes, not one per sentence.
- **Verdict labels:** `SUPPORTED`, `NUANCED`, `DISPUTED`, `DEBUNKED`, `UNVERIFIED`. A verdict
  other than `UNVERIFIED` needs at least two independent sources that the agent actually fetched,
  each with a short quote and a date. Without them, the verdict is `UNVERIFIED`. `DEBUNKED` is allowed
  only when the sources directly contradict the claim.
- **Card:** three rows. `SAID` (speaker, quote, timestamp), `SOURCES SAY` (two or three sourced
  lines), `WHY <VERDICT>` (one sentence). Example from the science fixture: "midday sleep cuts
  cardiovascular strain by 37%" → `NUANCED`. The study was observational and measured coronary
  deaths, not "strain".
- This replaces "never a verdict score" in [design-language.md](design-language.md): a verdict is a
  label backed by visible sources, not a score. *Owner decision* (§10).

### 2.2 "Who is that?"

- **Entity linking offline:** the Archivist resolves each mention to a Wikidata ID and resolves
  pronouns per segment, so every transcript span knows its *active people*. This is what makes "who
  is **he**?" instant at pause.
- **Facts:** structured facts come from Wikidata (titles, team, role, born) and are shown with
  "as of <date>". Live numbers such as current goals appear only if search returns a dated source;
  otherwise they are left out. Episode facts cite a timestamp, and outside facts cite a source (as
  `DossierWidget` already does).
- **Images without licence trouble:** take the image from Wikimedia Commons, read its licence from
  `extmetadata`, and accept only CC0, public domain, CC BY or CC BY-SA. Show the credit line on the
  card. The backend copies a resized version (for example 320 × 320 px) to our S3/CloudFront, so the
  TV never hotlinks and never decodes a full-resolution file. With no acceptable image, show a
  monogram tile. Wikimedia APIs require a descriptive `User-Agent`.
- **People roster:** a separate **People** tab lists everyone in the episode in order of first
  mention, with a timestamp. On pause, people active near the playhead come first.

### 2.3 "Catch me up"

Built only from the transcript before the playhead, so it never spoils. Each segment has a
precomputed 1–2 line recap. On pause, the live agent adds one line for the segment in progress. The
whole recap is capped at 5 lines, each ending in a timestamp. SELECT on a line seeks the video there.

### 2.4 "What did he just say?"

- **Burst detector:** if the window holds at least three named items of the same kind (medicines,
  supplements, books, studies, places), or rare terms, the Lister builds an `entity_list`. Each item
  shows the name as spelled correctly, what it is (sourced), who it is for and why (as the speaker said
  it), and the dose if a dose was said. Health items carry "Mentioned in the episode. Not medical
  advice."
- **Speech-recognition risk:** drug names are where Transcribe errs most. Use a Transcribe custom
  vocabulary for the demo episodes. The Lister also corrects spellings, but only when a search result
  confirms the corrected name.
- Captions from the same transcript (WebVTT) are a companion feature: CC on shows the words, and the
  burst card explains them.

### 2.5 Protocols and "Try it"

- `protocol`: numbered steps exactly as described ("no coffee after 10 a.m.", "no screens an hour
  before bed"), each with its timestamp.
- `technique`: when steps can be practised live, the Coach writes an **animation spec**, not code:
  `phases[{label, seconds, motion}]`, `cycles`, and `shape` (`box`, `circle` for expand and
  contract, `bars`). The TV animates it with Reanimated 4 on the UI thread.
- **TRY IT:** pauses the episode, runs the guided session full-screen (shape, phase label,
  countdown, cycle count), and on BACK or completion returns to the same frame. Any breathing pattern
  the speakers describe gets its own animation without an app update.

### 2.6 Ask and counterfactuals

- **Remote-first input:** each moment comes with 2–3 **suggested questions** generated offline,
  including contradictions the Chronologist found. For example: "Earlier he said he never left the
  diner. Is the phone record a contradiction?" A question is one SELECT away, with no typing.
- **Free questions:** typed or spoken on the paired phone, in the Link thread. On a physical Fire TV,
  a `TextInput` with the system keyboard's microphone also works (keyboard dictation; *unverified* on
  the VVD).
- **The Ask agent** is Strands on AgentCore Runtime, using AgentCore Memory for this viewing session.
  Its tools are `transcript_search(query, before_t)`, `get_widgets(t_range)`, `web_search` and
  `wiki_lookup`. It answers in 2–4 sentences with cited timestamps, streamed into the panel. It is
  labelled `AI CO-VIEWER` and never speaks as the hosts.
- Questions about the episode use only the transcript before the playhead unless the viewer asks to
  include spoilers.

### 2.7 Timeline

Only when there are at least three dated or ordered events. Each event is marked `claim`, `fact` or
`conflict` (already in `TimelineWidget`). Conflict events link to the claim they contradict. LEFT and
RIGHT walk the rail, and SELECT seeks the video.

### 2.8 Send to phone

- Any widget with something to take away gets a **SEND TO PHONE** action. Each kind sends a different
  payload: a routine as a checklist with an `.ics` reminder, a list of names with their sources, a
  person as a short bio with links, a place as a map link, a recap as a note.
- **Paired phone:** the action posts a card to the Link thread (through the companion, §12). The TV confirms
  with a system toast (`useToastKepler`): `SENT TO ARI'S PHONE`.
- **No phone paired:** the TV shows a QR code for that one item. It links to a static share page on
  CloudFront, keyed by an unguessable ID that expires in 24 hours. No pairing or typing is needed, and
  `QrGlyph` already exists.

## 3. On the remote: Glance without pausing, Deep on pause

There are two depths, so the viewer never has to stop the podcast to look.

| State | How to get there | What shows | Video |
| --- | --- | --- | --- |
| **Watching** | default | Nothing but crimson notches on a 2 dp rail. When a notable cue enters (claim, burst, new person), a small chip appears for 6 s: `◆ CLAIM · ▲ GLANCE` | Full screen, playing |
| **Glance (the Stage)** | RIGHT while playing (or MENU): focus moves right, into the rail | The video eases to the left 70% and the **intelligence rail** takes the right 30%: at most three cards for *now*. It follows the playhead and re-composes when a moment cue enters, not on every `timeupdate`. UP/DOWN moves between cards; SELECT expands a card; LEFT returns focus to the video and closes the rail | **Keeps playing** |
| **Deep** | PLAY/PAUSE (pause), or SELECT on a Glance card's `MORE` | Tabs: `NOW · PEOPLE · CLAIMS · TIMELINE · RECAP · ASK`. Fast card at once; the refined or new widget replaces it in place | Paused, dimmed |
| **Try it** | SELECT on `TRY IT` | Full-screen guided technique | Paused |

- BACK closes the innermost layer: Try it → Deep → Glance → Watching → stop. PLAY/PAUSE in Deep
  closes the panel and resumes. DOWN while playing shows the SeekBar and transport; seeking uses
  REWIND/FAST-FORWARD, or LEFT/RIGHT once the SeekBar has focus. This changes the player column of
  the remote map in [tv-experience.md](tv-experience.md#4-remote-button-map): RIGHT now opens the
  rail, because the rail is on the right and focus visibly travels there.
- **Stage layout (the hero shot, §11):** the video container scales to 70% with a Reanimated
  transform (scale and translate on the UI thread, not a width animation that relayouts every frame),
  and the rail slides in. Whether the `VideoPlayer` surface follows a transform, or a one-shot resize,
  without a stall is *unverified*. This is spike **G1b** tonight. If it stutters, fall back to a
  flat overlay rail with the video at full size.
- **Focus:** each panel is a `TVFocusGuideView` that traps focus. Opening the panel focuses its first
  card, and closing it returns focus to the player. Cards are keyed by widget ID, so a re-compose
  keeps focus on the same card if it still exists. Otherwise `FocusManager` moves focus to the nearest
  card. Rapid D-pad input only changes a focused ID.

## 4. Generative UI on a precompiled app

> The rail layout and card forms are now the screen grammar in [system-architecture.md](system-architecture.md) §4. The principle in this section (data, not code) stands.


### 4.1 The app is compiled; the screens are data

The `.vpkg` holds our JavaScript compiled to Hermes bytecode, and that code does not change after
install. **The AI never writes code that the TV runs.** Even where an engine could evaluate
downloaded code, we do not do it: the engineering contract (§8) forbids running AI-generated code,
and it could not be validated first.

What the AI produces is a **screen description in JSON**. The app ships an interpreter for it: a
registry that maps each `type` to a precompiled React component. This is the same idea as a
compiled music player playing new songs. Rendering data this way is ordinary React. Yoga lays out
any combination of these components, and Fabric draws them natively.

```
AI (cloud)                         TV (precompiled)
{ layout: "hero+2",          ──▶   validateWidget()          drops anything malformed or oversized
  widgets: [                         │
   {type:"claim", ...},              ▼
   {type:"dossier", ...},          REGISTRY[type] ─▶ <ClaimCard/> <DossierCard/> <BlockCard/>
   {type:"card", blocks:[...]}],     │
  lenses: [...], chips: [...] }      ▼
                                   <Rail layout="hero+2"> in TVFocusGuideView ─▶ native views on screen
```

```tsx
// Sketch. The real registry lives next to src/analysis/schema.ts.
const REGISTRY: Record<Widget['type'], React.FC<{w: any}>> = {
  claim: ClaimCard, dossier: DossierCard, timeline: TimelineRail,
  entity_list: EntityList, protocol: ProtocolSteps, technique: TechniquePlayer,
  recap: RecapLines, relation_graph: RelationGraph, answer: AnswerCard, card: BlockCard,
};
const Rail = ({card}: {card: PanelCard}) => (
  <TVFocusGuideView trapFocusUp trapFocusDown style={LAYOUTS[card.layout]}>
    {card.widgets.map(w => {
      const C = REGISTRY[w.type];
      return C ? <C key={w.id} w={w} /> : null;
    })}
  </TVFocusGuideView>
);
```

### 4.2 What can change without an app update, and what cannot

| Dynamic (data from the AI) | Fixed (compiled into the app) |
| --- | --- |
| Which widgets appear at a moment, their order, and the layout template | The set of widget types and layout templates |
| All text, people, images (URLs from our CDN), sources and verdicts | Fonts, colours and the focus treatment (`FocusFrame`) |
| **`card`**: up to 8 blocks (`heading`, `text`, `stat`, `chip`, `image`, `list`, `quote`) in any order, so the agent can invent a card ("Ronaldo by the numbers") | The seven block primitives |
| **Animation specs**: phases, seconds, motion, cycles and shape. Precompiled Reanimated code reads the spec and builds `withSequence(withTiming(...))` at runtime, so a new breathing pattern needs no update | The animation engine and the shapes (`box`, `circle`, `bars`) |
| Graph and timeline coordinates, computed on the server | SVG drawing code |
| Lenses offered at a moment, suggested questions, actions | The meaning of each action (`seek`, `send_to_phone`, `try_it`, `ask`) |

Why not JSX or HTML from the model: running it breaks the contract, it cannot be validated, and a
WebView would add a Chromium instance to a 1 GB device and lose native D-pad focus. The grammar is
the Vega-correct pattern, and the part Amazon can reuse (§9).

### 4.3 Schema changes (not made yet)

| Change | For |
| --- | --- |
| `claim.verdict` enum, `claim.sources[{title, url, quote, date}]` | §2.1 |
| `dossier.image{url, credit, licence}`, `dossier.wikidataId`, `fact.asOf` | §2.2 |
| New `recap` (≤ 5 lines with `t`) | §2.3 |
| `entity_list.items[].what`, `forWhom`, `why`, `source` | §2.4 |
| `technique.shape` adds `circle`; `phases[].motion` (`expand`, `hold`, `contract`, `move`) | §2.5 |
| New `answer` (text, cited `t[]`, `streaming` flag) | §2.6 |
| `actions[]` on every widget: `seek`, `send_to_phone`, `try_it`, `ask` | §2.8 |
| New `card` (≤ 8 primitive blocks) | §4.2 |
| `score{confidence, salience}` on every widget | §5.4 |
| `Moment{t0, t1, lenses[], layout, widgetIds[], chips[], caption}` replaces `Moment{t, caption}` | §5.5 |

## 5. The AI system, end to end

### 5.1 The owner's pipeline, checked

The owner's pipeline:

1. Transcript.
2. Topic segments.
3. Per segment, the AI looks through each "lens" (the viewer questions).
4. Results are stored with a probability.
5. A curator agent reviews everything and decides the presentation, including animations.
6. On a timestamp, the stored items near it are fetched and shown, with the available options
   (people, graph, timeline, facts, catch-up).

**This is the right design.** Five refinements make it work and keep it instant:

1. **Two passes of lenses, not one.** Some questions only make sense across the whole episode: one
   person mentioned in three segments, a timeline that spans segments, a contradiction between minute
   2 and minute 30. Pass A runs lenses per segment. Pass B runs episode-wide lenses over Pass A's
   output.
2. **"Probability" becomes two measured scores, not the model's guess.** Models report their own
   confidence poorly. `confidence` (is it correct?) comes from checks: the Guardrails grounding score,
   the number of agreeing sources, and whether the name resolved to Wikidata. `salience` (is it worth
   showing?) is the lens's rating, adjusted by mention count and surprise. Thresholds decide what is
   shown.
3. **The curator works offline. "Instant" is a lookup, not an agent.** The curator agent runs once
   per episode, after the lenses. It writes a **moment index**: for each stretch of time, which lenses
   are available, the default layout, the cards and the chips. At play start, the TV downloads that
   package (tens of KB for a short episode, §5.5). On pause, `composeCard()` (already in
   `src/analysis/composer.ts`) picks the screen **on the TV in a few milliseconds, without the
   network**.
4. **A live curator only refines.** After the instant screen appears, the TV sends `{sessionId, t}`.
   The live curator (Haiku, warm AgentCore session) checks whether the last 15 s hold something no
   card covers. If so, it makes one new card, grounding-checks it and pushes it. The screen updates in
   place 1–3 s later (estimate).
5. **Search happens only offline.** The fact-check and dossier lenses search during ingest. The live
   path never waits for the web.

### 5.2 Stages

```
 1 TRANSCRIBE   Amazon Transcribe: words + timestamps + speakers (custom vocabulary for names, drugs)
                └ Speaker namer (Haiku): spk_0 → "Host", spk_1 → "Dr. Julian" from the intro
 2 SEGMENT      Segmenter agent (Sonnet): topic segments {start, end, title, genre}.
                A 37 s clip gets 3–4 segments; a 1 h episode about 10–20
 3 LENSES A     per segment, in parallel (Strands agents as tools; Gateway for outside data)
   (segment)      people      mentions, pronoun resolution, Wikidata ID  ── wiki tools
                  claims      checkable + surprising? then verdict, sources ── web search
                  burst       ≥ 3 named items in ~20 s → names, what, for whom, why ── web search
                  protocol    steps as said; practisable live? → technique spec
                  events      dated or ordered events
                  recap       1–2 lines for this segment
 4 LENSES B     episode-wide, after A
   (episode)      cast        merge people across segments, dossiers, licensed images
                  timeline    order events from all segments, ≥ 3 or none
                  conflicts   statements that contradict each other → claim(kind: conflict)
                  relations   people graph, laid out on the server (x/y)
                  questions   2–3 suggested questions per stretch, incl. conflicts
 5 VERIFY       schema check; Guardrails grounding against the segment text; outside facts need
                fetched sources; one repair attempt, else drop. Writes score.confidence
 6 STORE        DynamoDB: every candidate with score{confidence, salience}, evidence, lens
 7 CURATE       Curator agent (Sonnet) over all stored items:
                  - picks what to show where (thresholds), dedupes, words the headlines
                  - chooses card types, layout templates, animation specs, actions
                  - writes the moment index (§5.5) and captions/cues (WebVTT)
 8 PUBLISH      episode package JSON → S3 + CloudFront; job status → DynamoDB
 ─────────────────────────────────────────────────────────────────────────────────────────
 9 PLAY         TV downloads the package and starts an AgentCore session (transcript cached)
10 PAUSE/RAIL   TV: composeCard(package, t) → screen in milliseconds, offline
11 REFINE       TV → POST /v1/refine {sessionId, t} → live curator: novelty? → one new card → in place
12 ASK          chip or phone question → Ask agent (transcript before t, widgets, search) → stream
```

Stages 1–8 run once per episode, in minutes. For the demo they run ahead of time on the two
episodes, and the result is labelled preprocessed. Stages 9–12 are live, and the video shows them
working.

### 5.3 What a lens is, concretely

Every lens has the same contract, so adding a lens is one prompt plus one output schema:

- **Input:**
  - the segment transcript with timestamps;
  - an episode brief: cast so far and earlier segment recaps (prompt-cached);
  - the lens instructions.
- **Output** (structured, schema-checked): a list of candidates. Each has its payload, `evidence:
  [{t0, t1}]` and a `salience` from 0 to 1, with a one-line reason.
- **Rules:** quote or cite the transcript; never invent numbers; return an empty list when nothing
  fits. The empty list is how "only show when it actually came up" is enforced.

```python
# Sketch (Strands, Python on AgentCore Runtime). Names are ours; check the SDK version's API.
claims_lens = Agent(model=SONNET, system_prompt=CLAIMS_LENS, tools=[web_search, fetch_page])
people_lens = Agent(model=SONNET, system_prompt=PEOPLE_LENS, tools=[wikidata_search, wiki_summary])
...
analyst = Agent(model=SONNET, system_prompt=ANALYST,          # orchestrator: agents as tools
                tools=[as_tool(claims_lens), as_tool(people_lens), as_tool(burst_lens), ...])
```

### 5.4 Scores and thresholds (starting values, tuned on the demo episodes)

| Lens | `confidence` from | `salience` from | Shown when |
| --- | --- | --- | --- |
| people | Wikidata ID resolved, mention count | Mentions, and whether the person is central to a segment | confidence ≥ 0.7 |
| claims | Number of agreeing or contradicting sources fetched | Surprise and checkability | salience ≥ 0.6; verdict needs ≥ 2 sources, else `UNVERIFIED` |
| burst | Spelling confirmed by search | Density of items in the window | ≥ 3 items |
| protocol | Grounding score | A speaker recommends it | grounding ≥ 0.7 |
| timeline | Grounding score | Event count | ≥ 3 events |
| recap | Grounding score | Always | Always |

### 5.5 The moment index: how the curator's choices reach the screen

The curator divides the episode into stretches, each from one notable change to the next (a
person named, a claim, a new topic). Each stretch gets an entry:

```json
{"t0": 5, "t1": 13,
 "caption": "A claim: midday sleep cuts cardiovascular strain by 37%.",
 "layout": "hero+2",
 "widgetIds": ["siesta-claim", "ronaldo", "r90"],
 "lenses": [{"lens": "claims", "count": 1}, {"lens": "people", "count": 1},
            {"lens": "protocol", "count": 1}, {"lens": "recap"}, {"lens": "ask"}],
 "chips": ["Is 37% from a real study?", "Who is Nick Littlehales?"]}
```

On the TV:

- **Rail open or pause at `t`:** take the entry covering `t`. Put its first widget in the hero slot,
  then the next two. The **lens bar** above the cards shows only lenses with content here, ordered by
  salience (`FACT CHECK 1 · PEOPLE 1 · PROTOCOL · CATCH ME UP · ASK`). Catch-up and Ask are always
  present.
- **Choosing a lens:** the lens bar opens that lens for the whole episode up to `t`. Examples: People
  lists everyone so far; Timeline shows the rail with the current event focused.
- **Entering a stretch while playing:** with the rail open, the rail re-composes; with it closed,
  the cue chip appears. A metadata `VTTCue` per entry fires this, or a throttled `timeupdate`
  (§6).
- **When the live curator adds a card:** it is inserted into the entry in memory, so the next pause
  at this moment shows it too.

Package size, estimated: about 1–2 KB per widget and about 0.3 KB per entry. A 37 s demo episode is
well under 50 KB. For a 1 h episode the TV fetches the package by segment, so the 16 KB per-widget cap
(§7) and the memory budget hold.

### 5.6 Where each piece lives

| Data | Store | Why |
| --- | --- | --- |
| Media, transcript, episode package, resized images | S3 + CloudFront | The TV fetches one cacheable file per episode |
| Candidates with scores, curated widgets, jobs, compose cache | DynamoDB (`MEDIA#id` / `CAND#lens#t0`, `W#…`, `MOM#…`, `JOB#…`) | Agents query and update by time and lens; the live curator writes new cards here |
| What this viewer has seen and asked | AgentCore Memory | So the live curator and Ask do not repeat themselves |
| Ingest progress | Step Functions | `ANALYSING 3/12` on the TV; resumes after a relaunch |

### 5.7 AWS services and what each actually does

The full backend design, the AWS Builder rubric and the build order are in
[aws-backend.md](aws-backend.md). It wins where the two disagree.

The AWS Builder judging favours integrations that do real work over token calls. Each row below
carries load in the product.

| Service | Real job in StudioX |
| --- | --- |
| **Strands Agents** | The Episode Analyst (orchestrator with lenses as agent tools), the Curator, the live curator, the Ask agent |
| **AgentCore Runtime** | Hosts the agents; one session per viewing keeps the transcript warm |
| **AgentCore Gateway** | Turns Wikidata, Wikipedia, Commons and search into MCP tools shared by all agents |
| **AgentCore Memory** | Short-term: what this viewer saw and asked |
| **AgentCore Identity** | Holds the search-provider API key if a third-party search is used |
| **AgentCore Observability** | Traces of every agent and tool call; shown in the demo video as evidence |
| **Bedrock** (Claude Sonnet 5.5 offline, Haiku 5.5 live) | Structured JSON output, prompt caching |
| **Bedrock Guardrails** | Contextual grounding scores, which feed `confidence` |
| **Transcribe** | Word timestamps, speaker labels, custom vocabulary |
| **Step Functions** | Runs stages 1–8 with retries and job state |
| **AppSync Events** (after the deadline) | One WebSocket for TV and phone. For the deadline, HTTPS request/response and short polling replace it (§12.2) |
| **API Gateway + Lambda, DynamoDB, S3, CloudFront** | API, candidate store, package and image delivery, share pages |
| **CDK** | One stack (the AgentCore CLI also deploys with CDK) |

If an AgentCore session adds too much latency for the live curator (cold-start figures are not
published), the live call falls back to one streaming `ConverseStream` from a Lambda. The instant
screen does not depend on it either way.

**Region:** us-east-1 for everything (decided 21 Oct).

**Search: the AgentCore Web Search Tool** (decided 21 Oct; checked against
[the official page](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-target-connector-web-search-tool.html)
on 21 Oct).

- **What it is:** a managed **Gateway target connector** (`connectorId: "web-search"`). Agents find
  it with `tools/list` and call it like any MCP tool, from Strands or any other framework. It needs
  no third-party API or key, so AgentCore Identity is not needed for search.
- **Index:** Amazon-operated, with a knowledge graph for entity facts. Queries stay inside AWS.
- **Input:** `query` (≤ 200 characters), `maxResults` (1–25), and, from connector 1.2.0,
  `filters.domainFilter.include/exclude` (≤ 100 domains each) and `filters.publishedDateFilter`.
- **Output:** results with a snippet, `url`, `title` and `publishedDate`. These map directly onto
  `claim.sources[{title, url, quote, date}]`.
- **Regions:** us-east-1, us-east-2, us-west-2, eu-west-1, ap-southeast-2, ap-northeast-1 and
  GovCloud.
- **Pricing:** not on that page; check the AgentCore pricing page and the bill.
- **How we use it:**
  - The FactChecker restricts health and science claims to high-quality domains per request (for
    example `nih.gov`, `who.int`, `cochrane.org`, journals), and leaves news claims unrestricted.
  - The Archivist uses it for dated facts ("as of").
- **Acceptable use:** the citations and links must be shown with every result we surface (the
  `SOURCES SAY` row already does this). Bulk extraction or storage of results is not allowed, so we
  store only the snippet each claim cites.
- **Alternative:** Nova 2 Lite with the `nova_grounding` system tool (US regions only) is one
  Converse call that returns cited text. It is a fallback for the live Ask agent if a Gateway hop is
  too slow, not the main path.

## 6. Vega and Fire TV features to use

The goal is a high Fire TV platform score from features a judge can see in the video and that run
without catalog or partner approval.

**Tier 1: demoable on the Virtual Device**

| Feature | StudioX use | Package (RN 0.83) | State |
| --- | --- | --- | --- |
| W3C media `VideoPlayer` | Playback; `pause` opens Deep; `currentTime` is the composer's `t` | `react-native-w3cmedia ~2.3.2` | Installed; not playing yet (gate 1) |
| Media Controls | Remote PLAY/PAUSE, rewind and fast-forward in the player | `kepler-media-controls ~1.0.25` | Installed |
| TimedMetadata (`metadata` track, `VTTCue`) | Insight chips and Glance re-compose happen when a cue *enters*, with no polling | w3cmedia | *Unverified* on VVD; fallback is a throttled `timeupdate` |
| Captions (WebVTT) + OS caption settings | Transcript captions styled to the system settings | w3cmedia + `kepler-a11y-settings-interface-turbo` | To add |
| Vega UI `SeekBar` | AI chapter breaks, `segmentColors` by topic, insight markers | `kepler-ui-components ~3.2.0` | Installed |
| Reanimated 4 + Worklets | Try it animations and panel slide on the UI thread | `react-native-reanimated ~4.0.0`, `react-native-worklets ~1.0.0` | Installed |
| SVG | Timeline rail, relation graph, countdown ring | `react-native-svg ~3.0.0` | Installed |
| Vega Carousel v2 | People roster, entity lists | `vega-carousel ~1.0.0` | To add |
| `TVFocusGuideView`, `FocusManager`, `useTVEventHandler` | Focus traps, restoration, UP-to-Glance, long-press | react-native-kepler | In use |
| `useToastKepler` | `SENT TO PHONE`; a phone question arrives | built in; notification privilege | Manifest change |
| VoiceView, `aria-live` | The panel announces "New: claim, nuanced" | built in; accessibility privilege | Manifest change |
| Deep links (`studiox://episode?id&t`) | Shared items open at a timestamp; demoed with `vmsgr send` | `Linking` + manifest `[[message]]` | Manifest change |
| AppState lifecycle | Release the player and socket on background, keep position and panel, resume and catch up | `useKeplerAppStateManager` | Pattern in use |
| `SplashScreenManager` | The rendered StudioX sting as the native splash | built in | To add |
| `useReportFullyDrawn` + KPI Visualizer | Measured TTFD, memory and key latency for the write-up | `kepler-performance-api ~0.1.4` | To add |

**VVD-specific risks (the demo is recorded on the VVD; there is no physical Fire TV):**

- **Playback:** one developer reported `MEDIA_ERR_SRC_NOT_SUPPORTED` on the VVD. That is gate G1.
- **Text tracks:** Amazon's caption docs list "Text track doesn't work on Simulator". So metadata
  cues may not fire, and system captions may not render. The cue scheduler therefore sits behind one
  interface with a throttled `timeupdate` fallback. Captions are app-drawn from our WebVTT and styled
  to the OS caption settings (the pattern in the `amazon-devices-vega-caption-settings` skill).
- **Recording:** VVD screenshots and screen recording do not work (R-05). Record the desktop and crop
  to the TV pane. VVD keys: ENTER = SELECT, ESC = BACK, F2 = MENU, F4 = PLAY/PAUSE.
- **Performance:** every number is labelled "Vega Virtual Device". No hardware claims.

**Tier 2: not in the demo (needs a physical Fire TV, which we do not have)**

| Feature | StudioX use |
| --- | --- |
| On-screen voice navigation (`com.amazon.category.kva`; `aria-label`, `ariaPosInSet`) | "Alexa, select People", "Alexa, select number two". Voice, D-pad and visuals together match a judging example. Needs a reboot after sideload |
| Keyboard dictation | Ask by holding the Alexa button over the Ask field |
| Alexa transport ("Alexa, pause") | Pausing by voice opens Deep (routing to a sideloaded app is *unverified*) |
| Recommendation Manager | A home-screen tile: "Resume Case 104 · AI breakdown ready" |

**Skipped:** Content Launcher, Content Personalization and Account Login (catalog or select partners
only), Matter Casting and DIAL (need a native phone app), Login with Amazon (not on the VVD), and
headless services (crash on RN 0.83).

Manifest changes that need the owner's approval: the notification and
accessibility privileges, the deep-link `[[message]]`/`[[offers]]` entries, and later the
recommendation and input-method services.

## 7. TV memory and performance

- One `VideoPlayer`. Glance mounts at most 3 widgets and Deep at most 5. Panels unmount on close,
  which releases their images.
- Images are resized on the server to about 2× their dp size. At most 6 are decoded at once, and no
  image is ever sent as base64.
- Widget JSON is ≤ 16 KB each, fetched by segment and not for the whole episode. Answers are capped
  at about 600 characters, and streamed tokens are batched into at most 4 UI updates a second.
- The playhead never goes into React state. Only the SeekBar and the cue handler read it.
- Measure PSS during a 10-minute session with repeated Glance and Deep, then report it labelled
  **VVD**. Hardware numbers appear only if a device is tested.

## 8. Build plan for the 53 hours left

Two tracks run in parallel and agree on the schema (§4.3) first. **TV** works from fixtures, so it is
never blocked by the backend. **Cloud** replaces the fixtures with pipeline output. The long
third-party transcript is the cloud track's test input from the first hour (§13).

| When (IST) | TV track | Cloud track | Gate |
| --- | --- | --- | --- |
| **21 Oct, until 02:00** | Player screen: an MP4 plays on the VVD; spike the Stage transform (G1b); PAUSE opens Deep from fixtures through `composeCard`; BACK order | `cdk bootstrap` in us-east-1; `agentcore create`; Gateway with Wikipedia/Wikidata tools; the people and claims lenses run on the long test transcript; Transcribe both demo clips | **G1:** video plays on the VVD. **G1b:** the Stage transition keeps the video smooth. **G2:** a lens on AgentCore returns schema-valid JSON |
| **22 Oct, until 22:00** | Renderers: dossier with image, claim verdict, recap, entity_list, protocol + Try it, timeline; lens bar; Stage rail; SeekBar markers, cues, focus traps; `/v1/refine` and `/v1/ask` calls | All lenses, pass B, verifier, curator → both demo packages (`provenance: 'pipeline'`); live curator; Ask agent; API Gateway + Lambda; CloudFront; companion routes for phone questions and send to phone | **G3 (22:00):** a real pause on the VVD shows pipeline output, one live-refined card and one Ask answer |
| **23 Oct, until 16:00** | Send to phone (QR + Link) + toast; app-drawn captions; lifecycle; offline fallback packages; KPI run on the VVD | Upload → analyse (stretch, only if G3 passed); Observability traces captured; budget alarm; judge README | **G4 (16:00): feature freeze** |
| **23 Oct, 16:00–23:30** | Record the demo on the VVD + phone; screenshots | Devpost fields (local plan in `submission/`, not published), public friction log, feedback answers | **Submit by 23:30**, leaving an hour of margin |

**Order of additions once G3 passes:** demo-mode bundle (required) → one-viewer adaptation →
real-scale numbers → your own words analysed (optional video shot).

**Cut order if behind:** phone upload analysis → Recommendation tile → phone
typing for Ask (keep the chips) → squeeze-back (keep the overlay) → live new-widget generation (keep
the instant screen and refined caption) → relation graph → household profiles. Never cut: playback, the rail and Deep, at least four lenses, BACK
and focus, one real pipeline run, the hosted backend.

**Honesty in the demo:** precomputed analysis is labelled preprocessed. The video shows at least one
live pause producing a new card, and the AgentCore trace behind it.

## 9. Material Amazon can showcase

To be written *after* implementation, from what actually ran, in a public `docs/showcase/`:

1. **"Server-driven generative UI on Vega"**: the widget grammar, the validator, the D-pad-safe
   renderers and the TimedMetadata sync, packaged as a pattern other Vega apps can copy (MIT).
2. **Architecture diagram**: TV ↔ API Gateway ↔ Strands/AgentCore ↔ Bedrock, with the latency budget we
   measured.
3. **Vega feature map**: the tables in §6 with real versions, what worked on the VVD, and the gotchas
   we hit.
4. **Measured KPIs**: TTFD, PSS and key latency, labelled VVD or device.
5. **Friction log and feature requests**: already being kept, and worth up to a 10% bonus.
6. **The 3-minute video**: problem → watch → glance without pausing → pause → fact check, who is
   that, try it → ask a contradiction → send to phone → the agent trace.

## 10. Owner decisions

Decided 21 Oct:

1. **Verdict labels:** `SUPPORTED`, `NUANCED`, `DISPUTED`, `DEBUNKED`, `UNVERIFIED`. `DEBUNKED` is
   kept, and needs at least two fetched sources that directly contradict the claim.
2. **No physical Fire TV.** The demo is VVD-only, Tier 2 is out, and performance numbers are labelled
   VVD.
3. **Region:** us-east-1 for everything on AWS.
4. **Episodes:** the two 37 s clips are the demo content. The long third-party transcript is for
   pipeline development and testing only (§13).

Still open:

5. **Search:** the AgentCore Web Search Tool, or a third-party API with a key. Decide in the first
   cloud hour, from whichever works in us-east-1.
6. **Rights** to the two clips and the intro audio (§13).
7. **Manifest changes** listed in §6.

## 11. Platform showcase: what makes a judge say "this is Vega"

Review of two outside suggestions (21 Oct planning session). Judges may score from the video alone,
so the Vega evidence has to be visible on screen, not just claimed in the write-up.

### 11.1 Two hero moments

1. **The Stage.** The podcast plays. The viewer presses RIGHT, the video eases to 70% *without
   pausing*, and the rail slides in with native cards, while Vega SeekBar markers light up as
   TimedMetadata cues enter. One shot shows the W3C media pipeline, native rendering, the Vega focus
   engine and a Vega UI component working together. Proof: a **KPI Visualizer** capture of video and
   UI fluidity during the transition, labelled VVD, cut into the video. A measured number convinces
   more than the claim "60 FPS".
2. **AI that composes native UI.** Pause: the backend composes the screen, and the TV renders it
   with native components. No WebView. Then TRY IT runs a breathing animation generated from a spec
   and driven on the UI thread. Two pauses a few seconds apart produce visibly different screens, and
   the lens bar changes with them. That is the evidence that the UI is generated rather than
   hardcoded. Cut to the AgentCore Observability trace of the live curator that added a card.

   **The multimodal beat without voice:** record the VVD and a phone side by side. A question typed
   on the phone appears as an answer card on the TV. SEND TO PHONE on the TV lands on the phone, with
   a system toast on the TV. Voice is not in the video: there is no device to test it on, and it is
   never simulated. The rail's controls still get `aria-label`s phrased as the questions ("Is that
   true", "Who is that"). That serves VoiceView and makes the app voice-ready, and the write-up says
   so without claiming it was tested.

Supporting Vega details that cost little and show in the video:

- Native splash (`SplashScreenManager`).
- `useReportFullyDrawn` with the measured TTFD.
- The system toast on send to phone.
- VoiceView reading a new card through `aria-live` (VoiceView on the VVD is *unverified*: try `vdcm set ... VoiceViewEnabled`, and drop it if it is silent).
- A deep link opening an episode at a timestamp (`vmsgr send`).
- App-drawn captions that follow the OS caption settings.

### 11.2 Adopted from the suggestions

| Suggestion | Decision |
| --- | --- |
| Keep 90% of the excitement on the TV; the phone is a side channel | Adopted (already the plan) |
| Split-screen rail without pausing, no dropped frames | Adopted as hero moment 1, with a fallback |
| D-pad-driven rail and focus snapping with a scale lift | Adopted. `FocusFrame` already lifts 4%. The colour stays bone and crimson ([design-language.md](design-language.md)), not "Amazon blue" |
| Demo opens with launch and TTFD | Adopted, using measured numbers only |
| Friction log as a feedback section | Adopted (already kept). Feedback is honest, not praise |
| `@amazon-devices/react-native-qrcode-svg` (npm 3.0.0 exists) | Optional swap for our `qrcode-generator` + SVG glyph. It changes nothing a judge sees, so do it only if it saves code |

### 11.3 Rejected, with reasons

| Suggestion | Why not |
| --- | --- |
| Content Launcher ("Alexa, launch … on StudioX") | Needs catalog ingestion and a partner ID; "available to select partners only" (Amazon staff, May 2026). Cannot be demoed |
| Content Personalization (Continue Watching, Watchlist) | Needs a catalog, entitlements, backend enablement and an ECID allowlist. Logs only |
| Matter Casting | The phone side needs the native Android/iOS SDK; our phone app is a web page |
| EPG / Live TV, IAP, APS, Simple Sign-In, Account Login | Not part of the product; partner-gated |
| Headless JS services (playback service, background sync) | Crash on RN 0.83 (release-note known issue, F-35); the workaround must not ship |
| WebView for charts and graphs | Contradicts the "native, not a web page" goal. It adds Chromium memory on a 1 GB device and loses native focus. SVG and Reanimated cover it |
| Lottie to animate the split screen | Lottie plays pre-made animation files. It does not drive layout, and Vega does not support remote sources. Reanimated (installed) does this |
| MMKV cache of segment JSON | Pause latency is the network, not storage. Adds flash writes for no visible gain |
| "Alexa, what did he just cite?" as a custom intent | No custom voice intents or app-level speech recognition for third-party Vega apps. Only "Alexa, select <label>" (above) and keyboard dictation exist |
| Runtime loader `keplerscript.runtime.loader_2@IKeplerScript_2_0` | That is the RN 0.72 module. StudioX is RN 0.83: `react_native_kepler_4@IReactNativeKepler_0` |
| "Target Navigator API", `isPresentOnOS`, Appstore bytecode recompilation, "30% faster TTFF", Flashlight | No source found in our notes or the installed packages. Do not claim them. Deep links use the documented `Linking` + manifest path |
| A11y "colour correction, timeout multipliers" | *Unverified*. The package describes caption settings, audio description and "UI scaling hooks". Use captions; check the scaling hook in its README before claiming it |

## 12. What runs where for the deadline

### 12.1 Placement

| Piece | Where it runs | Reached by |
| --- | --- | --- |
| TV app | Vega Virtual Device (judges: the VVD or a Fire TV) | — |
| Episode packages, resized images, demo MP4s, QR share pages | S3 + CloudFront, us-east-1 | TV over HTTPS |
| API: `/v1/sessions`, `/v1/refine`, `/v1/ask`, `/v1/share` | API Gateway HTTP API + Lambda, us-east-1, with throttling | TV and companion over HTTPS |
| Agents: Episode Analyst (lenses + curator), live curator, Ask | AgentCore Runtime + Gateway + Memory + Observability | Lambda |
| Candidates, widgets, moments, jobs | DynamoDB | Agents and Lambda |
| Phone pages, pairing, uploads, the Link thread | **The existing companion** (`companion/server.mjs`, Node 22) on the workstation LAN | Phone over LAN HTTP; TV over the VVD network |

The companion already serves pairing, uploads, the phone pages and byte-range media. Moving it to
AWS (the 30-day tokens and AppSync design in [architecture.md](architecture.md)) is post-deadline
work. For the deadline it gains three routes:

- the phone posts a question or a message;
- the TV and the phone poll the thread with `?after=<cursor>`;
- the TV posts a send-to-phone item.

Phone questions are forwarded to `/v1/ask`. A judge without a phone still gets every TV feature,
plus the QR share pages on CloudFront.

### 12.2 Why HTTPS and polling instead of a WebSocket for now

- `/v1/refine` is a single request that returns the refined card within a few seconds. The TV has
  already drawn the instant screen, so the wait costs nothing.
- `/v1/ask` returns the whole answer when it is ready, with a `THINKING` state and BACK to cancel
  (`AbortController`). RN `fetch` does not stream response bodies, so a streamed answer would need
  the WebSocket anyway.
- Thread polling runs every 1.5 s, only while the app is in the foreground. That is the existing
  pairing poll pattern.

This avoids the unverified WebSocket-subprotocol spike on Vega. AppSync Events stays the upgrade
path.

### 12.3 Judging: demo mode, and what AWS is for (verdict, 21 Oct)

**What judges realistically do:**

- Most judges watch the video and read the description. The rules allow scoring "solely on the text
  description, images, and video", and say the project is accessible to judges "via code repository
  and demo video".
- A few open the repository.
- Very few install the app on a VVD.
- Almost none will find a podcast, pair a phone and upload it.

So the live backend is **not what gets judged**. **The video is.**

**Verdict:**

1. **Judges get a demo mode that needs no backend.** The app bundles the real pipeline's output for
   the two clips: every moment's cards, every lens, Try it, and precomputed answers to every
   suggested question. Send to phone uses static QR share pages. Anything a judge can trigger with
   the remote works, deterministically, at no cost, and cannot break. The screen says so: `ANALYSED
   BY THE STUDIOX PIPELINE · 22 OCT`. One-viewer adaptation is stored on the device (AsyncStorage),
   so it works in demo mode too.
2. **AWS is still essential, before judging rather than during it:**
   - **The pipeline runs on AWS to produce that output.** Strands lenses and curator on AgentCore,
     web search, grounding. The bundled files must be genuine pipeline output, not hand-written.
   - **The video shows the live parts, recorded on 23 Oct with the backend up.** A pause where the
     live curator adds a new card, an Ask answer, and the AgentCore trace. Without these, the demo
     looks like hardcoded JSON.
   - **The AWS Builder judges read the code and the write-up:** the CDK stack, the agent code, and
     trace screenshots. That is the "documented integration".
3. **During judging, only S3 + CloudFront stays up.** It serves the two clips and the share pages:
   static files, a few cents, almost nothing to break. The live AI is **switched off**. The judge
   build does not call it, so it needs no access code, cap or kill switch, and there is no surprise
   bill.
4. **Not built for judges:** the hosted companion, phone pairing for judges, a public live-AI
   endpoint.
5. **Upload "your own words":** optional. Its only value is as a shot in the video proving the
   pipeline is general. The cheaper must-have proof is the live pause card plus the trace. Build the
   upload only if G3 passes early.
6. **The live AI during development and recording** sits behind a private access code kept outside
   the repository, with API Gateway throttling and a budget alert. After recording on 23 Oct, set
   `live=off` (or delete the AgentCore runtime), and leave the static hosting.

**The app has three modes**, set in `src/config.ts` at build time:

| Mode | Who | Backend |
| --- | --- | --- |
| `demo` (default, judge build) | Judges, public repository builds | Static CloudFront only |
| `live` | The team, when recording | Full AWS, with the access code |
| `offline` | Anyone with no network | Bundled data; clips unavailable |

**Effort saved:** the hosted companion, the judge access-code flow, the daily caps, canaries, and a
month of uptime worry. That is roughly half a day, moved to video quality and polish, which is where
the score is.

## 13. Content and rights

The rules exclude third-party copyrighted material from the video unless permission is held. They
also require that the repository not violate IP rights.

| Material | Use | Rule |
| --- | --- | --- |
| Two 37 s demo clips (`media/tv/`) | Demo video, judge testing | Pexels footage (owner, 21 Oct). Credit Pexels in the README anyway. Pexels terms bar showing identifiable people "in a bad light": check that the crime clip does not present a recognisable stock actor as the suspect, or label the story as fiction over generic footage. Verified licence text: "Identifiable people may not appear in a bad light or in a way that is offensive", and "Don't imply endorsement" (so stock actors must not appear to endorse StudioX). The licence also bars redistributing the clips as stock, so host them for playback; do not commit them as a downloadable asset pack |
| Third-party sleep-science podcast transcript (`review/transcript/podcast1.md`) | Development input only: an 81-minute real transcript to stress-test segmentation and lenses and to tune thresholds | **Never in the repository** (git-ignored since 21 Oct), never on screen, never named in the video. The write-up may say "tested on a public 81-minute sleep-science podcast transcript", with measured numbers only |
| Intro audio (extracted from the *Black Mirror* titles, [opening-sequence.md](opening-sequence.md)) | None in public material | **Must not be in the demo video.** Use silence, an original sound, or a licensed track |
| Wikipedia/Wikidata text, Commons images | Dossiers | CC BY-SA / licence-filtered, credited on the card |

What the test transcript gives the cloud track, so it is worth the effort:

- **Claims:** commercial melatonin "15% to 400 times" the label dose, the retracted "light on the
  back of the knee" study, and "50 times less effective through a window".
- **Burst:** magnesium threonate, theanine, apigenin and the doses he gives.
- **Protocols:** morning and sunset light for 2–10 minutes, no bright light between 11 p.m. and
  4 a.m., NSDR.
- **People:** Matt Walker, Jamie Zeitzer, David Berson, Samer Hattar, Satchin Panda, David Spiegel.
- **Timeline:** real segment titles. A daily schedule could also arise (cortisol at waking, melatonin
  12–14 h later).

These are test expectations, not verified verdicts. The lenses decide.

## 14. Competitive position: what makes this a winner and not "chat with a transcript"

Written 21 Oct after a zoomed-out review. About 60,000 people registered across four tracks.
Registrations are not submissions, and the number of Fire TV entries is unknown.

### 14.1 Where we stand

- **On target.** "AI-enhanced viewing" is the first Fire TV priority category. A
  "remote-controlled game" and a "simple video player" are named as *obvious*. A strong game needs
  something exceptional to beat that label.
- **Main risk 1: it looks like a commodity.** "An LLM summarises a transcript" is easy to imagine. The
  demo must show what a transcript chatbot cannot: timing (no spoilers, "what did he *just* say"),
  the TV-native Stage, verdicts with sources, and talk turned into action (Try it).
- **Main risk 2: the content looks staged.** Two 37 s clips with hand-picked moments can look
  canned.
- **Main risk 3: execution.** VVD playback, a half-finished panel or eight shallow lenses lose
  against a smaller, polished app. The tie-breaker is Tech Implementation.

### 14.2 Three additions, in priority order

1. **Adaptive co-viewer for one remembered viewer** (narrowed 21 Oct, §14.5; the profile text below
   is superseded). This matches the rules' own example of creative work:
   "AI-enhanced viewing that adapts to household patterns".
   - Two viewer profiles, chosen with the D-pad on the library screen (or from the paired phone).
   - Each lens opened and each question asked is recorded per profile, in AgentCore Memory
     (`actorId = profileId`) or a DynamoDB counter if Memory's extraction is too slow to show.
   - The live curator orders the lens bar and picks the proactive cue chip from those preferences.
     One viewer always opens fact checks and gets claim chips while watching; the other gets people
     chips.
   - **Demo shot:** the same pause, two profiles, two different rails.
   - Estimate 4–6 h.
2. **Your own words, analysed** (optional since 21 Oct, §12.3: a video shot only). Record 20–30 s on the phone (for example a surprising claim and two
   supplement names), upload it, and let the real pipeline run: `ANALYSING 2/4` on the TV, then a
   fact-check card on your own sentence. The team owns the content, it proves nothing is hardcoded,
   and it uses the companion upload that already exists. The video may cut the wait with an on-screen
   timer ("2 min later"). Needs G3 first.
3. **Real-scale evidence.** Run the pipeline on the 81-minute test transcript and report measured
   numbers in the write-up: segments, cards per lens, ingest time, cost. Do not name it.

### 14.3 A video-frame pipeline: no

- Every question the product answers comes from speech. Podcasts are talk-first.
- Our clips are stock footage under narration. Vision would describe stock actors and attach the
  wrong faces to "who is that". On this content it would mislead.
- The rules' computer-vision example is a TV camera for fitness, not frame analysis of a video.
- It would add MediaConvert/BDA or frame-sampling cost and hours we do not have.
- If time remains (it will not), the cheapest multimodal step is one Bedrock Data Automation pass
  for on-screen text, used only as a hint to the segmenter.

### 14.4 What "complete" means for judging

One loop without a rough edge:

1. Open.
2. Choose a profile.
3. Play.
4. Glance without pausing.
5. Pause and explore.
6. Try it.
7. Ask.
8. Send to phone.
9. Resume where you left off.

It also needs a first-run hint (`PRESS ▶ FOR STUDIOX`), honest empty and error states, and a
measured number for speed. Five lenses done very well beat eight done partly. The order to protect
is: fact check, who is that, burst, Try it, catch me up, Ask; then timeline (crime episode); and
relation graph last.

### 14.5 Directions considered and rejected (21 Oct)

| Idea | Decision | Why |
| --- | --- | --- |
| A model picker the viewer uses | **No** | A viewer does not care which model answers, and a picker on a TV is clutter. Bedrock's multi-model strength is shown as **routing by job** instead: Sonnet for the offline lenses and curator, Haiku for live refine and Ask, Nova 2 Lite with web grounding as a fallback. Each card carries a mono provenance line, for example `HAIKU 5.5 · 1.4 S · 3 SOURCES`. The trace and the write-up show the routing |
| Several household profiles | **No: one viewer** | Multiple profiles invite "coming soon" questions. Keep **one viewer who is remembered**: what was watched, which lenses they open, what they asked. The lens bar and the proactive chip adapt to that, and a small `YOU USUALLY OPEN: FACT CHECK` shows it. This still answers "adapts to patterns" without looking unfinished. Never mention multiple profiles |
| YouTube links: play in an iframe, take the transcript, overlay the analysis | **No** | YouTube's developer policies forbid the pieces this needs: "modify, build upon, or block any portion or functionality of a YouTube player" (III.I.6); "scrape YouTube Applications … or obtain scraped YouTube data" (III.E.6); "use any technology other than YouTube API Services to access or retrieve API Data" (III.I.14). The official `captions.download` "requires the user to have permission to edit the video", so it works only for the viewer's own videos. It would also replace the native Vega player with a WebView, and the demo video could not show the third-party content. Possible after the hackathon only for creators' own channels, and even then without overlays on the player |

