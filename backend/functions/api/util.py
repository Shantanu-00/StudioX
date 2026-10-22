"""Pure helpers: ULID, pairing codes, hashing, validation, file names."""
import hashlib
import os
import re
import secrets
import time

CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0 O 1 I L
CODE_LENGTH = 6
PART_SIZE = 16 * 1024 * 1024
MAX_SIZE = 1024 * 1024 * 1024  # 1 GiB: enough for a demo upload, bounded for cost
MAX_TEXT = 2000
MAX_CARD_BYTES = 8 * 1024
PHONE_KINDS = ("text", "question")
TV_KINDS = ("text", "share")


class ApiError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def sha256(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


_last = {"ms": -1, "rand": 0}


def ulid(now_ms=None):
    """26-char ULID. Strictly increasing within a process, even in the same ms."""
    ms = int(time.time() * 1000) if now_ms is None else now_ms
    if ms <= _last["ms"]:
        ms = _last["ms"]
        rand = _last["rand"] + 1
        if rand >= 1 << 80:
            ms += 1
            rand = int.from_bytes(os.urandom(10), "big")
    else:
        rand = int.from_bytes(os.urandom(10), "big") >> 1  # headroom for increments
    _last["ms"], _last["rand"] = ms, rand
    n = (ms << 80) | rand
    out = []
    for _ in range(26):
        out.append(CROCKFORD[n & 31])
        n >>= 5
    return "".join(reversed(out))


def pairing_code():
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))


def valid_code(code):
    return isinstance(code, str) and len(code) == CODE_LENGTH and all(c in CODE_ALPHABET for c in code)


def valid_ulid(value):
    return isinstance(value, str) and len(value) == 26 and all(c in CROCKFORD for c in value)


def sanitize_filename(name):
    name = str(name or "").replace("\\", "/").split("/")[-1]
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("._")
    name = re.sub(r"\.{2,}", ".", name)
    return (name or "file")[:120]


def require_str(body, field, max_len, allow_empty=False):
    value = body.get(field) if isinstance(body, dict) else None
    if not isinstance(value, str):
        raise ApiError(400, "invalid_request", f"'{field}' must be a string")
    value = value.strip()
    if not value and not allow_empty:
        raise ApiError(400, "invalid_request", f"'{field}' must not be empty")
    if len(value) > max_len:
        raise ApiError(400, "invalid_request", f"'{field}' is too long (max {max_len})")
    return value


def validate_message(body, caller):
    """caller is 'phone' or 'tv'. Returns (kind, text, card)."""
    if not isinstance(body, dict):
        raise ApiError(400, "invalid_request", "JSON object expected")
    kind = body.get("kind")
    allowed = PHONE_KINDS if caller == "phone" else TV_KINDS
    if kind not in allowed:
        raise ApiError(400, "invalid_request", f"'kind' must be one of {', '.join(allowed)}")
    if kind == "share":
        import json
        card = body.get("card")
        if not isinstance(card, dict):
            raise ApiError(400, "invalid_request", "'card' must be an object")
        if len(json.dumps(card, separators=(",", ":")).encode("utf-8")) > MAX_CARD_BYTES:
            raise ApiError(400, "invalid_request", "'card' is too large (max 8 KB)")
        text = body.get("text", "")
        if not isinstance(text, str) or len(text) > MAX_TEXT:
            raise ApiError(400, "invalid_request", "'text' is invalid")
        return kind, text.strip(), card
    return kind, require_str(body, "text", MAX_TEXT), None


def validate_upload(body):
    name = require_str(body, "name", 255)
    size = body.get("size")
    if isinstance(size, bool) or not isinstance(size, int) or size <= 0 or size > MAX_SIZE:
        raise ApiError(400, "invalid_request", "'size' must be an integer from 1 byte to 1 GiB")
    ctype = require_str(body, "type", 100)
    if not re.fullmatch(r"[\w.+-]+/[\w.+-]+", ctype):
        raise ApiError(400, "invalid_request", "'type' must be a media type")
    return sanitize_filename(name), size, ctype


def part_count(size):
    return -(-size // PART_SIZE)
