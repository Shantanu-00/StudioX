"""The lenses: an orchestrator agent picks which apply (agents as tools); each lens is a fresh
Strands Agent with structured output that emits TV widgets with transcript evidence.

people -> dossier, claims -> claim (fact-check flow), burst -> entity_list,
protocol -> protocol, events -> timeline.
"""

from __future__ import annotations

import re

import logging
import threading
from typing import Literal, Optional

from pydantic import BaseModel, Field
from strands import tool

from studiox_core import transcript as T
from studiox_core.verdict import RULES_VERSION, decide_verdict

from .guards import BudgetGuard, cite_guard
from .llm import recorded, replaying, structured, system_blocks
from .search import BudgetExceeded, ledger, web_search, wiki_page

log = logging.getLogger("sxagents")

LENSES = ("people", "claims", "burst", "protocol", "events")
MAX_CLAIMS_PER_SEGMENT = 4
MAX_REFINES = 2  # fact-check: one search plus at most two refined searches per claim
BURST_MIN_ITEMS = 3
# Technical names (compounds, drugs) said with doses are hard to catch even two at a time.
BURST_MIN_TECHNICAL = 2
BURST_WINDOW_S = 20.0
EVENTS_MIN = 3
clip = T.clip


# ---- structured outputs ------------------------------------------------------------------------

class Rejected(BaseModel):
    text: str = Field(description="What was considered, in a few words")
    reason: str = Field(description="Why it is not worth a card (e.g. common knowledge, opinion, too vague)")


class Scored(BaseModel):
    salience: float = Field(ge=0, le=1, description="0..1: how much a viewer gains from this card right now")
    reason: str = Field(description="One short sentence: why this card is worth showing")


class Span(BaseModel):
    t0: float = Field(description="Start, seconds into the episode, from the transcript timestamps")
    t1: float = Field(description="End, seconds")


class PersonFact(BaseModel):
    text: str = Field(description="One fact, <= 150 characters")
    from_wikipedia: bool = Field(description="True only if the fact is taken from the Wikipedia extract you looked up")
    t0: Optional[float] = Field(default=None, description="For facts said in the episode: start second")
    t1: Optional[float] = None


class Person(Scored, Span):
    name: str
    role: str = Field(description="Who they are, <= 70 characters (from Wikipedia if found, else from the episode)")
    wikipedia_title: Optional[str] = Field(
        default=None, description="Exact Wikipedia title you looked up and confirmed is this person; else null")
    facts: list[PersonFact] = Field(description="2-5 facts")


class PeopleOut(BaseModel):
    people: list[Person]
    rejected: list[Rejected] = []


class ClaimCand(Scored, Span):
    claim: str = Field(description="ONE checkable claim, close to the speaker's words, <= 120 characters")
    speaker: str = Field(description="Who made it, <= 50 characters, e.g. 'Dr. Julian, citing Harvard data'")
    context: str = Field(description="What was said around it, <= 240 characters")
    query: str = Field(description="A web search query (<= 200 characters) likely to find the original evidence")


class ClaimsOut(BaseModel):
    claims: list[ClaimCand]
    rejected: list[Rejected] = []


class SourceStance(BaseModel):
    index: int = Field(description="The source number as listed")
    stance: Literal["supports", "contradicts", "mixed", "irrelevant"]
    note: str = Field(description="Why, <= 120 characters")


class StanceOut(BaseModel):
    stances: list[SourceStance]
    finding: str = Field(description="What the sources actually say about the claim, neutral, <= 240 characters")
    caveat: Optional[str] = Field(default=None, description="The key caveat or counterpoint, <= 150 characters")
    refine_query: Optional[str] = Field(
        default=None, description="A better search query if the sources are off-target; null if they suffice")
    best_index: Optional[int] = Field(
        default=None, description="The relevant source closest to the original evidence (the study or its report)")


class BurstItem(Span):
    name: str = Field(description="The named thing, <= 55 characters")
    dose: Optional[str] = Field(default=None, description="Amount if stated, e.g. '145 mg'")
    as_said: str = Field(description="How the speaker put it, near-verbatim, <= 150 characters")


