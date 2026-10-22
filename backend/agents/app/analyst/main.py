"""AgentCore Runtime entry for the StudioX `analyst` (modes: segment, lenses, curate, map, answer)."""

import json
import logging

from bedrock_agentcore.runtime import BedrockAgentCoreApp

from sxagents import analyst
from sxagents.llm import USAGE

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
    payload = _payload(payload)
    mode = payload.get("mode")
    app.logger.info("analyst %s %s", mode, payload.get("mediaId"))
    result = analyst.handle(payload)
    app.logger.info("analyst %s usage %s", mode, USAGE.totals())
    return result


if __name__ == "__main__":
    app.run()
