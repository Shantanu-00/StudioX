"""The Map (`explore` block of the episode package): validation and bounds, CONTRACTS section 9.

The Map author agent proposes; this code has the final say. `validate_map` cleans what it can
(clips text, clamps sim params, drops bad nodes, edges, sims and questions) and then applies the
eligibility rules. Stdlib only (it runs in the agents and in the publish Lambda).

  validate_map(explore, duration, widgets) -> (explore | None, problems)

`widgets` are the package's shown widgets: node `refs` may only point at them, and a node's
`verdict` is copied from a referenced claim widget, never taken from the agent. The result is
either a full eligible map, or `{"eligible": False, "reason": ...}`; None only when `explore` is
not an object at all. Validating an already-valid map returns it unchanged with no problems.
"""

from __future__ import annotations

import math
import re
from typing import Any

from .schema import VERDICTS, js_len

CATEGORIES = ("health", "crime", "finance", "history", "tech", "motivation", "scifi", "other")
LAYOUTS = ("flow", "timeline", "compare", "cluster")
KINDS = ("idea", "step", "claim", "event", "person", "number")
EDGE_KINDS = ("then", "because", "supports", "contradicts")
LIMITS = {"label": 44, "detail": 200, "when": 16, "title": 48, "summary": 120, "reason": 120,
          "group": 32, "edge": 24, "id": 32, "question": 100, "quote": 120, "unit": 12}
COUNTS = {"groups": (1, 5), "nodes": (3, 12), "edges": 16, "sims": 2, "questions": 4}
MIN_EDGES = 2         # flow and cluster
MIN_TIMED = 3         # timeline: nodes with `when` or a distinct `t`
T_SNAP_TOLERANCE = 1.0  # a node's t may sit this far outside its cards' evidence before it is snapped

# Simulation engines compiled into the TV: param -> (low, high, default). None default = required.
SIM_ENGINES: dict[str, dict[str, tuple[float, float, float | None]]] = {
    "night": {"cycleMinutes": (60, 120, 90), "cycles": (3, 6, 5), "bedtime": (1200, 1560, 1380)},
    "growth": {"start": (0, 1e9, 0), "monthly": (0, 1e7, 0), "ratePct": (0, 30, None), "years": (1, 50, None),
               "laterYears": (0, 30, 0)},
}
SIM_INTS = {"cycles", "cycleMinutes", "bedtime", "years", "laterYears"}
_CURRENCY = re.compile(r"^[A-Z]{3}$")
_ID = re.compile(r"^[A-Za-z0-9_.:-]{1,32}$")  # the TV's id rule (src/analysis/schema.ts)


def clip(text: Any, limit: int) -> str | None:
    """Collapse whitespace; cut to `limit` UTF-16 units at a word boundary with an ellipsis.
    None when empty or not a string."""
    if not isinstance(text, str):
        return None
    s = " ".join(text.split())
    if not s:
        return None
    if js_len(s) <= limit:
        return s
    cut = s
    while js_len(cut) > limit - 1:
        cut = cut[:-1]
    if " " in cut:
        cut = cut.rsplit(" ", 1)[0]
    return cut.rstrip(" ,;:.-") + "…"


def _num(v: Any) -> float | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        return None
    return float(v)


def _r(x: float) -> float | int:
    """Round seconds to 2 places; whole numbers stay ints (stable JSON)."""
    x = round(x, 2)
    return int(x) if x == int(x) else x


def _id(v: Any) -> str | None:
    return v if isinstance(v, str) and _ID.match(v) else None


def evidence_spans(widget: dict) -> list[tuple[float, float]]:
    """Every {t0, t1} in a widget: its evidence plus nested evidence of items, steps, events, facts."""
    out: list[tuple[float, float]] = []

    def walk(v: Any) -> None:
        if isinstance(v, dict):
            a, b = _num(v.get("t0")), _num(v.get("t1"))
            if a is not None and b is not None and b >= a and set(v) <= {"t0", "t1"}:
                out.append((a, b))
                return
            for x in v.values():
                walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)

    walk({k: v for k, v in widget.items() if k not in ("sources",)})
    return sorted(set(out))


def _snap_t(t: float, spans: list[tuple[float, float]]) -> float:
    """Inside (or near) a span: unchanged. Otherwise the start of the nearest span."""
    if not spans or any(a - T_SNAP_TOLERANCE <= t <= b + T_SNAP_TOLERANCE for a, b in spans):
        return t
    return min(spans, key=lambda s: min(abs(s[0] - t), abs(s[1] - t)))[0]


