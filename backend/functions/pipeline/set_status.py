"""Step Functions task: set MEDIA status/progress and post a thread status line.

Input: {mediaId, state, progress?, text?, speechPct?, error?}
"""
import common

MAX_ERROR = 300


def status_text(event):
    state = event["state"]
    if state == "NOT_A_FIT":
        pct = event.get("speechPct")
        return f"NOT A FIT · {pct}% SPEECH" if pct is not None else "NOT A FIT"
    if state == "FAILED":
        return "Analysis failed"
    return event.get("text")


def handler(event, context):
    state = event["state"]
    error = str(event["error"])[:MAX_ERROR] if event.get("error") else None
    progress = event.get("progress", 1 if state in ("NOT_A_FIT", "FAILED") else None)
    common.update_media(event["mediaId"], state, progress, status_text(event), error=error, title=event.get("title") or (event.get("input") or {}).get("title"))
    return {"mediaId": event["mediaId"], "state": state}
