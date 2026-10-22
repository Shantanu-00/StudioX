import json

from studiox_core import transcript as T
from studiox_core.package import assemble_package

TR = {"mediaId": "m", "durationSec": 20, "speakers": {"spk_0": "Dr. Julian"},
      "sentences": [{"t0": 0, "t1": 4, "speaker": "spk_0", "text": "one two three four"},
                    {"t0": 4, "t1": 8, "speaker": "spk_0", "text": "five six seven eight"},
                    {"t0": 8, "t1": 10, "speaker": "spk_0", "text": "nine ten",
                     "words": [{"text": "nine", "t0": 8, "t1": 9}, {"text": "ten", "t0": 9, "t1": 10}]}]}


def test_load_from_path_and_window(tmp_path):
    p = tmp_path / "t.json"
    p.write_text(json.dumps(TR))
    tr = T.load(str(p))
    assert [s["i"] for s in tr["sentences"]] == [0, 1, 2]
    assert [s["text"] for s in T.window(tr, 3, 5)] == ["one two three four", "five six seven eight"]
    assert T.window(tr, 11, 12) == []


def test_before_never_leaks():
    tr = T.load(TR)
    b = T.before(tr, 6)
    assert [s["text"] for s in b] == ["one two three four", "five six"]
    assert b[-1]["partial"] and b[-1]["t1"] == 6
    assert all(s["t1"] <= 6 for s in b)
    assert [s["text"] for s in T.before(tr, 9.5)][-1] == "nine"
    assert T.before(tr, 0) == []
    assert len(T.before(tr, 100)) == 3


def test_speech_stats_gate():
    st = T.speech_stats(T.load(TR))
    assert st["words"] == 10 and st["speechSeconds"] == 10
    assert st["speechRatio"] == 0.5 and st["wpm"] == 30.0 and st["fit"] is False


def test_format_lines():
    tr = T.load(TR)
    assert T.format_lines(tr, T.before(tr, 6), numbered=True).splitlines()[1] == "#1 [4.0-6.0] Dr. Julian: five six"


def claim(i, **kw):
    return {"id": i, "type": "claim", "evidence": [{"t0": 1, "t1": 2}], "claim": "c", "speaker": "s",
            "context": "x", **kw}


def test_assemble_package_funnel_and_rejects():
    cands = [{"lens": "claims", "widget": claim("c1")},
             {"lens": "claims", "widget": claim("c2", verdict="MAYBE")},
             {"lens": "people", "widget": {"id": "d1", "type": "dossier", "evidence": [{"t0": 0, "t1": 1}],
                                           "name": "N", "role": "R", "facts": [{"text": "f"}]}},
             {"lens": "claims", "widget": claim("c1")},
             claim("c3"),
             {"lens": "claims", "widget": claim("c4", context="x" * 281)}]
    pkg = assemble_package("m", [], [{"t": 5, "caption": "b"}, {"t": 1, "caption": "a"}], cands,
                           [{"lens": "claims", "text": "sky is blue", "reason": "common knowledge"}],
                           [], {"segment": "x"}, 2, transcript=T.load(TR), shown_ids=["d1", "c1", "nope"])
    assert [w["id"] for w in pkg["widgets"]] == ["d1", "c1"]
    # c2's bad verdict is dropped (as the TV does), so c2 is kept but not shown
    assert pkg["funnel"] == {"candidates": 7, "kept": 4, "shown": 2,
                             "byLens": {"claims": {"candidates": 6, "kept": 3}, "people": {"candidates": 1, "kept": 1}}}
    reasons = [r["reason"] for r in pkg["rejected"]]
    assert reasons[0] == "common knowledge"
    assert [r for r in reasons if r.startswith("failed validateWidget")] == [
        "failed validateWidget: claim fields fail schema limits"]
    assert "duplicate widget id" in reasons and "not selected by curator" in reasons
    assert pkg["moments"][0]["t"] == 1 and pkg["provenance"] == "pipeline" and pkg["version"] == 2
    assert pkg["transcript"][0] == {"t0": 0.0, "t1": 4.0, "speaker": "Dr. Julian", "text": "one two three four"}
    from studiox_core.schema import validate_package
    assert validate_package(pkg) == []


def test_clip():
    assert T.clip("one two three", 9) == "one two\u2026"
    assert T.clip("short", 9) == "short"
