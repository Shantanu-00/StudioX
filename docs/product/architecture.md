# StudioX architecture (v2)

Status: **proposal for review**, 21 October 2026. Nothing is deployed. The viewer questions, Glance mode and
search are planned in [coviewer-plan.md](coviewer-plan.md), which wins where the two disagree. Supersedes v1, which had
no agent layer. Research notes with sources are in `docs/reference/aws/` and `docs/reference/vega/`.
They are local and git-ignored. Items marked *unverified* have not been tested by us.

## 0. Reality check: time left

The submission closes **24 Oct 2026, 00:30 IST**, about three days from now. This document
describes the full product, and §10 cuts it into what can ship by the deadline. Judges may score only
from the video and description, so every tier must end in something demonstrable on the Vega
Virtual Device.

## 1. Pieces

| Piece | Tech | Role |
| --- | --- | --- |
| TV app | React Native for Vega (RN 0.83) | Plays the episode. Renders the AI panel from typed widget data. Uses Fire TV platform features (§6) |
| Phone web app | Static PWA | Pair once (30-day token), Link thread (text, links, uploads), camera gesture mode, later voice questions |
| API | API Gateway HTTP API → Lambda (TypeScript) | Devices, pairing, thread, uploads, playback URLs, live compose |
| Realtime | **AWS AppSync Events** | One managed pub/sub WebSocket for TV and phones: messages, receipts, gestures, refined panel cards |
| Agents | **Strands Agents on Amazon Bedrock AgentCore Runtime** | Offline episode analysis (multi-agent) and the follow-up "Ask" agent |
| Orchestration | **AWS Step Functions** | Upload → transcode, transcribe and understand → segment → per-segment fan-out → verify → publish |
| Models | Bedrock: Claude Sonnet 5.5 (offline), Claude Haiku 5.5 (live), Nova 2 Lite (option) | Structured JSON output, prompt caching |
| Media understanding | Amazon Transcribe (batch) + **Bedrock Data Automation** (video) | Word timestamps, speakers, chapters, on-screen text |
| Grounding | **Bedrock Guardrails**, contextual grounding check (`ApplyGuardrail`) | Rejects widget text that the transcript does not support |
| Data | DynamoDB; S3 (media, transcripts, assets); S3 Vectors (optional search) | |
| Media | S3 multipart upload, MediaConvert → HLS (MP4 first), CloudFront | |
| Infrastructure | One **AWS CDK** (TypeScript) app; the AgentCore CLI also uses CDK | |

## 2. Hosting: is S3 + CloudFront enough, or Amplify?

**S3 + CloudFront is enough for the web app itself**, because the web app is a client. Its
"server" needs (messaging, camera control, auth, AI) are API and realtime services, not page
rendering:

- Messaging and camera commands go over AppSync Events. Writes, pairing and uploads go to API
  Gateway + Lambda. None of this needs server-side rendering.
- API Gateway sits behind the same CloudFront domain (`/api/*`), so the 30-day HttpOnly cookie
  works without CORS.

The alternatives:

| Option | Verdict |
| --- | --- |
| **Amplify Hosting** | Good if you want deploy-on-git-push and preview branches. It is S3 + CloudFront managed for you, and it can host the same static PWA. Fine to choose for convenience |
| **Amplify Gen 2 full backend** (Cognito, AppSync GraphQL, functions) | Poor fit. Our identity is pairing codes, not Cognito accounts. AppSync Events, AgentCore and Step Functions all need custom CDK inside `backend.ts` anyway. Next.js SSR is documented only up to Next.js 15, without streaming |
| App Runner | Out: "will no longer accept new customers starting on April 30, 2026" |
| Lambda function URLs behind CloudFront | Avoid for POST: the origin-access setup requires clients to send a SHA-256 hash of every body |

Decision proposed: **one CDK app** deploying S3 + CloudFront (PWA), API Gateway + Lambda,
AppSync Events, DynamoDB, Step Functions, and the AgentCore agents. Optionally use Amplify Hosting
for the PWA only, if git-push deploys matter more than having one stack.

