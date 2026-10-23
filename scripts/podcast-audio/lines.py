#!/usr/bin/env python3
"""Write the per-episode voice lines manifest for the demo episodes.

Reads src/analysis/packages/<id>.json (transcript: [{t0, t1, speaker, text}]) and writes
  media/audio/<id>/lines.json  machine manifest used by polly.sh and assemble.py
  media/audio/<id>/lines.md    table to paste line by line into ElevenLabs (or any TTS)

Transcript rows that end without sentence punctuation are joined with the next row of the same
speaker ("In his recorded interview," + "suspect Marcus Vance ..."), so the TTS reads one sentence
with natural intonation. The join keeps a short SSML <break> where the captions split.

Usage:
  python3 scripts/podcast-audio/lines.py                    # both demo episodes
  python3 scripts/podcast-audio/lines.py science-ep42 --voice "Elena=Danielle" --engine neural
  python3 scripts/podcast-audio/lines.py crime-case104 --no-merge
"""
import argparse
import json
import re
import subprocess
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[2]
EPISODES = ("crime-case104", "science-ep42")

# Amazon Polly voices (all three exist in both the generative and the neural engine, en-US/en-GB;
# checked against docs.aws.amazon.com/polly/latest/dg/available-voices.html on 2026-10-23).
# ElevenLabs names are premade-library suggestions; audition before use, the library changes.
VOICES = {
    "Narrator": {
        "polly": {"voiceId": "Stephen", "languageCode": "en-US"},
        "elevenlabs": "Brian (deep, resonant US narration) or Bill (older documentary voice)",
        "why": "True-crime voiceover: a low, measured US male read. Stephen is a generative en-US "
               "male voice distinct from the science episode's guest; US accent fits the US setting "
               "(Westside Diner, Pier 9).",
    },
    "Dr. Julian": {
        "polly": {"voiceId": "Brian", "languageCode": "en-GB"},
        "elevenlabs": "Daniel (steady British broadcaster) or George (warm British storyteller)",
        "why": "The expert guest: a calm, authoritative British male. A different accent from the US "
               "host makes the two speakers easy to tell apart with eyes on the widgets.",
    },
    "Elena": {
        "polly": {"voiceId": "Ruth", "languageCode": "en-US"},
        "elevenlabs": "Sarah (confident, warm US female) or Matilda (professional US female)",
        "why": "The host: short, conversational interjections. Ruth is Polly's conversational en-US "
               "female voice (generative, neural and long-form).",
    },
}
FALLBACK_VOICE = {"polly": {"voiceId": "Matthew", "languageCode": "en-US"},
                  "elevenlabs": "any distinct premade voice", "why": "Speaker not in the voice table."}

ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen " \
       "sixteen seventeen eighteen nineteen".split()
TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()