class BurstList(Scored):
    title: str = Field(description="<= 55 characters")
    kind: Literal["compound", "protocol", "book", "study", "other"]
    items: list[BurstItem]
    disclaimer: Optional[str] = Field(default=None, description="e.g. 'As stated by the guest. Not medical advice.'")


class BurstOut(BaseModel):
    lists: list[BurstList]
    rejected: list[Rejected] = []


class Step(Span):
    label: str = Field(description="<= 36 characters")
    detail: str = Field(description="<= 150 characters")


class Protocol(Scored):
    title: str = Field(description="<= 55 characters")
    steps: list[Step]
    disclaimer: Optional[str] = None


class ProtocolOut(BaseModel):
    protocols: list[Protocol]
    rejected: list[Rejected] = []


class Event(Span):
    when: str = Field(description="Clock time or date as said, <= 20 characters, e.g. '10:14 PM'")
    label: str = Field(description="<= 150 characters")
    kind: Literal["claim", "fact", "conflict"] = Field(
        description="claim = someone's account; fact = record/evidence; conflict = contradicts an account")


class Timeline(Scored):
    title: str = Field(description="<= 55 characters")
    events: list[Event]


class EventsOut(BaseModel):
    timelines: list[Timeline]
    rejected: list[Rejected] = []


class OrchestratorOut(BaseModel):
    recap: str = Field(description="What happened in this segment, <= 200 characters, for later segments")
    skipped: list[Rejected] = Field(default=[], description="Lenses you did not call, with the reason")


# ---- shared helpers ----------------------------------------------------------------------------

def context_block(tr: dict, seg: dict, brief: dict | None) -> str:
    brief = brief or {}
    cast = brief.get("cast") or tr.get("speakers") or {}
    if isinstance(cast, dict):  # the pipeline passes the speakers map {spk_0: name}
        cast = sorted(set(map(str, cast.values())))
    cast = ", ".join(map(str, cast)) or "(unknown)"
    recaps = "\n".join(f"- {r}" for r in (brief.get("recaps") or [])) or "- (start of episode)"
    lines = T.format_lines(tr, T.window(tr, seg["start"], seg["end"]))
    return (f"EPISODE {tr.get('mediaId', '')} · genre {seg.get('genre', 'general')}\n"
            f"Cast: {cast}\nEarlier segments:\n{recaps}\n\n"
            f"TRANSCRIPT of segment {seg['id']} \"{seg.get('title', '')}\" ({seg['start']:.1f}-{seg['end']:.1f} s).\n"
            f"Each line is [start-end seconds] speaker: text.\n{lines}")


def snap(tr: dict, t0: float | None, t1: float | None, lo: float = 0.0, hi: float | None = None) -> dict | None:
    """Evidence snapped to the transcript sentences it overlaps, inside [lo, hi]; None if none."""
    if t0 is None:
        return None
    t1 = t0 if t1 is None or t1 < t0 else t1
    hi = tr["durationSec"] if hi is None else hi
    t0, t1 = max(t0, lo), min(t1, hi)
    if t1 < t0:
        return None
    inside = [s for s in tr["sentences"] if s["t0"] < hi and s["t1"] > lo]
    hits = [s for s in inside if s["t1"] > t0 + 0.1 and s["t0"] < t1 - 0.1]
    if not hits:  # a zero-length or boundary span: the line containing its midpoint
        mid = (t0 + t1) / 2
        hits = ([s for s in inside if s["t0"] <= mid < s["t1"]] or [s for s in inside if s["t0"] <= mid <= s["t1"]])[:1]
    if not hits:
        return None
    return {"t0": round(max(min(s["t0"] for s in hits), lo), 2), "t1": round(min(max(s["t1"] for s in hits), hi), 2)}


def merge_spans(spans: list[dict], max_n: int = 8) -> list[dict]:
    out: list[dict] = []
    for s in sorted((s for s in spans if s), key=lambda s: s["t0"]):
        if out and s["t0"] <= out[-1]["t1"]:
            out[-1]["t1"] = max(out[-1]["t1"], s["t1"])
        else:
            out.append(dict(s))
    return out[:max_n]


