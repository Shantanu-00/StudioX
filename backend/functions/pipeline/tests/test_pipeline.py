import os
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(HERE, "..", "..", "..", "shared", "python"))  # the studiox_core layer

import common  # noqa: E402
import invoke_agent  # noqa: E402
import normalise  # noqa: E402
import publish  # noqa: E402
import set_status  # noqa: E402
import start_pipeline  # noqa: E402
import verify  # noqa: E402


def word(text, a, b, kind="pronunciation"):
    return {"type": kind, "start_time": str(a), "end_time": str(b), "alternatives": [{"content": text}]}


def punct(text):
    return {"type": "punctuation", "alternatives": [{"content": text}]}


RAW = {"results": {
    "speaker_labels": {"segments": [
        {"items": [{"start_time": "0.0", "end_time": "0.5", "speaker_label": "spk_0"},
                   {"start_time": "0.5", "end_time": "1.0", "speaker_label": "spk_0"}]},
        {"items": [{"start_time": "1.2", "end_time": "1.6", "speaker_label": "spk_1"}]}]},
    "items": [word("Hello", 0.0, 0.5), word("there", 0.5, 1.0), punct("."),
              word("Hi", 1.2, 1.6), punct("!")]}}


def test_from_transcribe_splits_sentences_and_speakers():
    t = normalise.from_transcribe(RAW, "m1")
    assert [s["text"] for s in t["sentences"]] == ["Hello there.", "Hi!"]
    assert [s["speaker"] for s in t["sentences"]] == ["spk_0", "spk_1"]
    assert t["sentences"][0]["t0"] == 0.0 and t["sentences"][0]["t1"] == 1.0
    assert t["speakers"] == {"spk_0": "Speaker 1", "spk_1": "Speaker 2"}
    assert t["durationSec"] == 1.6 and t["speech"]["words"] == 3 and t["source"] == "transcribe"


def test_from_transcribe_empty():
    t = normalise.from_transcribe({"results": {"items": []}}, "m1")
    assert t["sentences"] == [] and t["durationSec"] == 0.0


def test_complete_fills_stats_of_supplied_transcript():
    t, changed = normalise.complete({"mediaId": "m", "sentences": [{"t0": 0, "t1": 10, "speaker": "spk_0", "text": "a b c d"}]}, "m")
    assert changed and t["speech"] == {"words": 4, "speechSeconds": 10.0} and t["durationSec"] == 10.0
    with pytest.raises(ValueError):
        normalise.complete({"sentences": []}, "m")


def _tr(duration, words, seconds):
    return {"durationSec": duration, "sentences": [{"t0": 0, "t1": seconds, "speaker": "spk_0", "text": " ".join(["w"] * words)}]}


def test_eligibility_gate():
    e = normalise.eligibility(_tr(37.28, 92, 33.5))
    assert e["fit"] and e["speechPct"] == 90
    e = normalise.eligibility(_tr(600, 900, 100))
    assert not e["fit"] and e["speechPct"] == 17
    assert not normalise.eligibility(_tr(600, 100, 400))["fit"]  # 10 words per minute
    assert not normalise.eligibility({"durationSec": 0, "sentences": []})["fit"]


def test_status_text_and_message():
    assert set_status.status_text({"state": "NOT_A_FIT", "speechPct": 12}) == "NOT A FIT · 12% SPEECH"
    assert set_status.status_text({"state": "FAILED"}) == "Analysis failed"
    assert set_status.status_text({"state": "ANALYSING", "text": "Finding topics"}) == "Finding topics"
    m = common.status_message("m1", "ANALYSING", 0.4, "Finding topics", now=0)
    assert m["kind"] == "status" and m["from"]["kind"] == "system" and len(m["id"]) == 26
    assert m["status"] == {"mediaId": "m1", "state": "ANALYSING", "progress": 0.4} and m["at"] == "1970-01-01T00:00:00Z"
    with pytest.raises(ValueError):
        common.update_media("m", "BOGUS")


