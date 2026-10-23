#!/usr/bin/env python3
"""Fit per-line TTS files into the transcript timing and mux a voiced copy of each demo episode.

Input  media/audio/<id>/lines.json (from lines.py) and one audio file per line in
       media/audio/<id>/lines/NN.(mp3|wav|m4a|ogg|flac) from any TTS (Polly, ElevenLabs, ...).
Output media/tv/<id>.voiced.mp4 and media/tv/<id>.voiced.frag.mp4: the original H.264 stream copied
       bit for bit plus one new 48 kHz stereo AAC-LC voice track. The originals are never touched.

Per line: leading/trailing silence is trimmed, then the line starts at t0 (+ a small offset at each
speaker change) at natural speed. If it is longer than its window it is sped up with atempo, at most
--max-tempo (1.25x). Inside one speaker turn (consecutive rows of the same speaker; their windows were
split by character count in backend/scripts/make_transcripts.py) a line may use slack left by its
neighbour, never time that belongs to the next speaker (--strict-windows disables this). Lines that
still do not fit are reported as needing a shorter text and the script exits with status 2.
Each clip gets --fade ms fades, the mix is loudness-normalised (two-pass loudnorm, -16 LUFS, true
peak -2 dBTP before AAC) and muxed with the same fragment flags as the existing TV files
(-movflags +frag_keyframe+empty_moov+default_base_moof, as in docs/product/rendering-and-playback-analysis.md).

Memory: every ffmpeg call takes the shared lock ~/.cache/studiox-heavy.lock (set STUDIOX_HEAVY_LOCK=""
to skip) and runs with -threads 2, one process at a time. Do not wrap this script in flock(1) as well.

Usage:
  python3 scripts/podcast-audio/assemble.py                     # both episodes
  python3 scripts/podcast-audio/assemble.py science-ep42 --offset 0.08
  python3 scripts/podcast-audio/assemble.py crime-case104 --lines-dir /tmp/x/{id} --out-dir /tmp/x/out
"""
import argparse
import fcntl
import json
import math
import os
import re
import struct
import subprocess
import sys
from collections import Counter
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EPISODES = ("crime-case104", "science-ep42")
EXTS = (".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac", ".opus")
MOVFLAGS = "+frag_keyframe+empty_moov+default_base_moof"
SR = 48000
LOCK = os.environ.get("STUDIOX_HEAVY_LOCK", str(Path.home() / ".cache" / "studiox-heavy.lock"))


# ----------------------------------------------------------------------------- process helpers
@contextmanager
def heavy_lock():
    if not LOCK:
        yield
        return
    Path(LOCK).parent.mkdir(parents=True, exist_ok=True)
    with open(LOCK, "a") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)


def ffmpeg(args, capture=False):
    cmd = ["ffmpeg", "-hide_banner", "-nostdin", "-y", "-filter_threads", "1"] + args
    with heavy_lock():
        res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        sys.exit(f"ffmpeg failed ({res.returncode}): {' '.join(cmd)}\n{res.stderr[-1500:]}")
    return res.stderr if capture else None


def ffprobe(path, *args):
    res = subprocess.run(["ffprobe", "-v", "error", *args, "-of", "json", str(path)],
                         capture_output=True, text=True, check=True)
    return json.loads(res.stdout)


def duration(path):
    return float(ffprobe(path, "-show_entries", "format=duration")["format"]["duration"])


def last_json(text):
    return json.loads(text[text.rindex("{"):text.rindex("}") + 1])


# ----------------------------------------------------------------------------- timing plan
def turns_of(lines, strict):
    out = []
    for i, ln in enumerate(lines):
        prev = lines[i - 1] if i else None
        if (not strict and prev and prev["speaker"] == ln["speaker"]
                and abs(prev["t1"] - ln["t0"]) < 0.05):
            out[-1].append(i)
        else:
            out.append([i])
    return out


def place_uniform(lines, durs, idx, tempo, offset, gap):
    """One tempo for the whole turn; each line starts at its t0 or right after the previous line."""
    starts, tempos, t = [], [], None
    for k, i in enumerate(idx):
        s = lines[i]["t0"] + (offset if k == 0 else 0.0)
        if t is not None:
            s = max(s, t + gap)
        starts.append(s)
        tempos.append(tempo)
        t = s + durs[i] / tempo
    return starts, tempos, t


