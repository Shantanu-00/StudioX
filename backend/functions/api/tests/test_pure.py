import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import auth  # noqa: E402
import util  # noqa: E402
from router import Router, strip_prefix  # noqa: E402
from util import ApiError  # noqa: E402


def test_router_matches_params_and_methods():
    r = Router()
    r.add("GET", "/links/{linkId}/messages", lambda: 1)
    r.add("POST", "/links/{linkId}/messages", lambda: 2)
    fn, params, known = r.match("POST", "/links/abc/messages")
    assert fn() == 2 and params == {"linkId": "abc"} and known
    fn, _, known = r.match("DELETE", "/links/abc/messages")
    assert fn is None and known
    fn, _, known = r.match("GET", "/nope")
    assert fn is None and not known
    assert r.match("GET", "/links/a/b/messages")[0] is None


def test_strip_prefix():
    assert strip_prefix("/v1/me") == "/me"
    assert strip_prefix("/v1") == "/"
    assert strip_prefix("/me") == "/me"
    assert strip_prefix("/v10/me") == "/v10/me"


def test_cookie_build_and_parse():
    c = auth.build_cookie("tok")
    for part in ("sx=tok", "HttpOnly", "Secure", "SameSite=Strict", "Path=/", f"Max-Age={30 * 86400}"):
        assert part in c
    assert auth.parse_cookies("a=1; sx=tok; b=2") == {"a": "1", "sx": "tok", "b": "2"}
    assert auth.parse_cookies(None, ["sx=tok2"])["sx"] == "tok2"
    assert "Max-Age=0" in auth.clear_cookie()
    assert len(auth.new_token()) >= 43


def test_device_header():
    secret = "s" * 43
    assert auth.parse_device_header(f"Device abcdefgh1234:{secret}") == ("abcdefgh1234", secret)
    assert auth.parse_device_header("Bearer x") is None
    assert auth.parse_device_header("Device short:x") is None
    assert auth.parse_device_header(None) is None


def test_ulid_format_and_order():
    ids = [util.ulid() for _ in range(2000)]
    assert all(len(i) == 26 and util.valid_ulid(i) for i in ids)
    assert ids == sorted(ids) and len(set(ids)) == len(ids)
    assert util.ulid(now_ms=9_000_000_000_000)[:10] < util.ulid(now_ms=10_000_000_000_000)[:10]


def test_ulid_same_millisecond_monotonic():
    a = util.ulid(now_ms=2_000_000_000_000)
    b = util.ulid(now_ms=2_000_000_000_000)
    c = util.ulid(now_ms=1_999_999_999_000)  # clock went backwards
    assert a < b < c


def test_pairing_code():
    for _ in range(500):
        code = util.pairing_code()
        assert len(code) == 6 and util.valid_code(code)
        assert not set(code) & set("0O1IL")
    assert not util.valid_code("ABC0EF") and not util.valid_code("abc")


def test_sanitize_filename():
    assert util.sanitize_filename("../../etc/passwd") == "passwd"
    assert util.sanitize_filename("My Episode (final).mp4") == "My_Episode_final_.mp4"
    assert util.sanitize_filename("") == "file"
    assert util.sanitize_filename("...") == "file"
    assert len(util.sanitize_filename("a" * 500 + ".mp4")) <= 120


def test_message_validation():
    assert util.validate_message({"kind": "text", "text": " hi "}, "phone") == ("text", "hi", None)
    assert util.validate_message({"kind": "question", "text": "who?"}, "phone")[0] == "question"
    with pytest.raises(ApiError):
        util.validate_message({"kind": "share", "card": {}}, "phone")
    with pytest.raises(ApiError):
        util.validate_message({"kind": "text", "text": "x" * 2001}, "tv")
    with pytest.raises(ApiError):
        util.validate_message({"kind": "text", "text": "  "}, "tv")
    assert util.validate_message({"kind": "share", "card": {"type": "link"}}, "tv")[2] == {"type": "link"}
    with pytest.raises(ApiError):
        util.validate_message({"kind": "share", "card": {"x": "y" * 9000}}, "tv")
    with pytest.raises(ApiError):
        util.validate_message(["nope"], "tv")


def test_upload_validation():
    name, size, ctype = util.validate_upload({"name": "a b.mp4", "size": 20_000_000, "type": "video/mp4"})
    assert (name, size, ctype) == ("a_b.mp4", 20_000_000, "video/mp4")
    for bad in ({"name": "a", "size": 0, "type": "video/mp4"},
                {"name": "a", "size": 4 * 1024 ** 3 + 1, "type": "video/mp4"},
                {"name": "a", "size": True, "type": "video/mp4"},
                {"name": "a", "size": 5, "type": "nonsense"}):
        with pytest.raises(ApiError):
            util.validate_upload(bad)
    assert util.part_count(1) == 1 and util.part_count(util.PART_SIZE) == 1
    assert util.part_count(util.PART_SIZE + 1) == 2


def test_handler_unknown_route_and_errors_without_aws():
    import app
    ev = {"requestContext": {"http": {"method": "GET", "path": "/v1/zzz"}}}
    assert app.handler(ev, None)["statusCode"] == 404
    ev = {"requestContext": {"http": {"method": "PATCH", "path": "/v1/me"}}}
    assert app.handler(ev, None)["statusCode"] == 405


def test_media_pointer_and_summary():
    from decimal import Decimal
    import app
    ptr = app.media_pointer("L1", "M1", "2026-10-22T10:00:00Z")
    assert ptr == {"PK": "LINK#L1", "SK": "MEDIA#2026-10-22T10:00:00Z#M1", "mediaId": "M1"}
    row = {"title": "Clip", "status": "READY", "progress": Decimal("1"), "playable": True,
           "mediaUrl": "https://d/media/M1.frag.mp4", "packageKey": "packages/M1/latest.json", "createdAt": "t"}
    out = app.media_summary("M1", row, "d")
    assert out["packageUrl"] == "https://d/packages/M1/latest.json" and out["playable"] is True
    assert out["progress"] == 1.0 and out["mediaUrl"].endswith(".frag.mp4")
    pending = app.media_summary("M2", {"name": "a.mp4", "status": "ANALYSING", "createdAt": "t"}, "d")
    assert pending["title"] == "a.mp4" and pending["playable"] is False and "packageUrl" not in pending
