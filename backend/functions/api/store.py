"""DynamoDB / S3 / SSM access. Only imported at runtime (needs boto3)."""
import os
import time
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key
from botocore.config import Config

_table = _s3 = _ssm = None
_domain = {"value": None, "at": 0.0}


def table():
    global _table
    if _table is None:
        _table = boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])
    return _table


def s3():
    global _s3
    if _s3 is None:
        _s3 = boto3.client("s3", config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}))
    return _s3


def bucket():
    return os.environ["BUCKET_NAME"]


def domain():
    """CloudFront domain, read from SSM by name and cached (avoids a CFN cycle)."""
    global _ssm
    if _domain["value"] and time.time() - _domain["at"] < 3600:
        return _domain["value"]
    if _ssm is None:
        _ssm = boto3.client("ssm")
    value = _ssm.get_parameter(Name=os.environ["DOMAIN_PARAM"])["Parameter"]["Value"]
    _domain.update(value=value, at=time.time())
    return value


_params = {}


def param(name, ttl=30):
    """SSM parameter value, cached per container for `ttl` seconds. Raises if the parameter is missing."""
    global _ssm
    hit = _params.get(name)
    if hit and time.time() - hit[1] < ttl:
        return hit[0]
    if _ssm is None:
        _ssm = boto3.client("ssm")
    value = _ssm.get_parameter(Name=name)["Parameter"]["Value"]
    _params[name] = (value, time.time())
    return value


def get(pk, sk="META"):
    return table().get_item(Key={"PK": pk, "SK": sk}).get("Item")


def put(item, condition=None):
    kwargs = {"Item": item}
    if condition:
        kwargs["ConditionExpression"] = condition
    table().put_item(**kwargs)


def query_after(pk, prefix, after, limit):
    """Items under pk whose SK starts with prefix, strictly after id `after`, oldest first."""
    lower = f"{prefix}{after}0" if after else prefix
    resp = table().query(
        KeyConditionExpression=Key("PK").eq(pk) & Key("SK").between(lower, prefix + "~"),
        Limit=limit,
        ScanIndexForward=True,
    )
    return resp["Items"]


def plain(value):
    """Convert DynamoDB Decimals to int/float for JSON."""
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, dict):
        return {k: plain(v) for k, v in value.items()}
    if isinstance(value, list):
        return [plain(v) for v in value]
    return value
