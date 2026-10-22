"""Step Functions task: produce transcripts/<mediaId>.json (CONTRACTS section 2) and speech stats.

Input: {mediaId, execution, input} where input is the execution input. A supplied transcript
(input.transcriptKey, already in contract form) wins; otherwise the raw Amazon Transcribe output at
runs/<mediaId>/<execution>/transcribe.json is converted. Output: {transcriptKey, durationSec, words,
speechSeconds, speechRatio, speechPct, wpm, options}. `options` carries the execution input's package
options, bounded, always present so later states can reference them: {pinnedQuestions: [{t, question}],
example: bool, title: str | null}.
"""
import common
import core

MAX_GAP = 1.2        # seconds of silence that closes a sentence
MAX_SENTENCE = 40    # words
MAX_PINNED = 2       # pinned Map questions per execution
END_MARKS = (".", "?", "!")


def _f(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def from_transcribe(raw, media_id):
    """Amazon Transcribe JSON -> contract transcript. Sentences break on end punctuation,
    speaker change, a long gap or a maximum length."""
    results = raw.get("results", {})
    speaker_at = {}
    for seg in (results.get("speaker_labels") or {}).get("segments", []):
        for it in seg.get("items", []):
            speaker_at[(it.get("start_time"), it.get("end_time"))] = it.get("speaker_label")
    sentences, cur = [], None

    def close():
        nonlocal cur
        if cur and cur["words"]:
            sentences.append({"t0": round(cur["t0"], 2), "t1": round(cur["t1"], 2), "speaker": cur["speaker"],
                              "text": " ".join(cur["words"])})
        cur = None

    speakers_seen = []
    for it in results.get("items", []):
        content = (it.get("alternatives") or [{}])[0].get("content", "")
        if it.get("type") == "punctuation":
            if cur and cur["words"]:
                cur["words"][-1] += content
                if content in END_MARKS:
                    close()
            continue
        t0, t1 = _f(it.get("start_time")), _f(it.get("end_time"))
        speaker = speaker_at.get((it.get("start_time"), it.get("end_time")), it.get("speaker_label")) or "spk_0"
        if speaker not in speakers_seen:
            speakers_seen.append(speaker)
        if cur and (speaker != cur["speaker"] or t0 - cur["t1"] > MAX_GAP or len(cur["words"]) >= MAX_SENTENCE):
            close()
        if cur is None:
            cur = {"t0": t0, "t1": t1, "speaker": speaker, "words": []}
        cur["words"].append(content)
        cur["t1"] = t1
    close()
    names = {sp: f"Speaker {i + 1}" for i, sp in enumerate(speakers_seen)} or {"spk_0": "Speaker 1"}
    transcript = {"mediaId": media_id, "source": "transcribe", "speakers": names, "sentences": sentences}
    transcript["durationSec"] = round(max((s["t1"] for s in sentences), default=0.0), 2)
    transcript["speech"] = speech_stats(sentences)
    return transcript


def speech_stats(sentences):
    words = sum(len(str(s.get("text", "")).split()) for s in sentences)
    seconds = sum(max(0.0, _f(s.get("t1")) - _f(s.get("t0"))) for s in sentences)
    return {"words": words, "speechSeconds": round(seconds, 2)}


def complete(transcript, media_id):
    """Fill in anything a supplied transcript lacks; returns (transcript, changed)."""
    changed = False
    sentences = transcript.get("sentences")
    if not isinstance(sentences, list) or not sentences:
        raise ValueError("transcript has no sentences")
    if transcript.get("mediaId") != media_id:
        transcript["mediaId"], changed = media_id, True
    if not isinstance(transcript.get("speech"), dict) or "words" not in transcript["speech"]:
        transcript["speech"], changed = speech_stats(sentences), True
    if not transcript.get("durationSec"):
        transcript["durationSec"], changed = round(max(_f(s.get("t1")) for s in sentences), 2), True
    if "source" not in transcript:
        transcript["source"], changed = "supplied", True
    return transcript, changed


def eligibility(transcript):
    """Stats for the eligibility gate (CONTRACTS section 7), computed by studiox_core so the agents and
    the pipeline agree: speech share of the duration and words per minute."""
    st = core.speech_stats(transcript)
    return {"durationSec": st["durationSec"], "words": st["words"], "speechSeconds": st["speechSeconds"],
            "speechRatio": st["speechRatio"], "speechPct": int(round(st["speechRatio"] * 100)),
            "wpm": st["wpm"], "fit": st["fit"]}


def options(inp):
    """Package options from the execution input (seed script, demo): pinned Map questions, the
    example flag and a title. Anything malformed is dropped."""
    pinned = []
    for q in (inp or {}).get("pinnedQuestions") or []:
        if not isinstance(q, dict) or isinstance(q.get("t"), bool):
            continue
        t, text = _f(q.get("t"), -1.0), " ".join(str(q.get("question") or "").split())
        if t >= 0 and 0 < len(text) <= 100 and len(pinned) < MAX_PINNED:
            pinned.append({"t": t, "question": text})
    title = (inp or {}).get("title")
    title = " ".join(title.split())[:60] if isinstance(title, str) and title.strip() else None
    return {"pinnedQuestions": pinned, "example": (inp or {}).get("example") is True, "title": title}


def transcribe_key(media_id, execution):
    return f"runs/{media_id}/{execution}/transcribe.json"


def handler(event, context):
    media_id = event["mediaId"]
    key = f"transcripts/{media_id}.json"
    supplied = (event.get("input") or {}).get("transcriptKey")
    if supplied:
        transcript, changed = complete(common.read_json(supplied), media_id)
        key = supplied
    else:
        raw = common.read_json(transcribe_key(media_id, event["execution"]))
        transcript, changed = from_transcribe(raw, media_id), True
    if changed:
        common.write_json(key, transcript)
    out = eligibility(transcript)
    out["transcriptKey"] = key
    out["options"] = options(event.get("input"))
    out.pop("fit")
    common.update_media(media_id, "ANALYSING", 0.25, "Reading the transcript", title=(event.get("input") or {}).get("title"))
    return out
