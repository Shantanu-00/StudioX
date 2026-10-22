"""EventBridge (S3 Object Created under uploads/) -> start the EpisodeAnalysis execution."""
import json
import os
import re

import common

KEY_RE = re.compile(r"^uploads/([A-Za-z0-9_-]{1,80})/([^/]+)$")


def parse_key(key):
    """'uploads/<mediaId>/<name>' -> (mediaId, name) or None."""
    m = KEY_RE.match(key or "")
    return (m.group(1), m.group(2)) if m else None


def derive_title(name):
    """Upload file name -> display title: no extension, underscores to spaces, at most 60 characters."""
    base = re.sub(r"\.[A-Za-z0-9]{1,5}$", "", name or "")
    base = re.sub(r"[_\s]+", " ", base).strip()
    return base[:60].rstrip() or None


def build_input(media_id, key, title=None):
    out = {"mediaId": media_id, "mediaKey": key}
    if title:
        out["title"] = title
    return out


def handler(event, context):
    key = ((event.get("detail") or {}).get("object") or {}).get("key", "")
    parsed = parse_key(key)
    if not parsed:
        return {"skipped": key}
    media_id, name = parsed
    row = common.table().get_item(Key={"PK": f"MEDIA#{media_id}", "SK": "META"}).get("Item") or {}
    title = row.get("title") or derive_title(row.get("name") or name)
    resp = common.client("stepfunctions").start_execution(
        stateMachineArn=os.environ["STATE_MACHINE_ARN"], input=json.dumps(build_input(media_id, key, title)))
    return {"executionArn": resp["executionArn"]}
