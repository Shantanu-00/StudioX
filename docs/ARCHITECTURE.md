# StudioX architecture

The one-page reference for the deadline build (22 Oct 2026). Notes in `docs/product/` are
background; where they disagree, this file and [`backend/CONTRACTS.md`](../backend/CONTRACTS.md)
win.

## The idea in one line

A Fire TV co-viewer for spoken-word video. **AWS Step Functions** runs a pipeline of **Strands
agents on Amazon Bedrock AgentCore**. They turn an episode into timed, sourced cards (fact checks,
people, compounds, timelines, protocols, breathing animations). A native **Vega OS** app draws them
beside the video, and the viewer never has to pause.

**Scope: the Know layer.** The pipeline produces one document, the **episode package**, which is
the `EpisodeAnalysis` shape the TV already renders (`src/analysis/schema.ts`) plus a few pipeline
fields. The exact format is in [CONTRACTS.md section 3](../backend/CONTRACTS.md). Playables are
parked, behind a flag.

## Diagram

```
 PHONE (web app "Link")              AWS (us-east-1)                                 FIRE TV (Vega OS app)
 pair, thread, ask, upload --HTTPS--> CloudFront --> API Gateway --> Lambda "api" <--HTTPS-- play, rail, pause
                                          |               |                              |
                                          |          DynamoDB (links, messages,          |
                                          |          media, jobs, quota)                 |
                                          v                                              |
        upload --------------------> S3 --EventBridge--> STEP FUNCTIONS "StudioX-EpisodeAnalysis"
                                                          Has transcript? -> Transcribe speech
                                                          Normalise transcript
                                                          Eligibility gate -> (Not a fit)
                                                          Find topics        --+  AgentCore Runtime
                                                          Analyse segments   --+  "analyst" (Strands)
                                                          Verify and score   --+  Web Search Tool,
                                                          Plan the screen    --+  Guardrails
                                                          Precompute answers --+
                                                          Publish package --> S3 packages/<id>/latest.json --> CloudFront --> TV
                                                                                         ask / refine --> Lambda --> AgentCore Runtime "coviewer"
```

## Pipeline (Step Functions state names)

| State | What happens |
| --- | --- |
| `Has transcript?` | Choice. A supplied transcript skips speech recognition |
| `Transcribe speech` | Amazon Transcribe, word timestamps and speakers |
| `Normalise transcript` | Writes `transcripts/<id>.json` (CONTRACTS section 2) |
| `Eligibility gate` / `Not a fit` | Speech under 30% of the duration, or under 40 words a minute, ends in `NOT_A_FIT` |
| `Find topics` | `analyst` runtime, mode `segment`: segments, speakers, genre |
| `Analyse segments` | Map over segments, `analyst` mode `lenses`: candidate widgets (claims, people, numbers, motion) |
| `Verify and score` | Fact-check graph with the Web Search Tool; verdict rule table; Guardrails grounding score |
| `Plan the screen` | `analyst` mode `curate`: moments, chosen widgets, suggested questions |
| `Precompute answers` | `analyst` mode `answer` for each suggested question, for demo mode |
| `Publish package` | Validates every widget, writes `packages/<id>/v<n>.json` and `latest.json`, sets `READY` |

## The pieces

