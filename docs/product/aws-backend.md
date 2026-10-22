# StudioX AWS backend: design and AWS Builder rubric

Status: **design for review**, 21 October 2026, 21:30 IST; §14 (lessons from winning entries) added 22:15 IST and wins where it conflicts. Nothing is deployed. The region is
**us-east-1**. This document is also the "documented integration" the AWS Builder mini challenge
asks for, and it is updated to match what actually ships. Product context is in
[coviewer-plan.md](coviewer-plan.md). AgentCore facts were checked on docs.aws.amazon.com on
21 Oct. *Unverified* marks anything not yet run by us.

## 1. What the AWS Builder mini challenge requires

From the official rules and the submission form, verbatim:

- **Eligibility:** "Any primary track project that incorporates AWS services (i.e. Amazon Bedrock,
  AgentCore, Strands SDK, Kiro Crew, SageMaker, etc.) with documented integrations."
- **Write-up, or no entry:** "Which AWS services did you incorporate and how? If no
  description/write up provided, you will not be considered for the AWS Builder Mini Challenge."
  The rules add: "Describe which AWS service(s) you used and how, in your Product Feedback answer."
- **Tech Implementation criterion:** "How well is the project built, and how effectively does it
  use the required tech? Does it effectively leverage the required APIs, SDKs, or device
  capabilities for the specified … mini-challenge (AWS Builder …)?"
- **Quality of the Idea for AWS Builder:** "Obvious: single Bedrock call for text generation, S3
  for storage. Creative: multi-service pipeline (Bedrock + AgentCore + Strands), agentic
  architecture with Claude/Kiro for development workflow, agent orchestration patterns."
- **The other criteria,** equally weighted: Design ("complete, coherent product experience") and
  Potential Impact ("could it realistically serve an audience beyond the hackathon?").
- **The prize:** $5,000 + $5,000 AWS credits + a meeting + a feature. A project can win one track
  prize and one mini-challenge prize.

## 2. Rubric

Stage 1 is pass/fail. Stage 2 scores the four criteria. Each row says what a judge looks for, how
StudioX answers it, and the evidence a judge can see without running anything.

### 2.1 Stage 1 gate (must all be true)

| Check | StudioX | Evidence |
| --- | --- | --- |
| A primary-track project | The Fire TV app on Vega | Video on the VVD |
| Incorporates AWS services | 12+ services, each doing real work (§3) | This document, the code |
| Integrations are *documented* | This file, the architecture diagram, `backend/README.md` deploy steps | The repository |
| The write-up field is filled in | §11 template, also inside Feedback Q1 | Devpost form |

### 2.2 Stage 2, scored

