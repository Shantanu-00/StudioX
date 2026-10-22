"""The analyst: modes segment, lenses, curate, map, answer (CONTRACTS sections 4 and 9), plus the full
local pipeline used by run_local.py."""

from __future__ import annotations

import logging
import time
from typing import Literal, Optional

from pydantic import BaseModel, Field

from studiox_core import transcript as T
from studiox_core.package import assemble_package, shown_widgets
from studiox_core.schema import validate_widget

from . import coviewer, mapper
from .lenses import run_segment_lenses
from .llm import HAIKU, NOVA, ROLE_MODEL, SONNET, USAGE, structured, system_blocks
from .search import GATEWAY_URL, ledger, new_ledger
from .store import transcript_for

log = logging.getLogger("sxagents")
Genre = Literal["crime", "health", "science", "general"]
SINGLE_SEGMENT_UNDER_S = 90


# ---- segment -----------------------------------------------------------------------------------

class SegItem(BaseModel):
    start: float
    end: float
    title: str = Field(description="<= 50 characters, what this part is about")
    genre: Genre


class Speaker(BaseModel):
    id: str = Field(description="Speaker label from the transcript, e.g. spk_0")
    name: str = Field(description="Name or role, e.g. 'Dr. Julian' or 'Narrator'")


class SegOut(BaseModel):
    title: str = Field(description="Episode title or topic, <= 50 characters")
    genre: Genre
    speakers: list[Speaker]
    segments: list[SegItem]


SEGMENT = """Split this episode transcript into topical segments for a TV co-viewer. A segment is a
stretch about one topic; boundaries fall at topic changes, on line starts. Segments are at least 10
seconds; a clip under a minute usually has 1 to 3, a long episode one per few minutes. Give each a
short title and genre (crime, health, science or general). Name each speaker label if the
transcript reveals the name or role; otherwise keep the given name."""


def segment(tr: dict) -> dict:
    """{segments, speakers, genre}. Boundaries are normalised in code: contiguous, on line starts."""
    lines = T.format_lines(tr, tr["sentences"])
    labels = ", ".join(f"{k}={v}" for k, v in (tr.get("speakers") or {}).items()) or "(unnamed)"
    raw_lines = "\n".join(f"[{s['t0']:.1f}-{s['t1']:.1f}] {s['speaker']}: {s['text']}" for s in tr["sentences"])
    shared = (f"EPISODE {tr.get('mediaId', '')}, {tr['durationSec']:.1f} s. Speaker labels: {labels}\n"
              f"TRANSCRIPT ([start-end seconds] label: text):\n{raw_lines if len(raw_lines) < 200_000 else lines}")
    out = structured("segment", system_blocks(shared, SEGMENT), "Segment this episode.", SegOut, max_tokens=3000)
    speakers = dict(tr.get("speakers") or {})
    for sp in out.speakers:
        if sp.id and sp.name and (sp.id not in speakers or speakers[sp.id] == sp.id):
            speakers[sp.id] = T.clip(sp.name, 60)
    items = out.segments
    if tr["durationSec"] < SINGLE_SEGMENT_UNDER_S:
        # a short clip is one story: splitting it splits its timeline and duplicates its people
        items = [SegItem(start=0, end=tr["durationSec"], title=out.title, genre=out.genre)]
    return {"segments": normalise_segments(tr, items, out.genre), "speakers": speakers, "genre": out.genre}


def normalise_segments(tr: dict, items: list[SegItem], genre: str) -> list[dict]:
    dur = tr["durationSec"]
    starts = sorted({s["t0"] for s in tr["sentences"]})

    def snap_start(x: float) -> float:
        return min(starts, key=lambda s: abs(s - x)) if starts else 0.0

    items = sorted((i for i in items if i.end > i.start), key=lambda i: i.start)
    segs: list[dict] = []
    for it in items:
        st = 0.0 if not segs else snap_start(it.start)
        if segs and (st <= segs[-1]["start"] or st - segs[-1]["start"] < 10):
            continue  # too short or overlapping: merge into the previous one
        segs.append({"start": st, "title": T.clip(it.title, 80), "genre": it.genre})
    if not segs:
        segs = [{"start": 0.0, "title": T.clip(tr.get("mediaId", "Episode"), 80), "genre": genre}]
    if len(segs) > 1 and dur - segs[-1]["start"] < 5:
        segs.pop()
    out = []
    for i, s in enumerate(segs):
        end = segs[i + 1]["start"] if i + 1 < len(segs) else dur
        out.append({"id": f"s{i + 1}", "start": round(s["start"], 2), "end": round(end, 2), "title": s["title"],
                    "genre": s["genre"]})
    return out


# ---- curate ------------------------------------------------------------------------------------

class MomentItem(BaseModel):
    t: float
    caption: str = Field(description="<= 120 characters")


