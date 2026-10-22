#!/usr/bin/env python3
"""Build transcripts in CONTRACTS section 2 format.

1. Demo clips: from the scripts in media/use.md (media/ is git-ignored, so the lines are
   embedded below, with the table time ranges). Long lines are split into sentences, each
   getting a share of its range proportional to its character count.
2. Local test transcript (third party, never tracked): review/transcript/podcast1.md, text lines
   followed by an m:ss (or h:mm:ss) timestamp line -> review/transcript/podcast1.json.

Usage: python3 backend/scripts/make_transcripts.py [demo|local|all]
"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# (t0, t1, speaker key, text). Source: media/use.md "Edit & Dialogue Timeline" tables.
DEMOS = {
    "science-ep42": {
        "duration": 37.28,
        "speakers": {"spk_0": "Dr. Julian", "spk_1": "Elena"},
        "rows": [
            (0, 3, "spk_0", "Look at how Cristiano Ronaldo optimizes his recovery."),
            (3, 5, "spk_1", "Right, the R90 polyphasic cycles?"),
            (5, 11, "spk_0", "Exactly. Five ninety-minute cycles. Harvard clinical data shows midday sleep cuts cardiovascular strain by 37 percent."),
            (11, 13, "spk_1", "And what was the compound stack?"),
            (13, 33, "spk_0", "Clinical protocols pair 145 milligrams of Magnesium L-Threonate with 50 milligrams of Apigenin. Threonate crosses the blood-brain barrier to deepen slow-wave sleep, while Apigenin quiets neuro-chatter. Kept at 18 degrees Celsius, delta waves surge."),
            (33, 34, "spk_1", "It completely stabilizes it."),
            (34, 37, "spk_0", "Within seven days, your sleep architecture completely transforms."),
        ],
    },
    "crime-case104": {
        "duration": 37.28,
        "speakers": {"spk_0": "Narrator"},
        "rows": [
            (0, 8, "spk_0", "In his recorded interview, suspect Marcus Vance swore under oath he never left the Westside Diner between 9:30 and 11:00 PM."),
            (8, 20, "spk_0", "But cellular dump records from Tower 4 reveal his phone pinged right here at Pier 9 at 10:14 PM, six minutes before his cracked burner phone hit the pavement."),
            (20, 30, "spk_0", "Which places Vance directly on the pier moments before the harbor security cameras were deliberately severed."),
            (30, 37, "spk_0", "And what detectives uncovered inside his waterfront locker at midnight changes the motive entirely."),
        ],
    },
}


def split_sentences(text):
    # Split after . ? ! followed by space, and after ", six" style clause only when very long.
    parts = [p.strip() for p in re.split(r"(?<=[.?!])\s+", text) if p.strip()]
    out = []
    for p in parts:
        if len(p) > 120 and "," in p:  # long: break at the comma nearest the middle
            idx = [m.start() for m in re.finditer(",", p)]
            mid = min(idx, key=lambda i: abs(i - len(p) / 2))
            out += [p[: mid + 1].strip(), p[mid + 1 :].strip()]
        else:
            out.append(p)
    return out


def demo(media_id, spec):
    sentences = []
    for t0, t1, spk, text in spec["rows"]:
        parts = split_sentences(text)
        total = sum(len(p) for p in parts)
        cur = float(t0)
        for p in parts:
            end = cur + (t1 - t0) * len(p) / total
            sentences.append({"t0": round(cur, 2), "t1": round(end, 2), "speaker": spk, "text": p})
            cur = end
        sentences[-1]["t1"] = float(t1)
    return finish(media_id, spec["duration"], "supplied", spec["speakers"], sentences)


def finish(media_id, duration, source, speakers, sentences):
    words = sum(len(s["text"].split()) for s in sentences)
    secs = round(sum(s["t1"] - s["t0"] for s in sentences), 2)
    return {
        "mediaId": media_id, "durationSec": duration, "source": source,
        "speakers": speakers, "sentences": sentences,
        "speech": {"words": words, "speechSeconds": secs},
    }


TS = re.compile(r"^(?:(\d+):)?(\d{1,2}):(\d{2})$")


def parse_local(path):
    """Lines of text, each block followed by a timestamp line giving when the NEXT block starts."""
    lines = [l.strip() for l in Path(path).read_text(encoding="utf-8").splitlines() if l.strip()]
    blocks, text, start = [], [], 0.0
    for l in lines:
        m = TS.match(l)
        if m:
            h, mi, s = int(m.group(1) or 0), int(m.group(2)), int(m.group(3))
            t = h * 3600 + mi * 60 + s
            if text:
                blocks.append((start, t, " ".join(text)))
            text, start = [], float(t)
        else:
            text.append(l)
    if text:
        blocks.append((start, start + 6.0, " ".join(text)))
    sentences = []
    for t0, t1, txt in blocks:
        txt = re.sub(r"^-\s+", "", txt)
        txt = re.sub(r"\((?:[a-z ]*music|[a-z ]+)\)", "", txt, flags=re.I).strip()  # (energetic music)
        parts = split_sentences(txt)
        if not parts:
            continue
        total = sum(len(p) for p in parts)
        cur = t0
        for p in parts:
            end = cur + (t1 - t0) * len(p) / total
            sentences.append({"t0": round(cur, 2), "t1": round(end, 2), "speaker": "spk_0", "text": p})
            cur = end
    dur = sentences[-1]["t1"] if sentences else 0
    return finish("podcast1", dur, "supplied", {"spk_0": "Host"}, sentences)


def main(which):
    if which in ("demo", "all"):
        out = ROOT / "backend/data/transcripts"
        out.mkdir(parents=True, exist_ok=True)
        for mid, spec in DEMOS.items():
            d = demo(mid, spec)
            (out / f"{mid}.json").write_text(json.dumps(d, indent=2) + "\n")
            print(mid, len(d["sentences"]), "sentences", d["speech"])
    if which in ("local", "all"):
        src = ROOT / "review/transcript/podcast1.md"
        if src.exists():
            d = parse_local(src)
            (ROOT / "review/transcript/podcast1.json").write_text(json.dumps(d, indent=1) + "\n")
            print("podcast1", len(d["sentences"]), "sentences", d["speech"], "dur", d["durationSec"])
        else:
            print("no local transcript; skipped")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "all")