class Collector:
    """Candidates and rejects from the lens calls of one invocation (lens tools run concurrently)."""

    def __init__(self, seg_id: str) -> None:
        self.seg_id = seg_id
        self.candidates: list[dict] = []
        self.rejected: list[dict] = []
        self.calls: list[dict] = []
        self.lock = threading.Lock()
        self.n: dict[str, int] = {}

    def next_id(self, lens: str) -> str:
        # per-lens counters keep ids stable when lenses run concurrently
        with self.lock:
            self.n[lens] = self.n.get(lens, 0) + 1
            return f"{lens}-{self.seg_id}-{self.n[lens]}"

    def add(self, lens: str, widget: dict, sc: Scored, audit: dict | None = None) -> None:
        c = {"lens": lens, "widget": widget, "salience": round(float(sc.salience), 2), "reason": clip(sc.reason, 160)}
        if audit:
            c["audit"] = audit
        with self.lock:
            self.candidates.append(c)

    def reject(self, lens: str, text: str, reason: str) -> None:
        with self.lock:
            self.rejected.append({"lens": lens, "text": clip(text or "?", 160), "reason": clip(reason or "?", 160)})


def _lens_system(ctx: str, instructions: str) -> list[dict]:
    return system_blocks(ctx, instructions + "\n\nUse only the transcript and, where stated, your tools. "
                         "Timestamps must come from the transcript lines. Return nothing rather than guess.")


# ---- people -------------------------------------------------------------------------------------

PEOPLE = """You are the PEOPLE lens of a TV co-viewer. Find people named in this segment who a viewer
would want to know about (public figures, or key people in the story). For a likely public figure,
call wikipedia_lookup with the exact article title and confirm the description matches the person
meant here; then take facts only from that extract (from_wikipedia=true). For people not on Wikipedia
(e.g. a suspect in a true-crime story), use what the episode says, with each fact's timestamps.
Do not make cards for the speakers themselves unless the episode says who they are. Put people not
worth a card in `rejected`."""


def people_lens(tr: dict, seg: dict, ctx: str, focus: str, col: Collector) -> str:
    looked: dict[str, dict | None] = {}

    @tool
    def wikipedia_lookup(title: str) -> dict:
        """Look up a Wikipedia article summary by exact title. Returns title, description and extract, or found=false."""
        page = wiki_page(title)
        looked[title.strip().lower()] = page
        if not page or page.get("disambiguation"):
            return {"found": False, "note": "no article or a disambiguation page; try a more exact title"}
        return {"found": True, "title": page["title"], "description": page["description"], "extract": page["extract"]}

    guard = BudgetGuard(max_calls=6, per_tool={"wikipedia_lookup": 5})
    out = structured("people", _lens_system(ctx, PEOPLE), f"Focus: {focus or 'people named'}", PeopleOut,
                     tools=[wikipedia_lookup], hooks=[guard])
    for r in out.rejected:
        col.reject("people", r.text, r.reason)
    for p in out.people[:4]:
        ev = snap(tr, p.t0, p.t1, seg["start"], seg["end"])
        if not ev:
            col.reject("people", p.name, "no transcript evidence")
            continue
        page = wiki_page(p.wikipedia_title) if p.wikipedia_title else None
        if page and page.get("disambiguation"):
            page = None
        facts = []
        for f in p.facts:
            if f.from_wikipedia:
                if page:
                    facts.append({"text": clip(f.text, 160), "source": "Wikipedia"})
                continue
            fev = snap(tr, f.t0, f.t1, seg["start"], seg["end"])
            if fev:
                facts.append({"text": clip(f.text, 160), "evidence": fev})
        if not facts:
            col.reject("people", p.name, "no grounded facts")
            continue
        w = {"id": col.next_id("people"), "type": "dossier", "evidence": [ev], "name": clip(p.name, 60),
             "role": clip(page["description"] if page and page.get("description") else p.role, 80),
             "facts": facts[:6]}
        if page and page.get("image"):
            w["image"] = {"url": page["image"]["url"], "credit": clip(page["image"]["credit"], 80)}
        col.add("people", w, p, {"wikipedia": page.get("url") if page else None,
                                 "imageLicence": (page.get("image") or {}).get("licence") if page else None})
    return f"people: {len(out.people)} found"


