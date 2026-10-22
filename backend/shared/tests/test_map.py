import copy

from studiox_core.map import SIM_ENGINES, clip, evidence_spans, keep_answered, validate_map
from studiox_core.package import assemble_package, shown_widgets
from studiox_core.schema import validate_package

CLAIM = {"id": "claims-s1-1", "type": "claim", "evidence": [{"t0": 34.0, "t1": 37.0}], "claim": "Seven days",
         "speaker": "Dr. Julian", "context": "c", "verdict": "NUANCED"}
PROTOCOL = {"id": "protocol-s1-1", "type": "protocol", "title": "Routine", "evidence": [{"t0": 5.41, "t1": 33.0}],
            "steps": [{"label": "Cycles", "detail": "d", "evidence": {"t0": 5.41, "t1": 6.76}},
                      {"label": "Cool room", "detail": "d", "evidence": {"t0": 29.26, "t1": 33.0}}]}
WIDGETS = [CLAIM, PROTOCOL]


def node(i, t, **kw):
    return {"id": f"n{i}", "group": "g1", "kind": "step", "label": f"Step {i}", "detail": None, "t": t, "t1": None,
            "when": None, "value": None, "verdict": None, "refs": [], "sim": None, **kw}


def flow(**kw):
    m = {"eligible": True, "reason": "A routine", "category": "health", "layout": "flow", "title": "The routine",
         "summary": "What to do, in order", "groups": [{"id": "g1", "title": "At night"}],
         "nodes": [node(1, 5.41, refs=["protocol-s1-1"], sim="night"), node(2, 13), node(3, 29.26),
                   node(4, 34, kind="claim", refs=["claims-s1-1"])],
         "edges": [{"from": "n1", "to": "n2", "kind": "then", "label": None},
                   {"from": "n2", "to": "n3", "kind": "then", "label": None},
                   {"from": "n3", "to": "n4", "kind": "because", "label": None}],
         "sims": [{"id": "night", "engine": "night", "title": "Plan your night",
                   "params": {"cycleMinutes": 90, "cycles": 5, "bedtime": 1380, "quote": "Five cycles.", "quoteT": 5.41}}],
         "questions": [{"nodeId": "n3", "t": 33, "question": "Does a cool room help?"}]}
    m.update(kw)
    return m


def test_valid_map_is_unchanged_and_idempotent():
    m = flow()
    out, problems = validate_map(copy.deepcopy(m), 37.28, WIDGETS)
    assert problems == []
    m["nodes"][3]["verdict"] = "NUANCED"  # copied from the referenced claim
    assert out == m
    again, p2 = validate_map(copy.deepcopy(out), 37.28, WIDGETS)
    assert again == out and p2 == []


def test_verdict_only_from_a_referenced_claim():
    m = flow()
    m["nodes"][1].update(kind="claim", verdict="DEBUNKED")  # invented, no claim ref
    m["nodes"][3]["verdict"] = "SUPPORTED"  # wrong: the card says NUANCED
    out, problems = validate_map(m, 37.28, WIDGETS)
    assert out["nodes"][1]["verdict"] is None and out["nodes"][3]["verdict"] == "NUANCED"
    assert sum("verdict" in p for p in problems) == 2


def test_bounds_and_cleaning():
    m = flow(title="T" * 60, category="cooking")
    m["nodes"][0]["label"] = "Sleep in ninety-minute blocks every single night of the week"
    m["nodes"][1]["refs"] = ["nope"]
    m["nodes"][2]["t"] = 99  # past the end: dropped
    m["nodes"].append(node(5, 6, refs=["protocol-s1-1"]))  # inside the protocol's evidence: kept
    m["nodes"].append(node(6, 3, refs=["claims-s1-1"]))  # outside its claim's evidence: snapped to 34
    m["edges"] += [{"from": "n1", "to": "n1", "kind": "then"}, {"from": "n1", "to": "zz", "kind": "then"},
                   {"from": "n2", "to": "n4", "kind": "maybe"}, {"from": "n4", "to": "n5", "kind": "supports",
                                                                  "label": "a much too long edge label here"}]
    out, problems = validate_map(m, 37.28, WIDGETS)
    assert out["eligible"] and out["category"] == "other" and len(out["title"]) <= 48
    labels = {n["id"]: n for n in out["nodes"]}
    assert len(labels["n1"]["label"]) <= 44 and labels["n1"]["label"].endswith("…")
    assert "n3" not in labels and labels["n2"]["refs"] == [] and labels["n6"]["t"] == 34
    assert [(e["from"], e["to"]) for e in out["edges"]] == [("n1", "n2"), ("n4", "n5")]
    assert len(out["edges"][1]["label"]) <= 24
    assert out["questions"] == []  # its node was dropped
    assert problems


def test_counts_are_capped():
    m = flow(nodes=[node(i, i) for i in range(1, 16)],
             edges=[{"from": f"n{i}", "to": f"n{i + 1}", "kind": "then"} for i in range(1, 15)] * 2,
             questions=[{"nodeId": "n1", "t": 2, "question": f"Q{i}?"} for i in range(6)], sims=[])
    out, _ = validate_map(m, 37.28, WIDGETS)
    assert len(out["nodes"]) == 12 and len(out["edges"]) <= 16 and len(out["questions"]) == 4


def test_sims_clamped_and_unknown_engine_dropped():
    m = flow()
    m["sims"] = [{"id": "night", "engine": "night", "title": "Plan", "params": {
        "cycleMinutes": 200, "cycles": 9, "bedtime": 30, "quote": "q", "quoteT": 500}},
        {"id": "x", "engine": "rocket", "title": "Go", "params": {}}]
    out, problems = validate_map(m, 37.28, WIDGETS)
    assert out["sims"] == [{"id": "night", "engine": "night", "title": "Plan",
                            "params": {"cycleMinutes": 120, "cycles": 6, "bedtime": 1470, "quote": "q"}}]
    assert any("rocket" in p for p in problems)