def _clean_sim(raw: Any, duration: float, problems: list[str]) -> dict | None:
    if not isinstance(raw, dict):
        return None
    engine = raw.get("engine")
    spec = SIM_ENGINES.get(engine)
    if spec is None:
        problems.append(f"sim dropped: unknown engine {engine!r}")
        return None
    sid = _id(raw.get("id")) or engine
    title = clip(raw.get("title"), LIMITS["title"])
    if not title:
        problems.append(f"sim {sid} dropped: no title")
        return None
    if title != raw.get("title"):
        problems.append(f"sim {sid}: title clipped")
    src = raw.get("params") if isinstance(raw.get("params"), dict) else {}
    params: dict[str, Any] = {}
    for k, (lo, hi, default) in spec.items():
        v = _num(src.get(k))
        if v is None:
            if default is None:
                problems.append(f"sim {sid} dropped: {k} is required")
                return None
            if k in src:
                problems.append(f"sim {sid}: bad {k}, default used")
            v = float(default)
        if engine == "night" and k == "bedtime" and 0 <= v < lo and v + 1440 <= hi:
            v += 1440  # 00:30 given as 30 means 24:30 here (wraps at 1440)
        c = min(max(v, lo), hi)
        if k in SIM_INTS:
            c = float(round(c))
        if c != v:
            problems.append(f"sim {sid}: {k} {src.get(k)!r} clamped to {_r(c)}")
        params[k] = _r(c)
    if engine == "growth":
        if params["start"] == 0 and params["monthly"] == 0:
            problems.append(f"sim {sid} dropped: nothing to grow (start and monthly are 0)")
            return None
        cur = src.get("currency")
        cur = cur.upper() if isinstance(cur, str) else None
        if not cur or not _CURRENCY.match(cur):
            problems.append(f"sim {sid}: bad currency {src.get('currency')!r}, USD used")
            cur = "USD"
        elif cur != src.get("currency"):
            problems.append(f"sim {sid}: currency upper-cased")
        params["currency"] = cur
    quote = clip(src.get("quote"), LIMITS["quote"])
    qt = _num(src.get("quoteT"))
    if quote:
        params["quote"] = quote
        if quote != src.get("quote"):
            problems.append(f"sim {sid}: quote clipped")
        if qt is not None and 0 <= qt <= duration:
            params["quoteT"] = _r(qt)
        elif "quoteT" in src:
            problems.append(f"sim {sid}: quoteT outside the episode, dropped")
    return {"id": sid, "engine": engine, "title": title, "params": params}


def _ineligible(reason: str) -> dict:
    return {"eligible": False, "reason": clip(reason, LIMITS["reason"]) or "Not a fit for a map"}


