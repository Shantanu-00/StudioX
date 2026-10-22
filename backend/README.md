# StudioX backend

Phase 1: storage and API foundation (S3, DynamoDB, one Python Lambda, HTTP API, CloudFront). The
contract is in [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) ("API contract v1").

## Layout

- `infra/` CDK app (TypeScript), stack `StudioXCore` in us-east-1.
- `functions/api/` the API Lambda (Python 3.13, stdlib + boto3). Tests in `functions/api/tests/`.
- `scripts/smoke.sh` end-to-end check against a deployed stack.
- The phone web app lives in `../webapp/link/` and is deployed to the `link/` prefix.

## Prerequisites

Node 22, the AWS CLI, and for tests `uv` (or Python 3.13 with pytest). The default AWS profile in
this environment is restricted and **cannot deploy**; use a profile with deploy rights (below).

## Commands

```bash
# unit tests (no AWS calls)
cd backend/functions/api && uv run --python 3.13 --with pytest pytest -q

# synthesize (no AWS calls)
cd backend/infra && npm install && npx cdk synth

# deploy (needs bootstrapped account and a profile that can deploy)
AWS_PROFILE=studiox npx cdk deploy StudioXCore

# smoke test, using the CloudFrontDomain output
DOMAIN=dxxxxxxxx.cloudfront.net ../scripts/smoke.sh

# teardown (bucket and table are removed; hackathon setting)
AWS_PROFILE=studiox npx cdk destroy
```

## Notes

- CloudFront routes `/v1/*` to the API and everything else to S3 (Origin Access Control). The
  Lambda learns the CloudFront domain from the SSM parameter `/studiox/domain` at runtime, which
  avoids a CloudFormation dependency cycle.
- Uploading a file moves the media to `PROCESSING`; EventBridge then starts the analysis pipeline
  (see "Pipeline" below).

## Data, seeding and evals

| Path | What |
| --- | --- |
| `data/transcripts/{science-ep42,crime-case104}.json` | Demo transcripts (CONTRACTS section 2), made by `scripts/make_transcripts.py` from the scripts in `media/use.md` |
| `scripts/make_transcripts.py` | `demo` builds the two transcripts; `local` converts `review/transcript/podcast1.md` (git-ignored) to `review/transcript/podcast1.json` |
| `scripts/seed_demo.sh [local\|cloud\|index]` | `local` runs `agents/run_local.py package` per clip, keeps a package only if it validates, then regenerates `src/analysis/packages/index.ts`. `cloud` is owner-run: uploads transcripts, starts `StudioX-EpisodeAnalysis`, copies `packages/<id>/latest.json` down |
| `scripts/upload_media.sh` | Owner-run. Copies `media/tv/*.mp4` to `s3://<bucket>/media/` with `video/mp4`, then invalidates `/media/*`. Pexels footage: serve for playback only, do not redistribute as stock |
| `eval/claims.json`, `eval/spoilers.json` | Ground-truth cases for the two demo clips |
| `eval/run_eval.py` | `uv run --python 3.13 backend/eval/run_eval.py --runs 3 [--local]` writes `eval/results.md` (verdict agreement, false DEBUNKED, spoiler leaks, citation checks) |

`--local` adds cases from the third-party test transcript. That transcript and its cases live under
`review/transcript/` (git-ignored) and must never be copied into tracked files.
Cloud steps need admin credentials; the restricted `claude-code` profile can call Bedrock only.

## Pipeline (StudioXPipeline)

Step Functions Standard machine **`StudioX-EpisodeAnalysis`**, in its own stack. Code is in
`functions/pipeline/` (Python 3.13, stdlib + boto3, plus the `studiox_core` layer built from
`shared/python/`). `StudioXCore` publishes the bucket and table names as SSM parameters
`/studiox/bucket` and `/studiox/table`; the pipeline stack reads them at deploy time, so Core must
be deployed first.

