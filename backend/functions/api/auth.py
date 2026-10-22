"""Pure auth helpers: header parsing and cookies."""
import re
import secrets

COOKIE_NAME = "sx"
COOKIE_MAX_AGE = 30 * 24 * 3600


def parse_device_header(value):
    """'Device <id>:<secret>' -> (id, secret) or None."""
    if not isinstance(value, str):
        return None
    m = re.fullmatch(r"Device ([A-Za-z0-9_-]{8,64}):([A-Za-z0-9_-]{16,128})", value.strip())
    return (m.group(1), m.group(2)) if m else None


def parse_cookies(header_value=None, cookies_list=None):
    """Accepts the v2 `cookies` list or a raw Cookie header."""
    out = {}
    parts = list(cookies_list or [])
    if header_value:
        parts += header_value.split(";")
    for part in parts:
        for piece in part.split(";"):
            if "=" in piece:
                k, v = piece.split("=", 1)
                out.setdefault(k.strip(), v.strip())
    return out


def new_token():
    return secrets.token_urlsafe(32)


def build_cookie(token, max_age=COOKIE_MAX_AGE):
    return f"{COOKIE_NAME}={token}; Max-Age={max_age}; Path=/; HttpOnly; Secure; SameSite=Strict"


def clear_cookie():
    return build_cookie("", 0)
