"""Live-route helpers: episodes, session ids, refine cache keys, quota and access-code checks.

Pure functions are tested without AWS; the boto3 parts are imported lazily.
"""
import json
import re
import secrets
import time
import uuid
from datetime import datetime, timezone

from util import ApiError

# The two demo episodes exist before any pipeline run; titles match the TV app (src/data/episodes.ts).
DEMO_EPISODES = {
    "science-ep42": "Elite Recovery Protocols",
    "crime-case104": "The Pier 9 Disappearance",
}
MEDIA_ID = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
SESSION_ID = re.compile(r"^[A-Za-z0-9_-]{33,128}$")
REFINE_BUCKET_SECONDS = 5
REFINE_TTL = 600
QUOTA_TTL = 3 * 24 * 3600
MAX_QUESTION = 500
AGENT_TIMEOUT = 24  # seconds; the Lambda timeout is 30 and a failed answer still has to be stored


def new_session_id():
    return "sx-" + uuid.uuid4().hex  # 35 characters


def link_session_id(link_id):
    return "sx-link-" + link_id  # ULID link ids give 34 characters


def valid_media_id(value):
    return isinstance(value, str) and bool(MEDIA_ID.match(value))


def valid_session_id(value):
    return isinstance(value, str) and bool(SESSION_ID.match(value))


def refine_bucket(t):
    return int(t // REFINE_BUCKET_SECONDS)


def quota_pk(now=None):
    return "QUOTA#" + datetime.fromtimestamp(now if now is not None else time.time(), timezone.utc).strftime("%Y-%m-%d")


def access_ok(provided, expected):
    """The shared TV code. 'unset' or empty means the owner has not configured one: nobody gets in."""
    if not expected or expected == "unset" or not isinstance(provided, str) or not provided:
        return False
    return secrets.compare_digest(provided.encode("utf-8"), expected.encode("utf-8"))


def episode_view(media_id, title, status, domain, has_package, row=None):
    """One element of GET /v1/episodes. `status` is the MEDIA status, or None when there is no row."""
    ready = status == "READY" or (status is None and has_package)
    out = {"mediaId": media_id, "title": title, "status": status or ("READY" if ready else "NONE"),
           "mediaUrl": f"https://{domain}/media/{media_id}.mp4"}
    if ready or has_package:
        out["packageUrl"] = f"https://{domain}/packages/{media_id}/latest.json"
    return out


def validate_t(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0 or value > 24 * 3600 * 10:
        raise ApiError(400, "invalid_request", "'t' must be a number of seconds >= 0")
    return float(value)


def validate_ids(body, with_session=True):
    media_id = body.get("mediaId") if isinstance(body, dict) else None
    if not valid_media_id(media_id):
        raise ApiError(400, "invalid_request", "'mediaId' is missing or invalid")
    if not with_session:
        return media_id, None
    session = body.get("sessionId")
    if not valid_session_id(session):
        raise ApiError(400, "invalid_request", "'sessionId' must be 33 to 128 characters from POST /v1/sessions")
    return media_id, session


# ---------------------------------------------------------------- AWS side

def invoke_agent(arn, body, session_id, read_timeout=AGENT_TIMEOUT):
    """One attempt at an AgentCore runtime; returns the parsed JSON response."""
    import boto3
    from botocore.config import Config
    cli = boto3.client("bedrock-agentcore", config=Config(retries={"total_max_attempts": 1},
                                                          read_timeout=read_timeout, connect_timeout=5))
    resp = cli.invoke_agent_runtime(agentRuntimeArn=arn, runtimeSessionId=session_id,
                                    payload=json.dumps(body).encode("utf-8"),
                                    contentType="application/json", accept="application/json")
    data = json.loads(resp["response"].read().decode("utf-8"))
    if isinstance(data, dict) and data.get("error"):
        raise RuntimeError(f"agent error: {str(data['error'])[:200]}")
    return data


def screen_question(guardrail_id, guardrail_version, text):
    """True if the guardrail's prompt-attack filter lets the question through."""
    import boto3
    resp = boto3.client("bedrock-runtime").apply_guardrail(
        guardrailIdentifier=guardrail_id, guardrailVersion=guardrail_version, source="INPUT",
        content=[{"text": {"text": text, "qualifiers": ["guard_content"]}}])
    return resp.get("action") != "GUARDRAIL_INTERVENED"