## 3. Identity, pairing and realtime

Unchanged from v1, except that realtime now uses AppSync Events.

- **TV:** registers on first launch and stores a revocable device secret in AsyncStorage.
  Vega has no secure keystore for apps; MMKV has encryption, but `recrypt` is not supported on the
  VVD.
- **Pairing:** the TV shows a 10-minute, single-use code and a QR. The phone redeems it and gets a
  **30-day sliding token** in an HttpOnly cookie. Only the token's hash is stored.
- **Realtime:** AppSync Events in Lambda-authorizer mode, with these channels:
  - `/link/<linkId>`: thread messages and receipts
  - `/tv/<deviceId>`: panel cards, media status and gesture commands
  - `/phone/<seatId>`: per-phone notices

  The phone gets a short-lived realtime token from `GET /api/v1/realtime-token`, because page
  scripts cannot read the HttpOnly cookie.
- **Raw WebSocket from the TV, no AWS SDK:**
  `new WebSocket('wss://<id>.appsync-realtime-api.<region>.amazonaws.com/event/realtime', ['aws-appsync-event-ws', 'header-' + base64url(JSON.stringify({host, Authorization}))])`.
  Connections last up to 24 h and the server sends a `ka` keep-alive every 60 s.
  - **Day-1 spike:** Vega's networking doc shows only `new WebSocket(url)`. If subprotocols or
    `btoa` are missing on Vega Hermes, the fallback is API Gateway WebSocket (2 h connections,
    10 min idle timeout, 32 KB frames).
- **Lifecycle:** the TV closes its socket on background and reopens it on foreground, catching up
  over REST with `?after=<cursor>`.

## 4. The agentic system

### 4.1 Contract: agents produce typed widgets, the TV renders them

The AI never sends UI code. Agents emit **widgets**, which are JSON objects of a fixed set of
types. The TV has one native renderer per type, each with hard size limits. This is what makes
"crime → timeline and relationship graph", "box breathing → animation" and "medicines → list" fast,
safe and good-looking on a 1 GB device.

| Widget | When the agents emit it | Payload (bounded) | TV renderer |
| --- | --- | --- | --- |
| `timeline` | Events in order (crime, history, a career) | ≤ 20 events: `when`, `label`, `people[]`, `evidence[]` | Horizontal rail; D-pad walks events |
| `relation_graph` | People and how they connect | ≤ 12 nodes, ≤ 20 edges; **x/y laid out on the server** | SVG lines + focusable node chips |
| `technique` | A practice to follow (box breathing, a stretch) | `phases[{label, seconds, motion}]`, `cycles`, `shape` | **Reanimated 4** animation driven by the spec, with a phase countdown |
| `entity_list` | Named medicines, supplements, protocols, books, studies | ≤ 10 items: `name`, `as_said`, `context`, `evidence[]` | Vega Carousel / list. Health items carry "Mentioned in the episode, not medical advice" |
| `concept` | Jargon or an idea that needs explaining | `term`, ≤ 2 sentences, ≤ 7 nodes | Small SVG concept map |
| `claim` | A checkable claim | `claim`, `speaker`, `context`, `counter?`, `sources[]` | Three-row evidence card; never a verdict score |
| `recap` | "Catch me up" | ≤ 5 lines, each ending in a timestamp | Typed-out mono lines |

Every item carries `evidence: [{t0, t1}]`, the transcript spans it came from. SELECT on an item
seeks the video there.

### 4.2 Offline analysis: a multi-agent pipeline (Step Functions + AgentCore)

Runs when a video is uploaded, or ahead of time for the two demo episodes.

