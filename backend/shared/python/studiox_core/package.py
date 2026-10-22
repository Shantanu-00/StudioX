"""Assemble an episode package (contract section 3) from verified lens candidates."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .map import keep_answered, validate_map
from .schema import validate_widget, why_invalid
from .transcript import to_tv_lines
from .verdict import RULES_VERSION


def _label(w: Any) -> str:
    if not isinstance(w, dict):
        return str(w)[:160]
    for k in ("claim", "name", "title"):
        if isinstance(w.get(k), str) and w[k]:
            return w[k][:160]
    return str(w.get("id", "?"))[:160]


LENS_OF_TYPE = {"claim": "claims", "dossier": "people", "entity_list": "burst", "protocol": "protocol",
                "timeline": "events"}


def _as_candidate(c: Any) -> dict:
    # Accept {lens, widget, salience, reason} candidates or bare widgets.
    if isinstance(c, dict) and isinstance(c.get("widget"), dict):
        return c
    t = c.get("type") if isinstance(c, dict) else None
    return {"lens": LENS_OF_TYPE.get(t, t or "unknown"), "widget": c}


HEADLINE_MAX, TEASER_MAX = 70, 48


def _short(text, limit):
    """Trim to `limit` characters at a word boundary; None if empty."""
    if not isinstance(text, str) or not text.strip():
        return None
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    cut = text[: limit - 1].rsplit(" ", 1)[0].rstrip(",;:-")
    return cut + "…"


def apply_label(widget: dict, label: dict | None) -> dict:
    """The curator's TV-sized words: a headline for every card, a curiosity teaser only for claims
    that are worth questioning (not SUPPORTED)."""
    if not label:
        return widget
    w = dict(widget)
    head = _short(label.get("headline"), HEADLINE_MAX)
    if head:
        w["headline"] = head
    teaser = _short(label.get("teaser"), TEASER_MAX)
    if teaser and w.get("type") == "claim" and w.get("verdict") != "SUPPORTED":
        w["teaser"] = teaser
    return w


def shown_widgets(candidates: list, shown_ids: list[str] | None, labels: dict[str, dict] | None = None) -> list[dict]:
    """The widgets a package will show, in order: valid, labelled, first of each id (as assemble_package)."""
    kept: dict[str, dict] = {}
    for c in map(_as_candidate, candidates or []):
        clean = validate_widget(c["widget"])
        if clean is not None and clean["id"] not in kept:
            kept[clean["id"]] = apply_label(clean, (labels or {}).get(clean["id"]))
    order = list(kept) if shown_ids is None else [i for i in dict.fromkeys(shown_ids) if i in kept]
    return [kept[i] for i in order]


def assemble_package(
    media_id: str,
    segments: list[dict],
    moments: list[dict],
    widgets: list[dict],
    rejected: list[dict],
    answers: list[dict],
    models: dict[str, str],
    version: int,
    *,
    transcript: dict | None = None,
    shown_ids: list[str] | None = None,
    generated_at: str | None = None,
    labels: dict[str, dict] | None = None,
    explore: dict | None = None,
) -> dict:
    """Build the package. Invalid widgets move to `rejected` with a reason.

    `widgets` are the candidates that survived the lenses and verification.
    `rejected` are candidates already dropped upstream, as {lens, text, reason}.
    `shown_ids` (from curate) picks and orders the widgets shown; None shows every valid one.
    `labels` (from curate): {widgetId: {headline, teaser?}}, the short text a TV shows; bounded here.
    `explore` (from the Map author): validated here against the shown widgets (CONTRACTS section 9);
    the package carries the clean map, or {eligible: false, reason}. Map questions whose answer is
    missing from `answers` (an answer call failed) are dropped.
    funnel: candidates = widgets + upstream rejects; kept = valid; shown = in the package.
    """
    rejected = [dict(r) for r in (rejected or [])]
    by_lens: dict[str, dict[str, int]] = {}

    def bump(lens: str, key: str) -> None:
        by_lens.setdefault(lens, {"candidates": 0, "kept": 0})[key] += 1

    for r in rejected:
        bump(r.get("lens", "unknown"), "candidates")

    kept: dict[str, dict] = {}
    kept_lens: dict[str, str] = {}
    for c in map(_as_candidate, widgets or []):
        lens, w = c.get("lens", "unknown"), c["widget"]
        bump(lens, "candidates")
        clean = validate_widget(w)
        if clean is None:
            rejected.append({"lens": lens, "text": _label(w), "reason": f"failed validateWidget: {why_invalid(w)}"})
            continue
        w = apply_label(clean, (labels or {}).get(clean["id"]))
        if w["id"] in kept:
            rejected.append({"lens": lens, "text": _label(w), "reason": "duplicate widget id"})
            continue
        kept[w["id"]] = w
        kept_lens[w["id"]] = lens
        bump(lens, "kept")

    if shown_ids is None:
        order = list(kept)
    else:
        order = [i for i in dict.fromkeys(shown_ids) if i in kept]
        for i in kept:
            if i not in order:
                rejected.append({"lens": kept_lens[i], "text": _label(kept[i]), "reason": "not selected by curator"})
    shown = [kept[i] for i in order]

    pkg = {
        "mediaId": media_id,
        "provenance": "pipeline",
        "version": int(version),
        "generatedAt": generated_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "models": dict(models or {}),
        "verdictRules": RULES_VERSION,
        "transcript": to_tv_lines(transcript) if transcript else [],
        "segments": list(segments or []),
        "moments": sorted(moments or [], key=lambda m: m.get("t", 0)),
        "widgets": shown,
        "funnel": {
            "candidates": sum(v["candidates"] for v in by_lens.values()),
            "kept": len(kept),
            "shown": len(shown),
            "byLens": by_lens,
        },
        "rejected": rejected,
        "answers": list(answers or []),
    }
    if explore is not None:
        dur = float((transcript or {}).get("durationSec") or 0) or max(
            [float(s.get("end", 0)) for s in segments or []] + [0.0])
        clean, _ = validate_map(explore, dur, shown)
        if clean is not None:
            pkg["explore"] = keep_answered(clean, pkg["answers"])
    return pkg