def test_start_pipeline_key_parsing():
    assert start_pipeline.parse_key("uploads/01ABC/talk.mp4") == ("01ABC", "talk.mp4")
    assert start_pipeline.parse_key("uploads/01ABC/") is None
    assert start_pipeline.parse_key("media/x.mp4") is None
    assert start_pipeline.parse_key("uploads/a/b/c.mp4") is None
    assert start_pipeline.build_input("m", "k", "T") == {"mediaId": "m", "mediaKey": "k", "title": "T"}


def test_invoke_agent_helpers():
    assert len(invoke_agent.session_id()) >= 33
    assert invoke_agent.run_key({"mediaId": "m", "execution": "e x", "name": "seg-0"}) == "runs/m/e_x/seg-0.json"
    docs = {"k.json": {"candidates": [1, 2], "rejected": []}}
    body = invoke_agent.build_payload({"mode": "curate"}, {"candidates": "k.json#candidates"}, docs.get)
    assert body == {"mode": "curate", "candidates": [1, 2]}
    body = invoke_agent.build_payload({"brief": {"cast": {"spk_0": "Ann"}, "recaps": []}}, None, docs.get)
    assert body["brief"]["cast"] == [{"id": "spk_0", "name": "Ann"}]
    assert invoke_agent.parse_response('{"a": 1}') == {"a": 1}
    with pytest.raises(invoke_agent.AgentError):
        invoke_agent.parse_response("nope")
    with pytest.raises(invoke_agent.AgentError):
        invoke_agent.parse_response('{"error": "boom"}')


def test_verify_helpers():
    claim = {"id": "c1", "type": "claim", "claim": "37% drop", "speaker": "A", "context": "said early", "source": "NIH", "evidence": []}
    # Only what the card says the episode said is grounded; the fact check's web context is not.
    assert verify.guard_text(claim) == "37% drop"
    assert verify.guard_text({"type": "technique", "caption": "breathe"}) is None
    dossier = {"id": "d", "type": "dossier", "name": "Ann", "role": "Doctor", "evidence": [{"t0": 1, "t1": 2}],
               "facts": [{"text": "Said she sleeps 6 hours", "evidence": {"t0": 1, "t1": 2}},
                         {"text": "Born 1970", "source": "Wikipedia"}]}
    assert verify.guard_text(dossier) == "Ann. Said she sleeps 6 hours"
    burst = {"type": "entity_list", "items": [{"name": "Apigenin", "asSaid": "50 mg of apigenin"}]}
    assert verify.guard_text(burst) == "Apigenin: 50 mg of apigenin"
    t = {"speakers": {"spk_0": "Ann"}, "sentences": [{"t0": 0, "t1": 5, "speaker": "spk_0", "text": "one"},
                                                       {"t0": 5, "t1": 9, "speaker": "spk_0", "text": "two"},
                                                       {"t0": 20, "t1": 25, "speaker": "spk_0", "text": "three"}]}
    assert verify.segment_text(t, {"start": 4, "end": 10}) == "Ann: one\nAnn: two"
    resp = {"assessments": [{"contextualGroundingPolicy": {"filters": [
        {"type": "GROUNDING", "score": 0.82, "threshold": 0.7, "action": "NONE"},
        {"type": "RELEVANCE", "score": 0.9, "threshold": 0.7, "action": "NONE"}]}}]}
    assert verify.grounding_score(resp) == (0.82, 0.9)
    assert verify.judge(0.82) == (True, "")
    keep, reason = verify.judge(0.41)
    assert not keep and "0.41" in reason
    assert not verify.judge(None)[0]
    seen = set()
    a, b = {"id": "w"}, {"id": "w"}
    verify.unique_id(a, seen, 0)
    verify.unique_id(b, seen, 2)
    assert a["id"] == "w" and b["id"] == "s2-w"


