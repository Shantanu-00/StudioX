# Backend build plan: phone web app to TV, end to end

> Trimmed on 22 Oct: [../ARCHITECTURE.md](../ARCHITECTURE.md) is the canonical, lean design (2 runtimes, no MediaConvert, no chunking). Use the phases here only as a checklist where they still apply.

Status: **plan**, 22 October 2026, 00:10 IST. About 48 hours to the deadline (24 Oct, 00:30 IST).
The design is in [system-architecture.md](../product/system-architecture.md) and
[aws-backend.md](../product/aws-backend.md). This file is the order of work, the files, and the test
that closes each step. Update `submission/aws-builder-log.md` as each step goes live (see
AGENTS.md).

## 0. Starting point (checked 22 Oct, 00:04 IST)

| Tool | State | Needed for |
| --- | --- | --- |
| Node 22.22.1, npm 9.2.0 | Present | CDK (TypeScript), AgentCore CLI, the web app |
| Python 3.14.4 | Present, but **no pip/uv** | Lambdas and agents. AgentCore Runtime's supported Python versions are *unverified*; plan on **3.13** via uv |
| ffmpeg 8.0.1, jq | Present | Local media tests, the fragmented MP4 fallback |
| `aws` CLI v2 | **Missing** | Everything |
| AWS CDK | **Missing** | Infrastructure |
| AgentCore CLI (`@aws/agentcore`) | **Missing** | Agents, Gateway, Memory |
| uv | **Missing** | Python 3.13 and dependencies |
| Docker | **Missing, and not required** | The design avoids it: Lambdas use only the runtime's boto3 and the standard library, and AgentCore deploys use CodeZip |
| AWS credentials | **Not configured** | — |
| RAM | 7 GiB, about 780 MiB available | Do not run the VVD during `cdk deploy` or `agentcore deploy` |

## 1. Decisions that fix the shape

- **Region:** us-east-1. **Infrastructure:** CDK in TypeScript. **Lambdas:** Python 3.13, boto3 and
  the standard library only (no bundling, no Docker). **Agents:** Python 3.13 + Strands on AgentCore
  (CodeZip).
- **One domain:** CloudFront serves the phone app (`/link/*`), the Lens Lab (`/lab/*`), static data
  (`/packages /images /media /share`) and proxies `/v1/*` to API Gateway, uncached and with cookies
  forwarded.
- **The phone app is plain HTML, CSS and JS** (like `companion/public/` today), with no framework and
  no build step. It is deployed by CDK `BucketDeployment`.
- **Auth:**
  - **TV:** registers once (`POST /v1/devices`) and keeps a device secret.
  - **Phone:** redeems a 10-minute pairing code and receives an **HttpOnly, Secure, SameSite=Strict
    cookie**: a 30-day sliding token, stored only as a hash.
  - Live AI routes also need the **access code** and the `live` flag.
- **The schema has one source:** Pydantic models in `backend/schema/` export JSON Schema files. The
  same fixture files are checked by pytest (Pydantic) and by Jest (the TV validator), so both sides
  agree without new dependencies.
- **The local `companion/` server is retired** once the phone app works on AWS. Keep it until then.

## 2. Repository layout (new)

```
backend/
  infra/                 CDK app (TypeScript): bin/studiox.ts, lib/{storage,api,media,analysis,observability}-stack.ts
  functions/             Python 3.13 Lambdas: api/, media_events/, normalise/, verify/, package/,
                         knowledge_tools/, episode_tools/, invoke_agent/
  agents/                AgentCore CLI project: analyst/, factcheck/, studio/, coviewer/, shared/ (models, prompts, hooks)
  schema/                Pydantic source + exported JSON Schema + shared fixtures
  eval/                  datasets, runners, results.md
  scripts/               seed_demo.py, ingest_transcript.py, export_demo_bundle.py, smoke.sh
  README.md              deploy and teardown
webapp/
  link/                  phone app: index.html, app.js, style.css, manifest.webmanifest, sw.js
  lab/                   Lens Lab: index.html, lab.js
```

## 3. Phases

Each phase ends with a **test that must pass** before the next phase starts. Times are estimates
for one person.

### P0 Setup (about 1.5 h). The owner does the credential steps

1. Install the tools without sudo:
   - **AWS CLI v2:** the official zip into `~/.local/aws-cli`.
   - **uv:** its installer. Then `uv python install 3.13`.
   - **npm global prefix:** `npm config set prefix ~/.local`.
   - `npm i -g aws-cdk @aws/agentcore`.

   Every download is logged in the friction log if it fails.
