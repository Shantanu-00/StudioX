"""Step Functions task 'Verify and score'.

Validates every candidate widget with studiox_core, then scores it with Bedrock ApplyGuardrail
(contextual grounding against the segment's transcript text). The grounding score is the confidence;
below GROUNDING_MIN the candidate is dropped with a reason.

Input: {mediaId, transcriptKey, execution, segments, lanes: [{key, meta: {index}} | {skipped, error}]}
Output: {key, candidates, kept, rejected}; the full list is at runs/<mediaId>/<execution>/verified.json
"""
import os
from concurrent.futures import ThreadPoolExecutor

import common
import core

GROUNDING_MIN = float(os.environ.get("GROUNDING_MIN", "0.7"))
SKIP_GROUNDING = ("technique",)  # animations carry no factual claim
MAX_GUARD, MAX_SOURCE, MAX_QUERY = 4500, 50000, 900


def _strings(value, out):
    if isinstance(value, str):
        out.append(value)
    elif isinstance(value, list):
        for v in value:
            _strings(v, out)
    elif isinstance(value, dict):
        for k, v in value.items():
            if k not in ("id", "evidence", "kind", "x", "y", "from", "to", "shape"):
                _strings(v, out)


def guard_text(widget):
    """Only what the card says THE EPISODE said is checked against the transcript. Outside facts
    (a fact check's explanation from web sources, Wikipedia facts in a dossier, what a compound is)
    cannot be grounded in the transcript by definition; they are covered by the citation guard
    instead. Grounding them here dropped every fact check and dossier in the first cloud run."""
    t = widget.get("type")
    if t in SKIP_GROUNDING:
        return None
    if t == "claim":
        parts = [widget.get("claim", "")]
    elif t == "dossier":
        # The name, plus only the facts tied to an episode timestamp.
        parts = [widget.get("name", "")] + [f.get("text", "") for f in widget.get("facts", [])
                                            if isinstance(f, dict) and f.get("evidence") and not f.get("source")]
    elif t == "entity_list":
        parts = [f"{i.get('name', '')}: {i.get('asSaid', '')}" for i in widget.get("items", []) if isinstance(i, dict)]
    elif t == "protocol":
        parts = [f"{st.get('label', '')}: {st.get('detail', '')}" for st in widget.get("steps", []) if isinstance(st, dict)]
    elif t == "timeline":
        parts = [f"{e.get('when', '')} {e.get('label', '')}" for e in widget.get("events", []) if isinstance(e, dict)]
    else:
        parts = []
        _strings({k: v for k, v in widget.items() if k not in ("source", "sources", "counter", "context",
                                                                "disclaimer", "type", "title", "image")}, parts)
    text = ". ".join(p.strip() for p in parts if isinstance(p, str) and p.strip())
    return text[:MAX_GUARD] or None


def named_in_transcript(widget, text):
    """A dossier with no episode facts is grounded deterministically when the transcript actually
    names the person (the full name, or the surname for multi-word names). The Guardrail cannot
    score a bare name: the first cloud run dropped Cristiano Ronaldo's dossier at 0.17."""
    if widget.get("type") != "dossier" or not text:
        return False
    if any(isinstance(f, dict) and f.get("evidence") and not f.get("source") for f in widget.get("facts", [])):
        return False
    name = " ".join(str(widget.get("name", "")).split()).lower()
    hay = text.lower()
    if not name:
        return False
    parts = [p for p in name.split(" ") if len(p) >= 3]
    return name in hay or (len(parts) > 1 and parts[-1] in hay)


def segment_text(transcript, segment):
    start, end = float(segment.get("start", 0)), float(segment.get("end", 1e9))
    names = transcript.get("speakers", {})
    lines = [f"{names.get(s.get('speaker'), s.get('speaker', ''))}: {s['text']}"
             for s in transcript["sentences"] if s["t1"] > start and s["t0"] < end]
    return "\n".join(lines)[:MAX_SOURCE]


def grounding_score(response):
    """Pull the GROUNDING score out of an ApplyGuardrail response; None if absent."""
    scores = {}
    for a in response.get("assessments", []):
        for f in (a.get("contextualGroundingPolicy") or {}).get("filters", []):
            scores[f.get("type")] = f.get("score")
    return scores.get("GROUNDING"), scores.get("RELEVANCE")