def test_collect_answers():
    items = [{"result": {"text": "yes", "cites": [1], "sources": [{"title": "t", "url": "https://x"}]}, "meta": {"question": "q?", "t": 11}},
             {"skipped": True, "error": "x"},
             {"result": {"nope": 1}, "meta": {"question": "q2", "t": 1}}]
    assert publish.collect_answers(items) == [{"question": "q?", "t": 11, "text": "yes", "cites": [1],
                                                "sources": [{"title": "t", "url": "https://x"}]}]
    assert publish.collect_answers(None) == []


def test_collect_answers_keeps_map_node():
    items = [{"result": {"text": "Not by itself.", "cites": [8]}, "meta": {"question": "Does the ping break it?", "t": 15.34,
                                                                         "mapNode": "n2"}},
             {"result": {"text": "x"}, "meta": {"question": "q", "t": 1, "mapNode": None}}]
    out = publish.collect_answers(items)
    assert out[0]["mapNode"] == "n2" and "mapNode" not in out[1]


def test_normalise_options():
    o = normalise.options({"pinnedQuestions": [{"t": 12, "question": "  Does the ping   break his alibi? "},
                                               {"t": True, "question": "bool t"}, {"t": -1, "question": "neg"},
                                               {"t": 3, "question": "x" * 101}, {"t": 4, "question": "b"},
                                               {"t": 5, "question": "c"}],
                           "example": True, "title": "  Starting at 25 " })
    assert o == {"pinnedQuestions": [{"t": 12.0, "question": "Does the ping break his alibi?"},
                                     {"t": 4.0, "question": "b"}], "example": True, "title": "Starting at 25"}
    assert normalise.options(None) == {"pinnedQuestions": [], "example": False, "title": None}
    assert normalise.options({"example": "yes"})["example"] is False


def test_core_adapter_with_studiox_core():
    import core
    good = {"id": "c1", "type": "claim", "claim": "x", "speaker": "A", "context": "y", "evidence": [{"t0": 1, "t1": 2}]}
    w, reason = core.validate_widget(good)
    assert w is not None and reason == ""
    w, reason = core.validate_widget({"id": "bad", "type": "claim", "evidence": []})
    assert w is None and reason.startswith("failed validateWidget")
    pkg = core.assemble_package(
        media_id="m", version=2, generated_at="2026-10-22T00:00:00Z", segments=[], moments=[], widgets=[
            {"lens": "claims", "widget": good, "confidence": 0.9}], rejected=[], answers=[], models={}, shown_ids=["c1"],
        transcript={"mediaId": "m", "speakers": {}, "sentences": [{"t0": 0, "t1": 1, "speaker": "spk_0", "text": "hi"}]})
    assert pkg["provenance"] == "pipeline" and pkg["version"] == 2 and [w["id"] for w in pkg["widgets"]] == ["c1"]


def test_derive_title():
    assert start_pipeline.derive_title("My_Podcast_Ep.1.mp4") == "My Podcast Ep.1"
    assert start_pipeline.derive_title("a" * 100 + ".mkv") == "a" * 60
    assert start_pipeline.derive_title(".mp4") is None


def _probe(v=None, a=None):
    streams = []
    if v:
        streams.append({"codec_type": "video", **v})
    if a:
        streams.append({"codec_type": "audio", **a})
    return {"streams": streams}


def test_prepare_playback_mode_and_command():
    import prepare_playback as pp
    h264 = {"codec_name": "h264", "pix_fmt": "yuv420p", "width": 1280}
    assert pp.choose_mode(_probe(h264, {"codec_name": "aac"})) == "copy"
    assert pp.choose_mode(_probe(h264)) == "copy"
    assert pp.choose_mode(_probe(h264, {"codec_name": "mp3"})) == "transcode"
    assert pp.choose_mode(_probe({"codec_name": "hevc", "width": 1280}, {"codec_name": "aac"})) == "transcode"
    assert pp.choose_mode(_probe({**h264, "width": 3840})) == "transcode"
    with pytest.raises(ValueError):
        pp.choose_mode(_probe(None, {"codec_name": "aac"}))
    cp = pp.build_command("copy", "i", "o")
    assert "copy" in cp and "frag_keyframe+empty_moov+default_base_moof" in cp and cp[-1] == "o"
    tc = pp.build_command("transcode", "i", "o", has_audio=False)
    # No audio in the upload: a silent AAC track is added for the TV's audio buffer.
    assert "libx264" in tc and "-crf" in tc and "anullsrc=channel_layout=stereo:sample_rate=48000" in tc
    assert tc[tc.index("-c:a") + 1] == "aac" and "-shortest" in tc
    assert pp.media_url("d.example", "M1") == "https://d.example/media/M1.frag.mp4"