2. **Credentials (owner):** `! aws configure sso`, or `! aws configure` with an IAM user that has
   admin rights in a dedicated account. Then check with `aws sts get-caller-identity`.
3. **Bedrock model access** in us-east-1: confirm or request Claude Sonnet 5.5, Claude Haiku 5.5 and
   Nova 2 Lite. Anthropic models may need the one-time use-case form. Test each with one `converse`
   call, and record the exact model and inference-profile IDs in the log.
4. `cdk bootstrap aws://<account>/us-east-1`.
5. Turn on **CloudWatch Transaction Search** once (needed for AgentCore traces).
6. Create an **AWS Budget** with an email alert at a small threshold the owner chooses.

**Test:** `aws sts get-caller-identity` works; three `converse` calls return text; `cdk doctor` is
clean.

### P1 Foundation: storage + API (about 2.5 h)

**StorageStack:**

- **S3 bucket `studiox-<acct>`** with prefixes `uploads/`, `media/`, `transcripts/`,
  `packages/`, `images/`, `share/`, `web/`. Block public access, CORS for multipart `PUT` from
  the CloudFront domain, and a lifecycle rule that aborts incomplete multipart uploads after 1 day.
- **CloudFront** with OAC to S3. Behaviours:
  - `/v1/*` → API Gateway, no cache, all viewer headers and cookies forwarded;
  - `/link/*` and `/lab/*` → `web/`;
  - static prefixes cached.
- **DynamoDB `studiox`** (on demand, TTL attribute `ttl`).

**ApiStack:** an HTTP API with one Python Lambda `api` and routes:

| Caller | Route | Does |
| --- | --- | --- |
| TV | `POST /v1/devices` | Register: returns `deviceId` and `deviceSecret` (only the hash is stored) |
| TV | `POST /v1/pairings` | A 10-minute single-use code + QR URL `https://<cf>/link/p/<code>` |
| Phone | `POST /v1/pairings/{code}/redeem {phoneName}` | Links the phone; sets the 30-day cookie; returns `linkId` |
| Phone | `GET /v1/me` | Linked TV, phone name; slides the cookie |
| Both | `GET /v1/links/{id}/messages?after=<cursor>` | The thread (newest last) |
| Both | `POST /v1/links/{id}/messages {kind, text, mediaId?, t?}` | `text`, `question`; the TV posts `share` |
| Phone | `POST /v1/uploads {name, size, type}` | Creates `MEDIA#`, starts the multipart upload, returns the first presigned part URLs |
| Phone | `POST /v1/uploads/{id}/parts {partNumbers}` | More presigned URLs (resume) |
| Phone | `POST /v1/uploads/{id}/complete {parts[{n, etag}]}` | `CompleteMultipartUpload`; thread message "Preparing" |
| Both | `GET /v1/media/{id}` | Status, `playable`, analysis horizon, package URL |
| Phone | `DELETE /v1/links/{id}/phones/me` | Unlink |

**Data:**

| PK | SK | Item |
| --- | --- | --- |
| `DEVICE#<id>` | `META` | Secret hash, created |
| `PAIR#<code>` | `META` | `deviceId`, `ttl` (10 min) |
| `TOKEN#<sha256>` | `META` | `linkId`, `phoneId`, `ttl` (30 days, slid on use) |
| `LINK#<id>` | `META` | `deviceId`, phones |
| `LINK#<id>` | `MSG#<ulid>` | `from` (`tv`, `phone:<id>`, `ai`, `system`), `kind`, `body`, `status` |
| `MEDIA#<id>` | `META` | Owner link, status (`UPLOADING`, `PREPARING`, `PLAYABLE`, `ANALYSING`, `READY`, `FAILED`), keys |

**Test (`scripts/smoke.sh`):**

1. Register a device with curl.
2. Get a pairing code.
3. Redeem it, which returns the cookie.
4. Post a message from the "phone".
5. Read it from the "TV".
6. Run the upload flow for a 30 MB file in 3 parts.
7. Check the object in S3 and `MEDIA#` = `PREPARING`.

### P2 The phone app "Link" (about 3.5 h)

Screens: plain DOM, the StudioX look (black, mono status lines, one crimson accent), mobile-first.

