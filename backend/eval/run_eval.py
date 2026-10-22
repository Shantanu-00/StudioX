#!/usr/bin/env python3
"""StudioX evaluation: claims (verdicts), spoilers (Ask), citations. Writes backend/eval/results.md.

  uv run --python 3.13 backend/eval/run_eval.py [--runs 3] [--suites claims,spoilers,citations] [--local]

Each case is run `--runs` times through backend/agents/run_local.py. Only real outputs are scored;
a failed call is counted as an error, never as a pass. --local adds the third-party test transcript
(review/transcript, git-ignored); its cases and numbers are reported only as aggregate counts, with
no transcript text.
"""
import argparse, datetime as dt, json, re, subprocess, sys, tempfile, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EVAL = ROOT / "backend/eval"
RUN_LOCAL = ROOT / "backend/agents/run_local.py"
TRANS = ROOT / "backend/data/transcripts"
LOCAL = ROOT / "review/transcript"
# How `cites` index the transcript: "sentence" = index into sentences[] (CONTRACTS example).
CITE_MODE = "seconds"  # A: cites are whole seconds into the episode (schema.validate_answer_body)
LOCAL_WINDOW = (460, 2110)  # seconds of the test transcript that hold the eval claims


def run(args, timeout=900):
    t = time.time()
    try:
        r = subprocess.run(["uv", "run", "--python", "3.13", str(RUN_LOCAL), *args], capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        r = subprocess.CompletedProcess(args, 124, "", f"timeout after {timeout}s")
    return r, time.time() - t


def last_json(text):
    for line in reversed(text.strip().splitlines()):
        line = line.strip()
        if line.startswith("{"):
            try:
                return json.loads(line)
            except ValueError:
                pass
    try:  # whole output may be one pretty-printed object
        return json.loads(text)
    except ValueError:
        return None


def toks(s):
    return set(re.findall(r"[a-z0-9]+", s.lower())) - {"the", "a", "of", "to", "his", "by", "and", "in", "is", "at", "with", "that"}


def match_widgets(case, pkg):
    """Claim widgets that contain the case: >= 60% of the case's words, or 45% when the widget's
    evidence covers the case's time. A package may merge several spoken claims into one widget."""
    out = []
    a = toks(case["claim"])
    for w in pkg.get("widgets", []):
        if w.get("type") != "claim":
            continue
        cont = len(a & toks(w.get("claim", ""))) / max(1, len(a))
        near = any(e["t0"] - 4 <= case["t"] <= e["t1"] + 4 for e in w.get("evidence", []))
        if cont >= 0.6 or (near and cont >= 0.45):
            out.append(w)
    return out


def verdict_of(w):
    v = w.get("verdict")
    return str(v).upper() if v else None


def package(media_id, transcript, out):
    r, dt_ = run(["package", "--transcript", str(transcript), "--out", str(out), "--media-id", media_id], timeout=1500)
    if r.returncode or not Path(out).exists():
        return None, dt_, (r.stderr or r.stdout)[-300:]
    return json.loads(Path(out).read_text()), dt_, ""


def windowed(path):
    d = json.loads(Path(path).read_text())
    lo, hi = LOCAL_WINDOW
    d["sentences"] = [s for s in d["sentences"] if lo <= s["t0"] < hi]
    d["durationSec"] = hi
    out = LOCAL / "podcast1_window.json"
    out.write_text(json.dumps(d))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--suites", default="claims,spoilers,citations")
    ap.add_argument("--local", action="store_true")
    a = ap.parse_args()
    suites = a.suites.split(",")
    if not RUN_LOCAL.exists():
        sys.exit("backend/agents/run_local.py not found")
    claims = json.loads((EVAL / "claims.json").read_text())["claims"]
    qs = json.loads((EVAL / "spoilers.json").read_text())["questions"]
    media = {"science-ep42": TRANS / "science-ep42.json", "crime-case104": TRANS / "crime-case104.json"}
    if a.local and (LOCAL / "eval_local.json").exists():
        loc = json.loads((LOCAL / "eval_local.json").read_text())
        claims += loc["claims"]; qs += loc["questions"]
        media["podcast1"] = windowed(LOCAL / "podcast1.json")
    sent = {m: json.loads(Path(p).read_text())["sentences"] for m, p in media.items()}

    res = {"date": dt.datetime.now().strftime("%Y-%m-%d %H:%M"), "runs": a.runs}
    pkgs = {m: [] for m in media}
    pkg_errors, pkg_secs = 0, []
    need_pkgs = "claims" in suites or "citations" in suites
    if need_pkgs:
        for m, tp in media.items():
            for i in range(a.runs):
                with tempfile.TemporaryDirectory() as td:
                    pkg, secs, err = package(m, tp, Path(td) / "p.json")
                if pkg is None:
                    pkg_errors += 1; print(m, "run", i, "ERROR", err); continue
                pkgs[m].append(pkg); pkg_secs.append(secs)
    res["package_runs"] = sum(len(v) for v in pkgs.values()); res["package_errors"] = pkg_errors
    res["package_secs_median"] = sorted(pkg_secs)[len(pkg_secs) // 2] if pkg_secs else None

    raw = []  # raw per-run records, written next to results (demo) or under review/ (local)
    if "claims" in suites:
        n = agree = missing = false_debunk = ambiguous = overreach = 0
        notes = []
        for c in claims:
            for k, pkg in enumerate(pkgs.get(c["mediaId"], [])):
                n += 1
                ws = match_widgets(c, pkg)
                if not ws:
                    missing += 1; raw.append({"kind": "claim", "case": c["id"], "run": k, "surfaced": False}); continue
                vs = [verdict_of(w) for w in ws]
                raw.append({"kind": "claim", "case": c["id"], "run": k, "surfaced": True, "verdicts": vs,
                            "widgets": [w.get("claim") for w in ws]})
                if any(v in c["expected"] for v in vs):
                    agree += 1
                for w, v in zip(ws, vs):
                    if v != "DEBUNKED":
                        continue
                    # other cases this same widget also contains (merged claim)?
                    others = [o for o in claims if o["mediaId"] == c["mediaId"] and o is not c
                              and w in match_widgets(o, pkg)]
                    if c.get("trueClaim") and all(o.get("trueClaim") for o in others):
                        false_debunk += 1; notes.append((c["id"], "FALSE DEBUNKED"))
                    elif c.get("trueClaim"):
                        ambiguous += 1; notes.append((c["id"], "DEBUNKED on merged widget, needs a human look"))
                    elif "DEBUNKED" not in c["expected"]:
                        overreach += 1; notes.append((c["id"], "DEBUNKED overreach"))
        shown = n - missing
        res["claims"] = {"cases_x_runs": n, "surfaced": shown, "not_surfaced": missing, "agree": agree,
                         "agreement_of_surfaced": f"{agree}/{shown}", "false_debunked": false_debunk,
                         "ambiguous_debunked": ambiguous, "debunk_overreach": overreach, "notes": notes[:14]}

    if "spoilers" in suites:
        tot = err = leaks = cite_leaks = kw_leaks = 0
        detail = []
        for q in qs:
            sents = sent[q["mediaId"]]
            for i in range(a.runs):
                r, secs = run(["ask", "--transcript", str(media[q["mediaId"]]), "--t", str(q["t"]), "--question", q["question"]])
                out = last_json(r.stdout) if r.returncode == 0 else None
                tot += 1
                if not out or "text" not in out:
                    err += 1; continue
                bad_c = []
                for ci in out.get("cites", []):
                    ts = sents[ci]["t0"] if CITE_MODE == "sentence" and 0 <= ci < len(sents) else ci  # seconds by default
                    if ts > q["t"]:
                        bad_c.append(ci)
                low = out["text"].lower()
                bad_k = [k for k in q["leakKeywords"] if k.lower() in low and k.lower() not in q["question"].lower()]
                raw.append({"kind": "ask", "case": q["id"], "run": i, "t": q["t"], "text": out["text"], "cites": out.get("cites"),
                            "badCites": bad_c, "badKeywords": bad_k})
                cite_leaks += bool(bad_c); kw_leaks += bool(bad_k); leaks += bool(bad_c or bad_k)
                if bad_c or bad_k:
                    detail.append((q["id"], bad_c, bad_k))
        res["spoilers"] = {"questions": len(qs), "asked": tot, "errors": err, "leaking_replies": leaks,
                           "cite_after_t": cite_leaks, "keyword_hits": kw_leaks, "detail": detail[:12]}

    if "citations" in suites:
        urls = bad = unlogged = 0
        for m, plist in pkgs.items():
            for pkg in plist:
                found = [w["source"] for w in pkg.get("widgets", []) if w.get("type") == "claim" and w.get("source")]
                for x in pkg.get("answers", []):
                    found += [s.get("url", "") for s in x.get("sources", [])]
                logged = set(pkg.get("searchedUrls") or [])
                for u in found:
                    if not re.match(r"^https?://", u):
                        continue  # a claim `source` may be a title; only URLs are checked
                    urls += 1
                    if not u.startswith("https://"):
                        bad += 1
                    elif logged and u not in logged:
                        unlogged += 1
                if not logged and found:
                    unlogged = unlogged  # run did not log searched URLs: that check is not possible
        res["citations"] = {"urls_checked": urls, "not_https": bad, "not_in_search_log": unlogged,
                            "search_log_available": any(p.get("searchedUrls") for v in pkgs.values() for p in v)}

    demo_raw = [r for r in raw if not r["case"].startswith(("loc-", "l"))]
    loc_raw = [r for r in raw if r["case"].startswith(("loc-",)) or re.match(r"^l\d", r["case"])]
    (EVAL / "runs").mkdir(exist_ok=True)
    (EVAL / "runs/latest.jsonl").write_text("".join(json.dumps(r) + "\n" for r in demo_raw))
    if loc_raw:
        (LOCAL / "eval_raw_local.jsonl").write_text("".join(json.dumps(r) + "\n" for r in loc_raw))
    write(res, claims, qs, a)
    print(json.dumps(res, indent=1))


def write(res, claims, qs, a):
    L = ["# Evaluation results", "", f"Generated by `backend/eval/run_eval.py`. Date: {res['date']}. Runs per case: {res['runs']}.",
         "Only real outputs are scored; failed calls count as errors. Ground truth is in `claims.json` and `spoilers.json` and is the author's recollection where flagged.", "",
         "| Metric | Value |", "| --- | --- |",
         f"| Package runs (ok / errors) | {res['package_runs']} / {res['package_errors']} |"]
    if res.get("package_secs_median") is not None:
        L.append(f"| Median package time | {res['package_secs_median']:.0f} s |")
    c = res.get("claims")
    if c:
        L += [f"| Claim cases x runs | {c['cases_x_runs']} |", f"| Surfaced by the package | {c['surfaced']} (not surfaced: {c['not_surfaced']}) |",
              f"| Verdict agreement (surfaced) | {c['agreement_of_surfaced']} |",
              f"| **False DEBUNKED (target 0)** | **{c['false_debunked']}** |", f"| DEBUNKED on a merged widget (human check) | {c['ambiguous_debunked']} |", f"| DEBUNKED overreach (claim not known true, expected set lacks it) | {c['debunk_overreach']} |"]
    s = res.get("spoilers")
    if s:
        L += [f"| Ask questions x runs | {s['asked']} ({s['errors']} errors) |",
              f"| **Spoiler leaks (target 0)** | **{s['leaking_replies']}** (cites after t: {s['cite_after_t']}, keyword hits: {s['keyword_hits']}) |"]
    ci = res.get("citations")
    if ci:
        L += [f"| Source URLs checked | {ci['urls_checked']} (not https: {ci['not_https']}) |",
              f"| URLs not in search log | {ci['not_in_search_log']} (log available: {ci['search_log_available']}) |"]
    for k in ("claims", "spoilers"):
        d = (res.get(k) or {}).get("notes") or (res.get(k) or {}).get("detail")
        if d:
            L += ["", f"Notes ({k}): " + "; ".join(str(x) for x in d)]
    L += ["", "Limits: small suites (see counts above). Keyword leak check is deterministic and can false-positive; hits need a human look."]
    (EVAL / "results.md").write_text("\n".join(L) + "\n")


if __name__ == "__main__":
    main()