def words(n):
    if n < 20:
        return ONES[n]
    if n < 100:
        return TENS[n // 10] + ("" if n % 10 == 0 else "-" + ONES[n % 10])
    return ONES[n // 100] + " hundred" + ("" if n % 100 == 0 else " " + words(n % 100))


def clock(h, m, ampm):
    """'9:30' -> 'nine thirty', '11:00 PM' -> 'eleven P M', '10:05' -> 'ten oh five'."""
    s = words(h)
    if m:
        s += " " + ("oh " + ONES[m] if m < 10 else words(m))
    if ampm:
        s += " " + " ".join(ampm.upper())
    return s


# Tokens the TTS should read in a fixed way: (regex, function(match) -> spoken text).
RULES = [
    (re.compile(r"\b(\d{1,2}):(\d{2})(?:\s*([AaPp][Mm])\b)?"),
     lambda m: clock(int(m[1]), int(m[2]), m[3])),
    (re.compile(r"\bR90\b"), lambda m: "R ninety"),
    (re.compile(r"\bL-Threonate\b"), lambda m: "L threonate"),
]


def spoken_and_ssml(text):
    """Plain spoken text (for ElevenLabs) and the SSML body (escaped, with <sub> for the rewrites)."""
    spans = []
    for rx, fn in RULES:
        for m in rx.finditer(text):
            if not any(a < m.end() and m.start() < b for a, b, _ in spans):
                spans.append((m.start(), m.end(), fn(m)))
    spans.sort()
    plain, ssml, pos = [], [], 0
    for a, b, alias in spans:
        plain += [text[pos:a], alias]
        ssml += [escape(text[pos:a]), f'<sub alias="{escape(alias)}">{escape(text[a:b])}</sub>']
        pos = b
    plain.append(text[pos:])
    ssml.append(escape(text[pos:]))
    return "".join(plain), "".join(ssml)


def build_ssml(parts, rate):
    """One <s> per line. Joined caption rows get a short break; <prosody rate> (supported by neural and
    generative, generative only around full sentences) wraps the whole sentence when rate != 100."""
    body = "<s>" + ' <break time="200ms"/> '.join(parts) + "</s>"
    if rate and rate != 100:
        body = f'<prosody rate="{rate}%">{body}</prosody>'
    return f"<speak>{body}</speak>"


SYL_PER_SEC = 4.2  # typical conversational English; a rough pre-flight figure, not a Polly measurement


def syllables(text):
    n = 0
    for w in re.findall(r"[a-z]+", text.lower()):
        k = len(re.findall(r"[aeiouy]+", w))
        if w.endswith("e") and not w.endswith(("le", "ee")) and k > 1:
            k -= 1
        n += max(1, k)
    return n


def video_duration(media_id):
    src = ROOT / "media" / "tv" / f"{media_id}.mp4"
    if not src.exists():
        return None
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                          "stream=duration", "-of", "csv=p=0", str(src)], capture_output=True, text=True)
    try:
        return round(float(out.stdout.strip()), 3)
    except ValueError:
        return None


def group_rows(transcript, merge):
    groups = []
    for i, row in enumerate(transcript):
        prev = groups[-1] if groups else None
        if (merge and prev and prev["speaker"] == row["speaker"]
                and not re.search(r"[.!?…][\"')\]]*$", prev["rows"][-1]["text"].strip())
                and abs(prev["rows"][-1]["t1"] - row["t0"]) < 0.05):
            prev["rows"].append(row)
            prev["idx"].append(i)
        else:
            groups.append({"speaker": row["speaker"], "rows": [row], "idx": [i]})
    return groups


def build(media_id, overrides, engine, merge, offset, rates):
    pkg_path = ROOT / "src" / "analysis" / "packages" / f"{media_id}.json"
    pkg = json.loads(pkg_path.read_text())
    transcript = pkg["transcript"]
    voices = {}
    lines = []
    for n, g in enumerate(group_rows(transcript, merge), start=1):
        spk = g["speaker"]
        if spk not in voices:
            v = json.loads(json.dumps(VOICES.get(spk, FALLBACK_VOICE)))
            if spk in overrides:
                v["polly"]["voiceId"] = overrides[spk]
                v["why"] = "Overridden on the command line."
            v["polly"]["engine"] = engine
            voices[spk] = v
        plain, ssml_parts = [], []
        for row in g["rows"]:
            p, s = spoken_and_ssml(row["text"].strip())
            plain.append(p)
            ssml_parts.append(s)
        t0, t1 = g["rows"][0]["t0"], g["rows"][-1]["t1"]
        text = " ".join(r["text"].strip() for r in g["rows"])
        rate = rates.get(n, 100)
        syl = syllables(" ".join(plain))
        lines.append({
            "n": n,
            "id": f"{media_id}-{n:02d}",
            "file": f"lines/{n:02d}.mp3",
            "speaker": spk,
            "voice": voices[spk]["polly"]["voiceId"],
            "t0": t0,
            "t1": t1,
            "window": round(t1 - t0, 3),
            "transcriptRows": g["idx"],
            "text": text,
            "spoken": " ".join(plain),
            "rate": rate,
            "ssml": build_ssml(ssml_parts, rate),
            "chars": len(" ".join(plain)),
            "syllables": syl,
            "estSec": round(syl / SYL_PER_SEC * 100 / rate, 2),
        })
    dur = video_duration(media_id)
    return {
        "mediaId": media_id,
        "source": str(pkg_path.relative_to(ROOT)),
        "videoDurationSec": dur if dur else max(r["t1"] for r in transcript),
        "startOffsetSec": offset,
        "engine": engine,
        "voices": voices,
        "lines": lines,
    }


