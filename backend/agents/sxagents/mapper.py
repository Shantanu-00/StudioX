"""The Map author (analyst mode `map`, CONTRACTS section 9).

One Sonnet agent with structured output turns the episode's shown cards and transcript into one
navigable picture: it decides eligibility, category and layout and writes groups, nodes, edges,
simulations and curiosity questions. Code then snaps every node to the transcript line it comes
from, attaches pinned questions, and `studiox_core.map.validate_map` has the final say.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

from studiox_core import transcript as T
from studiox_core.map import CATEGORIES, EDGE_KINDS, KINDS, LAYOUTS, validate_map
from studiox_core.package import shown_widgets

from .lenses import snap
from .llm import structured, system_blocks

MAX_PINNED = 2


class MapGroup(BaseModel):
    id: str = Field(description="g1, g2, ...")
    title: str = Field(description="<= 32 characters, a column or band title, sentence case")


class MapValue(BaseModel):
    n: float = Field(description="The number as stated in the episode")
    unit: str = Field(description="<= 12 characters, e.g. 'USD a month', '%', 'years'")


class MapNode(BaseModel):
    id: str = Field(description="n1, n2, ... in reading order")
    group: str = Field(description="A group id")
    kind: Literal[KINDS]  # type: ignore[valid-type]
    label: str = Field(description="<= 44 characters, plain words, sentence case, readable at a glance")
    detail: Optional[str] = Field(default=None, description="<= 200 characters: what the episode said, numbers as said")
    t: float = Field(description="Start second of the transcript line where this is first said")
    t1: Optional[float] = Field(default=None, description="End second of that stretch")
    when: Optional[str] = Field(default=None, description="Timeline only: story time as said, <= 16 characters")
    value: Optional[MapValue] = Field(default=None, description="Compare only, and only when the episode states it")
    refs: list[str] = Field(default_factory=list, description="Ids of the cards this node comes from")
    sim: Optional[Literal["night", "growth"]] = Field(default=None, description="The simulation this node opens")


class MapEdge(BaseModel):
    source: str = Field(description="Node id the connector starts at")
    target: str = Field(description="Node id it points to")
    kind: Literal[EDGE_KINDS]  # type: ignore[valid-type]
    label: Optional[str] = Field(default=None, description="<= 24 characters, or null")


class NightParams(BaseModel):
    cycle_minutes: int = Field(description="Minutes per sleep cycle, as said")
    cycles: int = Field(description="Cycles per night, as said")
    bedtime: str = Field(default="23:00", description="HH:MM 24-hour; as said, else 23:00")
    quote: str = Field(description="The exact words that prescribe the cycles, <= 120 characters")
    quote_t: float = Field(description="Start second of the quoted line")


class GrowthParams(BaseModel):
    start: float = Field(default=0, description="Starting amount as said (0 if none)")
    monthly: float = Field(default=0, description="Monthly contribution as said (0 if none)")
    rate_pct: float = Field(description="Yearly return in percent, as said")
    years: int = Field(description="Years of growth, as said")
    later_years: Optional[int] = Field(default=None, description="If the episode compares starting later: the delay in years")
    currency: str = Field(default="USD", description="3-letter currency code")
    quote: str = Field(description="The exact words with the numbers, <= 120 characters")
    quote_t: float = Field(description="Start second of the quoted line")


class MapSim(BaseModel):
    engine: Literal["night", "growth"]
    title: str = Field(description="<= 48 characters, e.g. 'Plan your night'")
    night: Optional[NightParams] = None
    growth: Optional[GrowthParams] = None


class MapQuestion(BaseModel):
    node_id: str
    t: float = Field(description="When it becomes askable: after the node's line was said")
    question: str = Field(description="<= 100 characters, as a curious viewer would ask it")


class MapOut(BaseModel):
    eligible: bool
    reason: str = Field(description="<= 120 characters: why this episode does or does not get a map")
    category: Literal[CATEGORIES]  # type: ignore[valid-type]
    layout: Literal[LAYOUTS]  # type: ignore[valid-type]
    title: str = Field(description="<= 48 characters")
    summary: str = Field(description="<= 120 characters: what the picture shows")
    groups: list[MapGroup] = Field(default_factory=list)
    nodes: list[MapNode] = Field(default_factory=list)
    edges: list[MapEdge] = Field(default_factory=list)
    sims: list[MapSim] = Field(default_factory=list)
    questions: list[MapQuestion] = Field(default_factory=list)


MAP = """You are the Map author of StudioX, a co-viewer for TV. Pressing Map turns the whole
conversation into ONE navigable picture on a television: what was said, how it connects, and each
piece one click from the moment it was said. Work from the cards already made for this episode and
the transcript.