```
S3 upload ─▶ Step Functions
   ├─ MediaConvert (HLS/MP4 renditions)
   ├─ Transcribe (word timestamps, speaker labels)      ┐ in parallel
   └─ Bedrock Data Automation (chapters, speakers, OCR) ┘
        ▼
   Segmenter agent ─────────── topic segments + genre + widget plan per segment
        ▼  Map state, one branch per segment, nearest-to-playhead first
   Segment Orchestrator agent (Strands "agents as tools")
        ├─ Investigator  → timeline, relation_graph   (crime, history)
        ├─ Coach         → technique, entity_list      (health, science, fitness)
        ├─ Explainer     → concept                     (science, tech)
        ├─ Analyst       → claim                       (finance, news; no invented numbers)
        └─ Archivist     → people dossier entries      (all genres)
        ▼
   Verifier ─── JSON-schema check + Guardrails grounding check; one repair attempt, else drop
        ▼
   Episode Aggregator ─── merges people and entities across segments; lays out graphs;
                          builds the moment index (one entry per ~20 s)
        ▼
   DynamoDB + S3 ─── publish `media.ready` / `segment.ready` on /tv/<deviceId>
```

- **Where agents run:** Strands agents (Python) on **AgentCore Runtime**, with AgentCore
  Observability for traces. Step Functions owns retries, the per-segment fan-out and job status, so
  the TV can show `ANALYSING 3/12` and resume after a relaunch.
- **"As soon as the video starts":** for uploads, analysis starts at upload. The Map state handles
  segments near the current playhead first, so the first panel is ready early. Segments not ready
  yet show `ANALYSING THIS PART`.
- **Models:** Sonnet 5.5 for the segmenter and specialists, which are quality-bound and offline;
  Haiku 5.5 for repair and the live path. Mumbai offers only Global inference profiles, so measure
  latency on day 1.

### 4.3 Live: pause-time composer (no agent hops)

When the viewer pauses or opens the panel, the TV calls `POST /api/v1/compose {mediaId, t}`:

1. **Fast card, under ~300 ms (estimate):** a warm Lambda reads the moment index and the widgets
   whose evidence overlaps **[t − 15 s, t + 4 s]**, picks a layout (at most three widgets) and returns
   at once. The `t + 4 s` look-ahead is possible because the whole transcript is already known.
2. **Refined card, about 1.5–2.5 s (estimate):** the same Lambda makes one streaming
   Claude Haiku 5.5 call, with the prompt and episode assets cached. The input is that 19-second
   transcript window plus the candidate widgets. The output is a one-line "right now" caption, which
   items to highlight, and occasionally a new small widget, which is grounding-checked. The result is
   published on `/tv/<deviceId>` and the panel updates in place.
3. **Ask (follow-up, slower):** questions from the phone ("who is this person?") go to an **Ask
   agent** on AgentCore with **AgentCore Memory**, keyed by Link and viewing session. The answer
   appears in the panel and in the thread, labelled `AI CO-VIEWER`.

Caching: fast cards are cached per `(mediaId, 5-second bucket)`, so the demo path does not depend
on model latency.

### 4.4 TimedMetadata: insights appear in sync without polling

On play, the TV fetches the moment index (small: about 100 cues for an hour). It adds one `VTTCue`
per moment to a `metadata` TextTrack on the W3C media element. Cue `enter` events light a notch on
the SeekBar and a small `INSIGHT` chip, with no `timeupdate` polling or re-render storms. Whether
metadata tracks work on the VVD is *unverified*: the caption docs list "Text track doesn't work on
Simulator". The fallback is a throttled `timeupdate` check.

### 4.5 Guardrails for the agents

- Inputs are only the transcript, BDA output and explicitly sourced documents. Superseded:
  [coviewer-plan.md](coviewer-plan.md) adds web search for fact checks and dossiers, offline only.
- Health content is extraction, not advice: "mentioned at 12:41 as …", plus the disclaimer.
- Numbers are never generated. A chart widget exists only with a cited data source, and it is out of
  hackathon scope.
- The TV validates every widget again before rendering (schema, lengths, enum values) and drops
  invalid ones.

## 5. Phone web app functions

