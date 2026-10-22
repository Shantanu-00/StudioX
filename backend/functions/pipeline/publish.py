"""Step Functions task 'Publish package': assemble the episode package, write it to S3 and mark READY.

Input: {mediaId, execution, transcriptKey, seg, verifiedKey, curate, map, answers, options}
  map      the `Draw the map` result {explore, questions, problems}; `explore` is validated again here
           against the shown widgets (studiox_core.map, CONTRACTS section 9)
  options  from Normalise: {pinnedQuestions, example, title}; `example` and `title` go top-level
Output: {mediaId, version, packageKey, map}
"""
import common
import core


def collect_answers(items):
    """Map output -> package `answers`. Skipped or malformed entries are dropped."""
    out = []
    for item in items or []:
        res, meta = item.get("result"), item.get("meta") or {}
        if not isinstance(res, dict) or not isinstance(res.get("text"), str) or not meta.get("question"):
            continue
        answer = {"question": meta["question"], "t": meta.get("t"), "text": res["text"],
                  "cites": res.get("cites") or [], "sources": res.get("sources") or []}
        if isinstance(meta.get("mapNode"), str) and meta["mapNode"]:
            answer["mapNode"] = meta["mapNode"]
        out.append(answer)
    return out


def next_version(media_id):
    resp = common.table().update_item(
        Key={"PK": f"MEDIA#{media_id}", "SK": "META"}, UpdateExpression="ADD packageVersion :one",
        ExpressionAttributeValues={":one": 1}, ReturnValues="UPDATED_NEW")
    return int(resp["Attributes"]["packageVersion"])


def handler(event, context):
    media_id = event["mediaId"]
    verified = common.read_json(event["verifiedKey"])
    curate = event["curate"]
    version = next_version(media_id)
    explore = (event.get("map") or {}).get("explore")
    package = core.assemble_package(
        media_id=media_id, version=version, generated_at=common.iso(),
        transcript=common.read_json(event["transcriptKey"]), explore=explore if isinstance(explore, dict) else None,
        segments=event["seg"]["segments"], moments=curate.get("moments", []),
        shown_ids=curate.get("widgetIds"), labels=curate.get("labels"), widgets=verified["candidates"],
        rejected=verified.get("rejected", []),
        answers=collect_answers(event.get("answers")), models=curate.get("models") or {})
    # Grounding score per shown widget (extra field; the TV ignores keys it does not know).
    scores = {c["widget"]["id"]: c["confidence"] for c in verified["candidates"]}
    package["confidence"] = {w["id"]: scores[w["id"]] for w in package["widgets"] if w["id"] in scores}
    opts = event.get("options") or {}
    if opts.get("title"):
        package["title"] = opts["title"]
    if opts.get("example") is True:
        package["example"] = True
    versioned = f"packages/{media_id}/v{version}.json"
    common.write_json(versioned, package)
    common.write_json(f"packages/{media_id}/latest.json", package, cache_control="public, max-age=60")
    common.update_media(media_id, "READY", 1, "Ready to watch", packageKey=f"packages/{media_id}/latest.json",
                        title=None)
    ex = package.get("explore") or {}
    return {"mediaId": media_id, "version": version, "packageKey": f"packages/{media_id}/latest.json",
            "map": {"eligible": ex.get("eligible"), "layout": ex.get("layout"), "nodes": len(ex.get("nodes") or [])}}
