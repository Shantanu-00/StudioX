"""Models, the structured-call seam, usage accounting and record/replay.

Every model call and every external lookup goes through `structured()` or `recorded()`, so a
run can be recorded (SX_RECORD=file.jsonl) and replayed offline in tests (SX_REPLAY=file.jsonl).
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import time
from typing import Any, Callable, TypeVar

from pydantic import BaseModel

log = logging.getLogger("sxagents")

# The contract fixes us-east-1; SX_REGION overrides (AWS_REGION is ignored on purpose: a stray
# shell value such as us-west-2 would silently move every call).
REGION = os.environ.get("SX_REGION", "us-east-1")
SONNET = os.environ.get("SONNET_MODEL_ID", "us.anthropic.claude-sonnet-5-5")
HAIKU = os.environ.get("HAIKU_MODEL_ID", "us.anthropic.claude-haiku-5-5")
NOVA = os.environ.get("NOVA_MODEL_ID", "us.amazon.nova-2-lite-v1:0")

# Which model each role uses (Sonnet for judgement, Haiku for speed).
ROLE_MODEL = {
    "segment": SONNET, "claims": SONNET, "stance": SONNET, "people": SONNET, "curate": SONNET, "map": SONNET,
    "orchestrator": HAIKU, "burst": HAIKU, "protocol": HAIKU, "events": HAIKU, "refine": HAIKU, "ask": HAIKU,
}

T = TypeVar("T", bound=BaseModel)


# ---- usage ------------------------------------------------------------------------------------

class Usage:
    """Thread-safe per-role counters for one process run (reset by the caller)."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.reset()

    def reset(self) -> None:
        self.by_role: dict[str, dict[str, float]] = {}

    def add(self, role: str, inp: int = 0, out: int = 0, cache_read: int = 0, cache_write: int = 0,
            seconds: float = 0.0, calls: int = 1) -> None:
        with self.lock:
            r = self.by_role.setdefault(role, {"calls": 0, "inputTokens": 0, "outputTokens": 0,
                                               "cacheReadTokens": 0, "cacheWriteTokens": 0, "seconds": 0.0})
            r["calls"] += calls
            r["inputTokens"] += inp
            r["outputTokens"] += out
            r["cacheReadTokens"] += cache_read
            r["cacheWriteTokens"] += cache_write
            r["seconds"] = round(r["seconds"] + seconds, 2)

    def totals(self) -> dict[str, float]:
        with self.lock:
            keys = ("calls", "inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "seconds")
            return {k: round(sum(r[k] for r in self.by_role.values()), 2) for k in keys}


USAGE = Usage()


# ---- record / replay --------------------------------------------------------------------------

_rec_lock = threading.Lock()
_replay: dict[str, Any] | None = None


def _replay_table() -> dict[str, Any] | None:
    global _replay
    path = os.environ.get("SX_REPLAY")
    if not path:
        return None
    if _replay is None:
        _replay = {}
        with open(path, encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    e = json.loads(line)
                    _replay.setdefault(e["key"], []).append(e["value"])
    return _replay


def _take(table: dict, key: str):
    """Recorded values for one key in recording order (a repeated identical call can differ);
    the last one repeats."""
    vals = table[key]
    return vals.pop(0) if len(vals) > 1 else vals[0]


def reset_replay() -> None:
    global _replay
    _replay = None


def _key(role: str, *parts: Any) -> str:
    h = hashlib.sha1(json.dumps(parts, sort_keys=True, default=str).encode()).hexdigest()[:20]
    return f"{role}:{h}"


def _record(key: str, value: Any) -> None:
    path = os.environ.get("SX_RECORD")
    if path:
        with _rec_lock, open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps({"key": key, "value": value}, default=str) + "\n")


def replaying() -> bool:
    return _replay_table() is not None


def recorded(role: str, key_parts: Any, fn: Callable[[], Any]) -> Any:
    """Run an external lookup (search, Wikipedia) through the record/replay seam."""
    key = _key(role, key_parts)
    table = _replay_table()
    if table is not None:
        if key not in table:
            raise KeyError(f"replay miss for {role} {key_parts!r}"[:200])
        return _take(table, key)
    value = fn()
    _record(key, value)
    return value


# ---- models -----------------------------------------------------------------------------------

def bedrock_model(model_id: str, max_tokens: int = 4000):
    # No temperature: Claude Sonnet/Haiku 5.5 on Bedrock reject it ("`temperature` is deprecated for this model").
    from strands.models.bedrock import BedrockModel

    return BedrockModel(model_id=model_id, region_name=REGION, max_tokens=max_tokens)


def system_blocks(shared: str | None, instructions: str) -> list[dict]:
    """System prompt as [shared context, cache point, role instructions].

    The shared block (transcript + brief) comes first so calls with the same context reuse the
    Bedrock prompt cache. Claude caches only prefixes over its minimum size (about 1k tokens),
    so a 37 s clip is below it; a full episode is not."""
    blocks: list[dict] = []
    if shared:
        blocks += [{"text": shared}, {"cachePoint": {"type": "default"}}]
    blocks.append({"text": instructions})
    return blocks


def structured(role: str, system: list[dict], prompt: str, out_model: type[T], *, tools: list | None = None,
               hooks: list | None = None, max_tokens: int = 4000, on_searches: Callable[[], list] | None = None,
               replay_searches: Callable[[list], None] | None = None) -> T:
    """One fresh Strands Agent (no history carried over) returning `out_model`.

    `on_searches` returns the search queries this call made (recorded with the output) and
    `replay_searches` re-issues them on replay, so the citation ledger is rebuilt offline."""
    key = _key(role, system, prompt, out_model.__name__)
    table = _replay_table()
    if table is not None:
        if key not in table:
            raise KeyError(f"replay miss for {role}")
        v = _take(table, key)
        if replay_searches and v.get("searches"):
            replay_searches(v["searches"])
        return out_model.model_validate(v["out"])

    from strands import Agent

    before = len(on_searches()) if on_searches else 0
    agent = Agent(
        model=bedrock_model(ROLE_MODEL[role], max_tokens=max_tokens),
        system_prompt=system,
        tools=tools or [],
        hooks=hooks or [],
        callback_handler=None,
        name=f"studiox-{role}",
    )
    t = time.time()
    result = agent(prompt, structured_output_model=out_model)
    dt = time.time() - t
    u = result.metrics.accumulated_usage
    USAGE.add(role, u.get("inputTokens", 0), u.get("outputTokens", 0), u.get("cacheReadInputTokens", 0),
              u.get("cacheWriteInputTokens", 0), dt)
    out = result.structured_output
    if out is None:
        raise RuntimeError(f"{role}: no structured output")
    searches = on_searches()[before:] if on_searches else []
    _record(key, {"out": out.model_dump(mode="json"), "searches": searches})
    log.info("%s: %.1fs in=%s out=%s", role, dt, u.get("inputTokens"), u.get("outputTokens"))
    return out
