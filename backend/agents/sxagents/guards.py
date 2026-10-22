"""Rules enforced in code: SpoilerGuard, CitationGuard, BudgetGuard.

The hooks use the Strands hooks API (BeforeToolCallEvent.cancel_tool / tool_use rewrite); the
tool functions and the post-processing enforce the same rules again, so a hook is never the only
line of defence.
"""

from __future__ import annotations

import threading
from collections import Counter

from strands.hooks import BeforeToolCallEvent, HookProvider, HookRegistry

from .search import Ledger


class BudgetGuard(HookProvider):
    """Caps tool calls per agent call, overall and per tool name."""

    def __init__(self, max_calls: int = 8, per_tool: dict[str, int] | None = None) -> None:
        self.max_calls = max_calls
        self.per_tool = per_tool or {}
        self.counts: Counter = Counter()
        self.cancelled: list[str] = []
        self.lock = threading.Lock()

    def register_hooks(self, registry: HookRegistry, **kwargs) -> None:
        registry.add_callback(BeforeToolCallEvent, self.before_tool)

    def before_tool(self, event: BeforeToolCallEvent) -> None:
        name = event.tool_use.get("name", "")
        with self.lock:
            total = sum(self.counts.values())
            limit = self.per_tool.get(name)
            if total >= self.max_calls or (limit is not None and self.counts[name] >= limit):
                event.cancel_tool = f"BudgetGuard: tool budget reached for {name}; answer with what you have."
                self.cancelled.append(name)
                return
            self.counts[name] += 1


class SpoilerGuard(HookProvider):
    """Clamps any time argument of a transcript tool to the playhead `t`."""

    TIME_KEYS = ("t", "t0", "t1", "until", "end")

    def __init__(self, t: float, tools: tuple[str, ...] = ("read_transcript",)) -> None:
        self.t = float(t)
        self.tools = tools
        self.clamped = 0

    def register_hooks(self, registry: HookRegistry, **kwargs) -> None:
        registry.add_callback(BeforeToolCallEvent, self.before_tool)

    def before_tool(self, event: BeforeToolCallEvent) -> None:
        if event.tool_use.get("name") not in self.tools:
            return
        args = event.tool_use.get("input") or {}
        for k in self.TIME_KEYS:
            v = args.get(k)
            if isinstance(v, (int, float)) and v > self.t:
                args[k] = self.t
                self.clamped += 1
        event.tool_use["input"] = args


def cite_guard(urls: list[str], led: Ledger, max_n: int = 4) -> tuple[list[dict], list[str]]:
    """CitationGuard: keep only URLs a search in this invocation returned.

    Returns (sources as {title, url[, quote, date]}, stripped urls)."""
    kept, stripped, seen = [], [], set()
    for u in urls:
        r = led.get(u)
        if r is None:
            stripped.append(u)
            continue
        if r["url"] in seen:
            continue
        seen.add(r["url"])
        src = {"title": r["title"], "url": r["url"]}
        for k in ("quote", "date"):
            if r.get(k):
                src[k] = r[k]
        kept.append(src)
    return kept[:max_n], stripped
