"""Agent tests, no network: guards, fact-check loop, spoiler rule, builders, and a full replay
of recorded Bedrock/search/Wikipedia calls (tests/fixtures/*.rec.jsonl, recorded with SX_RECORD)."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path[:0] = [str(HERE.parent), str(ROOT / "backend/shared/python")]

from studiox_core import transcript as T  # noqa: E402
from studiox_core.schema import VERDICTS, validate_package, validate_widget  # noqa: E402
from studiox_core.verdict import decide_verdict  # noqa: E402

from sxagents import analyst, coviewer, lenses, llm, mapper, search  # noqa: E402
from sxagents.guards import BudgetGuard, SpoilerGuard, cite_guard  # noqa: E402

SCIENCE = ROOT / "backend/data/transcripts/science-ep42.json"
PINNED = {"crime-case104": [{"t": 12, "question": "Does the ping break his alibi?"}]}  # as seed_demo.py
CRIME = ROOT / "backend/data/transcripts/crime-case104.json"


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("network call in a test")

    monkeypatch.setattr(search, "_search_backend", boom)
    monkeypatch.setattr(search, "_wiki_page", boom)
    monkeypatch.delenv("SX_RECORD", raising=False)
    search._wiki_cache.clear()
    search.new_ledger()
    yield
    llm.reset_replay()


def tr_science():
    return T.load(str(SCIENCE))


# ---- guards -----------------------------------------------------------------------------------

def ev(name, **inp):
    return SimpleNamespace(tool_use={"name": name, "input": inp, "toolUseId": "x"}, cancel_tool=False)


def test_budget_guard_caps_total_and_per_tool():
    g = BudgetGuard(max_calls=3, per_tool={"web_search": 1})
    events = [ev("web_search"), ev("web_search"), ev("read_transcript"), ev("read_transcript"), ev("x")]
    for e in events:
        g.before_tool(e)
    assert [bool(e.cancel_tool) for e in events] == [False, True, False, False, True]


def test_spoiler_guard_clamps_times():
    g = SpoilerGuard(12.0)
    e = ev("read_transcript", t0=5, t1=30)
    g.before_tool(e)
    assert e.tool_use["input"] == {"t0": 5, "t1": 12.0}
    other = ev("web_search", t1=99)
    g.before_tool(other)
    assert other.tool_use["input"]["t1"] == 99


def test_cite_guard_keeps_only_ledger_urls():
    led = search.new_ledger()
    led.add([{"title": "A", "url": "https://a.org/x/?utm_source=z", "snippet": "s", "quote": "q"}])
    kept, stripped = cite_guard(["https://a.org/x", "https://evil.example.com/"], led)
    assert kept == [{"title": "A", "url": "https://a.org/x/?utm_source=z", "quote": "q"}]
    assert stripped == ["https://evil.example.com/"]


def test_search_budget():
    search.new_ledger(max_searches=1)
    search.ledger().searches = 1
    with pytest.raises(search.BudgetExceeded):
        search.web_search("anything")


# ---- fact-check loop ----------------------------------------------------------------------------

def claim_cand(**kw):
    base = dict(claim="Naps cut cardiovascular strain by 37%", speaker="Dr. Julian", context="c", query="q0",
                t0=6.8, t1=11, salience=0.9, reason="r")
    return lenses.ClaimCand(**{**base, **kw})


def fake_search(results_by_query):
    calls = []

    def fn(query, max_results=5, include_domains=None):
        calls.append(query)
        res = results_by_query.get(query, [])
        search.ledger().add(res)
        return res

    return fn, calls


def src(n):
    return {"title": f"S{n}", "url": f"https://s{n}.org/p", "snippet": "text"}


def test_fact_check_verdict_comes_from_rules(monkeypatch):
    fn, calls = fake_search({"q0": [src(1), src(2), src(3)]})
    monkeypatch.setattr(lenses, "web_search", fn)
    stance = lenses.StanceOut(stances=[lenses.SourceStance(index=0, stance="supports", note=""),
                                       lenses.SourceStance(index=1, stance="supports", note=""),
                                       lenses.SourceStance(index=2, stance="irrelevant", note="")],
                              finding="f", best_index=1)
    monkeypatch.setattr(lenses, "structured", lambda *a, **k: stance)
    fc = lenses.fact_check(claim_cand())
    assert fc["verdict"] == "SUPPORTED" and calls == ["q0"]
    assert [s["url"] for s in fc["sources"]] == ["https://s2.org/p", "https://s1.org/p"]  # best first


def test_fact_check_refines_at_most_twice_then_unverified(monkeypatch):
    fn, calls = fake_search({})
    monkeypatch.setattr(lenses, "web_search", fn)
    monkeypatch.setattr(lenses, "structured", lambda *a, **k: pytest.fail("no stance call without results"))
    fc = lenses.fact_check(claim_cand())
    assert fc["verdict"] == "UNVERIFIED" and fc["sources"] == []
    assert len(calls) == 2  # q0, then the claim text; no refine_query without a stance call


def test_fact_check_bounded_with_refine_queries(monkeypatch):
    fn, calls = fake_search({"q0": [src(1)], "q1": [src(2)], "q2": [src(3)], "q3": [src(4)]})
    monkeypatch.setattr(lenses, "web_search", fn)
    n = iter(range(1, 10))

    def stance(*a, **k):
        return lenses.StanceOut(stances=[lenses.SourceStance(index=0, stance="supports", note="")],
                                finding="f", refine_query=f"q{next(n)}")

    monkeypatch.setattr(lenses, "structured", stance)
    fc = lenses.fact_check(claim_cand())
    assert calls == ["q0", "q1", "q2"]  # 1 search + MAX_REFINES refinements
    assert fc["verdict"] == "UNVERIFIED"


def test_fact_check_citation_guard_strips_unseen(monkeypatch):
    def fn(query, max_results=5, include_domains=None):
        return [src(1), src(2)]  # returned but never entered in the ledger

    monkeypatch.setattr(lenses, "web_search", fn)
    stance = lenses.StanceOut(stances=[lenses.SourceStance(index=0, stance="contradicts", note=""),
                                       lenses.SourceStance(index=1, stance="contradicts", note="")], finding="f")
    monkeypatch.setattr(lenses, "structured", lambda *a, **k: stance)
    fc = lenses.fact_check(claim_cand())
    assert fc["sources"] == [] and fc["verdict"] == "UNVERIFIED"


# ---- spoiler rule in ask / refine ---------------------------------------------------------------

def test_ask_never_sees_or_cites_after_t(monkeypatch):
    tr = tr_science()
    seen = {}

    def fake(role, system, prompt, out_model, **kw):
        seen["text"] = json.dumps(system) + prompt
        return coviewer.AskOut(text="Answer.", cite_seconds=[0, 6.9, 13.5, 30],
                               source_urls=["https://not-searched.example.com/"])

    monkeypatch.setattr(coviewer, "structured", fake)
    res = coviewer.ask(tr, 12, "Is the 37% real?")
    assert "Magnesium" not in seen["text"] and "Harvard clinical data" in seen["text"]
    assert res["cites"] == [0, 6] and res["sources"] == []
    assert res["text"] == "Answer."


def test_ask_read_transcript_tool_is_clamped(monkeypatch):
    tr = tr_science()
    out = {}

    def fake(role, system, prompt, out_model, tools=None, **kw):
        out["read"] = tools[0]._tool_func(t0=0, t1=99)  # the tool itself clamps to t
        return coviewer.AskOut(text="x")

    monkeypatch.setattr(coviewer, "structured", fake)
    coviewer.ask(tr, 12, "q")
    assert "compound stack" not in out["read"] and "Cristiano" in out["read"]


def test_refine_widget_evidence_never_after_t(monkeypatch):
    tr = T.load(str(CRIME))
    item = lambda n, t0: lenses.BurstItem(name=n, as_said=n, t0=t0, t1=t0 + 1)  # noqa: E731
    out = coviewer.RefineOut(
        caption="The alibi cracks.", widget_kind="entity_list",
        entity_list=lenses.BurstList(title="Evidence", kind="other", salience=0.5, reason="r",
                                     items=[item("Diner", 2), item("Tower 4", 9), item("Pier 9", 10),
                                            item("Locker", 31)]))
    monkeypatch.setattr(coviewer, "structured", lambda *a, **k: out)
    res = coviewer.refine(tr, 16.0)
    w = res["widget"]
    assert validate_widget(w) and [i["name"] for i in w["items"]] == ["Diner", "Tower 4", "Pier 9"]
    assert all(i["evidence"]["t1"] <= 16.0 for i in w["items"]) and all(e["t1"] <= 16.0 for e in w["evidence"])


# ---- builders and helpers -----------------------------------------------------------------------

def test_burst_needs_three_items_or_two_technical_names_in_window():
    tr = tr_science()
    col = lenses.Collector("s1")
    two = lenses.BurstList(title="Compounds", kind="compound", salience=0.8, reason="r", items=[
        lenses.BurstItem(name="Magnesium L-Threonate", dose="145 mg", as_said="145 milligrams", t0=13, t1=20),
        lenses.BurstItem(name="Apigenin", dose="50 mg", as_said="50 milligrams of Apigenin", t0=13, t1=20)])
    assert lenses.build_burst(tr, two, 0, 37.28, col)["type"] == "entity_list"
    books = two.model_copy(update={"kind": "book", "items": [
        i.model_copy(update={"dose": None}) for i in two.items]})
    assert lenses.build_burst(tr, books, 0, 37.28, col) is None
    assert "needs 3" in col.rejected[-1]["reason"]
    spread = two.model_copy(update={"items": two.items + [
        lenses.BurstItem(name="Delta waves", as_said="delta waves surge", t0=36, t1=37)]})
    assert lenses.build_burst(tr, spread, 0, 37.28, col) is None
    assert "spread" in col.rejected[-1]["reason"]


def test_snap_to_sentences():
    tr = tr_science()
    assert lenses.snap(tr, 7, 10) == {"t0": 6.76, "t1": 11.0}
    assert lenses.snap(tr, 11.0, 11.0) == {"t0": 11.0, "t1": 13.0}
    assert lenses.snap(tr, 50, 60) is None
    assert lenses.snap(tr, 13, 25, 0, 20) == {"t0": 13.0, "t1": 20.0}


def test_segments_are_normalised():
    sents = [{"t0": x, "t1": x + 4.5, "speaker": "spk_0", "text": f"line {x}"} for x in range(0, 195, 5)]
    tr = T.load({"mediaId": "m", "durationSec": 199, "sentences": sents + [
        {"t0": 195, "t1": 199, "speaker": "spk_0", "text": "end"}]})
    items = [analyst.SegItem(start=3, end=50, title="A", genre="science"),
             analyst.SegItem(start=52, end=118, title="B", genre="science"),
             analyst.SegItem(start=118, end=121, title="C", genre="health"),
             analyst.SegItem(start=121, end=197, title="C2", genre="health"),
             analyst.SegItem(start=197, end=199, title="D", genre="health")]
    segs = analyst.normalise_segments(tr, items, "science")
    assert [(s["id"], s["start"], s["end"], s["title"]) for s in segs] == [
        ("s1", 0.0, 50.0, "A"), ("s2", 50.0, 120.0, "B"), ("s3", 120.0, 199.0, "C")]


def test_askable_at_moves_to_line_end():
    tr = tr_science()
    assert analyst.askable_at(tr, 13.0) == 20.72 and analyst.askable_at(tr, 37.2) == 37.2


def test_licences():
    ok = search._licence_ok
    assert ok("CC BY-SA 4.0", "cc-by-sa-4.0") and ok("CC0", "cc0") and ok("Public domain", "pd")
    assert ok("CC BY 2.0", "cc-by-2.0")
    assert not ok("CC BY-NC 2.0", "cc-by-nc-2.0") and not ok("Fair use", "") and not ok("", "")


def test_nova_citations_parsed(monkeypatch):
    resp = {"output": {"message": {"content": [
        {"toolUse": {"name": "nova_grounding", "input": {"query": "q"}}},
        {"text": "A 2007 study found a 37% lower coronary mortality among regular nappers "},
        {"citationsContent": {"citations": [{"location": {"web": {
            "url": "https://news.harvard.edu/gazette/story/2007/02/sleeping-your-way-to-heart-health/",
            "domain": "harvard.edu"}}}]}},
        {"citationsContent": {"citations": [{"location": {"web": {"url": "http://insecure.org/x"}}}]}},
        {"text": ". It was observational."},
        {"citationsContent": {"citations": [{"location": {"web": {"url": "https://www.eurekalert.org/news-releases/700591"}}}]}},
    ]}}, "usage": {"inputTokens": 1, "outputTokens": 2}, "metrics": {"latencyMs": 5}}
    monkeypatch.setattr(search, "_bedrock", SimpleNamespace(converse=lambda **k: resp))
    out = search._nova_search("q", 5)
    assert [r["url"] for r in out] == [
        "https://news.harvard.edu/gazette/story/2007/02/sleeping-your-way-to-heart-health/",
        "https://www.eurekalert.org/news-releases/700591"]
    assert out[0]["title"] == "Sleeping your way to heart health · news.harvard.edu"
    assert out[0]["snippet"].startswith("A 2007 study") and "quote" not in out[0]
    assert out[1]["title"] == "eurekalert.org"


# ---- full replay of a recorded run ------------------------------------------------------------

@pytest.mark.parametrize("path", [SCIENCE, CRIME], ids=["science", "crime"])
def test_replayed_package_is_valid_and_grounded(path, monkeypatch):
    media_id = path.stem
    rec = HERE / "fixtures" / f"{media_id}.rec.jsonl"
    if not rec.exists():
        pytest.skip(f"no recording {rec.name}")
    monkeypatch.setenv("SX_REPLAY", str(rec))
    llm.reset_replay()
    searched = {search._norm(r["url"]) for e in map(json.loads, rec.read_text().splitlines())
                if e["key"].startswith("search:") for r in e["value"]["results"]}
    tr = T.load(str(path))
    pinned = PINNED.get(media_id)
    pkg = analyst.build_package(tr, media_id, 1, say=lambda m: None, pinned=pinned)
    run = pkg.pop("_run")
    assert validate_package(pkg, media_id) == []
    assert pkg["widgets"] and pkg["funnel"]["shown"] == len(pkg["widgets"])
    assert pkg["funnel"]["candidates"] >= pkg["funnel"]["kept"] >= pkg["funnel"]["shown"]
    assert not {w["type"] for w in pkg["widgets"]} & {"relation_graph", "technique"}
    audit = {a["id"]: a for a in run["candidatesAudit"]}
    for w in pkg["widgets"]:
        for e in w["evidence"]:
            assert 0 <= e["t0"] <= e["t1"] <= tr["durationSec"]
            assert T.window(tr, e["t0"], e["t1"]), "evidence must overlap the transcript"
        if w["type"] == "claim":
            assert w["verdict"] in VERDICTS
            assert w["verdict"] == decide_verdict(audit[w["id"]]["stances"], audit[w["id"]]["stanceUrls"])
            for s in w.get("sources", []):
                assert search._norm(s["url"]) in searched, "CitationGuard"
        if w["type"] == "dossier" and "image" in w:
            assert w["image"]["url"].startswith("https://upload.wikimedia.org/") or \
                w["image"]["url"].startswith("https://thumb.wikimedia.org/")
    ex = pkg["explore"]
    assert ex["eligible"] is True and 3 <= len(ex["nodes"]) <= 12
    shown = {w["id"]: w for w in pkg["widgets"]}
    for n in ex["nodes"]:
        assert any(s["t0"] == n["t"] for s in tr["sentences"]), "every node starts at a transcript line"
        claims = [shown[r] for r in n["refs"] if shown[r]["type"] == "claim"]
        assert n["verdict"] == (claims[0]["verdict"] if claims and n["kind"] == "claim" else None)
    map_answers = {a["question"]: a for a in pkg["answers"] if a.get("mapNode")}
    assert {q["question"] for q in ex["questions"]} == set(map_answers)
    for p in pinned or []:
        q = next(q for q in ex["questions"] if q["question"] == p["question"])
        assert map_answers[p["question"]]["mapNode"] == q["nodeId"]
    for a in pkg["answers"]:
        said = [s for s in tr["sentences"] if s["t0"] < a["t"]]
        assert all(c < a["t"] for c in a["cites"]) and all(any(int(s["t0"]) == c for s in said) for c in a["cites"])
        for s in a["sources"]:
            assert search._norm(s["url"]) in searched


def test_curator_backstop_keeps_one_card_of_each_type():
    from sxagents.analyst import ensure_variety
    cands = [{"widget": {"id": "c1", "type": "claim"}, "salience": 0.9},
             {"widget": {"id": "c2", "type": "claim"}, "salience": 0.8},
             {"widget": {"id": "b1", "type": "entity_list"}, "salience": 0.7},
             {"widget": {"id": "p1", "type": "dossier"}, "salience": 0.6}]
    assert ensure_variety(["c1", "c2", "p1"], cands, 37) == ["c1", "c2", "p1", "b1"]
    assert ensure_variety(["c1"], cands, 37) == ["c1", "b1", "p1"]


# ---- the Map author -----------------------------------------------------------------------------

def crime_map_out(**kw):
    N = mapper.MapNode
    base = dict(
        eligible=True, reason="A case", category="crime", layout="timeline", title="The alibi", summary="s",
        groups=[mapper.MapGroup(id="g1", title="His account"), mapper.MapGroup(id="g2", title="Evidence")],
        nodes=[N(id="n1", group="g1", kind="claim", label="Never left the diner", t=3.0, when="9:30 PM",
                 refs=["events-s1-1"]),
               N(id="n2", group="g2", kind="claim", label="Phone pinged Pier 9", t=9.5, when="10:14 PM",
                 refs=["claims-s1-1"]),
               N(id="n3", group="g2", kind="event", label="Burner hit the pavement", t=16, when="10:20 PM"),
               N(id="n4", group="g2", kind="event", label="Locker search", t=31, when="Midnight")],
        edges=[mapper.MapEdge(source="n2", target="n1", kind="contradicts", label="Ping vs. alibi")],
        questions=[mapper.MapQuestion(node_id="n4", t=20, question="What was in the locker?")])
    base.update(kw)
    return mapper.MapOut(**base)


CRIME_CARDS = [
    {"id": "claims-s1-1", "type": "claim", "claim": "Ping at 10:14", "speaker": "Narrator", "context": "c",
     "verdict": "UNVERIFIED", "evidence": [{"t0": 8.0, "t1": 15.34}]},
    {"id": "events-s1-1", "type": "timeline", "title": "Night", "evidence": [{"t0": 1.69, "t1": 37.0}], "events": [
        {"id": "e1", "when": "9:30 PM", "label": "Diner", "evidence": {"t0": 1.69, "t1": 8.0}}]}]


def test_map_nodes_snap_to_lines_and_pinned_questions_attach(monkeypatch):
    tr = T.load(str(CRIME))
    monkeypatch.setattr(mapper, "structured", lambda *a, **k: crime_map_out())
    explore, problems = mapper.author_map(tr, [], CRIME_CARDS, [], PINNED["crime-case104"])
    assert [n["t"] for n in explore["nodes"]] == [1.69, 8.0, 15.34, 30.0]  # line starts
    assert [n["verdict"] for n in explore["nodes"]] == [None, "UNVERIFIED", None, None]
    q = explore["questions"]
    # the pinned question attaches to the node on screen at 12 s; askable at the end of that line
    assert q[0] == {"nodeId": "n2", "t": 15.34, "question": "Does the ping break his alibi?"}
    assert q[1] == {"nodeId": "n4", "t": 30, "question": "What was in the locker?"}  # never before its node
    assert explore["edges"] == [{"from": "n2", "to": "n1", "kind": "contradicts", "label": "Ping vs. alibi"}]


def test_map_sims_and_bedtime(monkeypatch):
    tr = tr_science()
    N = mapper.MapNode
    out = mapper.MapOut(
        eligible=True, reason="A routine", category="health", layout="flow", title="Sleep", summary="s",
        groups=[mapper.MapGroup(id="g1", title="Night")],
        nodes=[N(id="n1", group="g1", kind="step", label="Sleep in 90-minute blocks", t=5.5, sim="night"),
               N(id="n2", group="g1", kind="step", label="Two supplements", t=13),
               N(id="n3", group="g1", kind="step", label="Keep the room cool", t=30)],
        edges=[mapper.MapEdge(source="n1", target="n2", kind="then"), mapper.MapEdge(source="n2", target="n3", kind="then")],
        sims=[mapper.MapSim(engine="night", title="Plan your night", night=mapper.NightParams(
            cycle_minutes=90, cycles=5, bedtime="00:30", quote="Five ninety-minute cycles.", quote_t=5.5)),
              mapper.MapSim(engine="growth", title="Money", growth=None)])
    monkeypatch.setattr(mapper, "structured", lambda *a, **k: out)
    res = mapper.handle_map(tr, {"candidates": [], "widgetIds": [], "questions": [{"t": 13, "question": "Q?"}]})
    ex = res["explore"]
    assert ex["sims"] == [{"id": "night", "engine": "night", "title": "Plan your night", "params": {
        "cycleMinutes": 90, "cycles": 5, "bedtime": 1470, "quote": "Five ninety-minute cycles.", "quoteT": 5.41}}]
    assert ex["nodes"][0]["sim"] == "night" and ex["nodes"][0]["t"] == 5.41
    assert res["questions"] == [{"t": 13, "question": "Q?", "mapNode": None}]


def test_ineligible_map_and_pinned_parsing(monkeypatch):
    tr = tr_science()
    monkeypatch.setattr(mapper, "structured", lambda *a, **k: crime_map_out(eligible=False, reason="Just chat"))
    ex, _ = mapper.author_map(tr, [], [], [], [{"t": 3, "question": "x?"}])
    assert ex == {"eligible": False, "reason": "Just chat"} and mapper.map_questions(ex) == []
    assert mapper.parse_pinned(["12|Does the ping break his alibi?"]) == [
        {"t": 12.0, "question": "Does the ping break his alibi?"}]
    with pytest.raises(ValueError):
        mapper.parse_pinned(["no separator"])
    assert "verdict UNVERIFIED" in mapper.card_rows(CRIME_CARDS) and "event [9:30 PM] Diner" in mapper.card_rows(CRIME_CARDS)