def place_greedy(lines, durs, idx, hard_end, offset, gap, max_tempo, max_lag):
    """Per-line tempo: each line is sped up only as much as needed to let the next line of the turn
    start within max_lag of its caption (and the last one to end before the next speaker)."""
    starts, tempos, t = [], [], None
    for k, i in enumerate(idx):
        s = lines[i]["t0"] + (offset if k == 0 else 0.0)
        if t is not None:
            s = max(s, t + gap)
        deadline = hard_end if k == len(idx) - 1 else lines[idx[k + 1]]["t0"] + max_lag - gap
        room = deadline - s
        tempo = max_tempo if room <= 0 else min(max_tempo, max(1.0, durs[i] / room))
        if tempo > 1.0:
            tempo = min(max_tempo, math.ceil(tempo * 1000) / 1000)
        starts.append(s)
        tempos.append(tempo)
        t = s + durs[i] / tempos[-1]
    return starts, tempos, t


def plan(lines, durs, video_dur, offset=0.05, gap=0.12, tail=0.05, max_tempo=1.25, max_lag=0.35, strict=False):
    """Start time and tempo for every line. durs = trimmed natural length of each clip (s).
    Hard limit: a turn ends before the next speaker's t0 (or the end of the video). Soft limit: inside a
    turn no line starts more than max_lag after its caption. Per-line tempos are tried first, then one
    tempo for the whole turn; the first plan that meets both limits wins, else the one ending earliest.
    Returns (rows, problems); problems are turns whose text must be shortened."""
    turns = turns_of(lines, strict)
    rows, problems = [None] * len(lines), []
    for ti, idx in enumerate(turns):
        nxt = lines[turns[ti + 1][0]]["t0"] if ti + 1 < len(turns) else video_dur
        hard_end = min(nxt, video_dur) - tail
        cands = [place_greedy(lines, durs, idx, hard_end, offset, gap, max_tempo, max_lag)]
        tempo = 1.0
        while True:
            cands.append(place_uniform(lines, durs, idx, tempo, offset, gap))
            if tempo >= max_tempo - 1e-9:
                break
            tempo = min(max_tempo, round(tempo + 0.005, 3))

        def lag(c):
            return max(st - lines[i]["t0"] for st, i in zip(c[0], idx))

        good = [c for c in cands if c[2] <= hard_end + 1e-6 and lag(c) <= max_lag + 1e-6]
        fitting = [c for c in cands if c[2] <= hard_end + 1e-6]
        if good:      # least stretching
            starts, tempos, end = min(good, key=lambda c: (max(c[1]), sum(c[1])))
        elif fitting:  # in time for the next speaker, smallest caption lag
            starts, tempos, end = min(fitting, key=lambda c: (lag(c), max(c[1])))
        else:          # overruns: the plan that ends earliest
            starts, tempos, end = min(cands, key=lambda c: c[2])
        fits = end <= hard_end + 1e-6
        over = 0.0 if fits else end - hard_end
        for k, i in enumerate(idx):
            ln, d, tp = lines[i], durs[i], tempos[k]
            win = max(ln["t1"] - ln["t0"], 1e-3)
            length = d / tp
            r = {"n": ln["n"], "speaker": ln["speaker"], "t0": ln["t0"], "t1": ln["t1"],
                 "window": round(win, 3), "audio": round(d, 3), "tempo": tp,
                 "start": round(starts[k], 3), "end": round(starts[k] + length, 3),
                 "lag": round(starts[k] - ln["t0"], 3), "fill": round(length / win, 2),
                 "turnEnd": round(hard_end, 3), "status": "ok"}
            if tp > 1.0005:
                r["status"] = "sped up"
                if tp >= 1.1 and fits:
                    # Polly can read faster itself, which can sound more natural than atempo
                    r["suggestRate"] = int(round(100 * tp))
            if fits and r["lag"] > max_lag + 1e-6:
                r["status"] = f"late {r['lag']:.2f}s"
            if fits and d / win < 0.75:
                # optional: a slower Polly <prosody rate> fills more of a long window (85-100 %)
                r["suggestRate"] = max(85, min(100, int(round(100 * d / win / 0.9))))
            rows[i] = r
        if not fits:
            for i in idx:
                rows[i]["status"] = "NEEDS SHORTER TEXT"
            chars = sum(lines[i].get("chars", len(lines[i].get("spoken", ""))) for i in idx)
            cps = chars / max(sum(durs[i] for i in idx), 1e-3)
            problems.append({"lines": [lines[i]["n"] for i in idx], "speaker": lines[idx[0]]["speaker"],
                             "from": lines[idx[0]]["t0"], "to": round(hard_end, 3), "overflow": round(over, 3),
                             "cutChars": int(over * max_tempo * cps + 0.999)})
    return rows, problems


