"""Web search (AgentCore Gateway Web Search Tool, else Nova 2 Lite web grounding) and Wikipedia.

Every result passes through the invocation's `Ledger`: the CitationGuard only lets a card or an
answer cite a URL that a search in this invocation returned.
"""

from __future__ import annotations

import contextvars
import json
import logging
import os
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any

from .llm import NOVA, REGION, recorded

log = logging.getLogger("sxagents")

USER_AGENT = os.environ.get(
    "SX_USER_AGENT", "StudioX/0.1 (Fire TV podcast co-viewer, AWS hackathon build; studiox-agents)")
GATEWAY_URL = os.environ.get("GATEWAY_URL", "")
MAX_SEARCHES_PER_INVOCATION = int(os.environ.get("SX_MAX_SEARCHES", "12"))


class BudgetExceeded(RuntimeError):
    pass


def _norm(url: str) -> str:
    """URL identity for the citation check: drop tracking params, fragment and trailing slash."""
    p = urllib.parse.urlsplit(url.strip())
    q = [(k, v) for k, v in urllib.parse.parse_qsl(p.query) if not k.startswith("utm_")]
    return urllib.parse.urlunsplit((p.scheme.lower(), p.netloc.lower(), p.path.rstrip("/"),
                                    urllib.parse.urlencode(q), ""))


@dataclass
class Ledger:
    """Search results seen in one invocation, plus the search budget."""

    max_searches: int = MAX_SEARCHES_PER_INVOCATION
    searches: int = 0
    queries: list = field(default_factory=list)
    results: dict = field(default_factory=dict)  # normalised url -> result
    paths: set = field(default_factory=set)  # which backend served the searches
    lock: threading.Lock = field(default_factory=threading.Lock)

    def add(self, results: list[dict]) -> None:
        with self.lock:
            for r in results:
                self.results.setdefault(_norm(r["url"]), r)

    def get(self, url: str) -> dict | None:
        return self.results.get(_norm(url)) if isinstance(url, str) else None


_LEDGER: contextvars.ContextVar[Ledger | None] = contextvars.ContextVar("sx_ledger", default=None)


def new_ledger(max_searches: int = MAX_SEARCHES_PER_INVOCATION) -> Ledger:
    led = Ledger(max_searches=max_searches)
    _LEDGER.set(led)
    return led


def ledger() -> Ledger:
    led = _LEDGER.get()
    return led if led is not None else new_ledger()


def web_search(query: str, max_results: int = 5, include_domains: list[str] | None = None) -> list[dict]:
    """Search the web; results are [{title, url, snippet, quote?, date?}] with https URLs only."""
    led = ledger()
    query = " ".join(query.split())[:200]
    with led.lock:
        if led.searches >= led.max_searches:
            raise BudgetExceeded(f"search budget of {led.max_searches} reached")
        led.searches += 1
        led.queries.append({"query": query, "max_results": max_results, "include_domains": include_domains})
    out = recorded("search", [query, max_results, include_domains],
                   lambda: _search_backend(query, max_results, include_domains))
    led.paths.add(out["path"])
    led.add(out["results"])
    return out["results"]


def replay_searches(queries: list[dict]) -> None:
    for q in queries:
        try:
            web_search(q["query"], q.get("max_results", 5), q.get("include_domains"))
        except BudgetExceeded:
            break


def _search_backend(query: str, max_results: int, include_domains: list[str] | None) -> dict:
    if GATEWAY_URL:
        try:
            return {"path": "gateway", "results": _gateway_search(query, max_results, include_domains)}
        except Exception as e:  # fall through to Nova, but say so
            log.warning("gateway web search failed (%s); using Nova grounding", e)
    try:
        return {"path": "nova_grounding", "results": _nova_search(query, max_results)}
    except Exception as e:
        # AccessDenied or throttling: claims become UNVERIFIED with no sources.
        log.warning("nova grounding failed: %s", e)
        return {"path": f"none ({type(e).__name__})", "results": []}