def validate_map(explore: Any, duration: float, widgets: list[dict] | None) -> tuple[dict | None, list[str]]:
    if not isinstance(explore, dict):
        return None, ["explore is not an object"]
    problems: list[str] = []
    duration = float(duration or 0)
    if explore.get("eligible") is not True:
        reason = explore.get("reason") if isinstance(explore.get("reason"), str) else "The agent found no map"
        out = _ineligible(reason)
        if out["reason"] != explore.get("reason") or set(explore) - {"eligible", "reason"}:
            problems.append("ineligible map reduced to {eligible, reason}")
        return out, problems

    by_id = {w["id"]: w for w in widgets or [] if isinstance(w, dict) and isinstance(w.get("id"), str)}

    def text(key: str, limit_key: str, required: bool = True) -> str | None:
        v = clip(explore.get(key), LIMITS[limit_key])
        if v is not None and v != explore.get(key):
            problems.append(f"{key} clipped")
        if v is None and required:
            problems.append(f"missing {key}")
        return v

    reason = text("reason", "reason")
    title = text("title", "title")
    summary = text("summary", "summary")
    category = explore.get("category")
    if category not in CATEGORIES:
        problems.append(f"category {category!r} -> other")
        category = "other"
    layout = explore.get("layout")
    if layout not in LAYOUTS:
        return _ineligible(f"Unknown layout {layout!r}"), problems + [f"unknown layout {layout!r}"]
    if not (reason and title and summary):
        return _ineligible("The map is missing its title, summary or reason"), problems

    # groups
    groups, gids = [], set()
    for g in explore.get("groups") or []:
        gid = _id(g.get("id")) if isinstance(g, dict) else None
        gt = clip(g.get("title"), LIMITS["group"]) if isinstance(g, dict) else None
        if not gid or not gt or gid in gids:
            problems.append(f"group dropped: {g!r}"[:120])
            continue
        if gt != g.get("title"):
            problems.append(f"group {gid}: title clipped")
        if len(groups) >= COUNTS["groups"][1]:
            problems.append(f"group {gid} dropped: more than {COUNTS['groups'][1]}")
            continue
        groups.append({"id": gid, "title": gt})
        gids.add(gid)
    if not groups:
        problems.append("no valid group: one made from the title")
        groups = [{"id": "g1", "title": clip(title, LIMITS["group"])}]
        gids = {"g1"}

    # sims (before nodes, so node.sim can be checked)
    sims: list[dict] = []
    raw_sims = explore.get("sims") or []
    for s in raw_sims if isinstance(raw_sims, list) else []:
        cs = _clean_sim(s, duration, problems)
        if cs is None:
            continue
        if any(x["id"] == cs["id"] for x in sims) or len(sims) >= COUNTS["sims"]:
            problems.append(f"sim {cs['id']} dropped: duplicate or over {COUNTS['sims']}")
            continue
        sims.append(cs)
    sim_ids = {s["id"] for s in sims}

    # nodes
    nodes, nids = [], set()
    raw_nodes = explore.get("nodes") if isinstance(explore.get("nodes"), list) else []
    for n in raw_nodes:
        if not isinstance(n, dict):
            continue
        nid = _id(n.get("id"))
        label = clip(n.get("label"), LIMITS["label"])
        t = _num(n.get("t"))
        if not nid or nid in nids or not label or t is None or not 0 <= t <= duration:
            problems.append(f"node dropped (id, label or t): {n.get('id')!r} {str(n.get('label'))[:30]!r} t={n.get('t')!r}")
            continue
        if len(nodes) >= COUNTS["nodes"][1]:
            problems.append(f"node {nid} dropped: more than {COUNTS['nodes'][1]}")
            continue
        if label != n.get("label"):
            problems.append(f"node {nid}: label clipped")
        kind = n.get("kind")
        if kind not in KINDS:
            problems.append(f"node {nid}: kind {kind!r} -> idea")
            kind = "idea"
        group = n.get("group")
        if group not in gids:
            if group is not None:
                problems.append(f"node {nid}: unknown group {group!r} -> {groups[0]['id']}")
            group = groups[0]["id"]
        refs_in = n.get("refs") if isinstance(n.get("refs"), list) else []
        refs = [r for r in dict.fromkeys(x for x in refs_in if isinstance(x, str)) if r in by_id][:4]
        if len(refs) != len(refs_in):
            problems.append(f"node {nid}: refs to unknown cards dropped")
        spans = sorted({sp for r in refs for sp in evidence_spans(by_id[r])})
        t_snapped = _snap_t(t, spans)
        if t_snapped != t:
            problems.append(f"node {nid}: t {t} outside its cards' evidence, snapped to {t_snapped}")
            t = t_snapped
        t1 = _num(n.get("t1"))
        if t1 is not None:
            t1c = min(max(t1, t), duration)
            if t1c != t1:
                problems.append(f"node {nid}: t1 clamped")
            t1 = t1c
        detail = clip(n.get("detail"), LIMITS["detail"])
        if detail is not None and detail != n.get("detail"):
            problems.append(f"node {nid}: detail clipped")
        when = clip(n.get("when"), LIMITS["when"])
        if when is not None and when != n.get("when"):
            problems.append(f"node {nid}: when clipped")
        value = None
        v = n.get("value")
        if isinstance(v, dict) and layout == "compare":
            num, unit = _num(v.get("n")), clip(v.get("unit"), LIMITS["unit"])
            if num is not None and unit:
                value = {"n": num if num != int(num) else int(num), "unit": unit}
        if v is not None and value is None:
            problems.append(f"node {nid}: value dropped")
        # verdict: copied from a referenced claim, never the agent's own
        verdict = None
        if kind == "claim" or n.get("verdict") is not None:
            for r in refs:
                w = by_id[r]
                if w.get("type") == "claim" and w.get("verdict") in VERDICTS:
                    verdict = w["verdict"]
                    break
        if n.get("verdict") is not None and n.get("verdict") != verdict:
            problems.append(f"node {nid}: verdict {n.get('verdict')!r} -> {verdict!r} (from its claim card)")
        sim = n.get("sim")
        if sim is not None and sim not in sim_ids:
            problems.append(f"node {nid}: sim {sim!r} dropped")
            sim = None
        nodes.append({"id": nid, "group": group, "kind": kind, "label": label, "detail": detail, "t": _r(t),
                      "t1": _r(t1) if t1 is not None else None, "when": when, "value": value, "verdict": verdict,
                      "refs": refs, "sim": sim})
        nids.add(nid)

    # a sim no node opens is unreachable on the TV
    used = {n["sim"] for n in nodes if n["sim"]}
    for s in [s for s in sims if s["id"] not in used]:
        problems.append(f"sim {s['id']} dropped: no node opens it")
    sims = [s for s in sims if s["id"] in used]
    # groups with no node are empty columns
    used_g = {n["group"] for n in nodes}
    if any(g["id"] not in used_g for g in groups) and used_g:
        problems.append("empty groups dropped")
        groups = [g for g in groups if g["id"] in used_g]

    # edges
    edges, seen = [], set()
    for e in explore.get("edges") or []:
        if not isinstance(e, dict):
            continue
        a, b, kind = e.get("from"), e.get("to"), e.get("kind")
        if a not in nids or b not in nids or a == b or kind not in EDGE_KINDS or (a, b) in seen:
            problems.append(f"edge dropped: {a!r}->{b!r} {kind!r}")
            continue
        if len(edges) >= COUNTS["edges"]:
            problems.append("edge dropped: more than 16")
            continue
        label = clip(e.get("label"), LIMITS["edge"])
        if label is not None and label != e.get("label"):
            problems.append(f"edge {a}->{b}: label clipped")
        edges.append({"from": a, "to": b, "kind": kind, "label": label})
        seen.add((a, b))

    # questions: spoiler-safe, never before the node they are about
    node_at = {n["id"]: n for n in nodes}
    questions = []
    for q in explore.get("questions") or []:
        if not isinstance(q, dict):
            continue
        node = node_at.get(q.get("nodeId"))
        text_q = clip(q.get("question"), LIMITS["question"])
        t = _num(q.get("t"))
        if not node or not text_q or t is None or not 0 <= t <= duration:
            problems.append(f"question dropped: {str(q.get('question'))[:40]!r}")
            continue
        if len(questions) >= COUNTS["questions"]:
            problems.append("question dropped: more than 4")
            continue
        if text_q != q.get("question"):
            problems.append("question clipped")
        if t < node["t"]:
            problems.append(f"question {text_q[:30]!r}: t {t} moved to its node's t {node['t']}")
            t = float(node["t"])
        questions.append({"nodeId": node["id"], "t": _r(t), "question": text_q})

    # eligibility (code decides)
    if len(nodes) < COUNTS["nodes"][0]:
        return _ineligible(f"Only {len(nodes)} valid nodes"), problems + [f"ineligible: {len(nodes)} nodes"]
    if layout in ("flow", "cluster") and len(edges) < MIN_EDGES:
        return _ineligible(f"Only {len(edges)} valid connections"), problems + [f"ineligible: {len(edges)} edges"]
    if layout == "timeline":
        timed = sum(1 for n in nodes if n["when"])
        distinct_t = len({n["t"] for n in nodes})
        if max(timed, distinct_t) < MIN_TIMED:
            return _ineligible("Too few timed events for a timeline"), problems + ["ineligible: timeline"]

    return {"eligible": True, "reason": reason, "category": category, "layout": layout, "title": title,
            "summary": summary, "groups": groups, "nodes": nodes, "edges": edges, "sims": sims,
            "questions": questions}, problems


def keep_answered(explore: dict | None, answers: list[dict]) -> dict | None:
    """A map question is offered only with its precomputed answer: drop questions whose answer
    failed (an answer is matched by question text and node)."""
    if not isinstance(explore, dict) or not explore.get("eligible"):
        return explore
    done = {(a.get("question"), a.get("mapNode")) for a in answers or [] if isinstance(a, dict)}
    qs = [q for q in explore.get("questions") or [] if (q.get("question"), q.get("nodeId")) in done]
    return {**explore, "questions": qs}
