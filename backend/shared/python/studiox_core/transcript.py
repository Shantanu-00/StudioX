"""Normalised transcript (contract section 2): load, window, before(t), speech stats."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def load(src: str | Path | dict) -> dict:
    """Load and sanity-check a transcript from a path, JSON string or dict."""
    if isinstance(src, dict):
        tr = src
    elif isinstance(src, Path) or (isinstance(src, str) and not src.lstrip().startswith("{")):
        tr = json.loads(Path(src).read_text(encoding="utf-8"))
    else:
        tr = json.loads(src)
    sents = tr.get("sentences")
    if not isinstance(sents, list) or not sents:
        raise ValueError("transcript has no sentences")
    clean = []
    for s in sents:
        t0, t1, text = float(s["t0"]), float(s["t1"]), str(s.get("text", "")).strip()
        if t1 < t0 or not text:
            continue
        clean.append({**s, "t0": t0, "t1": t1, "text": text, "speaker": s.get("speaker", "spk_0")})
    clean.sort(key=lambda s: s["t0"])
    for i, s in enumerate(clean):
        s["i"] = i  # stable sentence index, used for `cites`
    out = {**tr, "sentences": clean, "speakers": tr.get("speakers") or {}}
    out["durationSec"] = float(tr.get("durationSec") or clean[-1]["t1"])
    return out


def speaker_name(tr: dict, spk: str) -> str:
    return (tr.get("speakers") or {}).get(spk, spk)


def window(tr: dict, t0: float, t1: float) -> list[dict]:
    """Sentences overlapping [t0, t1]."""
    return [s for s in tr["sentences"] if s["t1"] > t0 and s["t0"] < t1]


def before(tr: dict, t: float) -> list[dict]:
    """Everything said up to time t, and nothing after it (the spoiler rule).

    A sentence that straddles t is cut: by word timings when present, otherwise in
    proportion to elapsed time, rounded down to a whole word. Cut sentences carry
    `partial: True` and t1 = t.
    """
    out = []
    for s in tr["sentences"]:
        if s["t1"] <= t:
            out.append(s)
        elif s["t0"] < t:
            words = s.get("words")
            if isinstance(words, list) and words and all("t1" in w for w in words):
                text = " ".join(str(w.get("text", "")) for w in words if float(w["t1"]) <= t).strip()
            else:
                toks = s["text"].split()
                keep = int(len(toks) * (t - s["t0"]) / max(s["t1"] - s["t0"], 1e-6))
                text = " ".join(toks[:keep])
            if text:
                cut = {k: v for k, v in s.items() if k != "words"}
                out.append({**cut, "t1": t, "text": text, "partial": True})
    return out


def format_lines(tr: dict, sentences: list[dict], numbered: bool = False) -> str:
    """Prompt text: `[12.3-15.0] Name: text`, optionally prefixed with the sentence index."""
    lines = []
    for n, s in enumerate(sentences):
        i = s.get("i", n)
        pre = f"#{i} " if numbered else ""
        lines.append(f"{pre}[{s['t0']:.1f}-{s['t1']:.1f}] {speaker_name(tr, s['speaker'])}: {s['text']}")
    return "\n".join(lines)


def speech_stats(tr: dict) -> dict[str, Any]:
    """Words, speech seconds, ratio and words per minute; `fit` is the section 7 eligibility gate."""
    sents = tr["sentences"]
    words = sum(len(s["text"].split()) for s in sents)
    # union of sentence intervals, so overlaps are not double counted
    speech, end = 0.0, -1.0
    for s in sorted(sents, key=lambda s: s["t0"]):
        a, b = max(s["t0"], end), s["t1"]
        if b > a:
            speech += b - a
        end = max(end, b)
    dur = float(tr.get("durationSec") or (sents[-1]["t1"] if sents else 0)) or 1e-6
    ratio = min(speech / dur, 1.0)
    wpm = words / (dur / 60)
    return {
        "words": words,
        "speechSeconds": round(speech, 2),
        "durationSec": round(dur, 2),
        "speechRatio": round(ratio, 3),
        "wpm": round(wpm, 1),
        "fit": ratio >= 0.30 and wpm >= 40,
    }


def clip(s: str, n: int) -> str:
    """Shorten to at most n characters at a word boundary, with an ellipsis."""
    s = " ".join(str(s).split())
    if len(s) <= n:
        return s
    cut = s[: n - 1].rsplit(" ", 1)[0] if " " in s[: n - 1] else s[: n - 1]
    return cut.rstrip(" ,;:.") + "\u2026"


def to_tv_lines(tr: dict) -> list[dict]:
    """The `transcript` array of EpisodeAnalysis: {t0, t1, speaker (display name), text}.

    The TV caps speaker at 60 and text at 400 characters."""
    return [
        {"t0": s["t0"], "t1": s["t1"], "speaker": clip(speaker_name(tr, s["speaker"]), 60),
         "text": clip(s["text"], 400)}
        for s in tr["sentences"]
    ]
