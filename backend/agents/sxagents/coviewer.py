"""The co-viewer: `ask` (answer a question at the playhead) and `refine` (caption + at most one
new card at the playhead). Neither ever reads the transcript after `t`."""

from __future__ import annotations

import logging
import math
import os
from typing import Literal, Optional

from pydantic import BaseModel, Field
from strands import tool

from studiox_core import transcript as T
from studiox_core.schema import validate_answer_body, validate_refine

from .guards import BudgetGuard, SpoilerGuard, cite_guard
from .lenses import (BurstList, Collector, Protocol, Timeline, build_burst, build_protocol, build_timeline)
from .llm import structured, system_blocks
from .search import BudgetExceeded, ledger, new_ledger, replay_searches, web_search

log = logging.getLogger("sxagents")

ASK_WINDOW_S = 900  # transcript before t given in full; older parts via read_transcript
REFINE_WINDOW_S = 45
MAX_ASK_SEARCHES = 2
MEMORY_ID = os.environ.get("MEMORY_ID", "")


class AskOut(BaseModel):
    text: str = Field(description="The answer, 1-4 short sentences, <= 600 characters, plain text")
    cite_seconds: list[float] = Field(
        default=[], description="Start seconds of the transcript lines the answer relies on (max 6)")
    source_urls: list[str] = Field(default=[], description="URLs from web_search results you relied on (max 4)")


ASK = """You are StudioX, a co-viewer watching this episode with the viewer. Answer their question
about what has been said so far. You only know the transcript up to the playhead; never guess what
comes later. Ground the answer in the transcript and cite the start seconds of the lines you use.
If the question needs outside facts (is a study real, who is someone), call web_search (at most
twice) and list the URLs you relied on; do not cite any URL that web_search did not return. If you
cannot tell, say so plainly. In a case or a mystery, weigh the evidence so far without settling
it: say what it does and does not prove yet, and leave the verdict to the episode. Health topics:
describe what was said, not medical advice."""


def ask(tr: dict, t: float, question: str) -> dict:
    """{text, cites (seconds), sources} for `question` at playhead `t`."""
    t = max(0.0, min(float(t), tr["durationSec"]))
    question = T.clip(str(question or ""), 300)
    if not question:
        raise ValueError("question is required")
    seen = T.before(tr, t)  # SpoilerGuard, in code: nothing after t is ever put in the prompt
    recent = [s for s in seen if s["t1"] >= t - ASK_WINDOW_S]
    led = new_ledger(max_searches=MAX_ASK_SEARCHES)

    @tool
    def read_transcript(t0: float, t1: float) -> str:
        """Read earlier transcript lines between t0 and t1 seconds (only up to the playhead)."""
        t1 = min(float(t1), t)  # enforced in the tool too
        return T.format_lines(tr, [s for s in seen if s["t1"] > float(t0) and s["t0"] < t1]) or "(nothing)"

    @tool(name="web_search")
    def web_search_tool(query: str) -> list:
        """Search the web. Returns results with title, url and snippet."""
        try:
            return [{"title": r["title"], "url": r["url"], "snippet": r["snippet"][:400]} for r in web_search(query)]
        except BudgetExceeded as e:
            return [{"error": str(e)}]

    shared = (f"EPISODE {tr.get('mediaId', '')}. Playhead at {t:.1f} s of {tr['durationSec']:.1f} s.\n"
              f"TRANSCRIPT so far ([start-end seconds] speaker: text):\n{T.format_lines(tr, recent) or '(nothing yet)'}")
    out = structured(
        "ask", system_blocks(shared, ASK), f"Viewer question at {t:.1f} s: {question}", AskOut,
        tools=[read_transcript, web_search_tool],
        hooks=[SpoilerGuard(t), BudgetGuard(max_calls=5, per_tool={"web_search": MAX_ASK_SEARCHES})],
        max_tokens=2000, on_searches=lambda: led.queries, replay_searches=replay_searches)
    starts = sorted({s["t0"] for s in seen})
    cites = []
    for c in out.cite_seconds:
        # snap to the start of a line already said; drop anything at or past the playhead
        if not 0 <= c < t:
            continue
        prior = [x for x in starts if x <= c + 0.5 and x < t]
        if prior:
            cites.append(math.floor(prior[-1]))
    sources, stripped = cite_guard(out.source_urls, ledger())
    if stripped:
        log.warning("CitationGuard stripped %d answer urls", len(stripped))
    body = validate_answer_body({"text": T.clip(out.text, 900), "cites": cites,
                                 "sources": [{"title": s["title"], "url": s["url"]} for s in sources]})
    if body is None:
        raise RuntimeError("answer failed validation")
    return body


