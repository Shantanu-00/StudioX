"""Fetch the CC0 Freesound recordings used by original-audio v2 and verify them.

Every file is a Freesound high-quality preview of a sound whose own page states
Creative Commons 0 (checked 22 October 2026). Previews are used because original
downloads need a Freesound login; CC0 applies to the sound, not a file format.
"""
import argparse
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
DEFAULT = ROOT / 'docs/local/intro/original-audio-v2/sources'
CC0 = 'https://creativecommons.org/publicdomain/zero/1.0/'

# id, author, title, role in the cue, preview URL, SHA-256 of the fetched preview.
SOURCES = [
    (83517, 'Woodingp', 'Low Rumble New.2.aif', 'sub pressure bed',
     'https://cdn.freesound.org/previews/83/83517_596857-hq.ogg',
     '0118bbf473343de9779224c66230a86851824dde82de8aae9954c2c6cd76a5f8'),
    (637511, 'kyles', 'electric crackle buzz high tension powerline hydro dam.flac',
     'high static crackle', 'https://cdn.freesound.org/previews/637/637511_612689-hq.ogg',
     'e4311c7a2876a285073e2057d5a30077fe1c48198827af96efd40a71363075eb'),
    (349696, 'Mikes-MultiMedia', 'electric humming heavy.mp3', 'electrical mid texture',
     'https://cdn.freesound.org/previews/349/349696_5632532-hq.ogg',
     'f1f37ee2e814bcfac4e216bcd62f401fe3b0725681501f2a3e5d2d55f9582bea'),
    (638895, 'Developer_Jake', 'Fluorescent lightbulb hum buzz (Extended)',
     'suspended cold resonance', 'https://cdn.freesound.org/previews/638/638895_11418394-hq.ogg',
     '19305176780dccbe05ad29841805816bec86e9160a52aabbe7f3f8b470a72de5'),
    (638914, 'lennartgreen', 'Low Rumble - loopable ambiance', 'surge texture',
     'https://cdn.freesound.org/previews/638/638914_3661618-hq.ogg',
     '0fc324ba4b1ac2c1f43bab5e7293f6844b8844461f868b6f524655252d886c01'),
    (610933, 'unfa', 'Glass Screen Protector Breaking & Cracking', 'fracture snap',
     'https://cdn.freesound.org/previews/610/610933_1038806-hq.ogg',
     'fd755b2305f8b60dcb7041c0e590b33aee05e5d682b91252b7cbc442d1a9cba2'),
    (168712, 'karlis.stigis', 'Ice Cracks', 'fracture crackle spread',
     'https://cdn.freesound.org/previews/168/168712_853134-hq.ogg',
     '0aeb1f939c71584ae2c53f29570614513336540423113fc1913d439665324b79'),
    (806423, 'Sanderboah', 'Car windshield crack', 'fracture body',
     'https://cdn.freesound.org/previews/806/806423_13017680-hq.ogg',
     '2900da6ba9df738e7c54a6ea9fc6bc07446ceff466f1658807d899cbe2a6d977'),
    (379008, '13FPanska_Cerny_Jan', 'Crack_glass.wav', 'secondary crack',
     'https://cdn.freesound.org/previews/379/379008_7020756-hq.ogg',
     '61b6b26e629f98ad5cfb9746457ef8e41c2d58cb6b2a1acf6faf2a68e3d9ada8'),
    (593785, 'steaq', 'Ominous Rumble - loopable (24bit flac)', 'aftermath rumble',
     'https://cdn.freesound.org/previews/593/593785_1474204-hq.ogg',
     '9e861e12e3cd99342f0f74978c0033e161b9f76eddf7ab90814a31056f1d09b1'),
    (273805, 'BrainClaim', 'Bass Rumble In The Distance', 'near-silence room',
     'https://cdn.freesound.org/previews/273/273805_4875045-hq.ogg',
     '4e1ed1934fd0191c693470800899f858b6e61ee045e802f1e3123be72a5e51ac'),
]


def path_for(directory, sound_id):
    return directory / f'freesound-{sound_id}.ogg'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=DEFAULT)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    manifest = []
    for sound_id, author, title, role, url, digest in SOURCES:
        target = path_for(args.output, sound_id)
        if not target.exists() or hashlib.sha256(target.read_bytes()).hexdigest() != digest:
            request = urllib.request.Request(url, headers={'User-Agent': 'StudioX-intro-audio/2'})
            data = urllib.request.urlopen(request, timeout=120).read()
            if hashlib.sha256(data).hexdigest() != digest:
                raise SystemExit(f'Checksum mismatch for Freesound {sound_id}; source changed upstream.')
            target.write_bytes(data)
        manifest.append({
            'freesound_id': sound_id, 'author': author, 'title': title, 'role': role,
            'page': f'https://freesound.org/people/{author}/sounds/{sound_id}/',
            'license': 'CC0 1.0 Universal', 'license_url': CC0,
            'license_checked': '2026-10-22, on the sound page',
            'file': target.name, 'preview_url': url, 'sha256': digest,
        })
    (args.output / 'sources-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'{len(manifest)} CC0 sources verified in {args.output}')


if __name__ == '__main__':
    main()