_gateway_client = None


def _gateway_search(query: str, max_results: int, include_domains: list[str] | None) -> list[dict]:
    """AgentCore Gateway Web Search connector (MCP tool `WebSearch`), SigV4-signed.

    Uses bedrock_agentcore's WebSearchClient, which speaks MCP `tools/call` to the gateway with
    IAM auth; Strands' MCPClient would need an extra SigV4 transport package."""
    global _gateway_client
    from bedrock_agentcore.tools.web_search_client import WebSearchClient

    if _gateway_client is None:
        _gateway_client = WebSearchClient(region=REGION, gateway_endpoint=GATEWAY_URL)
    resp = _gateway_client.search(query, max_results=max_results, include_domains=include_domains or None)
    out = []
    for r in resp.results:
        if not r.url or not r.url.startswith("https://"):
            continue
        item = {"title": (r.title or _domain(r.url))[:140], "url": r.url, "snippet": (r.text or "")[:600]}
        if r.text:
            item["quote"] = _clip(r.text, 240)
        if r.published_date:
            item["date"] = r.published_date[:32]
        out.append(item)
    return out[:max_results]


def _title_from_url(url: str) -> str:
    """Nova citations carry no page title: build one from the URL slug and domain."""
    dom = _domain(url)
    segs = [x for x in urllib.parse.urlsplit(url).path.split("/") if x]
    for seg in segs[-1:]:
        words = re.sub(r"\.(html?|php|aspx?)$", "", urllib.parse.unquote(seg)).replace("-", " ").replace("_", " ")
        if re.search(r"[A-Za-z]{3,}", words) and len(words.split()) >= 2:
            return _clip(f"{words[:1].upper()}{words[1:]} · {dom}", 140)
    return dom


def _domain(url: str) -> str:
    d = urllib.parse.urlsplit(url).netloc.lower()
    return d[4:] if d.startswith("www.") else d


def _clip(s: str, n: int) -> str:
    s = " ".join(s.split())
    return s if len(s) <= n else s[: n - 1].rsplit(" ", 1)[0] + "…"


_bedrock = None


def _nova_search(query: str, max_results: int) -> list[dict]:
    """Bedrock Nova 2 Lite with the `nova_grounding` system tool; sources come from citationsContent.

    The snippet for each URL is the grounded sentence Nova wrote before citing it, not a verbatim
    quote, so these results carry no `quote`."""
    global _bedrock
    import boto3

    if _bedrock is None:
        _bedrock = boto3.client("bedrock-runtime", region_name=REGION)
    prompt = (f"Search the web for evidence about: {query}\n"
              "Summarise what each source says about it, one or two sentences per source, and cite every source.")
    r = _bedrock.converse(
        modelId=NOVA,
        messages=[{"role": "user", "content": [{"text": prompt}]}],
        toolConfig={"tools": [{"systemTool": {"name": "nova_grounding"}}]},
        inferenceConfig={"maxTokens": 1200, "temperature": 0.1},
    )
    from .llm import USAGE

    u = r.get("usage", {})
    USAGE.add("search", u.get("inputTokens", 0), u.get("outputTokens", 0),
              seconds=r.get("metrics", {}).get("latencyMs", 0) / 1000)
    out: dict[str, dict] = {}
    last_text = ""
    for block in r["output"]["message"]["content"]:
        if "text" in block:
            last_text = block["text"]
        for c in (block.get("citationsContent") or {}).get("citations", []):
            web = (c.get("location") or {}).get("web") or {}
            url = web.get("url", "")
            if not url.startswith("https://"):
                continue
            snippet = _last_sentence(last_text)
            if url in out:
                if snippet and snippet not in out[url]["snippet"]:
                    out[url]["snippet"] = (out[url]["snippet"] + " " + snippet)[:600]
            else:
                out[url] = {"title": _title_from_url(url), "url": url, "snippet": snippet[:600]}
    return list(out.values())[:max_results]