class RefineOut(BaseModel):
    caption: str = Field(description="One line on what is happening right now, <= 180 characters")
    widget_kind: Literal["none", "entity_list", "protocol", "timeline"] = Field(
        description="A new card only if something worth one was just said and is not already covered; else none")
    entity_list: Optional[BurstList] = None
    protocol: Optional[Protocol] = None
    timeline: Optional[Timeline] = None


REFINE = """You are StudioX, a co-viewer. The viewer paused. Write one caption line about what is
happening at the playhead. Add at most one new card (entity_list for 3+ named things, protocol for
steps, timeline for 3+ timed events) only if the recent lines contain one and the existing cards do
not cover it. Use only the transcript lines given, with their timestamps."""


def refine(tr: dict, t: float, package: dict | None = None) -> dict:
    """{caption, widget?}: at most one new widget, which must pass validate_widget."""
    t = max(0.0, min(float(t), tr["durationSec"]))
    seen = T.before(tr, t)
    recent = [s for s in seen if s["t1"] >= t - REFINE_WINDOW_S]
    lo = recent[0]["t0"] if recent else 0.0
    existing = []
    for w in (package or {}).get("widgets") or []:
        if any(e.get("t1", 0) >= lo and e.get("t0", 1e9) <= t for e in w.get("evidence") or []):
            existing.append(f"- {w.get('type')}: {w.get('title') or w.get('name') or w.get('claim')}")
    shared = (f"EPISODE {tr.get('mediaId', '')}. Paused at {t:.1f} s.\nRECENT LINES:\n"
              f"{T.format_lines(tr, recent) or '(nothing yet)'}\n\nCARDS ALREADY SHOWN HERE:\n"
              f"{chr(10).join(existing) or '(none)'}")
    out = structured("refine", system_blocks(shared, REFINE), "Caption and optional card.", RefineOut, max_tokens=1500)
    col = Collector("live")
    widget = None
    sub = {"entity_list": out.entity_list, "protocol": out.protocol, "timeline": out.timeline}.get(out.widget_kind)
    if sub is not None:
        build = {"entity_list": build_burst, "protocol": build_protocol, "timeline": build_timeline}[out.widget_kind]
        widget = build(tr, sub, lo, t, col)  # evidence clamped to <= t
        if widget:
            widget["id"] = f"live-{int(t * 10)}-{widget['type']}"
    res = validate_refine({"caption": T.clip(out.caption, 200), **({"widget": widget} if widget else {})})
    return res or {"caption": T.clip(out.caption or "…", 200)}


def remember(session_id: str, viewer_id: str, question: str, answer: str) -> None:
    """Write the turn to AgentCore Memory when MEMORY_ID is set; never required."""
    if not MEMORY_ID:
        return
    try:
        from bedrock_agentcore.memory import MemoryClient

        MemoryClient().create_event(memory_id=MEMORY_ID, actor_id=viewer_id or "anonymous",
                                    session_id=session_id or "default",
                                    messages=[(question, "USER"), (answer, "ASSISTANT")])
    except Exception as e:
        log.warning("memory write failed: %s", e)
