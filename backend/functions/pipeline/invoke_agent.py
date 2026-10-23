"""Generic Step Functions task: call an AgentCore runtime (JSON in, JSON out).

Input:
  agent        'analyst' | 'coviewer'; the runtime ARN is read from SSM /studiox/agents/<agent>/arn
  payload      the request body (CONTRACTS section 4)
  payloadRefs  optional {field: s3Key or 's3Key#member'}; that JSON is inserted as payload[field]
               (keeps Step Functions payloads small)
  pick         optional {from: object, keys: [names]}; each key present in `from` is copied into the
               payload. A Step Functions path to a missing field is a States.Runtime error that no Catch
               can handle, so optional fields of an earlier result (for example the curator's `labels`,
               absent from runtimes deployed before 23 Oct) are passed this way
  run          optional {mediaId, execution, name}; the response is stored at runs/<mediaId>/<execution>/<name>.json
  inline       when true the response is also returned (small responses only)
  meta         optional; echoed back unchanged so Map results stay attributable
  status       optional {state, progress, text}; written to the MEDIA row before the call
Output: {key?, result?, meta?}

One attempt, read timeout 900 s: agent runs are slow and expensive, so retries are a human decision.
"""
import json
import os
import re
import uuid

import common

READ_TIMEOUT = 900
RUN_PART = re.compile(r"[^A-Za-z0-9._=-]+")


class AgentNotDeployed(Exception):
    pass


class AgentError(Exception):
    pass


def session_id():
    """runtimeSessionId must be at least 33 characters."""
    return "sx-pipeline-" + uuid.uuid4().hex


def run_key(run):
    parts = [RUN_PART.sub("_", str(run[k])) for k in ("mediaId", "execution", "name")]
    return f"runs/{parts[0]}/{parts[1]}/{parts[2]}.json"


def build_payload(payload, refs, loader, pick=None):
    """Insert S3 JSON into the payload. A ref is 's3key' or 's3key#field' (take one field of the document).
    `pick` copies the listed keys that exist in pick['from'] (missing keys are left out)."""
    body = dict(payload)
    if pick:
        source = pick.get("from") if isinstance(pick.get("from"), dict) else {}
        for name in pick.get("keys") or []:
            if name in source and name not in body:
                body[name] = source[name]
    for field, ref in (refs or {}).items():
        key, _, sub = ref.partition("#")
        doc = loader(key)
        body[field] = doc[sub] if sub else doc
    brief = body.get("brief")
    if isinstance(brief, dict) and isinstance(brief.get("cast"), dict):
        # Step Functions cannot reshape a map into a list: speakers {spk_0: name} -> [{id, name}]
        body["brief"] = {**brief, "cast": [{"id": k, "name": v} for k, v in brief["cast"].items()]}
    return body


def parse_response(raw):
    try:
        data = json.loads(raw)
    except ValueError:
        raise AgentError(f"agent returned non-JSON: {raw[:200]!r}")
    if isinstance(data, dict) and data.get("error"):
        raise AgentError(f"agent error: {str(data['error'])[:300]}")
    return data


def runtime_arn(agent):
    if not re.fullmatch(r"[a-z][a-z0-9_-]{0,30}", agent or ""):
        raise ValueError("bad agent name")
    arn = common.client("ssm").get_parameter(Name=f"/studiox/agents/{agent}/arn")["Parameter"]["Value"]
    if not arn or arn == "unset":
        raise AgentNotDeployed(f"agent not deployed: set /studiox/agents/{agent}/arn")
    return arn


def invoke(arn, body):
    from botocore.config import Config
    import boto3
    cli = boto3.client("bedrock-agentcore", config=Config(retries={"total_max_attempts": 1}, read_timeout=READ_TIMEOUT))
    resp = cli.invoke_agent_runtime(agentRuntimeArn=arn, runtimeSessionId=session_id(),
                                    payload=json.dumps(body).encode("utf-8"),
                                    contentType="application/json", accept="application/json")
    return parse_response(resp["response"].read().decode("utf-8"))


def handler(event, context):
    status = event.get("status")
    if status:
        common.update_media(event["payload"]["mediaId"], status["state"], status.get("progress"), status.get("text"))
    arn = runtime_arn(event["agent"])
    body = build_payload(event["payload"], event.get("payloadRefs"), common.read_json, event.get("pick"))
    result = invoke(arn, body)
    out = {}
    if event.get("run"):
        out["key"] = run_key(event["run"])
        common.write_json(out["key"], result)
    if event.get("inline") or not event.get("run"):
        out["result"] = result
    if "meta" in event:
        out["meta"] = event["meta"]
    return out