# ----------------------------------------------------------------------------- MP4 box inspection
CONTAINERS = {"moov", "trak", "mdia", "minf", "stbl", "mvex", "moof", "traf", "edts", "dinf", "mfra"}


def boxes(path):
    out = []

    def walk(fh, start, end, depth, parent):
        pos = start
        while pos + 8 <= end:
            fh.seek(pos)
            size, typ = struct.unpack(">I4s", fh.read(8))
            typ, hl = typ.decode("latin1"), 8
            if size == 1:
                size, hl = struct.unpack(">Q", fh.read(8))[0], 16
            elif size == 0:
                size = end - pos
            fh.seek(pos + hl)
            payload = fh.read(min(size - hl, 64)) if typ in ("ftyp", "tfhd", "tfdt", "mdhd", "tkhd", "trex") else b""
            out.append({"depth": depth, "type": typ, "pos": pos, "size": size, "parent": parent, "head": payload})
            if typ in CONTAINERS:
                walk(fh, pos + hl, pos + size, depth + 1, typ)
            pos += size

    with open(path, "rb") as fh:
        walk(fh, 0, os.path.getsize(path), 0, None)
    return out


def frag_summary(path):
    bx = boxes(path)
    top = [b["type"] for b in bx if b["depth"] == 0]
    ftyp = next(b["head"] for b in bx if b["type"] == "ftyp")
    major = ftyp[0:4].decode("latin1")
    brands = [ftyp[i:i + 4].decode("latin1") for i in range(8, len(ftyp) - 3, 4)]
    timescales, cur_tk = {}, None
    for b in bx:  # tkhd then mdhd inside each trak: map track id -> timescale
        if b["type"] == "tkhd":
            v = b["head"][0]
            cur_tk = struct.unpack(">I", b["head"][12:16] if v == 0 else b["head"][20:24])[0]
        elif b["type"] == "mdhd" and cur_tk is not None:
            v = b["head"][0]
            timescales[cur_tk] = struct.unpack(">I", b["head"][12:16] if v == 0 else b["head"][20:24])[0]
    trafs, starts, tid = [], {}, None
    for b in bx:
        if b["type"] == "moof":
            trafs.append(0)
        elif b["type"] == "traf":
            trafs[-1] += 1
        elif b["type"] == "tfhd":
            tid = struct.unpack(">I", b["head"][4:8])[0]
        elif b["type"] == "tfdt":
            v = b["head"][0]
            t = struct.unpack(">Q", b["head"][4:12])[0] if v == 1 else struct.unpack(">I", b["head"][4:8])[0]
            starts.setdefault(tid, []).append(round(t / timescales.get(tid, 1), 3))
    return {"top": top[:4] + (["..."] if len(top) > 4 else []), "topCounts": dict(Counter(top)),
            "majorBrand": major, "compatibleBrands": brands, "moofs": len(trafs),
            "trafsPerMoof": sorted(set(trafs)), "trex": sum(b["type"] == "trex" for b in bx),
            "mfra": "mfra" in top, "videoFragmentStarts": starts.get(1, []),
            "audioFragmentStarts": starts.get(2, [])}


# ----------------------------------------------------------------------------- audio steps
def find_clip(lines_dir, n):
    for stem in (f"{n:02d}", f"{n}", f"{n:03d}"):
        for ext in EXTS:
            p = lines_dir / f"{stem}{ext}"
            if p.exists() and p.stat().st_size > 0:
                return p
    return None


TRIM = ("silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02,areverse,"
        "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02,areverse")


def prep_clip(src, dst):
    ffmpeg(["-i", str(src), "-af", f"aformat=channel_layouts=mono,aresample={SR},{TRIM}",
            "-ar", str(SR), "-ac", "1", "-c:a", "pcm_f32le", "-threads", "2", str(dst)])
    return duration(dst)