| Piece | AWS service | Job |
| --- | --- | --- |
| Phone web app | S3 + CloudFront | Pair with the TV, chat thread, ask about what is playing, upload a video |
| API | API Gateway (HTTP) + one Lambda (Python) | Pairing, thread, uploads, media status, live calls |
| Data | DynamoDB (one table), S3 | Links, messages, media, jobs; media, transcripts, packages |
| **Pipeline** | **Step Functions** (started by EventBridge on upload) | The visible spine: each state is one step of the analysis |
| Speech | Amazon Transcribe | Word timestamps and speakers |
| **Agents** | **Strands Agents** on **AgentCore Runtime**, 2 runtimes | `analyst` (the pipeline's thinking steps) and `coviewer` (live refine and Ask) |
| Search | **AgentCore Gateway Web Search Tool** | Fact-check sources. If the tool is unavailable, a Nova grounded answer is the fallback, and its citations are still checked |
| Grounding | **Bedrock Guardrails** | Contextual grounding score per card; screens viewer questions |
| Models | **Bedrock**: Claude Sonnet 5.5, Claude Haiku 5.5, Nova 2 Lite | Sonnet for judgement, Haiku for speed, Nova for grounded quick answers |
| Evidence | **AgentCore Observability** (CloudWatch) | A trace of every agent and tool call |
| Infrastructure | CDK (TypeScript) | Everything as code |

**Rules carried by code, not prompts:**

- verdict labels come from a rule table over the sources' stances;
- the co-viewer never reads transcript past the playhead (no spoilers);
- every cited URL must be one a search tool actually returned;
- searches and tool calls are bounded per call;
- every widget passes the TV's `validateWidget`, or it is dropped and logged under `rejected`.

**The TV renders data, never code.** Agents emit widgets from a fixed catalog. The app draws them
with native Vega components.

## Demo mode and live mode

| | Demo mode | Live mode |
| --- | --- | --- |
| Source of cards | Bundled package JSON (`src/analysis/packages/`), or `packages/<id>/latest.json` over HTTPS | Same, plus `coviewer` calls |
| Ask | Precomputed `answers` in the package | `POST /v1/ask` to the `coviewer` runtime |
| Network needed | No (bundled) | Yes |
| Guards | None needed | SSM `/studiox/live` switch, daily quota, shared access code |

The bundled files are generated by `backend/scripts/seed_demo.sh`. The evaluation suite is in
`backend/eval/`.

## Demo view: how the AWS part shows in 20 seconds of video

1. The phone uploads a clip. Cut to the **Step Functions console**: the graph lights up state by
   state, from `Transcribe speech` to `Publish package`.
2. Cut to one **AgentCore Observability trace**: the analyst calling the fact-check graph, the Web
   Search Tool returning sources, Guardrails scoring.
3. Back to the TV: the cards from that run appear beside the video.

## Status

Checked against the repo on 22 Oct 2026. "Built" means code exists and unit tests or a synth pass;
it does not mean deployed unless it says so.

| Phase | What | Status |
| --- | --- | --- |
| P0 | Tools and credentials | Done for the tools (AWS CLI, uv, Python 3.13). Account access works for Bedrock. The restricted profile cannot read CloudFormation or SSM, so deploy state cannot be read from here |
| P1 | Storage and API (`backend/infra`, `backend/functions/api`) | Built. 11 API unit tests pass. Deployment not verified from this profile |
| P2 | Phone web app (`webapp/link`) | Built (11 files). Not checked on a phone from here |
| P3 | Media preparation | Encodes exist in `media/tv/` (both clips). Upload to S3 is owner-run: `backend/scripts/upload_media.sh`. Not yet confirmed done |
| P4 | Agents and tools (`backend/agents`) | In progress (another builder). See `backend/CONTRACTS.md` |
| P5 | Analysis pipeline and packages | In progress. Transcripts and seed/eval scripts are built; packages appear in `src/analysis/packages/` once produced |
| P6 | Live co-viewer | Pending |

Playables (`src/playables/`) are parked behind a flag.

## API contract v1

Base: `https://<cloudfront-domain>/v1`. JSON in and out. Errors: `{"error": {"code", "message"}}`
with a 4xx/5xx status.

**Auth:**

- **TV:** `Authorization: Device <deviceId>:<deviceSecret>`.
- **Phone:** cookie `sx` (HttpOnly, Secure, SameSite=Strict, 30 days, renewed on use), set by
  redeem.
- The phone app is served from the same domain, so the cookie is sent automatically.

| Method & path | Caller | Request | Response |
| --- | --- | --- | --- |
| `POST /devices` | TV | `{name}` | `{deviceId, deviceSecret}` |
| `POST /pairings` | TV | — | `{code, url, expiresAt}`. `url` = `https://<domain>/link/p/<code>`; the code is 6 characters and expires after 10 minutes |
| `GET /pairings/{code}` | TV | — | `{status: "waiting" \| "linked" \| "expired", linkId?, phoneName?}` |
| `POST /pairings/{code}/redeem` | Phone | `{phoneName}` | Sets cookie `sx`; `{linkId, tvName}` |
| `GET /me` | Phone | — | `{linkId, phoneName, tvName}`, or 401 when not paired |
| `DELETE /me` | Phone | — | 204; unlinks this phone |
| `GET /links/{linkId}/messages?after=<messageId>` | Both | — | `{messages: Message[], cursor}`, oldest first, at most 50 |
| `POST /links/{linkId}/messages` | Both | `{kind: "text" \| "question", text}`; the TV may also send `{kind: "share", card}` | `Message` |
| `PUT /links/{linkId}/now` | TV | `{mediaId, title, t, playing}` | 204 |
| `GET /links/{linkId}/now` | Phone | — | `{mediaId, title, t, playing, updatedAt}`, or `{}` |
| `POST /uploads` | Phone | `{name, size, type}` | `{mediaId, partSize, parts: [{n, url}]}`. Presigned S3 `PUT` URLs for the first 4 parts |
| `POST /uploads/{mediaId}/parts` | Phone | `{numbers: [n]}` | `{parts: [{n, url}]}` |
| `POST /uploads/{mediaId}/complete` | Phone | `{parts: [{n, etag}]}` | `{mediaId, status: "PROCESSING"}` |
| `GET /media/{mediaId}` | Both | — | `{mediaId, title, status, progress?, playable, packageUrl?}` |

- **Media status:** `UPLOADING` → `PROCESSING` → `ANALYSING` → `READY`, or `FAILED`.
- **`partSize`** is 16 MiB.
- The S3 CORS rule exposes the **`ETag`** header, so the phone can read each part's ETag.

**Message:**

```json
{"id": "01J...", "at": "2026-10-22T10:15:02Z",
 "from": {"kind": "phone" | "tv" | "ai" | "system", "name": "Ari's phone"},
 "kind": "text" | "question" | "answer" | "share" | "status",
 "text": "…",
 "mediaId": "…", "t": 734.2,
 "card": {"type": "checklist" | "list" | "person" | "link" | "reminder", "title": "…", "items": [...], "sources": [{"title", "url"}]},
 "status": {"mediaId": "…", "state": "PROCESSING", "progress": 0.4}}
```

- A `question` from the phone is answered by the `coviewer` agent with an `answer` message (from
  `ai`).
- Upload progress arrives as `status` messages from `system`.

## What is deliberately left out

- MediaConvert. Demo clips are already H.264/AAC; uploads are expected to be H.264.
- Progressive chunked analysis.
- Separate runtimes per specialist.
- AgentCore Policy and Evaluations (the repo has its own small suite instead).
- A2A, Swarm and Interrupts.
- A2UI-shaped surfaces and playable moments.
