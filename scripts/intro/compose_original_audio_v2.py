"""StudioX: ten-second title cue, revision two — CC0 recordings plus synthesis.

Revision one was entirely synthesized and its pitched grains, logo tone and
sine-mode glass read as toy-like. Here real recordings supply what synthesis
rendered unconvincingly: glass and ice fracture, electrical hum, static and low
rumble (CC0 Freesound sounds, fetched by fetch_cc0_sources_v2.py). Code supplies
the two bass surges, the sub thump, filtering, envelopes, panning and the mix.

Section times follow the V5 picture and the measured section contour of the V5
timing reference. The reference is only analysed (optional --fit and contour
report); none of its samples reach the output, and the tonal material differs
(D2 surge instead of ~89 Hz, a 120 Hz-series ballast buzz instead of ~1 kHz).
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
SOURCES = ROOT / 'docs/local/intro/original-audio-v2/sources'
REFERENCE = ROOT / 'docs/local/intro/v5/studiox-reference-soundtrack.wav'
RATE = 48000
COUNT = RATE * 10
TIME = np.arange(COUNT) / RATE
SEED = 2210
RNG = np.random.default_rng(SEED)
OPENING = .28
CUT = 9.25  # the cue is silent from here; the picture is black by 9.70 s
IMPACT = 4.25
LIMIT = .62

# Stem gains in dB, matched once to the reference band levels with --fit and
# then fixed, so the build does not depend on the reference being present.
GAINS = {
    '01-sub-bed': -32.87, '02-static': -37.08, '03-electric': -26.21, '04-surges': -12.87,
    '05-suspended-buzz': -30.44, '06-fracture': 2.39, '07-aftermath': -28.32,
    '08-residue': -46.09,
}
BANDS = [(20, 60), (60, 150), (150, 400), (400, 1200), (1200, 4000), (4000, 12000)]


def smooth(a, b, x):
    u = np.clip((x - a) / (b - a), 0, 1)
    return u * u * (3 - 2 * u)


def local_time(duration):
    return np.arange(round(duration * RATE)) / RATE


def load(sound_id, start, duration):
    """Stereo float64 excerpt of a verified source, with 4 ms edge fades."""
    raw = subprocess.check_output([
        'ffmpeg', '-v', 'error', '-ss', f'{start:.4f}', '-t', f'{duration + .05:.4f}',
        '-i', str(SOURCES / f'freesound-{sound_id}.ogg'), '-ar', str(RATE), '-ac', '2',
        '-f', 'f32le', '-'])
    x = np.frombuffer(raw, dtype='<f4').reshape(-1, 2).astype(np.float64)
    n = round(duration * RATE)
    x = np.pad(x[:n], ((0, max(0, n - len(x))), (0, 0)))
    fade = smooth(0, .004, local_time(.004))[:, None]
    x[:len(fade)] *= fade
    x[-len(fade):] *= fade[::-1]
    return x


def band(x, low=None, high=None):
    """Zero-phase FFT band-pass with smooth half-octave skirts."""
    size = 1 << (len(x) + RATE // 2 - 1).bit_length()
    f = np.fft.rfftfreq(size, 1 / RATE)
    gain = np.ones_like(f)
    if low:
        gain *= smooth(low / 1.41, low, f)
    if high:
        gain *= 1 - smooth(high, high * 1.41, f)
    spectrum = np.fft.rfft(x, size, axis=0) * gain[:, None]
    return np.fft.irfft(spectrum, size, axis=0)[:len(x)]


def curve(points, t=TIME):
    """Gain from (time, dB) breakpoints; -120 dB is treated as silence."""
    times, levels = zip(*points)
    gain = 10 ** (np.interp(t, times, levels) / 20)
    return np.where(gain < 1e-5, 0, gain)


def saturate(x, drive):
    return np.tanh(x * drive) / drive


def normalise(x):
    return x / max(float(np.sqrt(np.mean(x[np.abs(x).max(1) > 0] ** 2))), 1e-12)


def pan(mono, position):
    angle = (np.clip(position, -1, 1) + 1) * math.pi / 4
    return np.stack((mono * np.cos(angle), mono * np.sin(angle)), axis=-1)


def place(stem, signal, start):
    i = round(start * RATE)
    n = min(len(signal), COUNT - i)
    stem[i:i + n] += signal[:n]


def decorrelated(sound_id, start, duration, offset):
    """Wide stereo from two different moments of a mono recording."""
    left = load(sound_id, start, duration).mean(1)
    right = load(sound_id, start + offset, duration).mean(1)
    return np.stack((left, right), axis=-1)


def surge(duration, f0, cutoff_from, cutoff_to, bend=0.0):
    """Two detuned band-limited saws plus a sub octave, opening a resonant-free lowpass."""
    t = local_time(duration)
    progress = smooth(0, duration, t)
    cutoff = cutoff_from * (cutoff_to / cutoff_from) ** progress
    drift = 1 + .0025 * np.sin(math.tau * .41 * t) + bend * progress ** 2
    out = np.zeros_like(t)
    for detune, level in ((1.0, 1.0), (1.0063, .8)):
        phase = math.tau * np.cumsum(f0 * detune * drift) / RATE
        k = 1
        while k * f0 < 5000:
            amp = level / k / np.sqrt(1 + (k * f0 / cutoff) ** 4)
            out += amp * np.sin(k * phase + RNG.uniform(0, math.tau))
            k += 1
        out += .1 * level * np.sin(phase / 2)
    return out / np.abs(out).max()


def thump(duration=.3):
    """Sub body for the fracture: a fast 72 → 38 Hz drop."""
    t = local_time(duration)
    frequency = 38 + 34 * np.exp(-t / .05)
    body = np.sin(math.tau * np.cumsum(frequency) / RATE)
    return saturate(body * smooth(0, .002, t) * np.exp(-t / .04), 1.6)


def compose():
    stems = {name: np.zeros((COUNT, 2)) for name in GAINS}
    events = []

    def note(start, end, stem, description):
        events.append({'start': start, 'end': end, 'stem': stem, 'description': description})

    # Sub pressure from black, held until it is pulled away just before impact.
    bed = normalise(load(83517, 20.0, 4.4))
    harmonics = band(saturate(band(bed, None, 160) * 6, 2.2), 90, 700)
    bed = bed + .22 * normalise(harmonics)
    place(stems['01-sub-bed'], bed, OPENING)
    stems['01-sub-bed'] *= curve([(OPENING, -120), (OPENING + .008, -1.5), (1.7, -2), (2.7, -1), (2.82, -5),
                                  (3.4, -4), (4.1, -1), (4.19, 0), (4.225, -120),
                                  (4.25, -120), (4.252, -4), (4.40, -9), (4.55, -15), (4.6, -20),
                                  (4.625, -120)])[:, None]
    note(OPENING, 4.625, '01-sub-bed', 'Recorded low rumble with saturated upper harmonics for TV speakers; pulled out 4.19-4.25 s, returns briefly under the fracture.')

    # Static arrives with the first fragments; widens slightly, gone with the hold.
    static = band(decorrelated(637511, 4.0, 2.6, 3.7), 1500, 14000)
    place(stems['02-static'], normalise(static), .62)
    stems['02-static'] *= curve([(.62, -120), (.70, -4), (1.0, -8), (2.2, -5), (2.75, -3),
                                 (3.0, -120)])[:, None]
    note(.62, 3.0, '02-static', 'High-voltage powerline crackle, two decorrelated takes.')

    # Electrical hum texture grows as the word assembles, cut with the first surge.
    electric = band(saturate(decorrelated(349696, 3.0, 2.0, 5.3) * 3, 1.5), 160, 1600)
    place(stems['03-electric'], normalise(electric), .86)
    stems['03-electric'] *= curve([(.86, -120), (.95, -6), (1.7, -2), (2.5, 0), (2.76, 0),
                                   (2.79, -120)])[:, None]
    note(.86, 2.79, '03-electric', 'Heavy electrical hum, saturated and band-limited.')

    # Two bass surges (synthesized) with recorded rumble riding inside them.
    texture = band(load(638914, 12.0, 4.0), 70, 240)
    first = surge(1.07, 73.42, 220, 900)
    rough = 1 - .22 * smooth(0, .2, local_time(1.07)) * (1 - smooth(.2, .5, local_time(1.07))) * (
        .5 + .5 * np.sin(math.tau * 7.1 * local_time(1.07)))
    place(stems['04-surges'], pan(saturate(first * rough * 1.8, 1.3), 0), 1.68)
    u = local_time(.87)
    second = surge(.87, 73.42, 160, 1300, bend=.018)
    rate = 6 + 9 * smooth(0, .85, u)
    tremor = 1 - (.06 + .30 * smooth(.1, .8, u)) * (.5 + .5 * np.sin(math.tau * np.cumsum(rate) / RATE))
    place(stems['04-surges'], pan(saturate(second * tremor * 2.2, 1.5), 0), 3.35)
    place(stems['04-surges'], .4 * normalise(texture), 1.70)
    stems['04-surges'] *= curve([(1.70, -120), (1.74, -8), (1.95, -3), (2.2, -1), (2.74, 0),
                                 (2.785, -120), (3.35, -120), (3.4, -12), (3.75, -4), (4.05, -1),
                                 (4.19, 0), (4.225, -120)])[:, None]
    note(1.72, 2.785, '04-surges', 'First surge: D2 saws opening 220→900 Hz, roughness fading; hard stop.')
    note(3.35, 4.225, '04-surges', 'Second surge: rising bend, accelerating tremor with the screen shake.')

    # Cold suspended ballast buzz held over the readable title.
    buzz = band(load(638895, 6.0, 1.6), 560, 1000)
    place(stems['05-suspended-buzz'], normalise(buzz), 2.70)
    stems['05-suspended-buzz'] *= curve([(2.70, -120), (2.80, -1), (4.1, 0), (4.19, 0),
                                         (4.225, -120)])[:, None]
    note(2.70, 4.225, '05-suspended-buzz', 'Fluorescent ballast harmonics (120 Hz series) 0.56-1.0 kHz.')

    # Fracture. A tiny stress tick, then snap + body + right-to-left crackle.
    fracture = stems['06-fracture']
    tick = load(610933, 43.0669, .12).mean(1)
    place(fracture, pan(tick, .6) * .07, 4.198)
    snap = band(load(610933, 59.8273, .42), 300).mean(1)
    place(fracture, pan(snap, .35) * 1.8, IMPACT - .002)
    body = band(load(806423, 0.0, .38), None, 500).mean(1)
    place(fracture, pan(body / max(np.abs(body).max(), 1e-12), 0) * .12, IMPACT - .0027)
    place(fracture, pan(thump(), 0) * .09, IMPACT)
    crackle = band(load(168712, 8.8583, .40), None, 9000).mean(1)
    u = local_time(.40)
    sweep = .7 - 1.4 * smooth(.003, .075, u) + .45 * smooth(.12, .3, u)
    place(fracture, pan(crackle / np.abs(crackle).max(), sweep) * .35, IMPACT + .006)
    # The densest brittle spread bursts at ~4.39 s, after the line has crossed,
    # and collapses within ~50 ms into a fine crackle that the gate ends.
    spread = band(load(168712, 69.4830, .30), None, 7000).mean(1)
    u = local_time(.30)
    spread *= smooth(0, .055, u) * (np.exp(-np.maximum(u - .06, 0) / .028) + .12)
    place(fracture, pan(spread / np.abs(spread).max(), -.2 + .5 * np.sin(math.tau * 2.3 * u)) * 1.45, 4.36)
    second_crack = load(379008, 4.0858, .33).mean(1)
    place(fracture, pan(second_crack / np.abs(second_crack).max(), -.45) * .4, IMPACT + .036)
    fracture *= (1 - smooth(4.555, 4.625, TIME))[:, None]
    note(4.198, 4.25, '06-fracture', 'Pre-failure stress tick from the screen-protector recording.')
    note(IMPACT, 4.625, '06-fracture', 'Screen-protector snap (high-passed 300 Hz, soft-limited), light windshield body and 72→38 Hz thump, ice crackle sweeping right to left, second glass crack, brittle spread peaking ~4.39 s; gated.')

    # Hollow gap, then a slow low aftermath swell that recedes into silence.
    after = band(load(638914, 30.0, 4.6), 22, 110)
    after = after + .12 * band(saturate(after * 5, 2), 100, 600)
    after = normalise(after) + .08 * normalise(band(load(273805, 40.0, 4.6), 30, 300))
    muffled = band(decorrelated(349696, 9.0, 4.6, 2.1), 120, 600)
    after = after + .06 * normalise(muffled)
    place(stems['07-aftermath'], after, 4.66)
    aftermath_envelope = curve([(4.66, -120), (4.70, -50), (5.0, -30), (5.4, -16), (6.0, -13),
                                    (6.4, -7), (6.94, -4), (7.3, -4), (7.5, 0), (7.6, -3),
                                    (7.7, -11), (8.0, -9), (8.1, -7), (8.25, -14), (8.5, -22),
                                    (9.0, -25), (9.2, -28), (CUT, -120)])[:, None]
    stems['07-aftermath'] *= aftermath_envelope
    note(4.66, CUT, '07-aftermath', 'Recorded low rumble with harmonics, distant rumble and muffled hum; swell peaks 7.5 s.')

    # Faint high static residue keeps the aftermath from sounding like a dead line.
    residue = band(decorrelated(637511, 12.0, 4.6, 2.9), 1200, 4500)
    place(stems['08-residue'], normalise(residue), 4.66)
    stems['08-residue'] *= aftermath_envelope
    note(4.66, CUT, '08-residue', 'Very quiet powerline static following the aftermath envelope.')

    for name, stem in stems.items():
        stem[:round(OPENING * RATE)] = 0
        stem[round(CUT * RATE):] = 0
    return stems, events


def band_contour(x, hop=.05, window=4096):
    """dB power per band and frame (mono), the same measurement used on the reference."""
    mono = x.mean(1) if x.ndim == 2 else x
    w = np.hanning(window)
    f = np.fft.rfftfreq(window, 1 / RATE)
    masks = [(f >= a) & (f < b) for a, b in BANDS]
    frames = []
    for i in range(0, len(mono) - window, round(hop * RATE)):
        power = np.abs(np.fft.rfft(mono[i:i + window] * w)) ** 2
        frames.append([power[m].sum() for m in masks])
    return np.array(frames)


def decode(path):
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(path), '-ar', str(RATE),
                                   '-ac', '2', '-f', 'f32le', '-'])
    return np.frombuffer(raw, dtype='<f4').reshape(-1, 2).astype(np.float64)


# Where each stem dominates the reference: (start, end, band index).
ANCHORS = {
    '01-sub-bed': (.30, 1.6, 0), '02-static': (.70, .90, 5), '03-electric': (1.1, 1.7, 3),
    '04-surges': (2.2, 2.72, 1), '05-suspended-buzz': (2.85, 3.3, 3),
    '06-fracture': (4.22, 4.31, 4), '07-aftermath': (6.0, 7.6, 0),
    '08-residue': (6.6, 7.3, 4),
}


def fit_gains(stems):
    """Per-stem level matching the reference band power at each stem's anchor."""
    reference = 10 * np.log10(band_contour(decode(REFERENCE)) + 1e-9)
    times = (np.arange(len(reference)) * .05 * RATE + 2048) / RATE
    gains = {}
    for name, (start, end, index) in ANCHORS.items():
        ours = 10 * np.log10(band_contour(stems[name]) + 1e-9)
        frames = (times >= start) & (times <= end)
        gains[name] = round(float(np.median(reference[frames, index] - ours[frames, index])), 2)
    return gains


