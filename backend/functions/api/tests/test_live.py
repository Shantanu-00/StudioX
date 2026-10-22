import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import live  # noqa: E402
from util import ApiError  # noqa: E402


def test_session_ids_are_long_enough():
    assert len(live.new_session_id()) >= 33
    assert live.valid_session_id(live.new_session_id())
    link = "01JABCDEFGHJKMNPQRSTVWXYZ0"
    assert len(live.link_session_id(link)) >= 33 and live.valid_session_id(live.link_session_id(link))
    assert not live.valid_session_id("short")
    assert not live.valid_session_id("x" * 40 + " ")


def test_refine_bucket_is_five_seconds():
    assert live.refine_bucket(0) == 0
    assert live.refine_bucket(4.99) == 0
    assert live.refine_bucket(5) == 1
    assert live.refine_bucket(11.2) == 2


def test_quota_key_is_utc_date():
    assert live.quota_pk(0) == "QUOTA#1970-01-01"
    assert live.quota_pk(86400 * 365) == "QUOTA#1971-01-01"


def test_access_code():
    assert live.access_ok("abc", "abc")
    assert not live.access_ok("abd", "abc")
    assert not live.access_ok(None, "abc")
    assert not live.access_ok("unset", "unset")
    assert not live.access_ok("", "")


def test_episode_view():
    e = live.episode_view("science-ep42", "T", None, "d.example", False)
    assert e == {"mediaId": "science-ep42", "title": "T", "status": "NONE", "mediaUrl": "https://d.example/media/science-ep42.mp4"}
    e = live.episode_view("science-ep42", "T", None, "d.example", True)
    assert e["status"] == "READY" and e["packageUrl"] == "https://d.example/packages/science-ep42/latest.json"
    e = live.episode_view("x", "T", "PROCESSING", "d.example", False)
    assert e["status"] == "PROCESSING" and "packageUrl" not in e
    assert set(live.DEMO_EPISODES) == {"science-ep42", "crime-case104"}


def test_validation():
    sid = live.new_session_id()
    assert live.validate_ids({"mediaId": "science-ep42", "sessionId": sid}) == ("science-ep42", sid)
    for bad in ({}, {"mediaId": "a/b", "sessionId": sid}, {"mediaId": "a", "sessionId": "short"}, None):
        with pytest.raises(ApiError):
            live.validate_ids(bad)
    assert live.validate_t(3) == 3.0
    for bad in (-1, "3", True, None):
        with pytest.raises(ApiError):
            live.validate_t(bad)