def render_clip(src, dst, tempo, fade):
    length = duration(src) / tempo
    f = min(fade, length / 4)
    chain = []
    if tempo > 1.0005:
        chain.append(f"atempo={tempo:.4f}")
    chain += [f"afade=t=in:st=0:d={f:.3f}", f"afade=t=out:st={max(0.0, length - f):.3f}:d={f:.3f}",
              "pan=stereo|c0=c0|c1=c0"]
    ffmpeg(["-i", str(src), "-af", ",".join(chain), "-ar", str(SR), "-c:a", "pcm_f32le",
            "-threads", "2", str(dst)])


def mix(clips, starts, video_dur, dst):
    args, graph = [], []
    for k, (c, s) in enumerate(zip(clips, starts)):
        args += ["-i", str(c)]
        graph.append(f"[{k}:a]adelay=delays={int(round(s * SR))}S:all=1[d{k}]")
    ins = "".join(f"[d{k}]" for k in range(len(clips)))
    graph.append(f"{ins}amix=inputs={len(clips)}:normalize=0:dropout_transition=0,"
                 f"apad=whole_dur={video_dur:.3f},atrim=0:{video_dur:.3f},"
                 f"afade=t=out:st={video_dur - 0.04:.3f}:d=0.04[m]")
    ffmpeg(args + ["-filter_complex", ";".join(graph), "-map", "[m]", "-ar", str(SR), "-ac", "2",
                   "-c:a", "pcm_f32le", "-threads", "2", str(dst)])


def loudnorm_encode(src, dst, lufs, tp, lra, bitrate, video_dur):
    base = f"loudnorm=I={lufs}:TP={tp}:LRA={lra}"
    m = last_json(ffmpeg(["-i", str(src), "-af", base + ":print_format=json", "-threads", "2",
                          "-f", "null", "-"], capture=True))
    if m["input_i"] in ("-inf", "inf"):
        sys.exit(f"{src}: mix is silent")
    second = (f"{base}:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}"
              f":measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true:print_format=json")
    r = last_json(ffmpeg(["-i", str(src), "-af", f"{second},aresample={SR},apad=whole_dur={video_dur:.3f},atrim=0:{video_dur:.3f}", "-ar", str(SR), "-ac", "2",
                          "-c:a", "aac", "-profile:a", "aac_low", "-b:a", bitrate, "-threads", "2", str(dst)],
                         capture=True))
    return {"inputI": float(m["input_i"]), "inputTP": float(m["input_tp"]),
            "normalization": r.get("normalization_type")}


def measure(path):
    err = ffmpeg(["-i", str(path), "-map", "0:a:0", "-af", "ebur128=peak=true", "-threads", "2",
                  "-f", "null", "-"], capture=True)
    tail = err[err.rfind("Summary:"):]
    i = re.search(r"I:\s+(-?[\d.]+) LUFS", tail)
    p = re.search(r"Peak:\s+(-?[\d.]+|-inf) dBFS", tail)
    return {"I": float(i[1]) if i else None, "truePeak": float(p[1]) if p and p[1] != "-inf" else None}


def video_md5(path):
    """MD5 of the copied video packets (container independent: same for .mp4 and .frag.mp4)."""
    with heavy_lock():
        res = subprocess.run(["ffmpeg", "-hide_banner", "-nostdin", "-v", "error", "-i", str(path), "-map", "0:v:0",
                              "-c", "copy", "-f", "md5", "-"], capture_output=True, text=True)
    if res.returncode != 0:
        sys.exit(f"md5 of {path} failed: {res.stderr[-300:]}")
    return res.stdout.strip().split("=")[-1]


def streams(path):
    p = ffprobe(path, "-show_entries", "stream=index,codec_type,codec_name,profile,width,height,sample_rate,"
                "channels,duration:format=duration")
    return p["streams"], float(p["format"]["duration"])


