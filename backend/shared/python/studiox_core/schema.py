"""Python mirror of `src/analysis/schema.ts` (validateWidget, validateSources, validateAnswer,
validateRefine, validatePackage): same limits, same rules.

Like the TS, validate_widget returns the widget (or a cleaned copy) or None:
  claim:   an unknown `verdict` is dropped; `sources` are filtered to <=4 well-formed https ones.
  dossier: an invalid `image` is dropped; the card itself still passes.
Strings are measured in UTF-16 code units, as JavaScript `.length` does.
"""

from __future__ import annotations

import math
import re
from datetime import datetime
from typing import Any

LIMITS = {"text": 160, "items": 12, "nodes": 12, "edges": 20, "events": 20, "phases": 12}
VERDICTS = ("SUPPORTED", "NUANCED", "DISPUTED", "DEBUNKED", "UNVERIFIED")
WIDGET_TYPES = ("dossier", "timeline", "relation_graph", "entity_list", "protocol", "technique", "claim")
GENRES = ("crime", "health", "science", "general")
PKG_MAX = {"transcript": 2000, "segments": 60, "moments": 300, "widgets": 80, "answers": 40}
_HTTPS = re.compile(r"^https://[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?$", re.IGNORECASE)


def js_len(s: str) -> int:
    return len(s.encode("utf-16-le")) // 2


def is_str(v: Any, max_len: int = LIMITS["text"]) -> bool:
    return isinstance(v, str) and 0 < js_len(v) <= max_len


def is_num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and v >= 0


def is_evidence(v: Any) -> bool:
    return isinstance(v, dict) and is_num(v.get("t0")) and is_num(v.get("t1")) and v["t1"] >= v["t0"]


def is_https(v: Any) -> bool:
    return is_str(v, 500) and _HTTPS.match(v) is not None


def _list(v: Any, max_len: int, each) -> list | None:
    if isinstance(v, list) and 0 < len(v) <= max_len and all(isinstance(x, dict) and each(x) for x in v):
        return v
    return None


def validate_sources(raw: Any, max_n: int = 4) -> list[dict]:
    """Keeps up to `max_n` well-formed https sources (from the first 16); drops the rest."""
    if not isinstance(raw, list):
        return []
    out: list[dict] = []
    for s in raw[:16]:
        if len(out) >= max_n:
            break
        if not isinstance(s, dict) or not is_str(s.get("title"), 140) or not is_https(s.get("url")):
            continue
        src = {"title": s["title"], "url": s["url"]}
        if is_str(s.get("quote"), 240):
            src["quote"] = s["quote"]
        if is_str(s.get("date"), 32):
            src["date"] = s["date"]
        out.append(src)
    return out


def validate_widget(raw: Any) -> dict | None:
    """Return the widget (possibly cleaned) if well-formed and within limits, otherwise None."""
    w = raw
    if not isinstance(w, dict) or not is_str(w.get("id"), 64) or _list(w.get("evidence"), 8, is_evidence) is None:
        return None
    t = w.get("type")
    if t == "dossier":
        if not (is_str(w.get("name"), 60) and is_str(w.get("role"), 80)
                and _list(w.get("facts"), 6, lambda f: is_str(f.get("text"))) is not None):
            return None
        rest = {k: v for k, v in w.items() if k != "image"}
        img = w.get("image")
        if isinstance(img, dict) and is_https(img.get("url")) and is_str(img.get("credit"), 80):
            rest["image"] = {"url": img["url"], "credit": img["credit"]}
        return rest
    if t == "timeline":
        ok = is_str(w.get("title"), 60) and _list(
            w.get("events"),
            LIMITS["events"],
            lambda e: is_str(e.get("id"), 32)
            and is_str(e.get("when"), 24)
            and is_str(e.get("label"))
            and is_evidence(e.get("evidence")),
        ) is not None
    elif t == "relation_graph":
        nodes = _list(
            w.get("nodes"),
            LIMITS["nodes"],
            lambda n: is_str(n.get("id"), 32)
            and is_str(n.get("label"), 32)
            and is_num(n.get("x"))
            and n["x"] <= 1
            and is_num(n.get("y"))
            and n["y"] <= 1,
        )
        if not is_str(w.get("title"), 60) or nodes is None:
            return None
        ids = {n["id"] for n in nodes}
        ok = _list(
            w.get("edges"),
            LIMITS["edges"],
            lambda e: e.get("from") in ids and e.get("to") in ids and is_str(e.get("label"), 32),
        ) is not None
    elif t == "entity_list":
        ok = is_str(w.get("title"), 60) and _list(
            w.get("items"),
            LIMITS["items"],
            lambda i: is_str(i.get("name"), 60) and is_str(i.get("asSaid")) and is_evidence(i.get("evidence")),
        ) is not None
    elif t == "protocol":
        ok = is_str(w.get("title"), 60) and _list(
            w.get("steps"),
            8,
            lambda s: is_str(s.get("label"), 40) and is_str(s.get("detail")) and is_evidence(s.get("evidence")),
        ) is not None
    elif t == "technique":
        ok = (
            is_str(w.get("title"), 60)
            and w.get("shape") in ("box", "bars")
            and is_str(w.get("caption"))
            and _list(
                w.get("phases"),
                LIMITS["phases"],
                lambda p: is_str(p.get("label"), 24) and is_num(p.get("seconds")) and p["seconds"] > 0,
            )
            is not None
        )
    elif t == "claim":
        if not (is_str(w.get("claim")) and is_str(w.get("speaker"), 60) and is_str(w.get("context"), 280)):
            return None
        clean = {k: v for k, v in w.items() if k not in ("verdict", "sources")}
        if w.get("verdict") in VERDICTS:
            clean["verdict"] = w["verdict"]
        srcs = validate_sources(w.get("sources"))
        if srcs:
            clean["sources"] = srcs
        return clean
    else:
        return None
    return w if ok else None


