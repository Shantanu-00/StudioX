"""Step Functions task: make a watchable fragmented MP4 from an upload (CONTRACTS section 8).

Input: {mediaId, mediaKey}. Output: {mediaId, playable, mediaUrl?, error?}. Never raises for media problems:
a failure sets playable=false plus playbackError and returns normally so the analysis branch still runs.
ffmpeg and ffprobe come from the layer at /opt/bin.
"""
import json
import os
import subprocess
import tempfile
import time
from decimal import Decimal

import common

FFMPEG = os.environ.get("FFMPEG", "/opt/bin/ffmpeg")
FFPROBE = os.environ.get("FFPROBE", "/opt/bin/ffprobe")
# The TV player buffers the whole file (MSE, one SourceBuffer), so playback is bounded for a 1 GB
# device: longer uploads are still analysed but not offered for playback in this build.
MAX_PLAYBACK_S = int(os.environ.get("MAX_PLAYBACK_S", "1800"))


def duration_of(probe):
    """Whole seconds from ffprobe's format.duration, or None."""
    try:
        return int(round(float(probe.get("format", {}).get("duration"))))
    except (TypeError, ValueError):
        return None
DOMAIN_PARAM = "/studiox/domain"
MAX_ERROR = 300
MOVFLAGS = "frag_keyframe+empty_moov+default_base_moof"
SCALE = "scale='min(1280,iw)':-2"
READY_TEXT = "READY TO WATCH · ANALYSING"


def streams_of(probe):
    """First video and first audio stream from ffprobe JSON (either may be None)."""
    video = audio = None
    for s in probe.get("streams", []):
        if s.get("codec_type") == "video" and video is None and s.get("disposition", {}).get("attached_pic") != 1:
            video = s
        elif s.get("codec_type") == "audio" and audio is None:
            audio = s
    return video, audio


def choose_mode(probe):
    """'copy' when the video is 8-bit 4:2:0 H.264 up to 1080p wide and the audio is AAC or absent; else 'transcode'.
    Raises ValueError when there is no video stream."""
    video, audio = streams_of(probe)
    if video is None:
        raise ValueError("no video stream")
    ok_video = (video.get("codec_name") == "h264" and video.get("pix_fmt", "yuv420p") == "yuv420p"
                and int(video.get("width") or 0) <= 1920)
    ok_audio = audio is None or audio.get("codec_name") == "aac"
    return "copy" if ok_video and ok_audio else "transcode"


def build_command(mode, src, dst, has_audio=True):
    """The TV's MSE player opens one video and one audio buffer, so a silent AAC track is added when
    the upload has no audio (the video itself is still copied or transcoded as chosen)."""
    cmd = [FFMPEG, "-hide_banner", "-nostdin", "-y", "-i", src]
    if not has_audio:
        cmd += ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"]
    cmd += ["-map", "0:v:0", "-map", "0:a:0?" if has_audio else "1:a:0", "-sn", "-dn"]
    if mode == "copy":
        cmd += ["-c:v", "copy"]
    else:
        cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-vf", SCALE]
    if has_audio and mode == "copy":
        cmd += ["-c:a", "copy"]
    else:
        cmd += ["-c:a", "aac", "-b:a", "128k"]
    if not has_audio:
        cmd += ["-shortest"]
    return cmd + ["-movflags", MOVFLAGS, "-f", "mp4", dst]


def media_url(domain, media_id):
    return f"https://{domain}/media/{media_id}.frag.mp4"


def _run(cmd, timeout):
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if res.returncode != 0:
        raise RuntimeError(f"{os.path.basename(cmd[0])} exit {res.returncode}: {res.stderr.strip()[-200:]}")
    return res.stdout


def _record(media_id, **fields):
    names = {f"#f{i}": k for i, k in enumerate(fields)}
    values = {f":f{i}": v for i, v in enumerate(fields.values())}
    sets = ", ".join(f"#f{i} = :f{i}" for i in range(len(fields)))
    return common.table().update_item(
        Key={"PK": f"MEDIA#{media_id}", "SK": "META"}, UpdateExpression="SET " + sets,
        ExpressionAttributeNames=names, ExpressionAttributeValues=values, ReturnValues="ALL_NEW")["Attributes"]


def _post_ready(media_id, row):
    """Thread line; keeps the row's current state so a late finish never moves the status backwards."""
    link_id = row.get("linkId")
    if not link_id:
        return
    state = row.get("status", "PROCESSING")
    text = "READY TO WATCH" if state == "READY" else READY_TEXT
    progress = float(row.get("progress", 0))
    msg = common.status_message(media_id, state, progress, text)
    common.table().put_item(Item={"PK": f"LINK#{link_id}", "SK": f"MSG#{msg['id']}",
                                  "msg": json.loads(json.dumps(msg), parse_float=Decimal),
                                  "ttl": int(time.time()) + common.MSG_TTL})


def handler(event, context):
    media_id, key = event["mediaId"], event["mediaKey"]
    budget = max(60, int(context.get_remaining_time_in_millis() / 1000) - 45) if context else 800
    try:
        with tempfile.TemporaryDirectory(dir="/tmp") as tmp:
            src, dst = os.path.join(tmp, "in"), os.path.join(tmp, "out.mp4")
            common.client("s3").download_file(common.bucket(), key, src)
            probe = json.loads(_run([FFPROBE, "-v", "error", "-show_entries",
                                     "stream=codec_type,codec_name,pix_fmt,width:stream_disposition=attached_pic:format=duration",
                                     "-of", "json", src], 60))
            seconds = duration_of(probe)
            if seconds and seconds > MAX_PLAYBACK_S:
                _record(media_id, playable=False, durationSec=seconds,
                        playbackError=f"{seconds // 60} min is longer than the {MAX_PLAYBACK_S // 60} min TV playback limit")
                return {"mediaId": media_id, "playable": False, "error": "too long for TV playback"}
            mode = choose_mode(probe)
            _run(build_command(mode, src, dst, streams_of(probe)[1] is not None), budget)
            common.client("s3").upload_file(dst, common.bucket(), f"media/{media_id}.frag.mp4",
                                            ExtraArgs={"ContentType": "video/mp4"})
        domain = common.client("ssm").get_parameter(Name=DOMAIN_PARAM)["Parameter"]["Value"]
        url = media_url(domain, media_id)
        extra = {"durationSec": seconds} if seconds else {}
        row = _record(media_id, playable=True, mediaUrl=url, **extra)
        _post_ready(media_id, row)
        return {"mediaId": media_id, "playable": True, "mediaUrl": url, "mode": mode}
    except Exception as exc:  # never fail the execution: analysis continues without playback
        reason = f"{type(exc).__name__}: {exc}"[:MAX_ERROR]
        try:
            _record(media_id, playable=False, playbackError=reason)
        except Exception:
            pass
        return {"mediaId": media_id, "playable": False, "error": reason}