# ----------------------------------------------------------------------------- main
def run_episode(media_id, a):
    sub = lambda s: Path(s.replace("{id}", media_id))
    base = ROOT / "media" / "audio" / media_id
    manifest = json.loads((base / "lines.json").read_text())
    lines = manifest["lines"]
    lines_dir = sub(a.lines_dir) if a.lines_dir else base / "lines"
    work = sub(a.work_dir) if a.work_dir else base / "build"
    out_dir = sub(a.out_dir) if a.out_dir else ROOT / "media" / "tv"
    src_mp4 = ROOT / "media" / "tv" / f"{media_id}.mp4"
    src_frag = ROOT / "media" / "tv" / f"{media_id}.frag.mp4"
    work.mkdir(parents=True, exist_ok=True)
    out_dir.mkdir(parents=True, exist_ok=True)
    video_dur = float(ffprobe(src_mp4, "-select_streams", "v:0", "-show_entries", "stream=duration")
                      ["streams"][0]["duration"])

    missing = [ln["n"] for ln in lines if not find_clip(lines_dir, ln["n"])]
    if missing:
        sys.exit(f"{media_id}: no audio for lines {missing} in {lines_dir} (expected NN.mp3 etc.)")

    durs = []
    for ln in lines:
        d = prep_clip(find_clip(lines_dir, ln["n"]), work / f"{ln['n']:02d}.trim.wav")
        if d < 0.1:
            sys.exit(f"{media_id} #{ln['n']}: clip is silent after trimming")
        durs.append(d)
    offset = manifest.get("startOffsetSec", 0.05) if a.offset is None else a.offset
    rows, problems = plan(lines, durs, video_dur, offset=offset, gap=a.gap, max_tempo=a.max_tempo,
                          max_lag=a.max_lag, strict=a.strict_windows)

    clips = []
    for ln, r in zip(lines, rows):
        c = work / f"{ln['n']:02d}.fit.wav"
        render_clip(work / f"{ln['n']:02d}.trim.wav", c, r["tempo"], a.fade / 1000)
        clips.append(c)
    mix(clips, [r["start"] for r in rows], video_dur, work / "mix.wav")
    voice = work / "voice.m4a"
    ln_info = loudnorm_encode(work / "mix.wav", voice, a.lufs, a.tp, a.lra, a.bitrate, video_dur)

    voiced = out_dir / f"{media_id}.voiced.mp4"
    voiced_frag = out_dir / f"{media_id}.voiced.frag.mp4"
    for p in (voiced, voiced_frag):
        if p.resolve() in (src_mp4.resolve(), src_frag.resolve()):
            sys.exit("refusing to overwrite an original")
    ffmpeg(["-i", str(src_mp4), "-i", str(voice), "-map", "0:v:0", "-map", "1:a:0", "-c", "copy",
            "-map_metadata", "0", "-movflags", "+faststart", str(voiced)])
    # same command that produced media/tv/*.frag.mp4 from the progressive file
    ffmpeg(["-i", str(voiced), "-c", "copy", "-movflags", MOVFLAGS, str(voiced_frag)])

    report = {"mediaId": media_id, "videoDurationSec": video_dur, "lines": rows, "needsShorterText": problems,
              "loudnorm": ln_info, "outputs": {}}
    if not a.no_verify:
        report["outputs"] = verify(src_mp4, src_frag, voiced, voiced_frag)
    (work / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print_report(report, work / "report.json")
    return problems, report


def verify(src_mp4, src_frag, voiced, voiced_frag):
    ref_md5 = video_md5(src_mp4)
    out = {}
    for p in (voiced, voiced_frag):
        st, fdur = streams(p)
        v = next(s for s in st if s["codec_type"] == "video")
        au = next(s for s in st if s["codec_type"] == "audio")
        out[p.name] = {
            "size": p.stat().st_size, "formatDuration": fdur,
            "streams": [f"{s['index']}:{s['codec_type']}:{s['codec_name']}:{s.get('profile')}" for s in st],
            "video": f"{v['width']}x{v['height']} {v.get('duration')}s",
            "audio": f"{au['sample_rate']}Hz {au['channels']}ch {au.get('duration')}s",
            "videoIdentical": video_md5(p) == ref_md5,
            "loudness": measure(p),
        }
    if src_frag.exists():
        a, b = frag_summary(src_frag), frag_summary(voiced_frag)
        same = {k: a[k] == b[k] for k in ("topCounts", "majorBrand", "compatibleBrands", "moofs", "trafsPerMoof",
                                          "trex", "mfra", "videoFragmentStarts")}
        out["fragments"] = {"original": {k: a[k] for k in a if k != "audioFragmentStarts"},
                            "voiced": {k: b[k] for k in b if k != "audioFragmentStarts"},
                            "same": same, "match": all(same.values())}
    return out


def print_report(rep, path):
    print(f"\n== {rep['mediaId']}  (video {rep['videoDurationSec']:.3f} s)")
    print(f"{'#':>2} {'speaker':<11} {'window':>13} {'win s':>6} {'audio':>6} {'stretch':>7} "
          f"{'start':>6} {'end':>6} {'lag':>5} {'fill':>5}  status")
    for r in rep["lines"]:
        extra = ""
        if "suggestRate" in r:
            extra += f" [Polly rate {r['suggestRate']}%?]"
        print(f"{r['n']:>2} {r['speaker']:<11} {r['t0']:6.2f}-{r['t1']:6.2f} {r['window']:6.2f} {r['audio']:6.2f} "
              f"{r['tempo']:6.3f}x {r['start']:6.2f} {r['end']:6.2f} {r['lag']:5.2f} {r['fill']:5.2f}  {r['status']}{extra}")
    ln = rep["loudnorm"]
    print(f"loudnorm: mix {ln['inputI']} LUFS / {ln['inputTP']} dBTP -> {ln['normalization']}")
    for name, o in rep["outputs"].items():
        if name == "fragments":
            f = o
            print(f"fragments: original {f['original']['moofs']} moof x {f['original']['trafsPerMoof']} traf, "
                  f"voiced {f['voiced']['moofs']} moof x {f['voiced']['trafsPerMoof']} traf; match={f['match']}"
                  + ("" if f["match"] else f" diff={[k for k, v in f['same'].items() if not v]}"))
            continue
        L = o["loudness"]
        print(f"{name}: {o['size']} B, {o['formatDuration']:.3f} s, {', '.join(o['streams'])}; "
              f"video {o['video']} identical={o['videoIdentical']}; audio {o['audio']}; "
              f"{L['I']} LUFS, true peak {L['truePeak']} dBTP")
    for p in rep["needsShorterText"]:
        print(f"!! {p['speaker']} lines {p['lines']} ({p['from']:.2f}-{p['to']:.2f} s) overrun by {p['overflow']:.2f} s "
              f"even at the max stretch: cut about {p['cutChars']} characters from them")
    print(f"report: {path}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("ids", nargs="*", default=list(EPISODES))
    ap.add_argument("--lines-dir", help="folder with NN.mp3 files ({id} is replaced); default media/audio/<id>/lines")
    ap.add_argument("--work-dir", help="intermediate files ({id} is replaced); default media/audio/<id>/build")
    ap.add_argument("--out-dir", help="where <id>.voiced(.frag).mp4 go ({id} is replaced); default media/tv")
    ap.add_argument("--offset", type=float, help="start delay after t0 at each speaker change (default from manifest, 0.05)")
    ap.add_argument("--gap", type=float, default=0.12, help="minimum pause between lines of one speaker turn")
    ap.add_argument("--max-tempo", type=float, default=1.25)
    ap.add_argument("--max-lag", type=float, default=0.35,
                    help="latest a line may start after its caption appears when it uses a neighbour's slack")
    ap.add_argument("--fade", type=float, default=40, help="fade in/out per line in ms (30-60)")
    ap.add_argument("--strict-windows", action="store_true", help="never borrow slack from a neighbouring line")
    ap.add_argument("--lufs", type=float, default=-16.0)
    ap.add_argument("--tp", type=float, default=-2.0, help="true-peak target before AAC (final must stay < -1 dBTP)")
    ap.add_argument("--lra", type=float, default=11.0)
    ap.add_argument("--bitrate", default="128k")
    ap.add_argument("--no-verify", action="store_true")
    a = ap.parse_args()
    if not 30 <= a.fade <= 60:
        ap.error("--fade must be 30-60 ms")
    bad = False
    for media_id in a.ids:
        problems, rep = run_episode(media_id, a)
        outs = rep["outputs"]
        tps = [o["loudness"]["truePeak"] for k, o in outs.items() if k != "fragments" and o["loudness"]["truePeak"] is not None]
        if problems or any(tp > -1.0 for tp in tps) or not all(
                o["videoIdentical"] for k, o in outs.items() if k != "fragments"):
            bad = True
    sys.exit(2 if bad else 0)


if __name__ == "__main__":
    main()