| Screen | Behaviour |
| --- | --- |
| **Pair** (`/link/p/<code>`) | Name this phone → redeem → thread. Opening `/link/` with a valid cookie goes straight to the thread |
| **Thread** | iMessage-style. Phone bubbles on the right; TV, AI and system messages on the left; mono timestamps. Polls every 2 s while visible, 15 s when hidden, stops when closed |
| **Composer** | A text field: a plain message, or **Ask about what's playing**, which sends `kind: question` with the current `mediaId` and `t` the TV reported. Until P6, Ask answers `AI CO-VIEWER OFFLINE` |
| **+ menu → Upload video** | Pick a file → `POST /v1/uploads` → 16 MB parts, 4 in parallel, retry each part up to 3 times, resume from the parts already done, progress bar. Then `complete`. The thread shows `UPLOADING 64%` → `PREPARING` → `READY TO WATCH · ANALYSING 3/17` |
| **Shared item cards** | Items sent from the TV: protocol checklist (tick boxes stored locally), name list with sources, person card, **`.ics` download** for a routine reminder, links |
| **Settings** | Phone name, linked TV, Unlink |

PWA: `manifest.webmanifest` + a minimal `sw.js` that caches the shell only (never API responses).

**Test:**

1. A real phone opens the QR URL from a curl-created pairing.
2. It pairs, survives a reload (cookie), and sends a message the "TV" reads with curl.
3. It uploads a 37 s clip and a ~200 MB file with visible progress, survives one interrupted part,
   and sees the status messages.

### P3 Media preparation (about 2 h)

**MediaStack:**

- **EventBridge** rule on S3 `Object Created` under `uploads/` → **Step Functions `MediaPrep`**.
- Steps:
  1. **MediaConvert** `createJob.sync`: H.264/AAC MP4 with faststart, plus a fragmented MP4 for the
     MSE fallback, into `media/<id>/`. Then `MEDIA#` `playable=true`, plus a thread message.
  2. **Transcribe** `StartTranscriptionJob` with speaker labels and the custom vocabulary
     `studiox-v1` (supplement and drug names from the test transcript). Then a Wait/Get poll loop.
  3. **`normalise`** Lambda: Transcribe JSON → `transcripts/<id>.json` (words with `t0`/`t1`,
     speakers, sentences).
  4. Start `EpisodeAnalysis`.
- **Supplied transcripts:** `scripts/ingest_transcript.py` parses the `text / m:ss` format of the
  test transcript into the same `transcripts/<id>.json` and starts `EpisodeAnalysis`. It skips
  MediaConvert and Transcribe. It runs locally; the source file never leaves the machine except as
  normalised segments in our own bucket.
- Whole-file Transcribe first. 5-minute chunking (ffmpeg layer) only if time remains in P8.

**Test:**

- Upload `science-ep42.mp4` from the phone. Measure the time to `playable` and to the transcript.
- Upload an iPhone HEVC clip; the result plays in a desktop browser as H.264.
- Run the test transcript through `ingest_transcript.py`.

Write all three timings to the log.

### P4 Agents and tools (about 9 h). The core of the AWS Builder entry

Create the AgentCore project with `agentcore create`, then `agentcore add agent` × 4,
`agentcore add gateway` and `agentcore add memory`.

1. **Shared code (`agents/shared/`):**
   - Pydantic models: candidates, cards, chart, technique, the A2UI-shaped messages.
   - Prompts per lens.
   - Hooks: `SpoilerGuard`, `CitationGuard`, `BudgetGuard`, `InjectionGuard`.
   - Middleware: the search cache and the throttle retry.
   - Steering: the design rules for the Showrunner.
   - Verdict rules v1 as plain Python.
   - `pytest` for every deterministic piece.
2. **Gateway:**
   - **Web Search Tool** connector (`connectorId: "web-search"`, 1.2.0+ for filters).
   - Lambda target **`knowledge_tools`**: `wikidata_search`, `wikidata_facts`,
     `wikipedia_summary`, `commons_image`. The last one applies the licence filter and copies the
     320 px image to `images/`.
   - Lambda target **`episode_tools`**: `transcript_window`, `transcript_search(before_t)`,
     `get_cards`.
3. **`analyst`:** Segmenter, the five lenses as tools of the orchestrator, Continuity. Parallel
   tool executor. A fresh `Agent` per call.
4. **`factcheck`:** a Graph: query → search → stance → (refine ≤ 2) → verdict rules.
5. **`studio`:** Dossier Builder, **Data Analyst with Code Interpreter**, Motion Director,
   Showrunner (structured A2UI-shaped output + steering).
6. **`invoke_agent`** Lambda: `InvokeAgentRuntime` with one attempt and a 900 s read timeout.

**Test:**

- Each runtime returns schema-valid output for one segment of the test transcript and one demo clip.
- A planted "ignore your instructions" line changes nothing.
- A fabricated URL is removed by `CitationGuard`.
- Traces appear in CloudWatch GenAI observability (screenshot).

Log the tokens and latency per lens.

### P5 Analysis pipeline and packages (about 4.5 h)