# ---- claims (fact-check flow) -------------------------------------------------------------------

CLAIMS = """You are the CLAIMS lens of a TV co-viewer. Find factual claims in this segment that a
viewer might doubt and that can be checked on the web: statistics, studies, "research shows",
historical or scientific statements, and promised results ("transforms your sleep in seven days"). Skip opinions, jokes and common knowledge. In a true-crime
or other story episode, statements about the case itself (who was where, what records show) cannot
be checked on the web: reject them, the timeline lens covers them. List rejects with the reason. For each claim
write a search query aimed at the original evidence (study, agency, reputable outlet). One claim
per card: split compound statements and keep the most checkable part."""

STANCE = """You check one claim against web search results. For each numbered source, label its
stance toward the claim AS STATED: supports, contradicts, mixed (partly true, overstated, or a
different measure), or irrelevant (off-topic or no information). Judge only from the source text
given. Then state neutrally what the sources say, and the key caveat if any. If the sources are
off-target, propose a better search query; otherwise leave refine_query null."""


def fact_check(c: ClaimCand) -> dict:
    """query -> search -> stance per source -> verdict rules in code; at most MAX_REFINES refinements.

    A plain bounded loop (not a Strands Graph): two of its four steps are deterministic code."""
    results: list[dict] = []
    query, st, verdict, searches = c.query, None, "UNVERIFIED", 0
    for attempt in range(1 + MAX_REFINES):
        try:
            got = web_search(query, max_results=5)
            searches += 1
        except BudgetExceeded:
            break
        known = {r["url"] for r in results}
        fresh = [r for r in got if r["url"] not in known]
        if attempt and not fresh:
            break  # the refined search found nothing new: re-labelling the same sources is pointless
        results = (results + fresh)[:8]
        if results:
            listing = "\n".join(f"[{i}] {r['title']} ({r['url']}): {r['snippet']}" for i, r in enumerate(results))
            st = structured("stance", system_blocks(None, STANCE),
                            f"CLAIM: {c.claim}\nSPEAKER: {c.speaker}\nCONTEXT: {c.context}\n\nSOURCES:\n{listing}",
                            StanceOut, max_tokens=1500)
            labelled = [s for s in st.stances if 0 <= s.index < len(results)]
            verdict = decide_verdict([s.stance for s in labelled],
                                     urls=[results[s.index]["url"] for s in labelled])
        if verdict != "UNVERIFIED" or attempt == MAX_REFINES:
            break
        nxt = (st.refine_query if st else None) or (c.claim if attempt == 0 else None)
        if not nxt or nxt == query:
            break
        query = nxt
    usable: list[tuple[str, dict]] = []
    if st:
        rank = {"contradicts": 0, "supports": 0, "mixed": 1}
        best = st.best_index
        for s in sorted(st.stances, key=lambda s: (s.index != best, rank.get(s.stance, 9))):
            if 0 <= s.index < len(results) and s.stance != "irrelevant":
                usable.append((s.stance, results[s.index]))
    # CitationGuard: every URL must be one this invocation's searches returned.
    sources, stripped = cite_guard([r["url"] for _, r in usable], ledger())
    if stripped:
        log.warning("CitationGuard stripped %d urls", len(stripped))
        verdict = "UNVERIFIED" if len(sources) < 2 else verdict
    return {"verdict": verdict, "sources": sources, "stance": st, "searches": searches,
            "stances": [s for s, _ in usable], "stanceUrls": [r["url"] for _, r in usable]}