class QuestionItem(BaseModel):
    t: float = Field(description="When the question becomes askable: after the relevant line was said")
    question: str = Field(description="<= 100 characters, as a viewer would ask it")


class CardLabel(BaseModel):
    id: str
    headline: str = Field(description="<= 60 characters: the card's essence for a glance from the couch")
    teaser: Optional[str] = Field(default=None, description="Claims only, verdict not SUPPORTED: <= 40 characters, a curiosity question")


class CurateOut(BaseModel):
    widget_ids: list[str] = Field(description="Ids of the cards to show, best first")
    labels: list[CardLabel] = Field(default_factory=list, description="One per shown card")
    moments: list[MomentItem]
    questions: list[QuestionItem] = Field(description="2-3 suggested questions")


CURATE = """You are the showrunner of a TV co-viewer. From the candidate cards, choose the ones worth
showing. Aim for variety: a person worth knowing, the strongest fact checks, and any list, routine
or timeline the viewer would want to keep. Drop near-duplicates (two cards about the same thing:
keep the richer one) and weak, low-salience ones. Keep the rail calm: for a clip under a minute,
4 to 7 cards; for a long episode, about one card per minute. Then write moment captions: one line
at each key point, at the second the point is made. Then suggest 2-3 questions a viewer might ask,
each at a time after the lines needed to answer it were said.
Finally, label every card you show for a TV seen from across a room: a `headline` of at most 60
characters that keeps the meaning (no jargon, no hedging words, no "the speaker says"), and, for a
claim whose verdict is not SUPPORTED, a `teaser` of at most 40 characters phrased as the question a
curious viewer would ask, e.g. "Does a nap really cut heart strain 37%?". Never change a claim's
meaning to make it shorter."""


def curate(tr: dict, segments: list[dict], candidates: list[dict]) -> dict:
    """{moments, widgetIds, questions}."""
    rows = []
    for c in candidates:
        w = c["widget"]
        ev = w.get("evidence") or [{}]
        label = w.get("claim") or w.get("name") or w.get("title") or ""
        extra = f" verdict={w['verdict']}" if w.get("verdict") else ""
        rows.append(f"{w['id']} | {c.get('lens')} | {w['type']} | {label} | {ev[0].get('t0', 0):.1f}-"
                    f"{ev[-1].get('t1', 0):.1f} s | salience {c.get('salience', 0)}{extra} | {c.get('reason', '')}")
    seg_txt = "\n".join(f"{s['id']} {s['start']:.1f}-{s['end']:.1f} {s['title']}" for s in segments)
    shared = (f"EPISODE {tr.get('mediaId', '')}, {tr['durationSec']:.1f} s.\nSEGMENTS:\n{seg_txt}\n"
              f"TRANSCRIPT:\n{T.format_lines(tr, tr['sentences'])}")
    out = structured("curate", system_blocks(shared, CURATE),
                     "CANDIDATE CARDS (id | lens | type | label | evidence | salience | reason):\n"
                     + ("\n".join(rows) or "(none)"), CurateOut, max_tokens=2500)
    ids = {c["widget"]["id"] for c in candidates}
    dur = tr["durationSec"]
    moments = [{"t": round(min(max(m.t, 0), dur), 2), "caption": T.clip(m.caption, 200)}
               for m in out.moments if m.caption.strip()][:300]
    questions = [{"t": askable_at(tr, q.t), "question": T.clip(q.question, 140)}
                 for q in out.questions if q.question.strip()][:3]
    return {"moments": moments, "widgetIds": ensure_variety(
                [i for i in dict.fromkeys(out.widget_ids) if i in ids], candidates, dur),
            "questions": questions,
            "labels": {lb.id: {"headline": lb.headline, "teaser": lb.teaser} for lb in out.labels if lb.id in ids}}