| Function | How |
| --- | --- |
| Pair once, 30 days | `/p/<code>` → redeem → HttpOnly cookie; later visits open the thread directly |
| Thread (iMessage-style) | REST to send; AppSync `/link/<id>` to receive; states `SENT → ON TV → WATCHED` |
| Share a link or video | Link → server classifies it: direct media is processed, platform pages become cards only. Upload → presigned S3 multipart |
| Camera control | MediaPipe gesture model in the browser; commands such as `{"cmd":"pause"}` published to `/tv/<deviceId>`; nothing visual leaves the phone. Requires HTTPS |
| Voice questions (later) | The phone's microphone: Vega has **no app-level speech-to-text** on the TV (Amazon staff confirmation, see notes). Audio → Transcribe → Ask agent |

## 6. Fire TV / Vega platform features we use

Chosen because they need **no catalog or partner approval**, they work for a sideloaded app, and
they show the platform rather than custom code. Package versions are for RN 0.83 (see
`docs/reference/vega/`).

| Where | Platform feature | Package | Why it scores |
| --- | --- | --- | --- |
| Player | **W3C media `VideoPlayer`** (URL mode, MP4 first, HLS later) | `@amazon-devices/react-native-w3cmedia ~2.3.2` | Vega's standard media pipeline |
| Player | **TimedMetadata** `VTTCue` metadata track | same | AI moments synced by the platform's own events |
| Player | **Vega UI SeekBar** with break markers + `segmentColors` | `@amazon-devices/kepler-ui-components ~3.2.0` | AI chapters drawn on the native scrubber |
| Player | **Vega Media Controls** (remote transport; Alexa voice transport *unverified* for sideloaded apps) | `@amazon-devices/kepler-media-controls ~1.0.25` | Play/Pause opens the co-viewer |
| Player | Captions from our Transcribe VTT, honouring system caption settings | w3cmedia + `kepler-a11y-settings-interface-turbo` | Accessibility done the Vega way |
| Panel | **Reanimated 4 + Worklets** technique animations | `react-native-reanimated ~4.0.0` + `react-native-worklets ~1.0.0` | Smooth native-thread animation on 1 GB hardware |
| Panel | SVG relationship graphs and concept maps | `@amazon-devices/react-native-svg ~3.0.0` (installed) | |
| Home / panel | **Vega Carousel v2** for rows and entity lists | `@amazon-devices/vega-carousel ~1.0.0` | Amazon's high-performance list |
| App state | **Legend State / Legend List** (Amazon-recommended for RN 0.83) | `@legendapp/state`, `@legendapp/list` | No re-render storms on `timeupdate` |
| Phone → TV | **System toast** (`useToastKepler`) with an action: "Ari shared a video — open" | built in; notification privilege | The shared thread reaches the TV natively |
| Deep links | `Linking` + manifest `[[message]]`: open an item at a timestamp | built in | Shareable "watch from 41:00" |
| Launch | Native splash (`SplashScreenManager`) + `useReportFullyDrawn` TTFD | built in + `kepler-performance-api ~0.1.4` | A measured performance story (numbers need hardware) |
| Voice (stretch) | **On-screen voice navigation** ("Alexa, select Timeline") | built in; manifest category `com.amazon.category.kva` | Voice + D-pad + visuals together, a judging example. *Unverified on VVD* |
| Home screen (stretch) | Recommendation Manager tile: "AI breakdown ready" | `@amazon-devices/recommendation-manager 2.0.10` | *Unverified* whether it renders without approval |
| Accessibility | VoiceView: `aria-live` on panel updates, orientation text | built in | |
| Dev story | ADBT MCP, Vega Studio, KPI Visualizer | tooling | The submission asks for tool feedback |

Skipped, with reasons:

- **Content Launcher, Content Personalization, Account Login:** need catalog ingestion, a partner
  ID or an allowlist, and cannot be demoed.