def write_md(m, path):
    rows = [f"# Voice lines: {m['mediaId']}", "",
            f"Video {m['videoDurationSec']} s. Generated by `scripts/podcast-audio/lines.py` from "
            f"`{m['source']}`. Paste the **Text to speak** column into the TTS one row at a time and save "
            f"each result as the **Save as** file inside `media/audio/{m['mediaId']}/lines/` "
            "(any of .mp3 .wav .m4a .ogg .flac). Then run `scripts/podcast-audio/assemble.py`.", "",
            "## Voices", "", "| Speaker | Amazon Polly | ElevenLabs suggestion | Why |", "| --- | --- | --- | --- |"]
    for spk, v in m["voices"].items():
        rows.append(f"| {spk} | {v['polly']['voiceId']} ({v['polly']['engine']}, {v['polly']['languageCode']}) "
                    f"| {v['elevenlabs']} | {v['why']} |")
    rows += ["", "## Lines", "",
             "| # | Speaker | Start | End | Window s | Est. s | Text to speak | Save as |",
             "| --- | --- | --- | --- | --- | --- | --- | --- |"]
    for ln in m["lines"]:
        rows.append(f"| {ln['n']} | {ln['speaker']} | {ln['t0']:.2f} | {ln['t1']:.2f} | {ln['window']:.2f} "
                    f"| {ln['estSec']:.1f} | {ln['spoken']} | `{ln['n']:02d}.mp3` |")
    rows += ["", f"Est. s is a rough length at {SYL_PER_SEC} syllables per second (not measured). The window is how long the captions show the line. Lines up to 1.25x longer than their "
             "window are sped up by the assembler; a line may also use slack left by the same speaker's "
             "neighbouring line. Speak at a natural podcast pace; do not add long pauses at the start or end "
             "(they are trimmed anyway).", ""]
    path.write_text("\n".join(rows))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("ids", nargs="*", default=list(EPISODES))
    ap.add_argument("--voice", action="append", default=[], metavar="SPEAKER=VOICEID",
                    help="override the Polly voice for a speaker, e.g. 'Narrator=Matthew'")
    ap.add_argument("--engine", default="generative", choices=["generative", "neural", "long-form", "standard"])
    ap.add_argument("--rate", action="append", default=[], metavar="N=PERCENT",
                    help="Polly <prosody rate> for line N (20-200, e.g. 3=115); needs a single episode id")
    ap.add_argument("--no-merge", action="store_true", help="one line per transcript row")
    ap.add_argument("--offset", type=float, default=0.05,
                    help="seconds after t0 where each speaker turn starts (default 0.05)")
    a = ap.parse_args()
    overrides = dict(v.split("=", 1) for v in a.voice)
    rates = {int(k): int(v) for k, v in (r.split("=", 1) for r in a.rate)}
    if rates and len(a.ids) != 1:
        ap.error("--rate needs exactly one episode id")
    for media_id in a.ids:
        m = build(media_id, overrides, a.engine, not a.no_merge, a.offset, rates)
        out = ROOT / "media" / "audio" / media_id
        (out / "lines").mkdir(parents=True, exist_ok=True)
        (out / "lines.json").write_text(json.dumps(m, indent=2, ensure_ascii=False) + "\n")
        write_md(m, out / "lines.md")
        chars = sum(ln["chars"] for ln in m["lines"])
        print(f"{media_id}: {len(m['lines'])} lines, {chars} characters, voices "
              + ", ".join(f"{s}={v['polly']['voiceId']}" for s, v in m["voices"].items())
              + f" -> {(out / 'lines.json').relative_to(ROOT)}, lines.md")
        # pre-flight: same speaker turns share their windows (see assemble.py), others are hard limits
        tight = [f"#{ln['n']} est {ln['estSec']}s / {ln['window']}s" for ln in m["lines"]
                 if ln["estSec"] / 1.25 > ln["window"]]
        if tight:
            print(f"  estimate at {SYL_PER_SEC} syllables/s, over 1.25x their own window: " + "; ".join(tight))


if __name__ == "__main__":
    main()