def claims_lens(tr: dict, seg: dict, ctx: str, focus: str, col: Collector) -> str:
    out = structured("claims", _lens_system(ctx, CLAIMS), f"Focus: {focus or 'checkable claims'}", ClaimsOut)
    for r in out.rejected:
        col.reject("claims", r.text, r.reason)
    ranked = sorted(out.claims, key=lambda c: -c.salience)
    for c in ranked[MAX_CLAIMS_PER_SEGMENT:]:
        col.reject("claims", c.claim, "budget: lower salience than the claims checked")
    summary = []
    for c in ranked[:MAX_CLAIMS_PER_SEGMENT]:
        ev = snap(tr, c.t0, c.t1, seg["start"], seg["end"])
        if not ev:
            col.reject("claims", c.claim, "no transcript evidence")
            continue
        fc = fact_check(c)
        st: StanceOut | None = fc["stance"]
        w = {"id": col.next_id("claims"), "type": "claim", "evidence": [ev], "claim": clip(c.claim, 160),
             "speaker": clip(c.speaker, 60), "verdict": fc["verdict"],
             "context": clip(st.finding if st and fc["verdict"] != "UNVERIFIED" else c.context, 280)}
        if fc["sources"]:
            w["sources"] = fc["sources"]
            w["source"] = clip(fc["sources"][0]["title"], 80)
        if st and st.caveat and fc["verdict"] != "UNVERIFIED":
            w["counter"] = clip(st.caveat, 160)
        col.add("claims", w, c, {"verdictRules": RULES_VERSION, "stances": fc["stances"], "stanceUrls": fc["stanceUrls"],
                                 "searches": fc["searches"],
                                 "query": c.query})
        summary.append(f"{c.claim[:60]} -> {fc['verdict']} ({len(fc['sources'])} sources, {fc['searches']} searches)")
    return "claims: " + ("; ".join(summary) or "none")


# ---- burst, protocol, events --------------------------------------------------------------------

BURST = f"""You are the NAMED-THINGS lens of a TV co-viewer. Find bursts where the speaker names at
least {BURST_MIN_ITEMS} specific things (compounds, books, studies, products, techniques) within about
{int(BURST_WINDOW_S)} seconds, fast enough that a viewer would want them written down. Each item needs the
timestamps of the line that names it. Fewer than {BURST_MIN_ITEMS} items is not a burst: put it in `rejected`,
except compounds, drugs or supplements: {BURST_MIN_TECHNICAL} or more technical names said together (usually
with doses) count, because they are exactly what a viewer cannot spell or remember."""

PROTOCOL = """You are the PROTOCOL lens of a TV co-viewer. Find a routine, recipe or step-by-step
practice described in this segment (what to do, how much, when). Steps must be stated or directly
implied in the transcript, each with its timestamps; 2 to 8 steps. Health advice gets a disclaimer
such as 'As described in the episode. Not medical advice.'"""

EVENTS = f"""You are the TIMELINE lens of a TV co-viewer. Find at least {EVENTS_MIN} dated or clock-timed
events in this segment (including times mentioned for earlier events) and order them chronologically
in story time. Mark accounts as claim, records/evidence as fact, and evidence that contradicts an
account as conflict. `when` is the time as said; derive a clock time from a relative one with care
('the call came ten minutes after the 9:00 PM ping' means the call at 9:10 PM). Leave out events
with no time at all. Each event's timestamps are those of the line that mentions it. Fewer than
{EVENTS_MIN} events: put it in `rejected`."""


def build_burst(tr: dict, b: BurstList, lo: float, hi: float, col: Collector) -> dict | None:
    items = []
    for it in b.items[:12]:
        ev = snap(tr, it.t0, it.t1, lo, hi)
        if ev:
            item = {"name": clip(it.name, 60), "asSaid": clip(it.as_said, 160), "evidence": ev}
            if it.dose:
                item["dose"] = clip(it.dose, 24)
            items.append(item)
    technical = b.kind == "compound" or (items and all("dose" in i for i in items))
    need = BURST_MIN_TECHNICAL if technical else BURST_MIN_ITEMS
    if len(items) < need:
        col.reject("burst", b.title, f"only {len(items)} grounded items (needs {need})")
        return None
    starts = [i["evidence"]["t0"] for i in items]
    if max(starts) - min(starts) > BURST_WINDOW_S:
        col.reject("burst", b.title, f"items spread over {max(starts) - min(starts):.0f} s (> {BURST_WINDOW_S:.0f} s)")
        return None
    w = {"id": col.next_id("burst"), "type": "entity_list", "evidence": merge_spans([i["evidence"] for i in items]),
         "title": clip(b.title, 60), "kind": b.kind, "items": items}
    if b.disclaimer:
        w["disclaimer"] = clip(b.disclaimer, 160)
    return w


