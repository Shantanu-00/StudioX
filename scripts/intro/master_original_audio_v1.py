"""Master the original cue and attach it to the unchanged V5 picture stream."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs/local/intro/original-audio-v1'
GAIN_DB = 2.45


def run(*args):
    return subprocess.run(args, capture_output=True, check=True)


def pcm(path):
    raw = run('ffmpeg', '-v', 'error', '-i', str(path), '-vn', '-ar', '48000',
              '-ac', '2', '-f', 'f32le', '-').stdout
    return np.frombuffer(raw, dtype='<f4').reshape(-1, 2)


def loudness(path):
    result = run('ffmpeg', '-hide_banner', '-nostats', '-i', str(path),
                 '-af', 'loudnorm=I=-21.5:TP=-2:LRA=11:print_format=json',
                 '-f', 'null', '-')
    log = result.stderr.decode()
    report = json.loads(log[log.rfind('{'):log.rfind('}') + 1])
    # Only input_* fields measure this file. Filter output is discarded.
    return {key: float(report[key]) for key in ('input_i', 'input_tp', 'input_lra')}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--audio-only', action='store_true', help='Skip V5 movie muxing')
    args = parser.parse_args()
    draft = OUT / 'studiox-original-master-draft.wav'
    master = OUT / 'studiox-original-master.wav'
    preview = OUT / 'studiox-original-preview.mp3'
    picture = ROOT / 'docs/local/intro/v5/studiox-intro-v5-silent.mp4'
    movie = OUT / 'studiox-v5-original-audio.mp4'
    picture_hash = None if args.audio_only else hashlib.sha256(picture.read_bytes()).hexdigest()
    run('ffmpeg', '-v', 'error', '-y', '-i', str(draft), '-af',
        f'volume={GAIN_DB}dB', '-ar', '48000', '-c:a', 'pcm_s24le', str(master))
    run('ffmpeg', '-v', 'error', '-y', '-i', str(master), '-c:a',
        'libmp3lame', '-b:a', '256k', str(preview))
    if not args.audio_only:
        run('ffmpeg', '-v', 'error', '-y', '-i', str(picture), '-i', str(master),
            '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac',
            '-b:a', '256k', '-t', '10', '-movflags', '+faststart', str(movie))

    data = pcm(master)
    mono = data.mean(axis=1)
    levels = loudness(master)
    movie_levels = None if args.audio_only else loudness(movie)
    peak_frame = int(np.argmax(np.max(np.abs(data), axis=1)))
    original_packets = new_packets = None
    if not args.audio_only:
        original_packets = run('ffmpeg', '-v', 'error', '-i', str(picture),
                               '-map', '0:v:0', '-c:v', 'copy', '-f', 'hash', '-').stdout
        new_packets = run('ffmpeg', '-v', 'error', '-i', str(movie),
                          '-map', '0:v:0', '-c:v', 'copy', '-f', 'hash', '-').stdout
    report = {
        'master': str(master), 'movie': None if args.audio_only else str(movie),
        'gain_db': GAIN_DB,
        'mastering': 'Linear gain only; no dynamic normalization, time stretch or sample replacement.',
        'sample_rate': 48000, 'channels': 2, 'samples_per_channel': len(data),
        'duration_seconds': len(data) / 48000,
        'master_loudness_lufs': levels['input_i'],
        'master_true_peak_dbtp': levels['input_tp'],
        'encoded_movie_true_peak_dbtp': None if args.audio_only else movie_levels['input_tp'],
        'sample_peak_time_seconds': peak_frame / 48000,
        'stereo_correlation': float(np.corrcoef(data.T)[0, 1]),
        'mono_relative_rms_db': float(20 * np.log10(
            np.sqrt(np.mean(mono ** 2)) / np.sqrt(np.mean(data ** 2)))),
        'opening_silence_peak': float(np.abs(data[:13440]).max()),
        'ending_silence_peak': float(np.abs(data[468000:]).max()),
        'all_samples_finite': bool(np.isfinite(data).all()),
        'picture_packets_unchanged': None if args.audio_only else original_packets == new_packets,
        'source_picture_unchanged': None if args.audio_only else picture_hash == hashlib.sha256(picture.read_bytes()).hexdigest(),
        'visual_rights_status': 'Unresolved: existing V5 reference-derived artwork retained; this is an audio audition, not a whole-video rights clearance.',
        'auditory_review': 'Signal measurements and score review only; human listening and TV playback remain to be assessed.',
    }
    report['pass'] = all([
        len(data) == 480000, report['all_samples_finite'],
        levels['input_tp'] <= -2,
        report['opening_silence_peak'] == 0, report['ending_silence_peak'] == 0,
        4.25 <= report['sample_peak_time_seconds'] < 4.35,
    ])
    if not args.audio_only:
        report['pass'] &= all([movie_levels['input_tp'] < -1.5,
                              report['picture_packets_unchanged'], report['source_picture_unchanged']])
    report_name = 'audio-only-mastering.json' if args.audio_only else 'mastering-verification.json'
    (OUT / report_name).write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))
    if not report['pass']:
        raise SystemExit('Master verification failed')


if __name__ == '__main__':
    main()
