"""AgentCore Runtime entry for the StudioX `coviewer` (actions: refine, ask).

The transcript is cached in process per sessionId; AgentCore Memory is used only if MEMORY_ID is set."""

import json
import logging

from bedrock_agentcore.runtime import BedrockAgentCoreApp

from sxagents import coviewer
from sxagents.llm import USAGE
from sxagents.store import package_for, transcript_for

logging.basicConfig(level=logging.INFO)
app = BedrockAgentCoreApp()


def _payload(payload):
    # `agentcore invoke '<json>'` sends {"prompt": "<json>"}; the pipeline and API send the JSON itself.
    p = payload or {}
    if isinstance(p.get("prompt"), str) and p["prompt"].lstrip().startswith("{"):
        p = json.loads(p["prompt"])
    return p


@app.entrypoint
def invoke(payload, context):
    USAGE.reset()
    p = _payload(payload)
    action = p.get("action")
    session = p.get("sessionId") or getattr(context, "session_id", None) or "default"
    tr = transcript_for(p, cache_key=f"{session}:{p.get('mediaId')}")
    if action == "ask":
        res = coviewer.ask(tr, float(p.get("t", 0)), p.get("question", ""))
        coviewer.remember(session, p.get("viewerId", ""), p.get("question", ""), res["text"])
    elif action == "refine":
        res = coviewer.refine(tr, float(p.get("t", 0)), package_for(p))
    else:
        raise ValueError(f"unknown action {action!r}")
    app.logger.info("coviewer %s usage %s", action, USAGE.totals())
    return res


if __name__ == "__main__":
    app.run()