def build_protocol(tr: dict, p: Protocol, lo: float, hi: float, col: Collector) -> dict | None:
    steps = []
    for s in p.steps[:8]:
        ev = snap(tr, s.t0, s.t1, lo, hi)
        if ev:
            steps.append({"label": clip(s.label, 40), "detail": clip(s.detail, 160), "evidence": ev})
    if len(steps) < 2:
        col.reject("protocol", p.title, "fewer than 2 grounded steps")
        return None
    w = {"id": col.next_id("protocol"), "type": "protocol", "evidence": merge_spans([s["evidence"] for s in steps]),
         "title": clip(p.title, 60), "steps": steps}
    if p.disclaimer:
        w["disclaimer"] = clip(p.disclaimer, 160)
    return w


def build_timeline(tr: dict, tl: Timeline, lo: float, hi: float, col: Collector) -> dict | None:
    events = []
    for e in tl.events[:20]:
        ev = snap(tr, e.t0, e.t1, lo, hi)
        if ev:
            events.append({"id": f"e{len(events) + 1}", "when": clip(e.when, 24), "label": clip(e.label, 160),
                           "kind": e.kind, "evidence": ev})
    if len(events) < EVENTS_MIN:
        col.reject("events", tl.title, f"only {len(events)} grounded events (needs {EVENTS_MIN})")
        return None
    return {"id": col.next_id("events"), "type": "timeline", "evidence": merge_spans([e["evidence"] for e in events]),
            "title": clip(tl.title, 60), "events": events}


def burst_lens(tr: dict, seg: dict, ctx: str, focus: str, col: Collector) -> str:
    out = structured("burst", _lens_system(ctx, BURST), f"Focus: {focus or 'named things'}", BurstOut)
    for r in out.rejected:
        col.reject("burst", r.text, r.reason)
    for b in out.lists[:2]:
        w = build_burst(tr, b, seg["start"], seg["end"], col)
        if w:
            col.add("burst", w, b)
    return f"burst: {len(out.lists)} lists"


def protocol_lens(tr: dict, seg: dict, ctx: str, focus: str, col: Collector) -> str:
    out = structured("protocol", _lens_system(ctx, PROTOCOL), f"Focus: {focus or 'routines'}", ProtocolOut)
    for r in out.rejected:
        col.reject("protocol", r.text, r.reason)
    for p in out.protocols[:2]:
        w = build_protocol(tr, p, seg["start"], seg["end"], col)
        if w:
            col.add("protocol", w, p)
    return f"protocol: {len(out.protocols)} found"


def events_lens(tr: dict, seg: dict, ctx: str, focus: str, col: Collector) -> str:
    out = structured("events", _lens_system(ctx, EVENTS), f"Focus: {focus or 'dated events'}", EventsOut)
    for r in out.rejected:
        col.reject("events", r.text, r.reason)
    for tl in out.timelines[:1]:
        w = build_timeline(tr, tl, seg["start"], seg["end"], col)
        if w:
            col.add("events", w, tl)
    return f"events: {len(out.timelines)} timelines"


LENS_FN = {"people": people_lens, "claims": claims_lens, "burst": burst_lens, "protocol": protocol_lens,
           "events": events_lens}


# ---- orchestrator --------------------------------------------------------------------------------

