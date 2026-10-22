"""Where transcripts and packages come from: inline in the payload (local runs, tests) or S3."""

from __future__ import annotations

import json
import os
from collections import OrderedDict

from studiox_core import transcript as T

from .llm import REGION

_bucket = os.environ.get("BUCKET", "")
_cache: OrderedDict[str, dict] = OrderedDict()
_CACHE_MAX = 64


def bucket() -> str:
    """BUCKET env, else the SSM parameter named by BUCKET_PARAM (/studiox/bucket)."""
    global _bucket
    if not _bucket and os.environ.get("BUCKET_PARAM"):
        import boto3

        _bucket = boto3.client("ssm", region_name=REGION).get_parameter(
            Name=os.environ["BUCKET_PARAM"])["Parameter"]["Value"]
    return _bucket


def _s3_json(key: str) -> dict:
    if not bucket():
        raise RuntimeError(f"no BUCKET (or BUCKET_PARAM) to read s3 key {key}")
    import boto3

    body = boto3.client("s3", region_name=REGION).get_object(Bucket=bucket(), Key=key)["Body"].read()
    return json.loads(body)


def transcript_for(payload: dict, cache_key: str | None = None) -> dict:
    """payload.transcript (inline, optional extension) or s3://$BUCKET/<transcriptKey>.

    `cache_key` (the coviewer's sessionId) keeps the transcript in process for the session."""
    if cache_key and cache_key in _cache:
        _cache.move_to_end(cache_key)
        return _cache[cache_key]
    if isinstance(payload.get("transcript"), dict):
        tr = T.load(payload["transcript"])
    else:
        key = payload.get("transcriptKey") or f"transcripts/{payload['mediaId']}.json"
        tr = T.load(_s3_json(key))
    if cache_key:
        _cache[cache_key] = tr
        while len(_cache) > _CACHE_MAX:
            _cache.popitem(last=False)
    return tr


def package_for(payload: dict) -> dict | None:
    """The current episode package, if there is one (used by refine to avoid repeating cards)."""
    if isinstance(payload.get("package"), dict):
        return payload["package"]
    if not payload.get("mediaId") or not (os.environ.get("BUCKET") or os.environ.get("BUCKET_PARAM")):
        return None
    try:
        return _s3_json(f"packages/{payload['mediaId']}/latest.json")
    except Exception:
        return None