1. **Step Functions `EpisodeAnalysis`:** Segment → Map(segments, max 4) [lenses → factcheck +
   studio specialists in parallel] → **`verify`** Lambda (schemas, Guardrails `ApplyGuardrail`
   grounding → `confidence`, keep/drop with reason → DynamoDB rejection log) → Continuity →
   Showrunner → **`package`** Lambda (`packages/<id>/v<n>.json`, horizon, thread "READY").
2. **Guardrail** (CDK): contextual grounding at 0.7; prompt-attack filter.
3. `scripts/seed_demo.py` runs both demo clips. `export_demo_bundle.py` writes their packages into
   the TV app for demo mode.

**Test:**

- Both clips have packages that pass the TV validator in Jest.
- The test transcript produces a funnel table (sentences → candidates → kept → shown, per lens).
- The Step Functions graph screenshot is all green.

### P6 Live co-viewer (about 3.5 h)

1. **`coviewer`** runtime:
   - Session per viewing.
   - `refine`: novelty → at most one card, cached per 5 s bucket.
   - `ask`: transcript before `t`, cards, search, Nova grounding fallback.
   - **Memory:** user preference + summary strategies; lens opens as USER turns.
2. API routes:
   - `POST /v1/sessions`, `POST /v1/refine`, `POST /v1/ask`, `POST /v1/share`, behind the access
     code, the `live` flag, the daily `QUOTA` and throttling.
   - Phone `question` messages are routed to `ask`, and the answer is posted to the thread as `ai`.
3. Precompute the answers to every suggested question at package time, so demo mode needs no
   live call.

**Test:**

- A pause on the VVD returns a refined card.
- A phone question is answered in the thread and on the TV.
- Setting `live=off` makes both return `LIVE_OFF` within a minute.
- Measure p50/p95 and the cold start.

### P7 Evidence (about 4 h)

1. **Lens Lab** (`webapp/lab/` + `POST /v1/lab`): pass-A lenses on pasted text (≤ 1,500
   characters). It shows the cards plus the rejected candidates with reasons, the models and the
   latency. Daily cap; nothing stored.
2. **Evaluations** (`backend/eval/`), each run three times:
   - claim verdicts (no wrong `DEBUNKED`);
   - spoilers (red team; 0 leaks);
   - citations (100%);
   - injection (0 behaviour changes).

   Use the Strands Evals SDK, and AgentCore Evaluations online on co-viewer traces if the setup fits.
3. **CloudWatch dashboard** (EMF metrics per lens: latency, tokens, keep/drop) and a 5xx alarm.
4. The screenshots listed in the log.

### P8 Stretch, then freeze

- **Stretch, in order:**
  1. 5-minute chunked, progressive analysis (ffmpeg layer, package versions, horizon on the TV);
  2. AgentCore Policy on the co-viewer;
  3. the A2UI renderer as an open-source repository (default: skip).
- **Freeze at 23 Oct 16:00.** Record the demo with `live=on`. Then set `live=off`, or delete the
  agent runtimes. Keep S3 + CloudFront until 21 Nov 01:30 IST.

## 4. Totals and what has to give

| Phase | Hours |
| --- | --- |
| P0–P3 (setup, foundation, phone app, media) | about 9.5 |
| P4–P6 (agents, pipeline, live) | about 17 |
| P7 (evidence) | about 4 |
| **Cloud total** | **about 30** |

The TV track (player, Stage rail, catalog renderer, rigs, charts) has to run **in parallel**. One
person cannot do both inside 48 hours.

If the cloud track slips, cut in this order:

1. Chunked analysis (P8).
2. Lens Lab.
3. The phone upload → MediaConvert path (keep the phone thread, Ask and send to phone).
4. Code Interpreter charts (fall back to transcript-only numbers).
5. AgentCore Evaluations (keep the Strands Evals suites).

Never cut:

- the agents producing the two demo packages;
- the guards;
- the claim and spoiler evaluations;
- one live refine and one Ask in the video.

## 5. Risks to spike first

| Risk | Spike (inside its phase) | Fallback |
| --- | --- | --- |
| Model access for Claude 5.5 in us-east-1 | P0 step 3 | Another available Claude or Nova model; record the IDs |
| AgentCore Python runtime version | P4: `agentcore create` with 3.13 | 3.12 |
| Gateway auth from a runtime | P4 step 2 | Whatever `agentcore add gateway` configures; record it |
| MediaConvert output plays on the VVD | P3 + TV gate G1 | The fragmented MP4 through MSE (an ffmpeg command is already in the media notes) |
| Low RAM while deploying | Every phase | Stop the VVD before `cdk deploy` / `agentcore deploy` |