def judge(confidence, minimum=GROUNDING_MIN):
    """(keep, reason)"""
    if confidence is None:
        return False, "guardrail returned no grounding score"
    if confidence < minimum:
        return False, f"grounding {confidence:.2f} below {minimum:.2f}"
    return True, ""


def _apply(guardrail, source, query, guard):
    resp = common.client("bedrock-runtime").apply_guardrail(
        guardrailIdentifier=guardrail[0], guardrailVersion=guardrail[1], source="OUTPUT",
        content=[{"text": {"text": source, "qualifiers": ["grounding_source"]}},
                 {"text": {"text": query[:MAX_QUERY], "qualifiers": ["query"]}},
                 {"text": {"text": guard, "qualifiers": ["guard_content"]}}])
    return grounding_score(resp)


def _guardrail_ids():
    ssm = common.client("ssm")
    return tuple(ssm.get_parameter(Name=f"/studiox/guardrail/{p}")["Parameter"]["Value"] for p in ("id", "version"))


def unique_id(widget, seen, index):
    wid = str(widget.get("id", "w"))
    if wid in seen:
        wid = f"s{index}-{wid}"
        widget["id"] = wid
    seen.add(wid)


def handler(event, context):
    media_id = event["mediaId"]
    common.update_media(media_id, "ANALYSING", 0.7, "Checking every card against what was said")
    transcript = common.read_json(event["transcriptKey"])
    segments = event.get("segments") or []
    guardrail = _guardrail_ids()
    work, rejected, seen = [], [], set()
    for lane in event.get("lanes") or []:
        if not lane.get("key"):
            continue
        index = int((lane.get("meta") or {}).get("index", 0))
        segment = segments[index] if index < len(segments) else {}
        text = segment_text(transcript, segment)
        for cand in common.read_json(lane["key"]).get("candidates", []):
            widget = cand.get("widget") or {}
            lens = cand.get("lens", "?")
            widget, reason = core.validate_widget(widget)
            if widget is None:
                rejected.append({"lens": lens, "text": str(cand.get("widget", {}).get("id", ""))[:160], "reason": reason})
                continue
            cand = {**cand, "widget": widget}
            unique_id(widget, seen, index)
            work.append({"cand": cand, "text": text, "segment": segment, "index": index})

    def score(item):
        widget = item["cand"]["widget"]
        if named_in_transcript(widget, item["text"]):
            return 1.0, 1.0, None
        guard = guard_text(widget)
        if guard is None:
            return None, None, None
        query = f"What does the speaker say about {item['segment'].get('title', 'this topic')}?"
        try:
            return (*_apply(guardrail, item["text"] or "(no speech)", query, guard), None)
        except Exception as exc:  # throttling or a service error: drop this card, keep the run
            return None, None, f"{type(exc).__name__}"

    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(score, work))
    errors = sum(1 for r in results if r[2])
    if work and errors == len(work):
        raise RuntimeError("Bedrock ApplyGuardrail failed for every candidate; is the guardrail deployed?")

    kept, by_lens = [], {}
    for item, (conf, rel, err) in zip(work, results):
        cand, lens = item["cand"], item["cand"].get("lens", "?")
        stat = by_lens.setdefault(lens, {"candidates": 0, "kept": 0})
        stat["candidates"] += 1
        if err:
            rejected.append({"lens": lens, "text": cand["widget"].get("id", ""), "reason": f"guardrail error {err}"})
            continue
        if conf is None and guard_text(cand["widget"]) is None:
            keep, reason, conf = True, "", 1.0  # nothing factual to ground
        else:
            keep, reason = judge(conf)
        if not keep:
            rejected.append({"lens": lens, "text": cand["widget"].get("id", ""), "reason": reason})
            continue
        stat["kept"] += 1
        kept.append({"lens": lens, "widget": cand["widget"], "salience": cand.get("salience"),
                     "reason": cand.get("reason"), "confidence": round(conf, 3), "relevance": rel,
                     "segmentIndex": item["index"]})
    key = f"runs/{media_id}/{event['execution']}/verified.json"
    common.write_json(key, {"candidates": kept, "rejected": rejected, "byLens": by_lens})
    return {"key": key, "kept": len(kept), "rejected": len(rejected)}
