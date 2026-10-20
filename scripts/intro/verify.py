"""Validate the actual exported media, without Blender or third-party modules."""
import array
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
path = Path(sys.argv[1]) if len(sys.argv) > 1 else (
    ROOT / 'docs/local/intro/render/studiox-intro-10s.mp4')


def run(*args):
    return subprocess.check_output(args)


info = json.loads(run(
    'ffprobe', '-v', 'error', '-count_frames', '-show_streams',
    '-show_format', '-of', 'json', str(path)))
video = next(s for s in info['streams'] if s['codec_type'] == 'video')
audio = next(s for s in info['streams'] if s['codec_type'] == 'audio')
assert (video['width'], video['height']) == (1920, 1080)
assert video['r_frame_rate'] == '30/1'
assert int(video['nb_read_frames']) == 300
assert abs(float(info['format']['duration']) - 10) < .002
assert video['pix_fmt'] == 'yuv420p'
assert audio['sample_rate'] == '48000' and audio['channels'] == 2

black_checks = {}
for timestamp in ('0', '0.2', '9.9'):
    pixels = run('ffmpeg', '-v', 'error', '-ss', timestamp, '-i', str(path),
                 '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-')
    assert len(pixels) == 1920 * 1080 * 3
    black_checks[timestamp] = max(pixels)
    assert max(pixels) <= 2, 'Expected a black frame at ' + timestamp

pcm = array.array('h', run(
    'ffmpeg', '-v', 'error', '-i', str(path), '-vn', '-ac', '2',
    '-ar', '48000', '-c:a', 'pcm_s16le', '-f', 's16le', '-'))
peak = max(abs(x) for x in pcm)
assert 1000 < peak < 32767, 'Audio is silent or clipped'
assert max(abs(x) for x in pcm[:int(.25 * 48000 * 2)]) <= 4

report = {
    'file': str(path), 'duration_seconds': float(info['format']['duration']),
    'resolution': [video['width'], video['height']], 'frames': 300, 'fps': 30,
    'audio': '48 kHz stereo AAC', 'decoded_audio_peak_16bit': peak,
    'black_frame_max_rgb': black_checks,
    'result': 'PASS',
    'limits': 'Does not establish visual equivalence to the reference or Vega playback compatibility.',
}
print(json.dumps(report, indent=2))