| Criterion (rules' words) | "Obvious" we avoid | What a top score needs | How StudioX answers | Evidence for judges |
| --- | --- | --- | --- | --- |
| **Tech implementation**: how well built, how effectively the tech is used | A Lambda wrapping one `InvokeModel` | Several services, each with a real job; production-grade structure (IaC, auth, observability, cost limits); measured results | Step Functions runs the ingest. Strands agents on AgentCore Runtime with Gateway tools, Memory, Guardrails and Observability. CDK for everything. Measured latency, cost and pass rates | CDK code, agent code, Step Functions graph, AgentCore trace, CloudWatch dashboard, metrics table |
| **Quality of idea**: "multi-service pipeline (Bedrock + AgentCore + Strands) … agent orchestration patterns" | Single call for text, S3 for storage | A named orchestration pattern used for a reason; agents that use tools; a reason each service exists | **Agents as tools** (an analyst orchestrating 11 lens agents). A **two-pass map-reduce** over segments. A **curator** that plans the UI. A **live agent** with session-scoped context and long-term memory. Search through a managed MCP connector. The model chosen per job | §4 diagram, §5 lens table, trace screenshot |
| **Quality of idea**: "agentic architecture with Claude/Kiro for development workflow" | — | AI tooling used in building, documented honestly | Claude Code with the Amazon Devices Builder Tools MCP for the Vega app and the CDK/agent code; the log is kept in the repository | A public AI-workflow note in `docs/development/` (to write from the local log), friction log |
| **Design**: complete, coherent | A backend demo with a toy UI | The AI output shapes a polished product loop | The agents output typed widgets that a native Vega UI renders; the instant screen plus live refine keep the remote responsive | The video |
| **Potential impact** | A one-off script | Reusable, scalable, costed | Serverless, pay-per-use; per-episode ingest cost measured; the same pipeline works for any spoken video a publisher owns | Cost table (§9), write-up |
| **Friction log bonus** (up to 10%) | — | Real, specific AWS friction too | AWS entries in the friction log (title-only doc pages, the web search tool listed under Gateway connectors) | Friction log URL |

## 3. Services and the job each one does

| # | Service | Job in StudioX | Why this service and not a simpler one |
| --- | --- | --- | --- |
| 1 | **Amazon Bedrock**: Claude Sonnet 5.5, Claude Haiku 5.5, Amazon Nova 2 Lite | All reasoning. The **model is chosen per job** (§5) | One API, three model families; prompt caching; structured output |
| 2 | **Strands Agents SDK** (Python) | Every agent: analyst, 11 lenses, curator, co-viewer | Agents-as-tools and MCP tool use built in; emits OpenTelemetry traces |
| 3 | **AgentCore Runtime** | Hosts two runtimes: `analyst` (offline) and `coviewer` (live). One session per viewing keeps the episode in memory | Isolated microVM per session; sync calls up to 15 min for long lens runs; no servers to run |
| 4 | **AgentCore Gateway** | One MCP endpoint shared by all agents. Targets: the managed **Web Search Tool**, plus two Lambda tool targets (`knowledge-tools`, `episode-tools`) | Agents discover tools with `tools/list`; no per-agent glue code |
| 5 | **AgentCore Web Search Tool** (Gateway connector `web-search`) | Fact-check sources, "as of" facts, spelling checks for rapid-fire names | Amazon-operated index and knowledge graph; domain and date filters; queries stay inside AWS; no third-party key |
| 6 | **AgentCore Memory** | Co-viewer session context, plus the **user-preference** strategy per viewer (which lenses they open, what they ask) | Managed short- and long-term memory; preference extraction built in |
| 7 | **AgentCore Observability** | Traces of every agent, tool and model call in CloudWatch GenAI observability | Evidence for judges; debugging |
| 8 | **AgentCore Evaluations** (stretch) | Dataset evaluation of the fact checker against a labelled claim set; built-in evaluators on co-viewer answers | Measured quality instead of "it seems good" |
| 9 | **Bedrock Guardrails** | (a) Contextual grounding score on every episode-derived card, which becomes `confidence`. (b) Prompt-attack filter on typed viewer questions | Model-independent through `ApplyGuardrail` |
| 10 | **Amazon Transcribe** | Word timestamps, speaker labels, custom vocabulary (drug and supplement names) | The source of every timestamp |
| 11 | **AWS Step Functions** | The ingest pipeline: transcribe → normalise → segment → **Map** over segments → pass B → verify → curate → package, with retries and progress | Visible execution graph; per-state retries; job status for the TV |
| 12 | **AWS Lambda** | API handlers, the agent invoker, Gateway tool targets, verifier, packager | Glue that stays small |
| 13 | **Amazon DynamoDB** | Candidates with scores, cards, moment index, jobs, caches | Time- and lens-keyed lookups in milliseconds |
| 14 | **Amazon S3 + CloudFront** | Media, transcripts, episode packages, licensed images, QR share pages; the **only** part that stays up during judging | Static, cached, cheap |
| 15 | **API Gateway (HTTP API)** | `/v1/*` behind the same CloudFront domain, with throttling | Managed auth hook and throttling |
| 16 | **Amazon EventBridge** | S3 upload → start an ingest execution (phone upload, stretch) | Event-driven trigger, no polling |
| 17 | **SSM Parameter Store** | Agent ARNs, the access code, the `live` kill switch | Change behaviour without a redeploy |
| 18 | **CloudWatch** (dashboard, alarms) + **AWS Budgets** | Per-lens latency, tokens and keep/drop counts; error alarm; cost alert | Cost and quality visible |
| 19 | **AWS CDK** (TypeScript) + **AgentCore CLI** | All infrastructure as code | Reproducible in anyone's account |

## 4. Architecture

> Superseded by [system-architecture.md](system-architecture.md) §5–§6 (four runtimes, eleven agents, flows). Kept for history.


```
                         ┌──────────────── us-east-1 ───────────────────────────────────────────┐
 phone ── companion ──▶ S3 uploads/ ─ EventBridge ─┐                                            │
 (LAN, Node)                                       ▼                                            │
                                     Step Functions  "EpisodeIngest"                            │
                                       1 Transcribe (or Normalise a supplied transcript)        │
                                       2 Normalise → transcript.json (S3)                       │
                                       3 Invoke analyst: SEGMENT ──────────┐                    │
                                       4 Map(segments, max 4) ─ invoke analyst: PASS_A ─┐       │
                                       5 Invoke analyst: PASS_B                         │       │
                                       6 Verify (Lambda → Guardrails grounding)         │       │
                                       7 Invoke analyst: CURATE                         │       │
                                       8 Package (Lambda) → S3 packages/ + DynamoDB      │       │
                                       each state: DynamoDB JOB# progress               │       │
                                                                                        ▼       │
                         AgentCore Runtime "analyst" (Strands)  ◀────────────────────────┘      │
                            orchestrator ── lenses as tools (Sonnet / Haiku by job)              │
                                   │ MCP                                                        │
                         AgentCore Gateway ─┬─ Web Search Tool (managed connector)              │
                                            ├─ Lambda knowledge-tools: Wikidata, Wikipedia,     │
                                            │                          Commons licence + copy   │
                                            └─ Lambda episode-tools: transcript window/search,  │
                                                                     cards, DynamoDB            │
                         AgentCore Runtime "coviewer" (Strands, Haiku; Nova 2 Lite grounding)   │
                            session = one viewing  ── AgentCore Memory (session + preferences)  │
                                   ▲                                                            │
 TV (VVD) ── CloudFront ──┬─ /packages, /images, /media, /share  (S3, public, cached)           │
                          └─ /v1/*  → API Gateway → Lambda api ─┘ (access code, throttled,      │
                                                                    live flag in SSM)           │
                         Guardrails · DynamoDB · CloudWatch + AgentCore Observability · Budgets │
                         └───────────────────────────────────────────────────────────────────────┘
```

## 5. The agents

> Superseded by [system-architecture.md](system-architecture.md) §5. The lens contract, hooks and evaluations (§14) still apply.


### 5.1 Runtime `analyst` (offline)

One container, four modes chosen by `payload.mode`. The Step Functions invoker Lambda calls it
through `InvokeAgentRuntime`. The agent returns JSON, and **Lambdas do all writes**, after schema
validation. Agents never write to the database directly, which keeps them stateless and testable.

| Mode | Input | Pattern | Output |
| --- | --- | --- | --- |
| `SEGMENT` | Full transcript | One agent (Sonnet) | `segments[{id, start, end, title, genre}]`, speaker names |
| `PASS_A` | One segment + an episode brief (cast so far, earlier recaps; prompt-cached) | **Agents as tools**: the orchestrator decides which lenses fit the segment and calls them | Candidates with `evidence`, `salience`, reason |
| `PASS_B` | All pass-A candidates + segment recaps | Agents as tools over episode-wide lenses | Merged cast, timeline, conflicts, relations, questions |
| `CURATE` | Verified candidates with scores | One agent (Sonnet) | Moment index, layouts, animation specs, headlines, precomputed answers to every suggested question |

**Lenses, and the model routed to each.** These are starting choices. Cost and quality per lens
are measured, and the table is updated with the numbers.

| Lens | Pass | Model | Tools |
| --- | --- | --- | --- |
| people | A | Sonnet 5.5 | `wikidata_search`, `wikipedia_summary` |
| claims | A | Sonnet 5.5 | `web_search` (domain-filtered for health and science) |
| burst | A | Haiku 5.5 | `web_search` (spelling, "what is it") |
| protocol + technique spec | A | Haiku 5.5 | — |
| events | A | Haiku 5.5 | — |
| recap | A | Haiku 5.5 | — |
| cast (merge, dossiers, images) | B | Sonnet 5.5 | `wikidata_facts`, `commons_image` |
| timeline | B | Haiku 5.5 | — |
| conflicts | B | Sonnet 5.5 | `transcript_search` |
| relations | B | Haiku 5.5 | — (layout computed in the packager) |
| questions | B | Haiku 5.5 | — |
| curator | — | Sonnet 5.5 | `get_cards` |

```python
# Sketch only. Exact Strands/AgentCore APIs are checked when the code is written.
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from strands import Agent, tool
from strands.tools.mcp import MCPClient

app = BedrockAgentCoreApp()
gateway = MCPClient(...)            # AgentCore Gateway endpoint (web_search, wiki, episode tools)

def lens(name, model, prompt, tools=()):
    agent = Agent(model=model, system_prompt=prompt, tools=list(tools))
    @tool(name=f"{name}_lens")
    def run(segment_json: str) -> str:
        return str(agent(segment_json))   # structured JSON, validated by the caller
    return run

@app.entrypoint
def handler(payload):
    with gateway:
        tools = gateway.list_tools_sync()
        orchestrator = Agent(model=SONNET, system_prompt=ANALYST,
                             tools=[lens("claims", SONNET, CLAIMS, pick(tools, "web_search")),
                                    lens("people", SONNET, PEOPLE, pick(tools, "wikidata_search", "wikipedia_summary")),
                                    lens("burst", HAIKU, BURST, pick(tools, "web_search")), ...])
        return orchestrator(build_task(payload))
```

### 5.2 Runtime `coviewer` (live)

- **Session:** `runtimeSessionId` = the viewing session (≥ 33 characters). The first call loads the
  episode package and transcript into the session's memory. Later calls reuse them, with Bedrock
  prompt caching on the episode brief.
- **`refine {t}`:**
  1. Read the moment entry and the transcript window [t − 15 s, t + 4 s].
  2. Ask Haiku whether the window holds something no card covers.
  3. If it does, make one card, check its grounding, and return it.
  4. Results are cached per (episode, 5 s bucket) in DynamoDB.
- **`ask {question, t}`:**
  - Guardrails screens the question first (prompt attack).
  - Tools: `transcript_search(before_t)`, `get_cards`, `web_search`.
  - **Nova 2 Lite with `nova_grounding`** answers questions that need the outside web when a short,
    cited answer is enough.
  - The answer cites timestamps and sources and is capped at about 600 characters.
- **Memory:** each question and answer is written as a USER/ASSISTANT turn. Lens opens are written
  as short USER turns ("opened the fact check on melatonin dosing"), because the user-preference
  strategy reads only USER and ASSISTANT messages. Retrieved preferences order the lens bar and
  personalise suggestions. Visible in the video: an answer that refers back to an earlier question.

## 6. Gateway tools

| Target | Tools | Notes |
| --- | --- | --- |
| `web-search` (managed connector) | `WebSearch(query ≤ 200 chars, maxResults 1–25, filters.domainFilter, filters.publishedDateFilter)` | Show citations with every result surfaced (acceptable-use terms). Store only the cited snippet |
| Lambda `knowledge-tools` (Python) | `wikidata_search(name)`, `wikidata_facts(qid)`, `wikipedia_summary(title)`, `commons_image(file)` | `commons_image` reads `extmetadata`, keeps only CC0, PD, CC BY and CC BY-SA, copies the 320 px thumbnail to S3, and returns our CloudFront URL and credit. No image library is needed. Sends a descriptive `User-Agent` |
| Lambda `episode-tools` (Python) | `transcript_window(mediaId, t0, t1)`, `transcript_search(mediaId, query, before_t)`, `get_cards(mediaId, t0, t1)` | Reads S3 and DynamoDB. `before_t` enforces "no spoilers" in code, not in the prompt |
| **Policy** (stretch) | A Cedar policy: `coviewer` may call only `episode-tools` and `web-search` | Least privilege between the two runtimes |

## 7. Data

**DynamoDB, one table `studiox`, on demand:**

| PK | SK | Item |
| --- | --- | --- |
| `MEDIA#<id>` | `META` | Title, duration, status, package version |
| `MEDIA#<id>` | `SEG#<startMs>` | Segment |
| `MEDIA#<id>` | `CAND#<lens>#<t0Ms>#<n>` | Candidate, `score{confidence, salience}`, evidence, kept/dropped + reason |
| `MEDIA#<id>` | `W#<t0Ms>#<id>` | Curated card |
| `MEDIA#<id>` | `MOM#<t0Ms>` | Moment entry |
| `MEDIA#<id>` | `Q#<hash>` | Precomputed answer to a suggested question |
| `MEDIA#<id>` | `JOB#<executionId>` | Step, n/m, status, errors |
| `CACHE#<id>` | `REFINE#<bucket5s>` | Refined card, `ttl` |
| `QUOTA` | `<yyyy-mm-dd>` | Live-call counter |

**S3:**

- `media/`
- `uploads/`
- `transcripts/<id>.json`
- `packages/<id>/v<n>.json` (what the TV downloads; also bundled into the demo build)
- `images/`
- `share/<token>.html`

## 8. API

API Gateway HTTP API behind CloudFront `/v1/*`, with one Lambda (Python) and a simple authorizer
that checks `x-studiox-access` against SSM. Stage throttling is on. Every handler reads
`/studiox/live`; when it is `off` they return `503 LIVE_OFF`, and the TV shows its offline state.

| Route | Does |
| --- | --- |
| `GET /v1/episodes` | Library with package URLs |
| `POST /v1/sessions {mediaId, viewerId}` | Opens a co-viewer session and warms it |
| `POST /v1/refine {sessionId, t}` | Live refine (cached per 5 s bucket) |
| `POST /v1/ask {sessionId, t, question}` | Ask |
| `POST /v1/share {cardId}` | Static share page + QR URL |
| `POST /v1/uploads` → presigned PUT (stretch) | Phone upload into `uploads/` |
| `GET /v1/jobs/{id}` | Ingest progress (`ANALYSING 3/12`) |

## 9. Cost and safety

- **Ingest** runs once per episode. Measure the cost for the two clips and the 81-minute test
  transcript (tokens per lens from the traces) and publish the numbers. No estimate is published
  before it is measured.
- **Live calls:** a daily cap in `QUOTA`, capped `max_tokens`, cached refine, and precomputed
  suggested answers.
- **Safety:** no secrets in the app or repository. Budget alert at a small threshold. A 5xx alarm.
  After recording, set `live=off` and leave only S3 + CloudFront running for judging
  ([coviewer-plan.md §12.3](coviewer-plan.md#123-judging-demo-mode-and-what-aws-is-for-verdict-21-oct)).

## 10. Repository layout and deployment

```
backend/
  infra/            CDK app (TypeScript): StorageStack, PipelineStack, ApiStack, GuardrailStack, ObservabilityStack
  agents/           AgentCore CLI project (Python, Strands): analyst/, coviewer/, shared/ (schemas, prompts)
  functions/        Lambdas (Python): api, invoke_agent, normalise, verify, package, knowledge_tools, episode_tools
  eval/             labelled claim set, evaluation runner, results.md
  scripts/          seed_demo.py (run ingest on the two clips), export_demo_bundle.py (→ app bundle)
  README.md         deploy: cdk deploy --all; agentcore deploy; seed; export
```

- AgentCore Runtime, Gateway and Memory are deployed by the **AgentCore CLI** (`agentcore create`,
  `agentcore add gateway|memory`, `agentcore deploy`), which uses CDK internally. Their ARNs are
  written to SSM `/studiox/agents/*`, and our CDK stacks read them. If CloudFormation resources for
  AgentCore turn out to work in CDK (*unverified*), fold them into one app later.
- One-time step per account: **turn on CloudWatch Transaction Search**, or AgentCore traces do not
  appear.

## 11. Template for the "Which AWS services did you incorporate and how?" field

Fill this in only with what ran, and attach numbers:

> StudioX turns a spoken video into a timed, sourced co-viewing layer for Fire TV. On AWS:
> **Step Functions** runs ingest (Transcribe → segment → a Map over segments → verify → curate →
> package). Each analysis step calls **Strands agents on AgentCore Runtime**: an analyst
> orchestrates 11 lens agents as tools (agents-as-tools), with the **Bedrock** model chosen per job
> (Claude Sonnet 5.5 for claims, people, conflicts and curation; Claude Haiku 5.5 for recap, burst,
> events and questions; Nova 2 Lite web grounding for live outside-knowledge answers). Agents reach
> tools through **AgentCore Gateway**: the managed **Web Search Tool** for fact-check sources, and
> Lambda targets for Wikidata/Wikipedia/Commons (licence-filtered images) and spoiler-safe transcript
> search. **Bedrock Guardrails** scores the grounding of every card (the score becomes its
> confidence) and screens viewer questions. A live **co-viewer agent** keeps one AgentCore session
> per viewing and uses **AgentCore Memory** (user-preference strategy) to adapt to the viewer.
> **AgentCore Observability** traces every call; **AgentCore Evaluations** measured the fact
> checker at <X>% on a labelled set. Data lives in **DynamoDB** and **S3**, served by
> **CloudFront** and **API Gateway**; everything is defined in **CDK**. Measured: ingest of an
> 81-minute transcript took <N> min and cost $<C>; a live refine takes <L> s at p50.

## 12. Build order (cloud track) and gates

| # | Step | Estimate | Gate / fallback |
| --- | --- | --- | --- |
| 1 | `cdk bootstrap`; StorageStack (S3, CloudFront, DynamoDB); Transaction Search on | 1.5 h | A clip streams from CloudFront to the VVD (also TV gate G1) |
| 2 | `agentcore create` analyst; deploy; invoke with a test payload | 2 h | **G2**. Fallback: run the same Strands code in a Lambda (honestly described) |
| 3 | Gateway: web-search connector + `knowledge-tools` Lambda | 2 h | Web search from the agent returns results. Fallback: Nova grounding |
| 4 | Lenses: claims, people, burst, recap on the 81-minute transcript; iterate the prompts | 4 h | Schema-valid output; claims look sane |
| 5 | Remaining lenses, pass B, curator; verify (Guardrails) and package Lambdas | 4 h | One complete package for each demo clip |
| 6 | Step Functions EpisodeIngest wiring with progress | 2 h | Execution graph green. Fallback: `seed_demo.py` calling the same steps |
| 7 | coviewer runtime: refine + ask; Memory; ApiStack + authorizer + live flag | 3.5 h | **G3** with the TV (22 Oct, 22:00) |
| 8 | Export the demo bundle into the app; CloudWatch dashboard; budget alert | 1.5 h | The app runs in demo mode with the API unreachable |
| 9 | Stretch: Evaluations on a labelled claim set; Policy; EventBridge upload trigger | 2–3 h | Only after G3 |
| 10 | Screenshots (trace, Step Functions graph, dashboard), measured numbers, write-up | 1 h | Before the 23 Oct, 16:00 freeze |

About 21–23 hours for the core (steps 1–8). That fits one builder over the remaining days, alongside
the TV track.

## 13. Unverified until a spike runs

- The exact Strands and AgentCore Python APIs (sketch in §5.1).
- Gateway inbound auth from a Runtime (IAM vs JWT; whatever `agentcore add gateway` configures).
- Step Functions calling AgentCore directly. The design uses an invoker Lambda, so it does not
  depend on this.
- AgentCore cold-start latency on the live path.
- Web Search Tool pricing.
- The names of the built-in evaluators other than `Builtin.Helpfulness`.
- Model IDs and inference profiles for Sonnet 5.5 and Haiku 5.5 in us-east-1.

## 14. What winning agent entries had in common, and what changes here

Four winning entries from an AWS "agents for humans" Strands hackathon were reviewed on 21 Oct
(a local, unpublished copy of their write-ups is in `review/strandswinners/`):

- **Tally:** food-program paperwork for home child care.
- **Shoulder:** private agents that negotiate caregiving between siblings.
- **A regulatory radar** for a small grocery store.
- **Doorstep:** heat-wave check-in calls.

### 14.1 The shared pattern

| Pattern | How deep they went |
| --- | --- |
| **One person, one moment, priced pain** | "One lunch a day that fails the log … is 436.92 dollars gone in a month". "619 people died … more than half lived alone". Each figure has a cited source |
| **The model proposes, code decides** | Reimbursement rules, fairness maths, permissions and the interruption budget are plain Python against versioned data. "A rule a prompt can talk its way around is not a rule." "No language model ever computes a fairness number." |
| **Each Strands feature is used because the problem needs it, and the reason is stated** | Graph for a fixed evening pipeline; a conditional Graph plus A2A in another entry ("Two problems, two shapes. I did not want to reach for the same pattern twice and call it architecture"). Hooks on `BeforeToolCallEvent`/`AfterModelCallEvent` enforce privacy and authority. Structured output "as a contract". Interrupts with session persistence. Cedar authorisation on every tool call. A BidiAgent for voice |
| **Not using a feature, for a stated reason, counts too** | The radar entry: "I deliberately did not use AgentCore Memory for this data", because audit data belongs in a queryable database |
| **Evaluations with ground truth, including adversarial and unseen data** | "100 percent component recall" on curated photos, then "35" of 45 unseen, with the failure mode reported. "37 of 37 in-scope attacks blocked … 14 of 14 harmless messages untouched." "Red-flag recall 90%", "20 of 20 forbidden actions denied", each run three times. 158 tests |
| **Silence is a feature** | "It has read 761 real items so far and brought 30 of them to the owner." A **rejection log** shows every item not surfaced, with its reason. Tally asks at most two questions a night, "enforced in code, not requested in a prompt" |
| **Honest about live vs designed** | "AgentCore Code Interpreter and Memory are running here. Gateway and Runtime are designed and labelled as designed. Precision is more persuasive than claiming everything." Fictional people are declared fictional |
| **Real operational lessons, with numbers** | A batch agent that kept chat history cost "$30 and a day" (token use up about 25×). A boto3 default read timeout silently re-ran a whole batch. "The first call after an idle period takes about ten seconds", hence a warm-up request |
| **Something a judge can try** | Three of the four had a hosted app, a login, or "point it at your own lunch" |

### 14.2 Changes to StudioX's backend

**A. Three problems, three shapes, each stated with its reason.**

| Problem | Shape | Why this shape |
| --- | --- | --- |
| Ingest an episode | Step Functions DAG, with the `analyst` orchestrator calling **lenses as tools** per segment | Fixed stages that need retries and visible progress. Inside a segment, the orchestrator *chooses* which lenses apply, so a crime segment never pays for the protocol lens. Report the average number of lenses invoked per segment |
| Check a claim | A **Strands Graph** with a bounded conditional loop: `extract → search → stance → enough? ─no→ refine query (max 2) ─→ search` / `─yes→ verdict` | Verification needs iteration with a hard exit. After two refinements it stops at `UNVERIFIED` instead of searching forever |
| Answer at the pause | **One agent, no orchestrator**, with tools and hooks; the instant screen never waits for it | Latency is the product. Same reasoning as Tally's day path |

We do **not** use A2A: no agent holds a secret from another, so a process boundary would add latency
and protect nothing. The write-up says so.

**B. Code decides; the model proposes.** These become deterministic `@tool` functions or Lambda
code. They are never left to a prompt:

- **Verdict label.**
  - The model only labels each fetched source's *stance* (`supports`, `contradicts`, `mixed`,
    `irrelevant`) and gives a quote.
  - Code then maps stances to the verdict. Two or more independent `contradicts` with no `supports`
    → `DEBUNKED`. Two or more `supports` with no contradicting source → `SUPPORTED`. A mix →
    `NUANCED` or `DISPUTED`. Fewer than two usable sources → `UNVERIFIED`.
  - The rule table is versioned (`verdict-rules v1`), and every card records the version. That is
    what makes `DEBUNKED` defensible.
- **Scores and thresholds** (§5.4 of the plan); burst detection by counting entities per window;
  timeline ordering and date arithmetic; relation-graph layout; the moment index; spoiler window
  slicing.
- **Interruption budget:** at most one proactive cue chip per 60 s of playback and three per
  segment, enforced in the composer.

**C. Hooks that enforce the product's promises.** Exact Strands hook class names are checked against
the installed SDK.

| Hook | Event | Enforces |
| --- | --- | --- |
| `SpoilerGuard` | before every tool call | `transcript_search`, `transcript_window` and `get_cards` can never read past the playhead `t` in the co-viewer. The argument is clamped and the clamp is logged. "No spoilers" becomes a fact about the system, not a prompt request |
| `CitationGuard` | after tool calls and after the final model output | Every URL on a claim card must be one that `web_search` returned in this invocation. Otherwise the source is removed and the card falls back to `UNVERIFIED`. No invented sources |
| `BudgetGuard` | before tool calls | At most N searches per claim and M tool calls per segment. Cost is enforced in code |
| `InjectionGuard` | before the model call on viewer questions; on transcript text | Viewer questions go through Guardrails' prompt-attack filter. Transcript text is passed as quoted data, never as instructions. A test checks that a guest saying "ignore your instructions" changes nothing |

**D. Structured output as a contract, one schema for both runtimes.** A JSON Schema per widget is the
single source. Pydantic models for the agents and TypeScript types and validators for the TV are
generated from it (or checked against it in CI), so a card the agent can emit is exactly a card the
TV can draw.

**E. Silence and the rejection log.** Every dropped candidate keeps its reason in DynamoDB:

- `common knowledge`;
- `not checkable`;
- `grounding 0.41 < 0.70`;
- `duplicate of cast:berson`;
- `budget`.

We publish the funnel for the 81-minute transcript: sentences → candidates → kept → shown, per lens.
The Lens Lab (F) shows the rejected list with reasons. On the TV, a card's detail view shows one
line, `WHY THIS: surprising + checkable · 3 sources`.

**F. Something a judge can try: the Lens Lab.**

- **What it is:** a small public web page on the same CloudFront domain. Paste up to about 1,500
  characters of any podcast transcript and it runs the pass-A lenses through the real `analyst`
  runtime.
- **What it returns:** the cards it would show (claims with verdicts and sources, people, a burst
  list, protocols), the **rejected candidates with reasons**, the models used, the latency, and the
  trace ID.
- **Privacy:** nothing is stored. The text is processed and discarded.
- **Cost limits:**
  - a hard daily cap (for example 150 runs, then `LAB CLOSED FOR TODAY`);
  - capped input and `max_tokens`;
  - the `live` kill switch;
  - a budget alert.
- Worst-case daily cost = cap × the measured cost per run. Publish both numbers in the write-up.
- **This replaces "upload your own words via the phone".** It needs no TV, phone, pairing or
  Transcribe, and it answers "is this staged?" for the AWS judges directly. The TV judge build
  stays in demo mode.

**G. Evaluations: small, honest, with ground truth, each run three times.** Results go in
`backend/eval/results.md` and the write-up.

| Suite | Ground truth | Metric we report | Target |
| --- | --- | --- | --- |
| Claim verdicts | About 15 claims hand-labelled with sources (the two clips plus the 81-minute test transcript) | Verdict agreement; **wrong `DEBUNKED` = 0**; claim recall | No false `DEBUNKED` |
| Unseen text | Transcript passages not used to write the prompts | The same metrics, reported separately, failure mode included | — |
| Spoilers | 20 Ask questions about content after the playhead | Leak rate (deterministic: no cited evidence after `t`), plus an LLM judge | 0 leaks |
| Citations | Every claim card produced | Cited URLs that were really fetched | 100% |
| Injection | Instruction-like lines planted in a test transcript; hostile Ask questions | Behaviour changes; forbidden tool calls | 0 / 0 |
| Silence | The 81-minute transcript | The funnel per lens | Published, not targeted |
| Latency and cost | Real runs | Instant screen (TV, ms); refine and Ask p50/p95; cold start; cost per episode-hour | Published |

AgentCore Evaluations runs the built-in judge (`Builtin.Helpfulness` and any other built-ins that fit)
on co-viewer Ask traces. The claim set runs as a dataset evaluation if its API fits in time; otherwise
it uses `backend/eval/run.py`, and the write-up says which. Deterministic tools get pytest unit tests,
and the count is reported.

**H. Operational lessons applied before we hit them:**

- **A new `Agent` instance per lens call and per Lens Lab run.** Conversation history exists only in
  co-viewer sessions, and it is windowed. This avoids the "item 400 carried the prompts of the 399
  before it" failure.
- **The `InvokeAgentRuntime` client** gets one attempt (`retries={'total_max_attempts': 1}`) and a
  `read_timeout` matching the Lambda timeout, so a slow lens is never silently re-run.
- **Warm-up:** `/v1/sessions` warms the co-viewer session before the first pause. The Lens Lab page
  pings on load. We measure our own cold start, and do not assume the reported ten seconds.
- Idempotent writes keyed by `(mediaId, lens, t0, n)`, so a retried state cannot duplicate cards.

**I. The write-up: tell the truth precisely.**

- One headline list of the **7 services that carry the product**: Bedrock (three models), Strands,
  AgentCore Runtime, Gateway with the Web Search Tool, Memory, Observability, Step Functions.
  Everything else is listed as plumbing.
- A **live / designed** line for every service at submission time.
- Disclose that the narrators and stories in the clips are fictional and the footage is from
  Pexels.
- The cited "priced pain" figures must come from real sources found and checked by the team. None
  are invented here.
- Name the shapes and the reasons (A), the rules in code (B), the hooks (C) and the numbers (G). Do
  not list features without a reason.

### 14.3 Revised priorities for the cloud track

| Priority | Item | Added time |
| --- | --- | --- |
| P0 | Deterministic verdict rules, `SpoilerGuard`, `CitationGuard`, `BudgetGuard`, structured-output models, the rejection log with reasons, fresh agent per call, invoke-client settings | +3 h (mostly folded into lens work) |
| P0 | Evaluation suites: claim verdicts, spoilers, citations, injection; the funnel and latency numbers | +3 h |
| P1 | The fact-check Graph (replaces the claims lens agent) | +1.5 h |
| P1 | Lens Lab page + `/v1/lab` with cap and kill switch | +3 h |
| P2 | AgentCore Evaluations integration; AgentCore Policy (Cedar) restricting the co-viewer; EventBridge upload trigger | Only if time remains |

**To make room, cut:** the relations lens (and the relation graph on the TV), phone upload
analysis, and the Recommendation tile. Step Functions stays, but as a plain linear DAG plus one Map
state.
