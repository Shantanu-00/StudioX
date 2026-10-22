import copy

import pytest
from studiox_core.schema import validate_package, validate_widget

EV = [{"t0": 1.0, "t1": 2.0}]
GOOD = {
    "dossier": {"id": "d1", "type": "dossier", "evidence": EV, "name": "Cristiano Ronaldo", "role": "Footballer",
                "facts": [{"text": "Portuguese forward", "source": "Wikipedia"}],
                "image": {"url": "https://upload.wikimedia.org/x.jpg", "credit": "Bryan Berlin, CC BY-SA 4.0"}},
    "timeline": {"id": "t1", "type": "timeline", "evidence": EV, "title": "Night of the 14th",
                 "events": [{"id": "e1", "when": "9:30 PM", "label": "Diner alibi", "kind": "claim", "evidence": EV[0]}]},
    "relation_graph": {"id": "g1", "type": "relation_graph", "evidence": EV, "title": "Who knows whom",
                       "nodes": [{"id": "a", "label": "A", "kind": "person", "x": 0, "y": 1},
                                 {"id": "b", "label": "B", "kind": "place", "x": 0.5, "y": 0.5}],
                       "edges": [{"from": "a", "to": "b", "label": "at"}]},
    "entity_list": {"id": "l1", "type": "entity_list", "evidence": EV, "title": "Compounds", "kind": "compound",
                    "items": [{"name": "Apigenin", "dose": "50 mg", "asSaid": "50 milligrams of Apigenin", "evidence": EV[0]}]},
    "protocol": {"id": "p1", "type": "protocol", "evidence": EV, "title": "Evening routine",
                 "steps": [{"label": "Magnesium", "detail": "145 mg", "evidence": EV[0]}]},
    "technique": {"id": "q1", "type": "technique", "evidence": EV, "title": "Box", "shape": "box",
                  "phases": [{"label": "In", "seconds": 4}], "caption": "Breathe"},
    "claim": {"id": "c1", "type": "claim", "evidence": EV, "claim": "Naps cut strain 37%", "speaker": "Dr. Julian",
              "context": "Cites Harvard data", "verdict": "NUANCED",
              "sources": [{"title": "Harvard Gazette", "url": "https://news.harvard.edu/x", "quote": "37% lower"}]},
}


@pytest.mark.parametrize("kind", list(GOOD))
def test_good_widgets_pass(kind):
    assert validate_widget(GOOD[kind]) == GOOD[kind]


def test_optional_fields_are_cleaned_not_fatal():
    w = mutate_raw("dossier", lambda w: w.update(image={"url": "http://insecure/x.jpg", "credit": "c"}))
    assert "image" not in validate_widget(w)
    w = mutate_raw("dossier", lambda w: w["image"].update(credit="x" * 81))
    assert "image" not in validate_widget(w)
    c = validate_widget(mutate_raw("claim", lambda w: w.update(verdict="TRUE")))
    assert c and "verdict" not in c and c["sources"]
    c = validate_widget(mutate_raw("claim", lambda w: w.update(sources=[w["sources"][0]] * 6 + [{"title": "x"}])))
    assert len(c["sources"]) == 4
    c = validate_widget(mutate_raw("claim", lambda w: w["sources"][0].update(url="http://news.harvard.edu/x")))
    assert "sources" not in c
    c = validate_widget(mutate_raw("claim", lambda w: w["sources"][0].update(quote="q" * 241, extra=1)))
    assert c["sources"] == [{"title": "Harvard Gazette", "url": "https://news.harvard.edu/x"}]


def test_https_regex():
    from studiox_core.schema import is_https
    assert is_https("https://en.wikipedia.org/wiki/X_(y)?a=b#c")
    assert not is_https("https://localhost/x") and not is_https("https://a b.com") and not is_https("ftp://x.com")
    assert not is_https("https://x.com/" + "a" * 490)


def test_answer_and_refine():
    from studiox_core.schema import validate_answer, validate_refine
    a = validate_answer({"question": "Q?", "t": 11, "text": "A", "cites": [5.7, 5.2, -1, "x", 9],
                         "sources": [{"title": "T", "url": "https://a.org"}]})
    assert a["cites"] == [5, 9] and a["sources"][0]["url"] == "https://a.org"
    assert validate_answer({"question": "Q?", "t": 11, "text": "x" * 901}) is None
    assert validate_refine({"caption": "c"}) == {"caption": "c"}
    assert validate_refine({"widget": {"id": "x"}}) is None
    assert validate_refine({"caption": "c", "widget": GOOD["protocol"]})["widget"] == GOOD["protocol"]


def mutate_raw(kind, fn):
    w = copy.deepcopy(GOOD[kind])
    fn(w)
    return w


def mutate(kind, fn):
    return validate_widget(mutate_raw(kind, fn))


@pytest.mark.parametrize("kind,fn", [
    ("dossier", lambda w: w.update(name="x" * 61)),
    ("dossier", lambda w: w.update(role="")),
    ("dossier", lambda w: w.update(facts=[{"text": "f"}] * 7)),
    ("timeline", lambda w: w["events"][0].update(when="x" * 25)),
    ("timeline", lambda w: w["events"][0].update(evidence={"t0": 3, "t1": 2})),
    ("timeline", lambda w: w.update(events=[])),
    ("relation_graph", lambda w: w["nodes"][0].update(x=1.5)),
    ("relation_graph", lambda w: w["edges"][0].update(to="zz")),
    ("entity_list", lambda w: w["items"][0].update(asSaid="")),
    ("entity_list", lambda w: w.update(items=[w["items"][0]] * 13)),
    ("protocol", lambda w: w["steps"][0].update(label="x" * 41)),
    ("protocol", lambda w: w.update(steps=[w["steps"][0]] * 9)),
    ("technique", lambda w: w.update(shape="circle")),
    ("technique", lambda w: w["phases"][0].update(seconds=0)),
    ("claim", lambda w: w.update(context="x" * 281)),
    ("claim", lambda w: w.update(id="x" * 65)),
    ("claim", lambda w: w.update(evidence=[])),
    ("claim", lambda w: w.update(evidence=[{"t0": -1, "t1": 2}])),
    ("claim", lambda w: w.update(evidence=[{"t0": True, "t1": 2}])),
    ("claim", lambda w: w.update(evidence=[{"t0": float("nan"), "t1": 2}])),
    ("claim", lambda w: w.update(type="relation")),
])
def test_bad_widgets_fail(kind, fn):
    assert mutate(kind, fn) is None


def test_limits_are_inclusive_and_utf16():
    w = copy.deepcopy(GOOD["claim"])
    w["claim"] = "x" * 160
    assert validate_widget(w)
    w["claim"] = "\U0001F600" * 80  # 160 UTF-16 units
    assert validate_widget(w)
    w["claim"] = "\U0001F600" * 81
    assert validate_widget(w) is None


def test_non_objects():
    for raw in (None, [], "x", 3, {"id": "a"}):
        assert validate_widget(raw) is None


def test_validate_package():
    pkg = {"mediaId": "m", "provenance": "pipeline", "transcript": [],
           "segments": [{"id": "s1", "start": 0, "end": 10, "title": "T", "genre": "science"}],
           "generatedAt": "2026-10-22T18:00:00Z",
           "moments": [{"t": 1, "caption": "c"}], "widgets": [GOOD["claim"], GOOD["claim"]]}
    probs = validate_package(pkg)
    assert probs == ["duplicate widget id c1"]
    pkg["widgets"] = [GOOD["claim"]]
    assert validate_package(pkg) == []