def test_duration_and_playback_limit():
    import prepare_playback as pp
    assert pp.duration_of({"format": {"duration": "37.28"}}) == 37
    assert pp.duration_of({}) is None
    assert pp.MAX_PLAYBACK_S == 1800


def test_person_named_in_transcript_is_grounded():
    d = {"type": "dossier", "name": "Cristiano Ronaldo", "facts": [{"text": "Portuguese footballer", "source": "Wikipedia"}]}
    assert verify.named_in_transcript(d, "Look at how Cristiano Ronaldo optimizes his recovery.")
    assert verify.named_in_transcript(d, "Ronaldo trains at night.")
    assert not verify.named_in_transcript(d, "Look at how Messi optimizes his recovery.")
    assert not verify.named_in_transcript({"type": "claim", "name": "x"}, "x")


def test_publish_includes_validated_map(monkeypatch):
    claim = {"id": "c1", "type": "claim", "claim": "Ping at 10:14", "speaker": "N", "context": "y",
             "verdict": "UNVERIFIED", "evidence": [{"t0": 8, "t1": 15.34}]}
    tr = {"mediaId": "m", "durationSec": 37.28, "speakers": {}, "sentences": [
        {"t0": 0, "t1": 37, "speaker": "spk_0", "text": "hi"}]}
    store = {"tr.json": tr, "v.json": {"candidates": [{"lens": "claims", "widget": claim, "confidence": 0.9}],
                                       "rejected": []}}
    written = {}
    monkeypatch.setattr(common, "read_json", store.get)
    monkeypatch.setattr(common, "write_json", lambda k, v, cache_control=None: written.__setitem__(k, v))
    monkeypatch.setattr(common, "update_media", lambda *a, **k: None)
    monkeypatch.setattr(publish, "next_version", lambda m: 3)
    node = lambda i, t, **kw: {"id": f"n{i}", "group": "g1", "kind": "event", "label": f"E{i}", "t": t,  # noqa: E731
                               "when": f"{i} PM", **kw}
    explore = {"eligible": True, "reason": "A case", "category": "crime", "layout": "timeline", "title": "Case",
               "summary": "s", "groups": [{"id": "g1", "title": "Night"}],
               "nodes": [node(1, 1.7), node(2, 8, kind="claim", refs=["c1"], verdict="SUPPORTED"), node(3, 20)],
               "edges": [{"from": "n2", "to": "n1", "kind": "contradicts"}], "sims": [], "questions": []}
    out = publish.handler({"mediaId": "m", "execution": "e", "transcriptKey": "tr.json", "verifiedKey": "v.json",
                           "seg": {"segments": [{"id": "s1", "start": 0, "end": 37.28, "title": "A", "genre": "crime"}]},
                           "curate": {"moments": [], "widgetIds": ["c1"], "questions": []},
                           "map": {"explore": explore, "questions": []},
                           "options": {"pinnedQuestions": [], "example": True, "title": "Case 104"},
                           "answers": []}, None)
    pkg = written["packages/m/latest.json"]
    assert out["map"] == {"eligible": True, "layout": "timeline", "nodes": 3}
    assert pkg["explore"]["nodes"][1]["verdict"] == "UNVERIFIED"  # copied from the card, not the agent's
    assert pkg["example"] is True and pkg["title"] == "Case 104"
    from studiox_core.schema import validate_package
    assert validate_package(pkg, "m") == []
