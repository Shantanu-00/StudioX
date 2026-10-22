"""StudioX: original ten-second procedural sound-design cue, revision one.

No audio is decoded or sampled. All material is generated from analytic
oscillators, deterministic noise, resonators, and a synthesized reflection IR.
Visual event times are the only inputs borrowed from the existing V5 edit.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
RATE = 48000
DURATION = 10
COUNT = RATE * DURATION
SEED = 7216403
RNG = np.random.default_rng(SEED)
TIME = np.arange(COUNT, dtype=np.float64) / RATE


def smooth(a, b, x):
    u = np.clip((x - a) / (b - a), 0, 1)
    return u * u * (3 - 2 * u)


def local_time(duration):
    return np.arange(round(duration * RATE), dtype=np.float64) / RATE


def noise(duration, low, high):
    """Smoothly band-limited noise, synthesized from seeded random samples."""
    n = round(duration * RATE)
    size = 1 << (n - 1).bit_length()
    bins = np.fft.rfftfreq(size, 1 / RATE)
    gain = smooth(low * .65, low, bins) * (1 - smooth(high, min(high * 1.3, 23000), bins))
    spectrum = np.fft.rfft(RNG.standard_normal(size)) * gain
    signal = np.fft.irfft(spectrum, n=size)[:n]
    return signal / max(np.sqrt(np.mean(signal * signal)), 1e-12)


def oscillator(t, frequency, phase=0):
    return np.sin(math.tau * frequency * t + phase)


def pan(signal, position):
    """Constant-power stereo, no phase-inverted widening."""
    angle = (np.clip(position, -1, 1) + 1) * math.pi / 4
    return np.stack((signal * np.cos(angle), signal * np.sin(angle)), axis=-1)


def add(track, signal, start, position=0):
    index = round(start * RATE)
    if signal.ndim == 1:
        signal = pan(signal, position)
    length = min(len(signal), COUNT - index)
    if index < 0 or length < 0:
        raise ValueError('Event outside score')
    track[index:index + length] += signal[:length]


def attack_release(t, duration, attack=.006, release=.03):
    return smooth(0, attack, t) * (1 - smooth(duration - release, duration, t))


def reflection_ir(duration=1.65):
    """A sparse, damped stereo room; no external impulse response."""
    size = round(duration * RATE)
    ir = np.zeros((size, 2), dtype=np.float64)
    for channel in range(2):
        # Irregular early reflections avoid an audible regular echo train.
        for delay, gain in [(0.023, .15), (.047, .11), (.079, .085), (.113, .065)]:
            delay += channel * .0031
            i = round(delay * RATE)
            ir[i:i + 3, channel] += np.array([.23, .54, .23]) * gain
        for delay in RNG.uniform(.14, duration, 180):
            i = round(delay * RATE)
            level = math.exp(-delay / .37) * .047 * RNG.uniform(.5, 1.3)
            width = 6 + round(delay * 12)
            if i + width >= size:
                continue
            # Darker later reflections: short smooth kernels absorb upper treble.
            kernel = np.hanning(width)
            kernel /= max(kernel.sum(), 1e-12)
            ir[i:i + width, channel] += kernel * level
    return ir


ROOM_IR = reflection_ir()


def room(signal, amount):
    count = len(signal) + len(ROOM_IR) - 1
    fft_size = 1 << (count - 1).bit_length()
    wet = np.empty_like(signal)
    for channel in range(2):
        wet[:, channel] = np.fft.irfft(
            np.fft.rfft(signal[:, channel], fft_size) *
            np.fft.rfft(ROOM_IR[:, channel], fft_size), fft_size)[:len(signal)]
    return signal + wet * amount


def synthesize():
    stems = {name: np.zeros((COUNT, 2), dtype=np.float64) for name in (
        '01-pressure-bed', '02-fragment-grains', '03-lock-and-tension',
        '04-fracture', '05-resonant-aftermath', '06-x-signature')}
    events = []

    # Warm upper bass carries weight on television speakers without relying on sub.
    t = TIME
    bed_env = smooth(.28, 1.25, t) * (1 - smooth(4.19, 4.30, t))
    swell = .64 + .36 * smooth(1.2, 3.9, t)
    a = oscillator(t, 82.4069 + .018) * .026
    a += oscillator(t, 164.8138, .3) * .043
    a += oscillator(t, 247.2207, 1.1) * .019
    a += oscillator(t, 329.6276, 2.4) * .009
    a += oscillator(t, 170.13, .6) * .010 * smooth(.9, 3.8, t)
    breath = .94 + .035 * np.sin(math.tau * .53 * t) + .025 * np.sin(math.tau * .79 * t + .8)
    stems['01-pressure-bed'] += pan(np.tanh(a * 1.4) / 1.4 * bed_env * swell * breath, 0)
    # Air is low enough to act as texture, not an audible blanket of hiss.
    air = noise(10, 420, 2100) * .0023 * bed_env * smooth(.5, 2.5, t)
    stems['01-pressure-bed'] += pan(air, -.14)
    events.append({'time': .28, 'duration': 4.02, 'layer': 'pressure-bed',
                   'description': 'Soft E-derived harmonic pressure with a detuned fifth-partial tension; mid-bass remains audible on TV.'})

    # Irregular high-frequency grains precede the word. They are tiny strokes of
    # sound rather than a pitched arpeggio, rendered at a fixed coherent density.
    starts = [.33, .47, .62, .73, .89, 1.01, 1.16, 1.24, 1.38, 1.51,
              1.59, 1.72, 1.84, 1.97, 2.08, 2.18, 2.28, 2.39, 2.50, 2.61, 2.72, 2.85]
    for i, start in enumerate(starts):
        progress = (start - .33) / (2.85 - .33)
        length = .030 + progress * .078
        u = local_time(length)
        pitch = 2450 - 1560 * progress + RNG.uniform(-240, 240)
        frequency = pitch * (1 - .11 * smooth(0, length, u))
        phase = math.tau * np.cumsum(frequency) / RATE
        # Mild phase modulation supplies a crystalline rather than sine-beep edge.
        crystal = np.sin(phase + .60 * np.sin(phase * 1.417))
        crystal *= np.exp(-u / (.010 + progress * .026))
        texture = noise(length, 1000, 6200) * np.exp(-u / .010) * .16
        grain = (crystal + texture) * attack_release(u, length, .002, .010)
        level = .012 + .010 * progress
        level *= .83 + .17 * math.sin(i * 1.92)
        add(stems['02-fragment-grains'], grain * level, start, float(RNG.uniform(-.58, .58)))
        events.append({'time': start, 'duration': length, 'layer': 'fragment-grains',
                       'description': 'Small local crystalline grain, converging in spectral register.'})

    # A short, low spectral seal when the final pieces lock; no triumphant logo chord.
    u = local_time(.72)
    seal = oscillator(u, 164.8138) * .042 + oscillator(u, 247.2207, .4) * .025
    seal += oscillator(u, 370.8303, 1.2) * .012
    seal *= np.exp(-u / .22) * attack_release(u, .72, .014, .13)
    add(stems['03-lock-and-tension'], seal, 2.99, 0)
    events.append({'time': 2.99, 'duration': .72, 'layer': 'lock-and-tension',
                   'description': 'Warm, brief 2:3:4.5 partial seal as the title completes.'})

    # Pressure grows with the visible tremor. Avoid a full-band riser or siren.
    u = local_time(.84)
    progress = smooth(0, .78, u)
    tension = oscillator(u, 329.63) * .019 + oscillator(u, 342.12, .4) * .013
    tension += oscillator(u, 659.26, .2) * .007
    friction = noise(.84, 850, 4100) * (.001 + .008 * progress**2)
    tremor = .78 + .22 * np.sin(math.tau * (7.2 * u + 1.0 * u * u))
    tension = (tension * tremor + friction) * progress**1.3
    tension *= 1 - smooth(.76, .84, u)
    add(stems['03-lock-and-tension'], tension, 3.45, 0)
    events.append({'time': 3.45, 'duration': .84, 'layer': 'lock-and-tension',
                   'description': 'Narrow spectral tension and accelerating tremor, withdrawn under the fracture transient.'})

    # Contact: physical attack consists of a dry body, fast noise stress release,
    # and inharmonic glass modes, rather than a sampled smash or cinematic gunshot.
    u = local_time(.34)
    body_phase = math.tau * (124 * u + (78 - 124) * .09 * (1 - np.exp(-u / .09)))
    body = np.sin(body_phase) * np.exp(-u / .065) * .18
    body += oscillator(u, 241, .6) * np.exp(-u / .027) * .075
    stress = noise(.34, 1700, 9700) * np.exp(-u / .013) * .070
    snap = (body + stress) * attack_release(u, .34, .0005, .08)
    add(stems['04-fracture'], snap, 4.25, .06)
    events.append({'time': 4.25, 'duration': .34, 'layer': 'fracture',
                   'description': 'Primary dry fracture: short stress-noise release and compact pitched body.'})

    # The brittle crack advances from right to left in the same 70ms as the plate.
    for start, position, level in [(4.258, .68, .045), (4.282, .15, .035), (4.313, -.62, .028)]:
        u = local_time(.23)
        signal = noise(.23, 2200, 11200) * np.exp(-u / .009)
        signal += oscillator(u, 3971) * np.exp(-u / .035) * .12
        signal *= attack_release(u, .23, .00035, .025) * level
        add(stems['04-fracture'], signal, start, position)
    modes = [(1187, .032, .72), (2711, .022, .48), (4633, .016, .30),
             (6839, .010, .19), (9131, .006, .12)]
    u = local_time(2.25)
    resonance = np.zeros_like(u)
    for frequency, level, decay in modes:
        resonance += oscillator(u, frequency, float(RNG.uniform(0, math.tau))) * level * np.exp(-u / decay)
    resonance *= attack_release(u, 2.25, .0012, .32)
    add(stems['05-resonant-aftermath'], resonance, 4.263, -.10)
    events.append({'time': 4.263, 'duration': 2.25, 'layer': 'resonant-aftermath',
                   'description': 'Inharmonic plate resonators; each high mode dies faster than the low modes.'})

    # Two quiet splinter contacts, not a shower of jangling particles.
    for start, f0, gain, position in [(4.49, 1837, .012, -.46), (4.79, 2503, .008, .42)]:
        u = local_time(.85)
        tiny = oscillator(u, f0) * np.exp(-u / .19)
        tiny += oscillator(u, f0 * 2.376, .4) * .3 * np.exp(-u / .07)
        tiny *= attack_release(u, .85, .0015, .08) * gain
        add(stems['05-resonant-aftermath'], tiny, start, position)

    # Release the pre-crack dissonance into a darker consonant support; the sound
    # becomes still alongside the broken word instead of adding more spectacle.
    u = local_time(4.9)
    release = oscillator(u, 82.4069, .7) * .027
    release += oscillator(u, 164.8138, .2) * .035
    release += oscillator(u, 247.2207, .9) * .016
    release += oscillator(u, 329.6276, 1.1) * .006
    release *= smooth(0, .11, u) * np.exp(-u / 1.5) * (1 - smooth(3.7, 4.9, u))
    add(stems['05-resonant-aftermath'], release, 4.34, 0)

    # An understated two-partial X memory rises only after the main title fades.
    # This interval is a new score decision, not a reconstruction of a reference.
    u = local_time(1.78)
    memory = oscillator(u, 370.8303, .3) * .012
    memory += oscillator(u, 494.4413, .9) * .008
    memory += oscillator(u, 741.6606, 2.2) * .003
    memory *= smooth(0, .18, u) * np.exp(-u / .62) * (1 - smooth(1.2, 1.78, u))
    add(stems['06-x-signature'], memory, 7.78, -.08)
    events.append({'time': 7.78, 'duration': 1.78, 'layer': 'x-signature',
                   'description': 'Quiet 3:4 spectral memory for the lingering crimson X; no final stinger.'})

    wetness = {'01-pressure-bed': .3, '02-fragment-grains': 1.5,
               '03-lock-and-tension': .6, '04-fracture': .6,
               '05-resonant-aftermath': 1.7, '06-x-signature': 1.7}
    ending = 1 - smooth(9.38, 9.75, TIME)
    opening = smooth(.28, .295, TIME)
    final_envelope = opening * ending
    for name, signal in stems.items():
        signal = room(signal, wetness[name]) * final_envelope[:, None]
        signal[:round(.28 * RATE)] = 0
        signal[round(9.75 * RATE):] = 0
        stems[name] = signal
    mix = sum(stems.values())
    gain = .58 / max(float(np.abs(mix).max()), 1e-12)
    for name in stems:
        stems[name] *= gain
    return stems, sum(stems.values()), events, gain


def write_audio(path, samples):
    subprocess.run([
        'ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(RATE),
        '-ac', '2', '-i', '-', '-c:a', 'pcm_s24le', str(path),
    ], input=np.asarray(samples, dtype='<f4').tobytes(), check=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT / 'docs/local/intro/original-audio-v1')
    args = parser.parse_args()
    out = args.output.resolve()
    if out in [ROOT / 'docs/local/intro' / name for name in ('render', 'v2', 'v3', 'v4', 'v5')]:
        raise ValueError('Use a separate sound-design revision directory.')
    out.mkdir(parents=True, exist_ok=True)
    (out / 'stems').mkdir(exist_ok=True)
    stems, mix, events, gain = synthesize()
    write_audio(out / 'studiox-original-master-draft.wav', mix)
    for name, samples in stems.items():
        write_audio(out / 'stems' / f'{name}.wav', samples)
    stereo_correlation = float(np.corrcoef(mix[:, 0], mix[:, 1])[0, 1])
    mono = mix.mean(axis=1)
    report = {
        'title': 'StudioX — Fracture / original cue v1',
        'duration_seconds': DURATION,
        'sample_rate': RATE,
        'channels': 2,
        'bit_depth': 24,
        'random_seed': SEED,
        'render_source_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'external_audio_inputs': [],
        'source_statement': 'Every sample is synthesized from analytic oscillators, deterministic noise and a synthetic reflection impulse response. No third-party recording, loop, sample library, melody transcription, or generative-music service was used.',
        'methods': ['additive harmonic synthesis', 'phase-modulated micrograins',
                    'smooth FFT band-limited noise', 'inharmonic damped plate modes',
                    'constant-power panning', 'synthesized stereo room reflections'],
        'visual_timing_source': 'V5 ten-second StudioX animation event times, supplied by the parent task; no reference audio analyzed.',
        'design': 'Dark restraint, mid-bass presence for TV, a compact glass impact, and a quiet original 3:4 spectral X memory.',
        'events': events,
        'master_gain': gain,
        'sample_peak': float(np.abs(mix).max()),
        'rms_dbfs': float(20 * np.log10(np.sqrt(np.mean(mix * mix)))),
        'stereo_correlation': stereo_correlation,
        'mono_peak': float(np.abs(mono).max()),
        'opening_silence_peak': float(np.abs(mix[:round(.28 * RATE)]).max()),
        'ending_silence_peak': float(np.abs(mix[round(9.75 * RATE):]).max()),
        'delivery_status': 'Draft mix before parent loudness/true-peak review and final mux.',
        'quality_limit': 'Generated and measured; subjective auditory quality and physical-TV playback have not been evaluated by this script.',
        'rights_limit': 'This provenance records technical inputs and process; it does not constitute a legal clearance opinion or guarantee exclusive copyright in AI-assisted output.'
    }
    (out / 'score-and-provenance.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({key:report[key] for key in ('duration_seconds', 'sample_rate', 'sample_peak',
          'rms_dbfs', 'stereo_correlation', 'opening_silence_peak', 'ending_silence_peak')}, indent=2))


if __name__ == '__main__':
    main()