1. Eligible? A map needs a connected structure: a routine or how-to, a case, an argument, a history,
   a trend, or options being weighed. Small talk, one isolated fact or a loose chat is not: set
   eligible false with a short reason.
2. Category: health, crime, finance, history, tech, motivation, scifi or other.
3. Layout: `timeline` for a case or a history (events placed in story time); `flow` for a routine,
   a how-to or an argument (ordered steps or ideas with connectors); `compare` when the episode
   weighs two or more options, people or scenarios against each other (now or later, plan A or
   plan B), even if it argues for one: one group per option, matching nodes side by side; `cluster`
   for anything else (topics with their ideas).
4. Nodes, 3 to 12: the things a viewer would want to see connected, in reading order. Draw the
   spine of the structure: the steps in order and where they lead, the account and the evidence
   against it, the events in story order. For a clip under a minute that is 4 to 6 nodes. Who
   does it and why it works go into a node's detail, or the title, unless they are a step of their
   own; a person gets a node only when who they are is part of the structure (a suspect, a
   witness).
   - label: at most 44 characters, plain words, sentence case, readable from the couch at a glance
     ("Sleep in 90-minute blocks", not "R90 polyphasic cycle protocol"; "Phone pinged Pier 9 at
     10:14 PM"). A claim node whose card is not SUPPORTED may be phrased as the question it raises
     ("Results in 7 days?").
   - detail: one or two short sentences of what the episode said, numbers as said.
   - kind: step (something to do), claim (a checkable statement; reference its claim card),
     event (something that happened), person, number (a stated figure), idea.
   - t: the start second of the line where it is first said, taken from the cards' evidence or the
     transcript timestamps; t1: the end of that stretch. Never guess a time.
   - refs: the ids of the cards it comes from. A claim node must reference its claim card (its
     verdict is copied from the card by code; do not write verdicts).
   - group: 1 to 5 groups, each a short band or column title ("At night", "His account",
     "The evidence").
   - when (timeline only): the story time as said, at most 16 characters ("10:14 PM", "Midnight",
     "July 20, 1969"), else null. value (compare only): {n, unit} only when the episode states the
     number.
   Labels say only what the episode says. Merge what belongs together (one node for a pair of
   supplements taken together, not one per pill); leave out what does not connect to anything.
5. Edges, at most 16: `then` (sequence), `because` (cause), `supports`, `contradicts` (a record
   that conflicts with an account: always mark that conflict). Label at most 24 characters or null.
   Every edge must read true as a sentence ("A then B", "A because B", "A supports B"). In a flow,
   `then` edges follow the order of what to do, ending at the result; a claim hangs off the step
   it is about. flow and cluster need at least 2 edges.
6. Simulations, only when the episode itself gives the numbers:
   - `night` on the node about sleep cycles, only when the episode prescribes sleep cycles:
     cycle_minutes and cycles as said, bedtime as said (else 23:00), quote = the exact words,
     quote_t = that line's start.
   - `growth` on the node about money growing, only when the episode states the numbers: start
     and/or monthly amount, yearly rate, years, and later_years if it compares starting later.
   Set the node's `sim` to the engine. Otherwise no sims at all.
7. Questions, 0 to 3: curiosity questions a viewer would ask at a node, each at most 100
   characters, at a time t after that node was said. They must not reveal anything said after t.
8. title at most 48 characters, summary at most 120 (what the picture shows), reason at most 120.
Write for a TV: short, concrete, no hedging words, no "the speaker says"."""


def _ev(e: dict | None) -> str:
    return f"{e['t0']:.1f}-{e['t1']:.1f}" if isinstance(e, dict) and "t0" in e else "?"


def card_rows(widgets: list[dict]) -> str:
    """The cards as the Map author sees them: id, type, headline, verdict, evidence, and parts."""
    rows = []
    for w in widgets:
        head = w.get("headline") or w.get("claim") or w.get("title") or w.get("name") or ""
        spans = ", ".join(_ev(e) for e in w.get("evidence") or [])
        line = f"- {w['id']} | {w['type']} | {head} | evidence {spans} s"
        if w["type"] == "claim":
            line += f" | verdict {w.get('verdict', 'UNVERIFIED')} | said: {w.get('claim')}"
        elif w["type"] == "dossier":
            line += f" | {w.get('name')}: {w.get('role')}"
        parts = []
        for st in w.get("steps") or []:
            parts.append(f"step '{st.get('label')}' ({st.get('detail', '')}) at {_ev(st.get('evidence'))}")
        for e in w.get("events") or []:
            parts.append(f"event [{e.get('when')}] {e.get('label')} ({e.get('kind', '')}) at {_ev(e.get('evidence'))}")
        for i in w.get("items") or []:
            dose = f" {i['dose']}" if i.get("dose") else ""
            parts.append(f"item {i.get('name')}{dose} at {_ev(i.get('evidence'))}")
        rows.append(line + "".join(f"\n    {p}" for p in parts))
    return "\n".join(rows) or "(no cards)"


def _bedtime(hhmm: str) -> int:
    try:
        h, m = (int(x) for x in str(hhmm).strip().split(":")[:2])
    except ValueError:
        return 1380
    v = (h % 24) * 60 + m
    return v + 1440 if v < 12 * 60 else v  # after midnight wraps past 1440


def _quote_t(tr: dict, quote: str, t: float) -> float:
    """The start of the line that holds the quote (nearest to t if several), else the line at t."""
    q = " ".join(str(quote).lower().split()).strip(" .,!?\"'")
    hits = [s for s in tr["sentences"] if q and q in " ".join(s["text"].lower().split())]
    if hits:
        return min(hits, key=lambda s: abs(s["t0"] - t))["t0"]
    ev = snap(tr, t, t)
    return ev["t0"] if ev else t


def to_explore(out: MapOut, tr: dict) -> dict:
    """Agent output -> contract shape, with every node snapped to the transcript line it comes from."""
    nodes = []
    for n in out.nodes:
        ev = snap(tr, n.t, n.t1 if n.t1 is not None else n.t)
        t, t1 = (ev["t0"], ev["t1"]) if ev else (n.t, n.t1)
        nodes.append({"id": n.id, "group": n.group, "kind": n.kind, "label": n.label, "detail": n.detail,
                      "t": t, "t1": t1, "when": n.when, "value": n.value.model_dump() if n.value else None,
                      "verdict": None, "refs": n.refs, "sim": n.sim})
    sims = []
    for s in out.sims:
        if s.engine == "night" and s.night:
            p = s.night
            params = {"cycleMinutes": p.cycle_minutes, "cycles": p.cycles, "bedtime": _bedtime(p.bedtime),
                      "quote": p.quote, "quoteT": _quote_t(tr, p.quote, p.quote_t)}
        elif s.engine == "growth" and s.growth:
            p = s.growth
            params = {"start": p.start, "monthly": p.monthly, "ratePct": p.rate_pct, "years": p.years,
                      "laterYears": p.later_years or 0, "currency": p.currency, "quote": p.quote,
                      "quoteT": _quote_t(tr, p.quote, p.quote_t)}
        else:
            continue
        sims.append({"id": s.engine, "engine": s.engine, "title": s.title, "params": params})
    return {"eligible": out.eligible, "reason": out.reason, "category": out.category, "layout": out.layout,
            "title": out.title, "summary": out.summary,
            "groups": [g.model_dump() for g in out.groups], "nodes": nodes,
            "edges": [{"from": e.source, "to": e.target, "kind": e.kind, "label": e.label} for e in out.edges],
            "sims": sims,
            "questions": [{"nodeId": q.node_id, "t": askable_at(tr, q.t), "question": q.question} for q in out.questions]}


def askable_at(tr: dict, t: float) -> float:
    """A question time inside a line moves to the end of that line (same rule as the curator's)."""
    t = min(max(float(t), 0.0), tr["durationSec"])
    for s in tr["sentences"]:
        if s["t0"] <= t < s["t1"]:
            return round(s["t1"], 2)
    return round(t, 2)


def pin_questions(explore: dict, tr: dict, pinned: list[dict]) -> dict:
    """Pinned questions go first. Each attaches to the latest node said by its time (the node the
    viewer is looking at when they ask); its t moves to the end of the line being said."""
    if not explore.get("eligible") or not pinned:
        return explore
    nodes = sorted(explore.get("nodes") or [], key=lambda n: n.get("t", 0))
    out, seen = [], set()
    for p in pinned[:MAX_PINNED]:
        q = T.clip(str(p.get("question") or ""), 100)
        try:
            t = float(p.get("t"))
        except (TypeError, ValueError):
            continue
        said = [n for n in nodes if n.get("t", 0) <= t]
        if not q or not said:
            continue
        out.append({"nodeId": said[-1]["id"], "t": askable_at(tr, t), "question": q})
        seen.add(q.lower())
    rest = [q for q in explore.get("questions") or [] if str(q.get("question", "")).lower() not in seen]
    return {**explore, "questions": out + rest}


def parse_pinned(values: list[str] | None) -> list[dict]:
    """'12|Does the ping break his alibi?' -> {t: 12.0, question: ...}"""
    out = []
    for v in values or []:
        t, sep, q = str(v).partition("|")
        if not sep or not q.strip():
            raise ValueError(f"pinned question must be '<seconds>|<text>': {v!r}")
        out.append({"t": float(t), "question": q.strip()})
    return out


def author_map(tr: dict, segments: list[dict], widgets: list[dict], moments: list[dict],
               pinned: list[dict] | None = None, asked: list[dict] | None = None) -> tuple[dict, list[str]]:
    """(explore, problems): the validated map for the shown `widgets`. `asked` are the curator's
    questions, which the map must not repeat."""
    seg_txt = "\n".join(f"{s['id']} {s['start']:.1f}-{s['end']:.1f} {s['title']} ({s.get('genre')})" for s in segments)
    mom_txt = "\n".join(f"{m['t']:.1f} s: {m['caption']}" for m in moments) or "(none)"
    shared = (f"EPISODE {tr.get('mediaId', '')}, {tr['durationSec']:.1f} s.\nSEGMENTS:\n{seg_txt}\n"
              f"TRANSCRIPT ([start-end seconds] speaker: text):\n{T.format_lines(tr, tr['sentences'])}")
    asked_txt = "\n".join(f"{q['t']:.1f} s: {q['question']}" for q in asked or []) or "(none)"
    prompt = (f"CARDS (id | type | headline | evidence | ...; parts with their times):\n{card_rows(widgets)}\n\n"
              f"KEY MOMENTS (from the curator):\n{mom_txt}\n\n"
              f"QUESTIONS ALREADY SUGGESTED (do not repeat or rephrase these):\n{asked_txt}\n\nDraw the map.")
    out = structured("map", system_blocks(shared, MAP), prompt, MapOut, max_tokens=4000)
    explore = pin_questions(to_explore(out, tr), tr, pinned or [])
    return validate_map(explore, tr["durationSec"], widgets)


def map_questions(explore: dict) -> list[dict]:
    """The map's questions as items for the answer step: {t, question, mapNode}."""
    if not explore or not explore.get("eligible"):
        return []
    return [{"t": q["t"], "question": q["question"], "mapNode": q["nodeId"]} for q in explore.get("questions") or []]


def handle_map(tr: dict, payload: dict) -> dict:
    """Mode `map`: {segments, candidates, widgetIds, labels, moments, questions (curator), pinned}
    -> {explore, problems, questions}. `questions` = curator questions + map questions, the list
    the pipeline's answer step runs over (map ones carry `mapNode`)."""
    widgets = shown_widgets(payload.get("candidates") or [], payload.get("widgetIds"), payload.get("labels"))
    pinned = [p for p in payload.get("pinned") or [] if isinstance(p, dict)]
    explore, problems = author_map(tr, payload.get("segments") or [], widgets, payload.get("moments") or [], pinned,
                                   payload.get("questions") or [])
    return {"explore": explore, "problems": problems[:40],
            "questions": merge_questions(payload.get("questions") or [], map_questions(explore))}


def merge_questions(curator: list[dict], from_map: list[dict]) -> list[dict]:
    """Every item has the same keys (mapNode null for the curator's), deduplicated by text."""
    out, seen = [], set()
    for q in from_map + [{"t": c.get("t"), "question": c.get("question"), "mapNode": None} for c in curator]:
        k = str(q.get("question") or "").strip().lower()
        if k and k not in seen:
            seen.add(k)
            out.append(q)
    return out