def _last_sentence(text: str) -> str:
    text = re.sub(r"[*#]+", "", text).strip()
    parts = re.split(r"(?<=[.!?])\s+|\n+", text)
    parts = [p.strip(" -") for p in parts if p.strip(" -")]
    return parts[-1] if parts else ""


# ---- Wikipedia --------------------------------------------------------------------------------

FREE_LICENCES = ("cc0", "pd", "public domain", "cc-by-", "cc by ", "cc-by-sa-", "cc by-sa ")


def _get_json(url: str) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as resp:  # noqa: S310 (https only, fixed hosts)
        return json.loads(resp.read().decode("utf-8"))


def _licence_ok(short: str, code: str) -> bool:
    s = f"{code} {short}".lower()
    if any(x in s for x in ("-nc", " nc", "-nd", " nd", "fair use", "non-free")):
        return False
    return any(s.startswith(p) or f" {p}" in s for p in FREE_LICENCES) or "cc0" in s or "public domain" in s


def _strip_html(s: str) -> str:
    return " ".join(re.sub(r"<[^>]+>", "", s or "").split())


def _wiki_image(file_name: str) -> dict | None:
    """A Commons image with a free licence (CC0 / PD / CC BY / CC BY-SA), else None."""
    q = urllib.parse.urlencode({"action": "query", "format": "json", "formatversion": "2", "prop": "imageinfo",
                                "iiprop": "extmetadata|url", "iiurlwidth": "480", "titles": f"File:{file_name}"})
    data = _get_json(f"https://en.wikipedia.org/w/api.php?{q}")
    pages = (data.get("query") or {}).get("pages") or []
    info = ((pages[0].get("imageinfo") or [None])[0]) if pages else None
    if not info:
        return None
    meta = info.get("extmetadata") or {}
    short = (meta.get("LicenseShortName") or {}).get("value", "")
    code = (meta.get("License") or {}).get("value", "")
    if not _licence_ok(short, code):
        return None
    url = info.get("thumburl") or info.get("url") or ""
    url = url.split("?")[0]
    if not url.startswith("https://"):
        return None
    artist = _strip_html((meta.get("Artist") or {}).get("value", "")) or "Unknown author"
    credit = _clip(f"{artist} · {short} · Wikimedia Commons", 80)
    return {"url": url, "credit": credit, "licence": short}


def _wiki_page(title: str) -> dict | None:
    t = urllib.parse.quote(title.strip().replace(" ", "_"), safe="")
    try:
        s = _get_json(f"https://en.wikipedia.org/api/rest_v1/page/summary/{t}?redirect=true")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise
    if s.get("type") == "disambiguation":
        return {"title": s.get("title"), "disambiguation": True}
    page = {
        "title": s.get("title"),
        "description": s.get("description", ""),
        "extract": _clip(s.get("extract", ""), 900),
        "url": ((s.get("content_urls") or {}).get("desktop") or {}).get("page", ""),
        "image": None,
    }
    q = urllib.parse.urlencode({"action": "query", "format": "json", "formatversion": "2", "prop": "pageimages",
                                "piprop": "name", "titles": s.get("title", title)})
    try:
        pages = (_get_json(f"https://en.wikipedia.org/w/api.php?{q}").get("query") or {}).get("pages") or []
        name = pages[0].get("pageimage") if pages else None
        if name:
            page["image"] = _wiki_image(name)
    except Exception as e:  # an image is optional
        log.warning("wiki image lookup failed for %s: %s", title, e)
    return page


_wiki_cache: dict[str, Any] = {}


def wiki_page(title: str) -> dict | None:
    """Wikipedia summary for an exact title (redirects followed), with a free-licence image or None."""
    k = title.strip().lower()
    if k not in _wiki_cache:
        _wiki_cache[k] = recorded("wiki", k, lambda: _wiki_page(title))
    return _wiki_cache[k]