def test_growth_sim():
    m = flow(layout="compare", category="finance")
    m["nodes"][0]["sim"] = "growth"
    m["nodes"][0]["value"] = {"n": 200, "unit": "USD a month"}
    m["sims"] = [{"id": "growth", "engine": "growth", "title": "Start now or later", "params": {
        "start": 0, "monthly": 200, "ratePct": 45, "years": 40, "laterYears": 10, "currency": "usd"}}]
    out, _ = validate_map(m, 37.28, WIDGETS)
    p = out["sims"][0]["params"]
    assert p["ratePct"] == 30 and p["currency"] == "USD" and p["years"] == 40 and p["laterYears"] == 10
    assert out["nodes"][0]["value"] == {"n": 200, "unit": "USD a month"}
    m["sims"][0]["params"].pop("ratePct")  # the rate must come from the episode
    out, problems = validate_map(m, 37.28, WIDGETS)
    assert out["sims"] == [] and out["nodes"][0]["sim"] is None
    assert set(SIM_ENGINES) == {"night", "growth"}


def test_value_only_for_compare():
    m = flow()
    m["nodes"][0]["value"] = {"n": 90, "unit": "min"}
    out, _ = validate_map(m, 37.28, WIDGETS)
    assert out["nodes"][0]["value"] is None


def test_unreferenced_sim_dropped():
    m = flow()
    m["nodes"][0]["sim"] = None
    out, problems = validate_map(m, 37.28, WIDGETS)
    assert out["sims"] == [] and any("no node opens it" in p for p in problems)


def test_eligibility_rules():
    out, _ = validate_map(flow(edges=flow()["edges"][:1]), 37.28, WIDGETS)
    assert out == {"eligible": False, "reason": "Only 1 valid connections"}
    out, _ = validate_map(flow(nodes=flow()["nodes"][:2]), 37.28, WIDGETS)
    assert out["eligible"] is False
    tl = flow(layout="timeline", edges=[])
    out, _ = validate_map(tl, 37.28, WIDGETS)
    assert out["eligible"] is True  # 4 distinct t
    tl["nodes"] = [node(i, 5.41, refs=["protocol-s1-1"]) for i in (1, 2, 3)]
    out, _ = validate_map(tl, 37.28, WIDGETS)
    assert out["eligible"] is False
    for n, w in zip(tl["nodes"], ("9:30 PM", "10:14 PM", "Midnight")):
        n["when"] = w
    assert validate_map(tl, 37.28, WIDGETS)[0]["eligible"] is True
    out, _ = validate_map({"eligible": False, "reason": "Just chat", "nodes": []}, 37.28, WIDGETS)
    assert out == {"eligible": False, "reason": "Just chat"}
    assert validate_map(flow(layout="spiral"), 37.28, WIDGETS)[0]["eligible"] is False
    assert validate_map("nope", 37.28, WIDGETS) == (None, ["explore is not an object"])


def test_question_never_before_its_node():
    m = flow()
    m["questions"] = [{"nodeId": "n4", "t": 10, "question": "Seven days, really?"}]
    out, _ = validate_map(m, 37.28, WIDGETS)
    assert out["questions"] == [{"nodeId": "n4", "t": 34, "question": "Seven days, really?"}]


def test_helpers():
    assert clip("  a  b ", 10) == "a b" and clip("", 5) is None and clip(3, 5) is None
    assert clip("one two three", 9) == "one two…"
    assert evidence_spans(PROTOCOL) == [(5.41, 6.76), (5.41, 33.0), (29.26, 33.0)]


def test_package_carries_validated_map():
    tr = {"mediaId": "m", "durationSec": 37.28, "speakers": {}, "sentences": [
        {"t0": 0, "t1": 37, "speaker": "spk_0", "text": "hi"}]}
    segs = [{"id": "s1", "start": 0, "end": 37.28, "title": "All", "genre": "health"}]
    cands = [{"lens": "claims", "widget": CLAIM}, {"lens": "protocol", "widget": PROTOCOL}]
    assert [w["id"] for w in shown_widgets(cands, ["protocol-s1-1", "claims-s1-1"])] == ["protocol-s1-1", "claims-s1-1"]
    pkg = assemble_package("m", segs, [], cands, [], [], {}, 1, transcript=tr, explore=flow())
    assert pkg["explore"]["eligible"] and pkg["explore"]["nodes"][3]["verdict"] == "NUANCED"
    assert validate_package(pkg, "m") == []
    pkg["explore"]["nodes"][0]["label"] = "x" * 60
    assert any(p.startswith("explore:") for p in validate_package(pkg, "m"))
    # a claim card the curator did not show cannot lend its verdict
    pkg = assemble_package("m", segs, [], cands, [], [], {}, 1, transcript=tr, explore=flow(),
                           shown_ids=["protocol-s1-1"])
    assert pkg["explore"]["nodes"][3]["refs"] == [] and pkg["explore"]["nodes"][3]["verdict"] is None


def test_map_questions_need_their_answer():
    out, _ = validate_map(flow(), 37.28, WIDGETS)
    assert keep_answered(out, [])["questions"] == []
    kept = keep_answered(out, [{"question": "Does a cool room help?", "mapNode": "n3", "text": "x"}])
    assert kept["questions"] == out["questions"]
    assert keep_answered({"eligible": False, "reason": "r"}, []) == {"eligible": False, "reason": "r"}
