"""StudioX API Lambda: API Gateway HTTP API (payload v2) behind CloudFront at /v1/*."""
import base64
import json
import logging
import os
import secrets
import time
from datetime import datetime, timezone
from decimal import Decimal

import auth
import live
import util
from router import Router, strip_prefix
from util import ApiError

log = logging.getLogger()
log.setLevel(logging.INFO)

router = Router()
PAIR_TTL = 600
TOKEN_TTL = auth.COOKIE_MAX_AGE
MSG_TTL = 30 * 24 * 3600
URL_EXPIRY = 3600
FIRST_PARTS = 4
MAX_PARTS_REQUEST = 50
LIVE_PARAM = os.environ.get("LIVE_PARAM", "/studiox/live")
ACCESS_PARAM = os.environ.get("ACCESS_PARAM", "/studiox/access-code")
COVIEWER_PARAM = os.environ.get("COVIEWER_PARAM", "/studiox/agents/coviewer/arn")
GUARDRAIL_ID_PARAM = os.environ.get("GUARDRAIL_ID_PARAM", "/studiox/guardrail/id")
GUARDRAIL_VERSION_PARAM = os.environ.get("GUARDRAIL_VERSION_PARAM", "/studiox/guardrail/version")
QUOTA_LIMIT = int(os.environ.get("QUOTA_LIMIT", "300"))
# Each upload starts Transcribe and the analyst agent, so uploads are a live feature with their own cap.
UPLOAD_LIMIT = int(os.environ.get("UPLOAD_LIMIT", "10"))


def _store():
    import store  # imported lazily so pure helpers and tests need no boto3
    return store