def why_invalid(raw: Any) -> str:
    """A short human reason for a widget that fails validate_widget (best effort)."""
    if not isinstance(raw, dict):
        return "not an object"
    if not is_str(raw.get("id"), 64):
        return "bad id"
    if _list(raw.get("evidence"), 8, is_evidence) is None:
        return "bad or missing evidence"
    if raw.get("type") not in WIDGET_TYPES:
        return f"unknown type {raw.get('type')!r}"
    return f"{raw.get('type')} fields fail schema limits"


def _valid_cites(raw: Any) -> list[int]:
    if not isinstance(raw, list):
        return []
    return list(dict.fromkeys(math.floor(n) for n in raw if is_num(n)))[:6]


def validate_answer_body(raw: Any) -> dict | None:
    """{text, cites (seconds), sources}: text <= 900; cites deduped, floored, <= 6."""
    if not isinstance(raw, dict) or not is_str(raw.get("text"), 900):
        return None
    return {"text": raw["text"], "cites": _valid_cites(raw.get("cites")), "sources": validate_sources(raw.get("sources"))}


def validate_answer(raw: Any) -> dict | None:
    body = validate_answer_body(raw)
    if body is None or not is_str(raw.get("question"), 140) or not is_num(raw.get("t")):
        return None
    return {"question": raw["question"], "t": raw["t"], **body}


def validate_refine(raw: Any) -> dict | None:
    """The live refine reply: a caption (<= 200) and/or at most one widget."""
    if not isinstance(raw, dict):
        return None
    caption = raw["caption"] if is_str(raw.get("caption"), 200) else None
    widget = validate_widget(raw["widget"]) if raw.get("widget") else None
    if not caption and not widget:
        return None
    out: dict = {}
    if caption:
        out["caption"] = caption
    if widget:
        out["widget"] = widget
    return out


def is_segment(s: Any) -> bool:
    return (isinstance(s, dict) and is_str(s.get("id"), 32) and is_num(s.get("start")) and is_num(s.get("end"))
            and s["end"] >= s["start"] and is_str(s.get("title"), 80) and s.get("genre") in GENRES)


def is_moment(m: Any) -> bool:
    return isinstance(m, dict) and is_num(m.get("t")) and is_str(m.get("caption"), 200)


def is_line(x: Any) -> bool:
    return (isinstance(x, dict) and is_num(x.get("t0")) and is_num(x.get("t1")) and x["t1"] >= x["t0"]
            and is_str(x.get("speaker"), 60) and is_str(x.get("text"), 400))


def _is_date(v: Any) -> bool:
    if not is_str(v, 40):
        return False
    try:
        datetime.fromisoformat(v.replace("Z", "+00:00"))
        return True
    except ValueError:
        return False


def validate_package(pkg: Any, media_id: str | None = None) -> list[str]:
    """Problems with an episode package; [] when valid.

    Stricter than the TV's validatePackage (which silently drops bad items): every item that
    the TV would drop is reported, so the publisher can refuse the package instead.
    """
    if not isinstance(pkg, dict):
        return ["package is not an object"]
    p: list[str] = []
    if media_id is not None and pkg.get("mediaId") != media_id:
        p.append("mediaId mismatch")
    if pkg.get("provenance") != "pipeline":
        p.append("provenance != pipeline")
    for k in ("transcript", "segments", "moments", "widgets"):
        v = pkg.get(k)
        if not isinstance(v, list):
            p.append(f"missing {k}")
        elif len(v) > PKG_MAX[k]:
            p.append(f"too many {k}: {len(v)} > {PKG_MAX[k]}")
    if "answers" in pkg and len(pkg.get("answers") or []) > PKG_MAX["answers"]:
        p.append("too many answers")
    if "generatedAt" in pkg and not _is_date(pkg["generatedAt"]):
        p.append("bad generatedAt")
    widgets = pkg.get("widgets") if isinstance(pkg.get("widgets"), list) else []
    if not widgets:
        p.append("no widgets (the TV rejects a package without one)")
    seen: set[str] = set()
    for w in widgets:
        if validate_widget(w) is None:
            p.append(f"widget {w.get('id') if isinstance(w, dict) else w!r}: {why_invalid(w)}")
        elif w["id"] in seen:
            p.append(f"duplicate widget id {w['id']}")
        else:
            seen.add(w["id"])
    for name, check in (("transcript", is_line), ("segments", is_segment), ("moments", is_moment)):
        for x in pkg.get(name) or []:
            if not check(x):
                p.append(f"bad {name} item {x!r}"[:140])
    for a in pkg.get("answers") or []:
        if validate_answer(a) is None:
            p.append(f"bad answer {a!r}"[:140])
    if pkg.get("explore") is not None:
        from .map import validate_map  # the Map (section 9): a stored map must already be clean

        lines = pkg.get("transcript") if isinstance(pkg.get("transcript"), list) else []
        segs = pkg.get("segments") if isinstance(pkg.get("segments"), list) else []
        dur = max([x.get("t1", 0) for x in lines if is_line(x)] + [s.get("end", 0) for s in segs if is_segment(s)],
                  default=0)
        clean, probs = validate_map(pkg["explore"], dur, widgets)
        if clean is None or clean != pkg["explore"]:
            p += [f"explore: {x}"[:160] for x in (probs or ["not clean"])]
    return p