def ensure_variety(shown: list[str], candidates: list[dict], duration: float) -> list[str]:
    """Code backstop for the curator: every card type that survived verification appears at least
    once (its highest-salience card), within the rail budget (7 for a short clip, ~1 per minute)."""
    cap = max(7, int(duration // 60))
    shown = list(shown)
    types = {c["widget"]["id"]: c["widget"]["type"] for c in candidates}
    have = {types[i] for i in shown if i in types}
    for c in sorted(candidates, key=lambda c: -float(c.get("salience") or 0)):
        t = c["widget"]["type"]
        if t not in have and len(shown) < cap:
            shown.append(c["widget"]["id"])
            have.add(t)
    return shown


def askable_at(tr: dict, t: float) -> float:
    """A question time inside a line moves to the end of that line, so the answer can use it."""
    t = min(max(float(t), 0.0), tr["durationSec"])
    for s in tr["sentences"]:
        if s["t0"] <= t < s["t1"]:
            return round(s["t1"], 2)
    return round(t, 2)


# ---- dispatch ----------------------------------------------------------------------------------

def handle(payload: dict) -> dict:
    """AgentCore `analyst` entry: route by `mode`."""
    mode = payload.get("mode")
    tr = transcript_for(payload)
    new_ledger()
    if mode == "segment":
        return segment(tr)
    if mode == "lenses":
        return run_segment_lenses(tr, payload["segment"], payload.get("brief"))
    if mode == "curate":
        return curate(tr, payload.get("segments") or [], payload.get("candidates") or [])
    if mode == "map":
        return mapper.handle_map(tr, payload)
    if mode == "answer":
        return coviewer.ask(tr, float(payload["t"]), payload["question"])
    raise ValueError(f"unknown mode {mode!r}")


def models_used() -> dict:
    search = "agentcore-gateway WebSearch" if GATEWAY_URL else f"nova_grounding {NOVA}"
    return {"segment": SONNET, "lenses": f"orchestrator {ROLE_MODEL['orchestrator']}; claims+people {SONNET}; "
                                         f"burst+protocol+events {HAIKU}", "stance": SONNET, "curate": SONNET, "map": SONNET,
            "answers": ROLE_MODEL["ask"], "search": search}


def build_package(tr: dict, media_id: str, version: int = 1, say=print, pinned: list[dict] | None = None) -> dict:
    """segment -> lenses (every segment) -> validate/verdict -> curate -> map -> answers -> package.

    `pinned`: extra questions [{t, question}] the map attaches to the node on screen at t."""
    t_all = time.time()
    tr = {**tr, "mediaId": media_id}
    timings: dict[str, float] = {}

    t = time.time()
    seg = segment(tr)
    timings["segment"] = round(time.time() - t, 1)
    tr["speakers"] = seg["speakers"]
    say(f"segments: {[(s['id'], s['start'], s['end'], s['title']) for s in seg['segments']]}")

    candidates, rejected, recaps, paths = [], [], [], set()
    cast = sorted(set(seg["speakers"].values()))
    for s in seg["segments"]:
        t = time.time()
        new_ledger()
        r = run_segment_lenses(tr, s, {"cast": cast, "recaps": list(recaps)})
        paths |= ledger().paths
        dt = round(time.time() - t, 1)
        timings["lenses " + s["id"]] = dt
        say(f"{s['id']}: lenses {[c['lens'] for c in r['lensCalls']]} -> {len(r['candidates'])} candidates, "
            f"{len(r['rejected'])} rejected ({dt} s)")
        candidates += r["candidates"]
        rejected += r["rejected"]
        recaps.append(f"{s['title']}: {r['recap']}")

    valid = [c for c in candidates if validate_widget(c["widget"]) is not None]
    t = time.time()
    cur = curate(tr, seg["segments"], valid)
    timings["curate"] = round(time.time() - t, 1)

    t = time.time()
    shown = shown_widgets(valid, cur["widgetIds"], cur.get("labels"))
    try:
        explore, map_problems = mapper.author_map(tr, seg["segments"], shown, cur["moments"], pinned,
                                                     cur["questions"])
    except Exception as e:  # the map is optional: the episode still ships without one
        log.exception("map failed")
        explore, map_problems = {"eligible": False, "reason": "The map could not be drawn"}, [f"map failed: {e}"]
    timings["map"] = round(time.time() - t, 1)
    say(f"map: eligible={explore.get('eligible')} layout={explore.get('layout')} category={explore.get('category')} "
        f"nodes={len(explore.get('nodes') or [])} edges={len(explore.get('edges') or [])} "
        f"sims={[s['engine'] for s in explore.get('sims') or []]} problems={len(map_problems)}")

    answers = []
    t = time.time()
    for q in mapper.merge_questions(cur["questions"], mapper.map_questions(explore)):
        try:
            extra = {"mapNode": q["mapNode"]} if q.get("mapNode") else {}
            answers.append({"question": q["question"], "t": q["t"], **coviewer.ask(tr, q["t"], q["question"]), **extra})
            paths |= ledger().paths
        except Exception as e:
            log.exception("answer failed")
            say(f"answer failed for {q['question']!r}: {e}")
    timings["answers"] = round(time.time() - t, 1)

    pkg = assemble_package(media_id, seg["segments"], cur["moments"], candidates, rejected, answers,
                           models_used(), version, transcript=tr, shown_ids=cur["widgetIds"],
                           labels=cur.get("labels"), explore=explore)
    pkg["models"]["searchPathsUsed"] = ", ".join(sorted(paths)) or "none"
    timings["total"] = round(time.time() - t_all, 1)
    pkg["_run"] = {"timings": timings, "usage": USAGE.totals(), "usageByRole": USAGE.by_role,
                   "mapProblems": map_problems,
                   "candidatesAudit": [{"id": c["widget"]["id"], "lens": c["lens"], "salience": c.get("salience"),
                                        "reason": c.get("reason"), **(c.get("audit") or {})} for c in candidates]}
    return pkg