States: `Mark processing` → `Has transcript?` → (`Transcribe speech` → `Wait` →
`Check transcription` → `Transcription finished?`) → `Normalise transcript` → `Eligibility gate`
(→ `Not a fit`) → `Find topics` → `Analyse segments` (Map, 4 at a time, runs the lenses) →
`Verify and score` (schema check, then Bedrock Guardrails contextual grounding; below 0.7 is
dropped with a reason) → `Plan the screen` → `Draw the map` (analyst `map`; on failure `Map skipped`) →
`Precompute answers` (Map over curator + map questions) → `Publish package`.
Any failure goes to `Mark failed` (status FAILED). Intermediate outputs are under
`runs/<mediaId>/<execution>/`.

**Playback preparation (uploads).** For uploads the machine runs `Prepare playback and transcribe`
(Parallel): `Prepare playback` (Lambda `prepare_playback`, 3008 MB, 15 min, 10 GB `/tmp`, static ffmpeg
layer at `/opt/bin`) remuxes or transcodes to `media/<mediaId>.frag.mp4` and sets `playable`/`mediaUrl`
on `MEDIA#<id>/META`, beside `Transcribe speech` → `Normalise upload transcript`. A playback failure
sets `playable=false` and `playbackError` and never fails the run. Supplied-transcript runs skip it.
**Run `backend/scripts/fetch_ffmpeg.sh` before deploying** (downloads and md5-checks the static build
into `backend/layers/ffmpeg/bin/`, git-ignored). Without the binaries `cdk synth` still works but warns
and leaves the playback branch out. `GET /v1/links/{linkId}/media` lists a link's uploads from pointer
items `LINK#<id>/MEDIA#<createdAt>#<mediaId>` written at upload creation (older uploads are not listed).

```bash
./backend/scripts/fetch_ffmpeg.sh
cd backend/infra
AWS_PROFILE=studiox npx cdk deploy StudioXCore --hotswap   # API (new route, pointer items)
AWS_PROFILE=studiox npx cdk deploy StudioXPipeline         # not hotswap: new Lambda, layer, state machine
```

### Deploy order (admin profile; the `claude-code` profile cannot deploy)

```bash
cd backend/infra && npm install
# 1. Core: first time (bucket EventBridge notifications, new SSM params, API permissions, 30 s timeout)
AWS_PROFILE=studiox npx cdk deploy StudioXCore
# 2. Pipeline (also creates the guardrail and the two agent ARN parameters, value "unset")
AWS_PROFILE=studiox npx cdk deploy StudioXPipeline
# 3. After `agentcore deploy` of each runtime, point the pipeline and the API at it
aws ssm put-parameter --overwrite --type String --name /studiox/agents/analyst/arn  --value <analyst runtime ARN>
aws ssm put-parameter --overwrite --type String --name /studiox/agents/coviewer/arn --value <coviewer runtime ARN>
# 4. Live routes: shared code for the TV, then switch live on
aws ssm put-parameter --overwrite --type String --name /studiox/access-code --value <code>
aws ssm put-parameter --overwrite --type String --name /studiox/live --value on
# Later Lambda-code-only changes
AWS_PROFILE=studiox npx cdk deploy StudioXCore --hotswap
AWS_PROFILE=studiox npx cdk deploy StudioXPipeline --hotswap
```

`/studiox/live` starts as `off` and `/studiox/access-code` as `unset`: until the owner sets them the
live routes answer 503 `LIVE_OFF` / `ACCESS_CODE_UNSET`. CloudFormation does not overwrite a
parameter value that the template did not change. The daily quota is the API Lambda's `QUOTA_LIMIT`
environment variable (default 300 live calls per UTC day).

### Starting an execution

An upload starts one by itself: EventBridge sees Object Created under `uploads/<mediaId>/<name>`
and a small Lambda starts the machine with `{mediaId, mediaKey, title}`. By hand (demo seeding,
a supplied transcript at `transcripts/<id>.json`, skips Transcribe):

```bash
ARN=$(aws cloudformation describe-stacks --stack-name StudioXPipeline \
  --query "Stacks[0].Outputs[?OutputKey=='StateMachineArn'].OutputValue" --output text)
aws stepfunctions start-execution --state-machine-arn "$ARN" \
  --input '{"mediaId":"science-ep42","transcriptKey":"transcripts/science-ep42.json","title":"Elite Recovery Protocols"}'
# with media only (runs Transcribe):  {"mediaId":"...","mediaKey":"uploads/<id>/<file>.mp4"}
```