def write(path, samples):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(RATE), '-ac', '2',
                    '-i', '-', '-c:a', 'pcm_s24le', str(path)],
                   input=np.asarray(samples, dtype='<f4').tobytes(), check=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT / 'docs/local/intro/original-audio-v2')
    parser.add_argument('--fit', action='store_true', help='Print stem gains fitted to the reference contour')
    args = parser.parse_args()
    stems, events = compose()
    if args.fit:
        print(json.dumps(fit_gains(stems), indent=2))
        return
    out = args.output.resolve()
    (out / 'stems').mkdir(parents=True, exist_ok=True)
    for name in stems:
        stems[name] *= 10 ** (GAINS[name] / 20)
    # Soft ceiling on the fracture only: shaves the ~1 ms snap spike, leaves the crackle.
    stems['06-fracture'] = saturate(stems['06-fracture'] / LIMIT, 1) * LIMIT
    mix = sum(stems.values())
    write(out / 'studiox-original-v2-draft.wav', mix)
    for name, stem in stems.items():
        write(out / 'stems' / f'{name}.wav', stem)
    manifest = json.loads((SOURCES / 'sources-manifest.json').read_text())
    report = {
        'title': 'StudioX — Fracture / original cue v2',
        'render_source_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'random_seed': SEED,
        'stem_gains_db': GAINS,
        'external_audio_inputs': [{key: s[key] for key in ('freesound_id', 'author', 'title', 'role',
                                                            'page', 'license', 'sha256')} for s in manifest],
        'reference_use': 'V5 timing reference analysed for section times and band contour only; no reference samples are mixed.',
        'events': events,
        'sample_peak': float(np.abs(mix).max()),
    }
    if REFERENCE.exists():
        ours = 10 * np.log10(band_contour(mix) + 1e-9)
        ref = 10 * np.log10(band_contour(decode(REFERENCE)) + 1e-9)
        active = ref.max(1) > ref.max() - 50
        report['contour_vs_reference_db'] = {
            f'{a}-{b}Hz': round(float(np.median(np.abs(ours[active, i] - ref[active, i]))), 2)
            for i, (a, b) in enumerate(BANDS)}
    (out / 'score-and-provenance.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: report[k] for k in ('sample_peak', 'stem_gains_db')}, indent=2))
    print(json.dumps(report.get('contour_vs_reference_db'), indent=2))


if __name__ == '__main__':
    main()
