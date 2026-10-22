"""Retiming for the local v5 proof, with the glass transient at original speed.

The source is the user's downloaded reference. This does not create original
music. FFmpeg atempo changes the surrounding pacing without changing pitch; the
10.68–11.17 s source region is copied directly between short overlapping edits.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
RATE = 48000
SOURCE_ONSET = 10.775
OUTPUT_ONSET = 4.25
OPENING = .28
END = 9.75
PRE_ANCHOR = 10.70
POST_ANCHOR = 11.15
OVERLAP = .04


def decode(path):
    data = subprocess.check_output([
        'ffmpeg', '-v', 'error', '-i', str(path), '-vn', '-ar', str(RATE),
        '-ac', '2', '-f', 'f32le', '-',
    ])
    return np.frombuffer(data, dtype='<f4').reshape(-1, 2).copy()


def stretch(samples, ratio):
    process = subprocess.run([
        'ffmpeg', '-v', 'error', '-f', 'f32le', '-ar', str(RATE), '-ac', '2',
        '-i', '-', '-af', f'atempo={ratio:.12f},asetpts=N/SR/TB',
        '-f', 'f32le', '-',
    ], input=np.asarray(samples, dtype='<f4').tobytes(), capture_output=True, check=True)
    return np.frombuffer(process.stdout, dtype='<f4').reshape(-1, 2).copy()


def clip(samples, start, end):
    return samples[round(start * RATE):round(end * RATE)]


def fit(samples, duration):
    length = round(duration * RATE)
    return np.pad(samples[:length], ((0, max(0, length - len(samples))), (0, 0)))


def ramp(length):
    u = np.linspace(0, 1, length, dtype=np.float32)
    return u * u * (3 - 2 * u)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, default=ROOT / 'docs/local/intro/reference/reference.mp4')
    parser.add_argument('--output', type=Path, default=ROOT / 'docs/local/intro/v5')
    args = parser.parse_args()
    output = args.output.resolve()
    preserved = [ROOT / 'docs/local/intro' / name for name in ('render', 'v2', 'v3', 'v4')]
    if output in preserved:
        raise ValueError('Choose a new output directory; older revisions are preserved.')
    output.mkdir(parents=True, exist_ok=True)
    source = decode(args.source)
    offset = OUTPUT_ONSET - SOURCE_ONSET
    pre_out = PRE_ANCHOR + offset  # 4.175 s
    post_out = POST_ANCHOR + offset  # 4.625 s
    pre_ratio = (PRE_ANCHOR - 3.4) / (pre_out - OPENING)
    post_ratio = (17.461 - POST_ANCHOR) / (END - post_out)
    half = OVERLAP / 2

    # Extra context lets atempo complete its analysis windows before trimming.
    pre = fit(stretch(clip(source, 3.4, PRE_ANCHOR + .3), pre_ratio),
              pre_out + half - OPENING)
    raw_start = PRE_ANCHOR - half
    raw_end = POST_ANCHOR + half
    transient = clip(source, raw_start, raw_end)
    post_start = POST_ANCHOR - half * post_ratio
    post = fit(stretch(clip(source, post_start, 17.461), post_ratio),
               END - (post_out - half))

    cross = ramp(round(OVERLAP * RATE))[:, None]
    pre[-len(cross):] *= 1 - cross
    transient[:len(cross)] *= cross
    transient[-len(cross):] *= 1 - cross
    post[:len(cross)] *= cross
    pre[:round(.015 * RATE)] *= ramp(round(.015 * RATE))[:, None]

    result = np.zeros((10 * RATE, 2), dtype=np.float32)
    for samples, start in ((pre, OPENING), (transient, raw_start + offset),
                           (post, post_out - half)):
        index = round(start * RATE)
        result[index:index + len(samples)] += samples

    # Quiet final extinction follows the picture. Keep .25 s of actual silence.
    fade_start = 9.30
    result[round(fade_start * RATE):round(END * RATE)] *= (
        1 - ramp(round((END - fade_start) * RATE)))[:, None]
    gain = min(.85, .63 / max(float(np.abs(result).max()), 1e-8))
    result *= gain
    destination = output / 'studiox-reference-soundtrack.wav'
    subprocess.run([
        'ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(RATE),
        '-ac', '2', '-i', '-', '-c:a', 'pcm_s24le', str(destination),
    ], input=np.asarray(result, dtype='<f4').tobytes(), check=True)

    encoded = decode(destination)
    # The un-crossfaded glass event must match source samples, apart from gain.
    source_event = clip(source, 10.775, 11.10)
    output_event = clip(encoded, OUTPUT_ONSET, OUTPUT_ONSET + .325)
    event_error = float(np.max(np.abs(output_event - source_event * gain)))
    report = {
        'audio_file': str(destination),
        'source_file_sha256': hashlib.sha256(args.source.read_bytes()).hexdigest(),
        'duration_seconds': len(encoded) / RATE,
        'sample_rate': RATE,
        'channels': 2,
        'samples_per_channel': len(encoded),
        'source_glass_onset_seconds': SOURCE_ONSET,
        'output_glass_onset_seconds': OUTPUT_ONSET,
        'onset_note': 'Approximate onset located from a rise in high-frequency energy; no claim of sample-exact perceptual onset.',
        'original_speed_source_region_seconds': [raw_start, raw_end],
        'original_speed_output_region_seconds': [raw_start + offset, raw_end + offset],
        'buildup_tempo_ratio': pre_ratio,
        'decay_tempo_ratio': post_ratio,
        'crossfade_seconds': OVERLAP,
        'gain': gain,
        'peak_normalized': float(np.abs(encoded).max()),
        'opening_silence_peak': float(np.abs(encoded[:round(OPENING * RATE)]).max()),
        'ending_silence_peak': float(np.abs(encoded[round(END * RATE):]).max()),
        'unaltered_transient_max_abs_error_after_gain': event_error,
        'technical_result': 'PASS' if (
            len(encoded) == 480000 and event_error < 1e-6 and
            np.max(np.abs(encoded[:round(OPENING * RATE)])) == 0 and
            np.max(np.abs(encoded[round(END * RATE):])) == 0 and
            np.max(np.abs(encoded)) < 1
        ) else 'FAIL',
    }
    (output / 'audio-timing.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))
    if report['technical_result'] != 'PASS':
        raise SystemExit(1)


if __name__ == '__main__':
    main()
