# /// script
# requires-python = ">=3.13"
# dependencies = [
#   "strands-agents>=1.62",
#   "bedrock-agentcore>=1.24",
#   "boto3>=1.43",
#   "pydantic>=2.11",
# ]
# ///
"""Run the StudioX agents locally against Bedrock (no AgentCore deploy needed).

  uv run --python 3.13 backend/agents/run_local.py package --transcript <path> --out <package.json> [--media-id <id>]
        [--question "<seconds>|<text>"]... [--title "<title>"] [--example]
  uv run --python 3.13 backend/agents/run_local.py ask --transcript <path> --t <seconds> --question "<text>"
  uv run --python 3.13 backend/agents/run_local.py refine --transcript <path> --t <seconds>

Env: SONNET_MODEL_ID, HAIKU_MODEL_ID, NOVA_MODEL_ID, GATEWAY_URL (optional), AWS_REGION (us-east-1),
SX_RECORD=<file.jsonl> to record every model/search/wiki call for offline replay (SX_REPLAY).
`package` also writes <out>.run.json with timings, token usage and the per-candidate audit.
--question pins a question on the Map (answered spoiler-safe, stored in `answers` with `mapNode`).
--example marks a package built from a transcript StudioX wrote (top-level `example: true`); --title
(default: the transcript's `title`) sets a top-level `title`.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parent / "shared" / "python")]

from studiox_core import transcript as T  # noqa: E402
from studiox_core.schema import validate_package  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("package")
    p.add_argument("--transcript", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--media-id")
    p.add_argument("--version", type=int, default=1)
    p.add_argument("--question", action="append", default=[], metavar="T|TEXT",
                   help="pin a question on the map, e.g. '12|Does the ping break his alibi?' (repeatable)")
    p.add_argument("--title", help="top-level package title (default: the transcript's title, if any)")
    p.add_argument("--example", action="store_true", help="mark as an example transcript written by StudioX")
    a = sub.add_parser("ask")
    a.add_argument("--transcript", required=True)
    a.add_argument("--t", type=float, required=True)
    a.add_argument("--question", required=True)
    r = sub.add_parser("refine")
    r.add_argument("--transcript", required=True)
    r.add_argument("--t", type=float, required=True)
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING, stream=sys.stderr,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    from sxagents import analyst, coviewer, mapper  # noqa: E402  (imports strands)
    from sxagents.llm import USAGE  # noqa: E402

    tr = T.load(args.transcript)
    t0 = time.time()
    if args.cmd == "package":
        media_id = args.media_id or tr.get("mediaId") or Path(args.transcript).stem
        pinned = mapper.parse_pinned(args.question)
        pkg = analyst.build_package(tr, media_id, args.version, say=lambda m: print(m, file=sys.stderr),
                                    pinned=pinned)
        run = pkg.pop("_run")
        title = args.title or tr.get("title")
        if title:
            pkg["title"] = T.clip(title, 60)
        if args.example:
            pkg["example"] = True
        problems = validate_package(pkg, media_id)
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(pkg, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        Path(str(out) + ".run.json").write_text(json.dumps(run, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        f = pkg["funnel"]
        print(f"package {media_id} v{pkg['version']} -> {out}")
        print(f"funnel: candidates={f['candidates']} kept={f['kept']} shown={f['shown']} "
              f"byLens={json.dumps(f['byLens'])}")
        for w in pkg["widgets"]:
            label = w.get("claim") or w.get("name") or w.get("title")
            extra = f" [{w['verdict']}, {len(w.get('sources', []))} sources]" if w["type"] == "claim" else ""
            print(f"  {w['id']:<18} {w['type']:<12} {label}{extra}")
        ex = pkg.get("explore") or {}
        print(f"map: eligible={ex.get('eligible')} layout={ex.get('layout')} category={ex.get('category')} "
              f"title={ex.get('title')!r} reason={ex.get('reason')!r}")
        for n in ex.get("nodes") or []:
            print(f"  {n['id']:<4} t={n['t']:<6} {n['kind']:<6} {n['label']}"
                  + (f" [{n['verdict']}]" if n.get("verdict") else "") + (f" sim={n['sim']}" if n.get("sim") else "")
                  + (f" when={n['when']}" if n.get("when") else ""))
        for e in ex.get("edges") or []:
            print(f"  {e['from']} -{e['kind']}-> {e['to']}" + (f" ({e['label']})" if e.get("label") else ""))
        for q in ex.get("questions") or []:
            print(f"  ? {q['t']} {q['nodeId']}: {q['question']}")
        print(f"moments={len(pkg['moments'])} answers={len(pkg['answers'])} rejected={len(pkg['rejected'])} "
              f"search={pkg['models'].get('searchPathsUsed')}")
        u = run["usage"]
        print(f"usage: {u['calls']:.0f} model calls, in={u['inputTokens']:.0f} out={u['outputTokens']:.0f} "
              f"cacheRead={u['cacheReadTokens']:.0f} tokens; wall {time.time() - t0:.1f} s; timings {run['timings']}")
        if problems:
            print("INVALID package:", problems, file=sys.stderr)
            return 2
        return 0
    if args.cmd == "ask":
        res = coviewer.ask(tr, args.t, args.question)
    else:
        res = coviewer.refine(tr, args.t)
    print(json.dumps(res, indent=2, ensure_ascii=False))
    print(f"wall {time.time() - t0:.1f} s; usage {USAGE.totals()}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