- **Matter Casting and DIAL:** the phone side needs a native SDK or UDP, which a web app cannot do.
- **Login with Amazon:** not supported on the VVD.
- **Headless JS playback service:** crashes on RN 0.83 (`ReferenceError: Property '__DEV_RUNTIME__' doesn't exist`); the workaround flag must not ship.

Platform gotchas to respect:

- Reanimated 4 requires worklets, or the app crashes at launch.
- Never mix native-driver and JS-driver `Animated` values on one view (fatal SIGABRT).
- `setNativeProps` crashes on RN 0.83.
- `expo-image` fails to auto-link on RN 0.83.
- Release media on background.
- Pin versions to the RN 0.83 `vega-video-sample` set.

## 7. TV memory and performance plan

- One `VideoPlayer` instance at a time, released on background; position kept for resume.
- The panel mounts at most three widgets. Graphs are capped at 12 nodes. Lists are virtualised.
- Widgets arrive laid out (graph x/y from the server), so the TV does no layout computation beyond
  flexbox.
- Playhead state lives in Legend State observables; only the SeekBar and cue chip subscribe.
- All layout uses the 960 × 540 dp canvas ([tv-experience.md](tv-experience.md)).
- Measured, not assumed: PSS, TTFF/TTFD on VVD now and hardware if available.

## 8. Data model additions (DynamoDB)

| Entity | PK | SK | Notes |
| --- | --- | --- | --- |
| Media | `MEDIA#<id>` | `META` | status, HLS/MP4 keys, duration, genre mix |
| Segment | `MEDIA#<id>` | `SEG#<startMs>` | endMs, genre, title, widget plan |
| Widget | `MEDIA#<id>` | `W#<startMs>#<type>#<n>` | validated JSON ≤ 16 KB, evidence spans |
| Moment | `MEDIA#<id>` | `MOM#<tMs>` | moment-index entry → widget IDs + one-line caption |
| Job | `MEDIA#<id>` | `JOB#<jobId>` | Step Functions execution ARN, step, status |
| Compose cache | `MEDIA#<id>` | `CC#<bucket5s>` | fast card, `ttl` |

Devices, links, seats, tokens, codes and messages are as in v1.

## 9. Day-1 spikes (go/no-go)

1. `VideoPlayer` plays an MP4 from CloudFront on the VVD. Reports differ (one developer got
   `MEDIA_ERR_SRC_NOT_SUPPORTED`).
2. Metadata `VTTCue` events fire on the VVD.
3. A raw WebSocket with subprotocols connects to AppSync Events from the TV (`btoa` present?).
4. Bedrock Haiku 5.5 time to first token from ap-south-1 (Global profile): the live-path latency.
5. A Strands agent deploys to AgentCore Runtime in the chosen region.

## 10. Build tiers for the deadline

| Tier | Contents | Target |
| --- | --- | --- |
| **A: the demo** | Two demo episodes analysed by the real pipeline ahead of time (labelled preprocessed). Player with SeekBar markers, cues and Media Controls keys. AI panel with `timeline` + `relation_graph`, `technique` and `entity_list`. Live composer (fast + refined). Pairing with the 30-day token. Thread text/links → TV toast + Shared row. Fixed 960 × 540 layout | 22 Oct night |
| **B: end to end** | Phone upload → full pipeline → playable with panel. Camera gestures: pause/resume, open panel | 23 Oct |
| **C: stretch** | Voice navigation (kva), Ask agent from the phone, Recommendation tile, `concept` / `claim` widgets | If time |
| Submission | Demo video on the VVD, description, AWS usage write-up, tool feedback, friction log | 23 Oct evening, before 00:30 IST on the 24th |

## 11. Open decisions

1. Hosting: one CDK stack (proposed), or Amplify Hosting for the PWA?
2. Region: ap-south-1 (Global inference profiles) vs us-east-1 (wider model choice). Decide after
   spike 4.
3. Which two podcast episodes (with licence) for the demo. One crime-heavy and one health/science
   episode would show the widget range best.
4. Shared YouTube/Spotify links stay card-only (proposed).
