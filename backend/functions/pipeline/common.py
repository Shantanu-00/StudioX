"""Shared helpers for the pipeline Lambdas: DynamoDB status writes, S3 JSON, ULIDs.

boto3 is imported lazily so the pure helpers can be unit tested without AWS.
"""
import json
import os
import time
from datetime import datetime, timezone
from decimal import Decimal

CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
MSG_TTL = 30 * 24 * 3600
STATES = ("UPLOADING", "PROCESSING", "ANALYSING", "READY", "NOT_A_FIT", "FAILED")

_clients = {}


def client(name, **kwargs):
    if name not in _clients:
        import boto3
        _clients[name] = boto3.client(name, **kwargs)
    return _clients[name]


def table():
    if "table" not in _clients:
        import boto3
        _clients["table"] = boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])
    return _clients["table"]


def bucket():
    return os.environ["BUCKET_NAME"]


def iso(ts=None):
    return datetime.fromtimestamp(ts if ts is not None else time.time(), timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def ulid():
    n = (int(time.time() * 1000) << 80) | int.from_bytes(os.urandom(10), "big")
    out = []
    for _ in range(26):
        out.append(CROCKFORD[n & 31])
        n >>= 5
    return "".join(reversed(out))


def read_json(key):
    body = client("s3").get_object(Bucket=bucket(), Key=key)["Body"].read()
    return json.loads(body)


def write_json(key, value, cache_control=None):
    kwargs = {"Bucket": bucket(), "Key": key, "Body": json.dumps(value, separators=(",", ":")).encode("utf-8"),
              "ContentType": "application/json"}
    if cache_control:
        kwargs["CacheControl"] = cache_control
    client("s3").put_object(**kwargs)


def status_message(media_id, state, progress, text, now=None):
    """The `status` thread message body (CONTRACTS section 7 / API contract v1)."""
    msg = {"id": ulid(), "at": iso(now), "from": {"kind": "system", "name": "StudioX"}, "kind": "status",
           "mediaId": media_id, "status": {"mediaId": media_id, "state": state, "progress": progress}}
    if text:
        msg["text"] = text
    return msg


def update_media(media_id, state, progress=None, text=None, **extra):
    """Set MEDIA#<id>/META status and progress; post a status message to the owner's thread if there is one.

    Demo seeding has no owner (no linkId), so only the META row is written. `extra` fields (title,
    packageKey, error, ...) are stored as given.
    """
    if state not in STATES:
        raise ValueError(f"unknown status {state}")
    names, values, sets = {"#s": "status"}, {":s": state, ":u": iso()}, ["#s = :s", "updatedAt = :u"]
    if progress is not None:
        values[":p"] = Decimal(str(progress))
        sets.append("progress = :p")
    for i, (k, v) in enumerate(extra.items()):
        if v is None:
            continue
        names[f"#x{i}"], values[f":x{i}"] = k, v
        sets.append(f"#x{i} = :x{i}")
    resp = table().update_item(
        Key={"PK": f"MEDIA#{media_id}", "SK": "META"}, UpdateExpression="SET " + ", ".join(sets),
        ExpressionAttributeNames=names, ExpressionAttributeValues=values, ReturnValues="ALL_NEW")
    link_id = resp["Attributes"].get("linkId")
    if link_id:
        msg = status_message(media_id, state, progress if progress is not None else 0, text)
        table().put_item(Item={"PK": f"LINK#{link_id}", "SK": f"MSG#{msg['id']}",
                               "msg": json.loads(json.dumps(msg), parse_float=Decimal),
                               "ttl": int(time.time()) + MSG_TTL})
    return resp["Attributes"]