ORCH = """You are the showrunner's assistant for a TV co-viewer. Read the segment and decide which
lenses would give the viewer something worth a card. Call each useful lens tool once, with a short
focus note naming what it should look at; you may call several at once. Skip lenses with nothing to
find. Lenses: people (named people worth a dossier), claims (checkable factual claims; it fact-checks
on the web), burst (3+ named things in quick succession, or 2+ compounds/drugs named with doses), protocol (a routine or steps), events (3+
dated or timed events). After the tools return, write a short recap of the segment."""


DOSE = re.compile(r"\b\d+(?:\.\d+)?\s*(?:mg|milligrams?|mcg|micrograms?|g|grams?|iu|ml)\b", re.I)


def segment_text(tr: dict, seg: dict) -> str:
    lo, hi = seg.get("start", 0), seg.get("end", 1e9)
    return " ".join(x["text"] for x in tr.get("sentences", []) if x["t1"] > lo and x["t0"] < hi)


def run_segment_lenses(tr: dict, seg: dict, brief: dict | None = None) -> dict:
    """The `lenses` mode: {candidates, recap, rejected, lensCalls}."""
    ctx = context_block(tr, seg, brief)
    col = Collector(seg["id"])

    def run(lens: str, focus: str) -> str:
        col.calls.append({"lens": lens, "focus": focus})
        try:
            return LENS_FN[lens](tr, seg, ctx, focus, col)
        except Exception as e:  # one lens failing must not sink the segment
            log.exception("lens %s failed", lens)
            col.reject(lens, seg.get("title", seg["id"]), f"lens error: {type(e).__name__}")
            return f"{lens}: error"

    def lens_tool(lens: str, doc: str):
        def fn(focus: str) -> str:
            """Run the lens.

            Args:
                focus: What this lens should look at in the segment.
            """
            return run(lens, focus)

        return tool(name=f"{lens}_lens", description=doc)(fn)

    tools = [
        lens_tool("people", "People lens: dossiers for named people (Wikipedia for public figures)."),
        lens_tool("claims", "Claims lens: finds checkable claims and fact-checks them with web search."),
        lens_tool("burst", "Burst lens: a list when 3+ named things come in quick succession, or 2+ compounds/drugs with doses."),
        lens_tool("protocol", "Protocol lens: a routine or step-by-step practice described."),
        lens_tool("events", "Events lens: a timeline of 3+ dated or clock-timed events."),
    ]
    plan_key = [ctx, seg]
    recap = ""
    if replaying():
        plan = recorded("orchestration", plan_key, lambda: None)
        for c in plan["calls"]:
            run(c["lens"], c["focus"])
        recap = plan["recap"]
    else:
        try:
            guard = BudgetGuard(max_calls=len(LENSES), per_tool={f"{lens}_lens": 1 for lens in LENSES})
            out = structured("orchestrator", system_blocks(ctx, ORCH), "Pick the lenses for this segment.",
                             OrchestratorOut, tools=tools, hooks=[guard], max_tokens=1500)
            recap = out.recap
            for s in out.skipped:
                log.info("orchestrator skipped %s: %s", s.text, s.reason)
        except Exception:
            log.exception("orchestrator failed; running every lens")
            for lens in LENSES:
                if not any(c["lens"] == lens for c in col.calls):
                    run(lens, "")
        # Deterministic backstop: doses said aloud mean names a viewer will want written down.
        if not any(c["lens"] == "burst" for c in col.calls) and len(DOSE.findall(segment_text(tr, seg))) >= 2:
            run("burst", "compounds or drugs named with doses")
        recorded("orchestration", plan_key, lambda: {"calls": col.calls, "recap": recap})
    # Lens tools finish in any order; sort so downstream prompts (and replays) are deterministic.
    order = {lens: i for i, lens in enumerate(LENSES)}
    cands = sorted(col.candidates, key=lambda c: (c["widget"]["evidence"][0]["t0"], order.get(c["lens"], 9),
                                                  c["widget"]["id"]))
    rejected = sorted(col.rejected, key=lambda r: order.get(r["lens"], 9))
    return {"candidates": cands, "recap": clip(recap or seg.get("title", ""), 200),
            "rejected": rejected, "lensCalls": col.calls}
