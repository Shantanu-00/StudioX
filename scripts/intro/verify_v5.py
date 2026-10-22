"""Verify the ten-second v5 encode and inspect its revised motion windows."""
import argparse
import json
import subprocess
from pathlib import Path

import numpy as np


def command(*args):
    return subprocess.check_output(args)


def longest_run(values):
    best = run = 0
    for value in values:
        run = run + 1 if value else 0
        best = max(best, run)
    return best


def video_metrics(path, fps):
    width, height = 480, 270
    size = width * height * 3
    process = subprocess.Popen([
        'ffmpeg', '-v', 'error', '-i', str(path), '-an',
        '-vf', f'scale={width}:{height}', '-f', 'rawvideo',
        '-pix_fmt', 'rgb24', '-',
    ], stdout=subprocess.PIPE)
    changes, luminance, black_maxima = [], [], {}
    previous = None
    index = 0
    requested = {round(t * fps): str(t) for t in (0, .2, 9.85)}
    while True:
        chunk = process.stdout.read(size)
        if not chunk:
            break
        if len(chunk) != size:
            raise RuntimeError('Partial raw frame from FFmpeg')
        image = np.frombuffer(chunk, np.uint8).reshape(height, width, 3)
        signed = image.astype(np.int16)
        if previous is not None:
            changes.append(float(np.abs(signed - previous).mean()))
        luminance.append(float(image.mean()))
        if index in requested:
            black_maxima[requested[index]] = int(image.max())
        previous = signed
        index += 1
    process.stdout.close()
    if process.wait() != 0:
        raise RuntimeError('FFmpeg could not decode the video')

    windows = []
    for start, end in ((.3, 1.1), (1.1, 2.35), (2.35, 3.05),
                       (3.45, 4.24), (4.24, 4.6), (7.3, 9.65)):
        # Change j compares frame j to j+1.
        section = np.asarray(changes[int(start * fps):int(end * fps)])
        still = section < .001
        windows.append({
            'seconds': [start, end],
            'frame_pairs': len(section),
            'near_static_pairs': int(still.sum()),
            'near_static_fraction': round(float(still.mean()), 4),
            'longest_near_static_run_seconds': round(longest_run(still) / fps, 4),
            'mean_rgb_change_8bit': round(float(section.mean()), 6),
            'maximum_rgb_change_8bit': round(float(section.max()), 6),
        })
    fade = np.asarray(luminance[int(7.3 * fps):int(9.65 * fps)])
    differences = np.diff(fade)
    return {
        'decoded_frames': index,
        'black_frame_max_rgb': black_maxima,
        'motion_windows': windows,
        'fade_mean_rgb': {
            str(t): round(luminance[round(t * fps)], 6)
            for t in (7.3, 7.8, 8.3, 8.8, 9.3, 9.65)
        },
        'largest_fade_brightening_8bit': round(float(max(0, differences.max())), 6),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('video', type=Path)
    parser.add_argument('--compare-v4', type=Path)
    args = parser.parse_args()
    metadata = json.loads(command(
        'ffprobe', '-v', 'error', '-show_streams', '-show_format',
        '-of', 'json', str(args.video),
    ))
    video = next(s for s in metadata['streams'] if s['codec_type'] == 'video')
    audio = next(s for s in metadata['streams'] if s['codec_type'] == 'audio')
    numerator, denominator = map(int, video['avg_frame_rate'].split('/'))
    fps = numerator / denominator
    errors = []
    if (video['width'], video['height']) != (1920, 1080):
        errors.append('Expected 1920×1080')
    if fps != 60:
        errors.append('Expected 60fps')
    if abs(float(metadata['format']['duration']) - 10) > .02:
        errors.append('Expected ten-second container')
    if (int(audio['sample_rate']), audio['channels']) != (48000, 2):
        errors.append('Expected 48kHz stereo')

    timestamps = json.loads(command(
        'ffprobe', '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json',
        str(args.video),
    ))['frames']
    times = np.asarray([float(f['best_effort_timestamp_time']) for f in timestamps])
    maximum_interval_error = float(np.abs(np.diff(times) - 1 / 60).max())
    if len(times) != 600 or maximum_interval_error > .00001:
        errors.append('Expected 600 evenly spaced presentation timestamps')

    metrics = video_metrics(args.video, fps)
    if metrics['decoded_frames'] != 600:
        errors.append('Expected 600 decoded frames')
    if any(value > 2 for value in metrics['black_frame_max_rgb'].values()):
        errors.append('Opening/end black frames exceed RGB 2')
    pcm = np.frombuffer(command(
        'ffmpeg', '-v', 'error', '-i', str(args.video), '-vn',
        '-ar', '48000', '-ac', '2', '-f', 's16le', '-',
    ), dtype=np.int16).astype(np.int32)
    peak = int(np.abs(pcm).max())
    opening_peak = int(np.abs(pcm[:int(.25 * 48000 * 2)]).max())
    if peak >= 32767:
        errors.append('Audio reaches the PCM clipping limit')
    if opening_peak > 2:
        errors.append('Audio is not silent for the first quarter-second')
    result = {
        'file': str(args.video.resolve()),
        'technical_result': 'FAIL' if errors else 'PASS',
        'errors': errors,
        'fps': fps,
        'maximum_frame_interval_error_seconds': maximum_interval_error,
        'audio_peak_16bit': peak,
        'audio_opening_peak_16bit': opening_peak,
        **metrics,
        'limits': (
            'Motion statistics measure still holds and temporal changes. They do not '
            'prove natural motion, realistic glass, visual approval or Vega compatibility.'
        ),
    }
    if args.compare_v4:
        result['v4_motion_comparison'] = video_metrics(args.compare_v4, 60)
    audio_report = args.video.parent / 'audio-timing.json'
    if audio_report.exists():
        result['audio_retiming'] = json.loads(audio_report.read_text())
    print(json.dumps(result, indent=2))
    raise SystemExit(1 if errors else 0)


if __name__ == '__main__':
    main()