def iso(ts=None):
    return datetime.fromtimestamp(ts if ts is not None else time.time(), timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class Request:
    def __init__(self, event, params):
        self.event = event
        self.params = params
        self.headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
        self.set_cookies = []
        self.caller = None

    @property
    def body(self):
        raw = self.event.get("body")
        if not raw:
            return {}
        if self.event.get("isBase64Encoded"):
            raw = base64.b64decode(raw).decode("utf-8")
        try:
            return json.loads(raw)
        except ValueError:
            raise ApiError(400, "invalid_json", "Request body is not valid JSON")

    @property
    def query(self):
        return self.event.get("queryStringParameters") or {}


# ---------------------------------------------------------------- auth

def tv_auth(req):
    parsed = auth.parse_device_header(req.headers.get("authorization"))
    if parsed:
        dev = _store().get(f"DEVICE#{parsed[0]}")
        if dev and secrets.compare_digest(dev["secretHash"], util.sha256(parsed[1])):
            return {"kind": "tv", "deviceId": parsed[0], "linkId": dev.get("linkId"), "name": dev.get("name", "TV")}
    raise ApiError(401, "unauthorized", "Valid device credentials required")


def phone_auth(req):
    cookies = auth.parse_cookies(req.headers.get("cookie"), req.event.get("cookies"))
    token = cookies.get(auth.COOKIE_NAME)
    if token:
        item = _store().get(f"TOKEN#{util.sha256(token)}")
        if item and int(item.get("ttl", 0)) > time.time():
            return {"kind": "phone", "token": token, "phoneId": item["phoneId"],
                    "linkId": item["linkId"], "phoneName": item["phoneName"]}
    raise ApiError(401, "unauthorized", "Not paired")


def any_auth(req):
    if req.headers.get("authorization"):
        return tv_auth(req)
    return phone_auth(req)


def link_member(req, link_id):
    caller = any_auth(req)
    if caller["linkId"] != link_id:
        raise ApiError(403, "forbidden", "Not a member of this link")
    link = _store().get(f"LINK#{link_id}")
    if not link:
        raise ApiError(404, "not_found", "Link not found")
    caller["link"] = link
    return caller


# ---------------------------------------------------------------- devices & pairing

@router.route("POST", "/devices")
def create_device(req):
    name = util.require_str(req.body, "name", 60)
    device_id, secret = secrets.token_urlsafe(12), secrets.token_urlsafe(32)
    _store().put({"PK": f"DEVICE#{device_id}", "SK": "META", "name": name,
                  "secretHash": util.sha256(secret), "createdAt": iso()})
    return 201, {"deviceId": device_id, "deviceSecret": secret}


@router.route("POST", "/pairings")
def create_pairing(req):
    st = _store()
    tv = tv_auth(req)
    link_id = tv["linkId"]
    if not link_id:
        link_id = util.ulid()
        st.put({"PK": f"LINK#{link_id}", "SK": "META", "deviceId": tv["deviceId"],
                "tvName": tv["name"], "createdAt": iso()})
        st.table().update_item(Key={"PK": f"DEVICE#{tv['deviceId']}", "SK": "META"},
                               UpdateExpression="SET linkId = :l", ExpressionAttributeValues={":l": link_id})
    expires = int(time.time()) + PAIR_TTL
    for _ in range(5):
        code = util.pairing_code()
        try:
            st.put({"PK": f"PAIR#{code}", "SK": "META", "deviceId": tv["deviceId"], "linkId": link_id,
                    "ttl": expires}, condition="attribute_not_exists(PK)")
            break
        except st.table().meta.client.exceptions.ConditionalCheckFailedException:
            continue
    else:
        raise ApiError(503, "busy", "Could not allocate a pairing code")
    return 200, {"code": code, "url": f"https://{st.domain()}/link/p/{code}", "expiresAt": iso(expires)}


def _pair_item(code):
    if not util.valid_code(code):
        return None
    item = _store().get(f"PAIR#{code}")
    if item and int(item["ttl"]) > time.time():
        return item
    return None


@router.route("GET", "/pairings/{code}")
def get_pairing(req):
    tv = tv_auth(req)
    item = _pair_item(req.params["code"])
    if not item or item["deviceId"] != tv["deviceId"]:
        return 200, {"status": "expired"}
    if item.get("redeemedAt"):
        return 200, {"status": "linked", "linkId": item["linkId"], "phoneName": item.get("phoneName")}
    return 200, {"status": "waiting"}


@router.route("POST", "/pairings/{code}/redeem")
def redeem_pairing(req):
    st = _store()
    phone_name = util.require_str(req.body, "phoneName", 60)
    item = _pair_item(req.params["code"])
    if not item:
        raise ApiError(404, "pairing_expired", "This code is invalid or has expired")
    try:  # single use
        st.table().update_item(
            Key={"PK": f"PAIR#{req.params['code']}", "SK": "META"},
            UpdateExpression="SET redeemedAt = :t, phoneName = :n",
            ConditionExpression="attribute_exists(PK) AND attribute_not_exists(redeemedAt)",
            ExpressionAttributeValues={":t": iso(), ":n": phone_name})
    except st.table().meta.client.exceptions.ConditionalCheckFailedException:
        raise ApiError(409, "pairing_used", "This code has already been used")
    link = st.get(f"LINK#{item['linkId']}")
    token, phone_id = auth.new_token(), secrets.token_urlsafe(9)
    st.put({"PK": f"TOKEN#{util.sha256(token)}", "SK": "META", "linkId": item["linkId"],
            "phoneId": phone_id, "phoneName": phone_name, "ttl": int(time.time()) + TOKEN_TTL})
    req.set_cookies.append(auth.build_cookie(token))
    return 200, {"linkId": item["linkId"], "tvName": link["tvName"]}


@router.route("GET", "/me")
def get_me(req):
    st = _store()
    phone = phone_auth(req)
    st.table().update_item(Key={"PK": f"TOKEN#{util.sha256(phone['token'])}", "SK": "META"},
                           UpdateExpression="SET #ttl = :t", ExpressionAttributeNames={"#ttl": "ttl"},
                           ExpressionAttributeValues={":t": int(time.time()) + TOKEN_TTL})
    req.set_cookies.append(auth.build_cookie(phone["token"]))
    link = st.get(f"LINK#{phone['linkId']}") or {}
    return 200, {"linkId": phone["linkId"], "phoneName": phone["phoneName"], "tvName": link.get("tvName", "TV")}


@router.route("DELETE", "/me")
def delete_me(req):
    phone = phone_auth(req)
    _store().table().delete_item(Key={"PK": f"TOKEN#{util.sha256(phone['token'])}", "SK": "META"})
    req.set_cookies.append(auth.clear_cookie())
    return 204, None


# ---------------------------------------------------------------- messages & now playing

def put_message(link_id, sender, kind, text=None, card=None, media_id=None, t=None, status=None):
    msg = {"id": util.ulid(), "at": iso(), "from": sender, "kind": kind}
    if text:
        msg["text"] = text
    if card is not None:
        msg["card"] = card
    if media_id:
        msg["mediaId"] = media_id
    if t is not None:
        msg["t"] = t
    if status is not None:
        msg["status"] = status
    item = {"PK": f"LINK#{link_id}", "SK": f"MSG#{msg['id']}", "msg": json.loads(json.dumps(msg), parse_float=Decimal),
            "ttl": int(time.time()) + MSG_TTL}
    _store().put(item)
    return msg


@router.route("GET", "/links/{linkId}/messages")
def list_messages(req):
    link_id = req.params["linkId"]
    link_member(req, link_id)
    after = req.query.get("after")
    if after and not util.valid_ulid(after):
        raise ApiError(400, "invalid_request", "'after' must be a message id")
    items = _store().query_after(f"LINK#{link_id}", "MSG#", after, 50)
    messages = [_store().plain(i["msg"]) for i in items]
    return 200, {"messages": messages, "cursor": messages[-1]["id"] if messages else after}


@router.route("POST", "/links/{linkId}/messages")
def post_message(req):
    caller = link_member(req, req.params["linkId"])
    kind, text, card = util.validate_message(req.body, caller["kind"])
    name = caller.get("phoneName") if caller["kind"] == "phone" else caller["name"]
    body = req.body
    media_id = body.get("mediaId") if isinstance(body.get("mediaId"), str) else None
    t = body.get("t") if isinstance(body.get("t"), (int, float)) and not isinstance(body.get("t"), bool) else None
    msg = put_message(req.params["linkId"], {"kind": caller["kind"], "name": name}, kind,
                      text=text, card=card, media_id=media_id, t=t)
    if kind == "question" and caller["kind"] == "phone":
        _auto_answer(req.params["linkId"], caller, text, media_id, t)
    return 201, msg


@router.route("PUT", "/links/{linkId}/now")
def put_now(req):
    caller = link_member(req, req.params["linkId"])
    if caller["kind"] != "tv":
        raise ApiError(403, "forbidden", "Only the TV reports what is playing")
    b = req.body
    title = util.require_str(b, "title", 200)
    media_id = util.require_str(b, "mediaId", 80)
    t, playing = b.get("t"), b.get("playing")
    if isinstance(t, bool) or not isinstance(t, (int, float)) or t < 0 or not isinstance(playing, bool):
        raise ApiError(400, "invalid_request", "'t' must be a number >= 0 and 'playing' a boolean")
    _store().put({"PK": f"LINK#{req.params['linkId']}", "SK": "NOW", "mediaId": media_id, "title": title,
                  "t": Decimal(str(t)), "playing": playing, "updatedAt": iso()})
    return 204, None


@router.route("GET", "/links/{linkId}/now")
def get_now(req):
    link_member(req, req.params["linkId"])
    item = _store().get(f"LINK#{req.params['linkId']}", "NOW")
    if not item:
        return 200, {}
    return 200, {k: _store().plain(item[k]) for k in ("mediaId", "title", "t", "playing", "updatedAt")}


# ---------------------------------------------------------------- uploads & media

def _presign_parts(media, numbers):
    st = _store()
    return [{"n": n, "url": st.s3().generate_presigned_url(
        "upload_part",
        Params={"Bucket": st.bucket(), "Key": media["key"], "UploadId": media["uploadId"], "PartNumber": n},
        ExpiresIn=URL_EXPIRY)} for n in numbers]


def _owned_media(req, media_id):
    phone = phone_auth(req)
    media = _store().get(f"MEDIA#{media_id}")
    if not media or media["linkId"] != phone["linkId"] or media["phoneId"] != phone["phoneId"]:
        raise ApiError(404, "not_found", "Media not found")
    return phone, media


@router.route("POST", "/uploads")
def create_upload(req):
    st = _store()
    phone = phone_auth(req)
    name, size, ctype = util.validate_upload(req.body)
    _require_live()
    _consume_quota("uploads", UPLOAD_LIMIT)
    media_id = util.ulid()
    key = f"uploads/{media_id}/{name}"
    upload_id = st.s3().create_multipart_upload(Bucket=st.bucket(), Key=key, ContentType=ctype)["UploadId"]
    count = util.part_count(size)
    media = {"PK": f"MEDIA#{media_id}", "SK": "META", "linkId": phone["linkId"], "phoneId": phone["phoneId"],
             "status": "UPLOADING", "key": key, "uploadId": upload_id, "name": name, "size": size,
             "type": ctype, "partCount": count, "createdAt": iso()}
    st.put(media)
    st.put(media_pointer(phone["linkId"], media_id, media["createdAt"]))
    return 201, {"mediaId": media_id, "partSize": util.PART_SIZE,
                 "parts": _presign_parts(media, range(1, min(FIRST_PARTS, count) + 1))}


@router.route("POST", "/uploads/{mediaId}/parts")
def more_parts(req):
    _, media = _owned_media(req, req.params["mediaId"])
    if media["status"] != "UPLOADING":
        raise ApiError(409, "bad_state", "Upload is no longer in progress")
    numbers = req.body.get("numbers") if isinstance(req.body, dict) else None
    count = int(media["partCount"])
    if (not isinstance(numbers, list) or not numbers or len(numbers) > MAX_PARTS_REQUEST
            or any(isinstance(n, bool) or not isinstance(n, int) or not 1 <= n <= count for n in numbers)):
        raise ApiError(400, "invalid_request", f"'numbers' must be 1 to {MAX_PARTS_REQUEST} part numbers within 1..{count}")
    return 200, {"parts": _presign_parts(media, sorted(set(numbers)))}


@router.route("POST", "/uploads/{mediaId}/complete")
def complete_upload(req):
    st = _store()
    phone, media = _owned_media(req, req.params["mediaId"])
    if media["status"] != "UPLOADING":
        raise ApiError(409, "bad_state", "Upload is no longer in progress")
    parts = req.body.get("parts") if isinstance(req.body, dict) else None
    count = int(media["partCount"])
    if (not isinstance(parts, list) or len(parts) != count
            or any(not isinstance(p, dict) or isinstance(p.get("n"), bool) or not isinstance(p.get("n"), int)
                   or not isinstance(p.get("etag"), str) or not p["etag"] for p in parts)
            or sorted(p["n"] for p in parts) != list(range(1, count + 1))):
        raise ApiError(400, "invalid_request", f"'parts' must list all {count} parts as {{n, etag}}")
    ordered = sorted(parts, key=lambda p: p["n"])
    try:
        st.s3().complete_multipart_upload(
            Bucket=st.bucket(), Key=media["key"], UploadId=media["uploadId"],
            MultipartUpload={"Parts": [{"PartNumber": p["n"], "ETag": p["etag"]} for p in ordered]})
    except Exception as exc:  # S3 rejects bad ETags / missing parts
        log.warning("complete_multipart_upload failed: %s", type(exc).__name__)
        raise ApiError(400, "upload_incomplete", "S3 could not assemble the parts; check part numbers and ETags")
    st.table().update_item(Key={"PK": f"MEDIA#{media['PK'][6:]}", "SK": "META"},
                           UpdateExpression="SET #s = :p", ExpressionAttributeNames={"#s": "status"},
                           ExpressionAttributeValues={":p": "PROCESSING"})
    media_id = media["PK"][6:]
    # S3 emits Object Created for the finished upload; EventBridge starts StudioX-EpisodeAnalysis.
    put_message(media["linkId"], {"kind": "system", "name": "StudioX"}, "status", media_id=media_id,
                status={"mediaId": media_id, "state": "PROCESSING", "progress": 0})
    return 200, {"mediaId": media_id, "status": "PROCESSING"}


def media_pointer(link_id, media_id, created_at):
    """Index item so a link's uploads can be listed without a GSI (CONTRACTS section 8)."""
    return {"PK": f"LINK#{link_id}", "SK": f"MEDIA#{created_at}#{media_id}", "mediaId": media_id}


def media_summary(media_id, row, domain):
    """One element of GET /v1/links/{id}/media."""
    out = {"mediaId": media_id, "title": row.get("title") or row.get("name") or media_id,
           "status": row.get("status"), "playable": bool(row.get("playable")),
           "createdAt": row.get("createdAt")}
    if row.get("progress") is not None:
        out["progress"] = float(row["progress"])
    if row.get("durationSec") is not None:
        out["durationSec"] = int(row["durationSec"])
    if row.get("mediaUrl"):
        out["mediaUrl"] = row["mediaUrl"]
    if row.get("status") == "READY" and row.get("packageKey"):
        out["packageUrl"] = f"https://{domain}/{row['packageKey']}"
    return out


@router.route("GET", "/links/{linkId}/media")
def list_link_media(req):
    link_id = req.params["linkId"]
    link_member(req, link_id)
    from boto3.dynamodb.conditions import Key
    st = _store()
    resp = st.table().query(
        KeyConditionExpression=Key("PK").eq(f"LINK#{link_id}") & Key("SK").between("MEDIA#", "MEDIA#~"),
        Limit=20, ScanIndexForward=False)
    out = []
    for item in resp["Items"]:
        row = st.get(f"MEDIA#{item['mediaId']}")
        if row and row.get("linkId") == link_id:
            out.append(media_summary(item["mediaId"], row, st.domain()))
    return 200, {"media": out}


@router.route("GET", "/media/{mediaId}")
def get_media(req):
    st = _store()
    caller = any_auth(req)
    media = st.get(f"MEDIA#{req.params['mediaId']}")
    if not media or media["linkId"] != caller["linkId"]:
        raise ApiError(404, "not_found", "Media not found")
    if caller["kind"] == "phone" and media["phoneId"] != caller["phoneId"]:
        raise ApiError(404, "not_found", "Media not found")
    out = {"mediaId": req.params["mediaId"], "title": media.get("title") or media["name"],
           "status": media["status"], "playable": media["status"] == "READY"}
    if media.get("progress") is not None:
        out["progress"] = st.plain(media["progress"])
    if media["status"] == "READY" and media.get("packageKey"):
        out["packageUrl"] = f"https://{st.domain()}/{media['packageKey']}"
    return 200, out


# ---------------------------------------------------------------- live routes (coviewer) & episodes

def _flag(name, default=None):
    """SSM parameter, or `default` when it does not exist."""
    try:
        return _store().param(name)
    except Exception as exc:
        if type(exc).__name__ == "ParameterNotFound":
            return default
        raise


def _live_caller(req):
    """TV (device header and/or the shared access code) or phone (cookie)."""
    header = req.headers.get("x-studiox-access")
    if req.headers.get("authorization"):
        caller = tv_auth(req)
    elif header:
        caller = {"kind": "tv", "deviceId": None, "linkId": None, "name": "TV"}
    else:
        return phone_auth(req)
    expected = _flag(ACCESS_PARAM, "unset")
    if expected in ("", "unset"):
        raise ApiError(503, "ACCESS_CODE_UNSET", "The live access code has not been configured")
    if not live.access_ok(header, expected):
        raise ApiError(403, "access_denied", "Missing or wrong x-studiox-access code")
    return caller


def _require_live():
    if (_flag(LIVE_PARAM, "off") or "off").strip().lower() != "on":
        raise ApiError(503, "LIVE_OFF", "Live answers are switched off")


def _consume_quota(kind="calls", limit=None):
    st = _store()
    limit = QUOTA_LIMIT if limit is None else limit
    pk = live.quota_pk() if kind == "calls" else live.quota_pk().replace("QUOTA#", "QUOTA#UPLOAD#")
    try:
        st.table().update_item(
            Key={"PK": pk, "SK": "META"},
            UpdateExpression="ADD calls :one SET #ttl = :ttl",
            ConditionExpression="attribute_not_exists(calls) OR calls < :limit",
            ExpressionAttributeNames={"#ttl": "ttl"},
            ExpressionAttributeValues={":one": 1, ":limit": limit, ":ttl": int(time.time()) + live.QUOTA_TTL})
    except st.table().meta.client.exceptions.ConditionalCheckFailedException:
        raise ApiError(429, "QUOTA_EXCEEDED", f"The daily limit for live {kind} has been reached")


def _coviewer(body, session_id, read_timeout=live.AGENT_TIMEOUT):
    arn = _flag(COVIEWER_PARAM, "unset")
    if not arn or arn == "unset":
        raise ApiError(503, "AGENT_NOT_DEPLOYED", "The co-viewer agent is not deployed")
    try:
        result = live.invoke_agent(arn, body, session_id, read_timeout)
    except Exception:
        log.exception("coviewer call failed")
        raise ApiError(502, "agent_error", "The co-viewer did not answer")
    if not isinstance(result, dict):
        raise ApiError(502, "agent_error", "The co-viewer returned an unexpected response")
    return result


def _screen(text):
    """Prompt-attack screen for viewer questions. Fails open (the agent enforces its own rules) but logs."""
    try:
        gid, ver = _flag(GUARDRAIL_ID_PARAM), _flag(GUARDRAIL_VERSION_PARAM)
        if not gid or not ver:
            return
        ok = live.screen_question(gid, ver, text)
    except Exception:
        log.warning("guardrail screen unavailable", exc_info=True)
        return
    if not ok:
        raise ApiError(400, "question_blocked", "That question cannot be answered")


def _ask(session_id, viewer_id, media_id, t, question):
    _screen(question)
    _consume_quota()
    res = _coviewer({"action": "ask", "sessionId": session_id, "viewerId": viewer_id, "mediaId": media_id,
                     "t": t, "question": question}, session_id)
    if not isinstance(res.get("text"), str):
        raise ApiError(502, "agent_error", "The co-viewer returned an unexpected answer")
    return res


def _sources_card(res):
    sources = [{"title": str(x.get("title", ""))[:200], "url": x["url"]}
               for x in (res.get("sources") or [])[:5]
               if isinstance(x, dict) and isinstance(x.get("url"), str) and x["url"].startswith("https://")]
    return {"type": "link", "title": "Sources", "sources": sources} if sources else None


_AUTO_FALLBACK = {
    "LIVE_OFF": "Live answers are switched off right now.",
    "QUOTA_EXCEEDED": "The daily limit for live answers has been reached. Try again tomorrow.",
    "question_blocked": "I can't help with that question.",
}


def _auto_answer(link_id, phone, question, msg_media, msg_t):
    """A phone question gets an `answer` message from the coviewer, using what the TV last reported playing."""
    st = _store()
    now = st.get(f"LINK#{link_id}", "NOW") or {}
    media_id = now.get("mediaId") or msg_media
    t = float(now["t"]) if now.get("t") is not None else msg_t
    card = None
    try:
        if not media_id or t is None:
            text = "Start something playing on your TV, then ask again."
        else:
            _require_live()
            _consume_quota()
            res = _ask(live.link_session_id(link_id), phone["phoneId"], media_id, float(t), question)
            text, card = res["text"][:util.MAX_TEXT], _sources_card(res)
    except ApiError as exc:
        text = _AUTO_FALLBACK.get(exc.code, "I couldn't answer that just now. Try again in a moment.")
    except Exception:
        log.exception("auto-answer failed")
        text = "I couldn't answer that just now. Try again in a moment."
    try:
        put_message(link_id, {"kind": "ai", "name": "StudioX"}, "answer", text=text, card=card,
                    media_id=media_id, t=t)
    except Exception:
        log.exception("could not store the answer")


@router.route("POST", "/sessions")
def create_session(req):
    _live_caller(req)
    media_id, _ = live.validate_ids(req.body, with_session=False)
    session_id = live.new_session_id()
    try:  # best-effort warm-up of the coviewer microVM; a failure costs nothing
        if (_flag(LIVE_PARAM, "off") or "off").strip().lower() == "on":
            arn = _flag(COVIEWER_PARAM, "unset")
            if arn and arn != "unset":
                live.invoke_agent(arn, {"action": "warm", "sessionId": session_id, "mediaId": media_id}, session_id, 3)
    except Exception as exc:
        log.info("warm-up skipped: %s", type(exc).__name__)
    return 200, {"sessionId": session_id}


@router.route("POST", "/refine")
def refine(req):
    _live_caller(req)
    body = req.body
    media_id, session_id = live.validate_ids(body)
    t = live.validate_t(body.get("t"))
    _require_live()
    st = _store()
    sk = str(live.refine_bucket(t))
    cached = st.get(f"REFINE#{media_id}", sk)
    if cached and int(cached.get("ttl", 0)) > time.time():
        return 200, json.loads(cached["resp"])
    _consume_quota()
    res = _coviewer({"action": "refine", "sessionId": session_id, "mediaId": media_id, "t": t}, session_id)
    raw = json.dumps(res)
    if len(raw) < 300000:
        st.put({"PK": f"REFINE#{media_id}", "SK": sk, "resp": raw, "ttl": int(time.time()) + live.REFINE_TTL})
    return 200, res


@router.route("POST", "/ask")
def ask(req):
    caller = _live_caller(req)
    body = req.body
    media_id, session_id = live.validate_ids(body)
    t = live.validate_t(body.get("t"))
    question = util.require_str(body, "question", live.MAX_QUESTION)
    _require_live()
    viewer = caller.get("phoneId") or caller.get("deviceId") or "tv"
    return 200, _ask(session_id, viewer, media_id, t, question)


_pkg_cache = {}


def _has_package(media_id):
    hit = _pkg_cache.get(media_id)
    if hit and time.time() - hit[1] < 30:
        return hit[0]
    st = _store()
    try:
        found = st.s3().list_objects_v2(Bucket=st.bucket(), Prefix=f"packages/{media_id}/latest.json",
                                        MaxKeys=1).get("KeyCount", 0) > 0
    except Exception:
        log.warning("package lookup failed", exc_info=True)
        found = False
    _pkg_cache[media_id] = (found, time.time())
    return found


def _episode(media_id):
    """Public view of one episode, or None. Phone uploads (rows with a linkId) are private."""
    st = _store()
    row = st.get(f"MEDIA#{media_id}")
    if row and row.get("linkId"):
        row = None
    title = live.DEMO_EPISODES.get(media_id) or (row or {}).get("title")
    if not title:
        return None
    status = (row or {}).get("status")
    return live.episode_view(media_id, title, status, st.domain(), status != "READY" and _has_package(media_id))


@router.route("GET", "/episodes")
def list_episodes(req):
    return 200, {"episodes": [e for e in (_episode(m) for m in live.DEMO_EPISODES) if e]}


@router.route("GET", "/episodes/{mediaId}")
def get_episode(req):
    media_id = req.params["mediaId"]
    episode = _episode(media_id) if live.valid_media_id(media_id) else None
    if not episode:
        raise ApiError(404, "not_found", "Episode not found")
    return 200, episode


# ---------------------------------------------------------------- entry point

def _respond(status, body=None, cookies=None):
    resp = {"statusCode": status, "headers": {"content-type": "application/json", "cache-control": "no-store"}}
    if body is not None and status != 204:
        resp["body"] = json.dumps(body)
    if cookies:
        resp["cookies"] = cookies
    return resp


def _error(status, code, message):
    return _respond(status, {"error": {"code": code, "message": message}})


def handler(event, context):
    http = (event.get("requestContext") or {}).get("http") or {}
    method, path = http.get("method", ""), strip_prefix(http.get("path") or event.get("rawPath", "/"))
    try:
        fn, params, known = router.match(method, path)
        if fn is None:
            if known:
                return _error(405, "method_not_allowed", "Method not allowed")
            return _error(404, "not_found", "No such route")
        req = Request(event, params)
        status, body = fn(req)
        return _respond(status, body, req.set_cookies)
    except ApiError as exc:
        return _error(exc.status, exc.code, exc.message)
    except Exception:  # never leak internals
        log.exception("unhandled error on %s %s", method, path)
        return _error(500, "internal", "Internal error")
