# Credits and third-party content

StudioX's code is MIT-licensed ([LICENSE](LICENSE)). The images and footage below belong to their
authors and keep their own licences. Those licences take precedence over the MIT licence for
these files.

## Images bundled in the app (`src/assets/map/`)

All of these come from Wikimedia Commons, through the `upload.wikimedia.org` thumbnail URLs listed
in [`src/map/images.ts`](src/map/images.ts). They were cropped and resized for the TV: a 4:3 scene
crop and a square face crop. The app shows each image's credit next to it.

| Files | Subject | Author | Licence |
| --- | --- | --- | --- |
| `ronaldo.jpg`, `ronaldo-face.jpg` | Cristiano Ronaldo (Croatia v Portugal) | Bryan Berlin | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Our crops are shared under the same licence |
| `armstrong.jpg`, `armstrong-face.jpg` | Neil Armstrong | NASA | Public domain |
| `aldrin.jpg`, `aldrin-face.jpg`, `aldrin-surface.jpg` | Buzz Aldrin, Apollo 11 | NASA | Public domain |
| `collins.jpg`, `collins-face.jpg` | Michael Collins (S69-31742, restoration) | NASA; restored by Coffeeandcrumbs | Public domain |
| `eagle.jpg` | Apollo 11 Lunar Module *Eagle* in lunar orbit | NASA | Public domain |
| `tranquility.jpg` | Lunar Module at Tranquility Base (AS11-40-5962) | NASA | Public domain |

The agents select images only when the Commons licence is CC0, public domain, CC BY or CC BY-SA
(`backend/agents/sxagents/search.py`). Each one is published with its credit.

## Demo episodes

- The demo video clips are stock interview footage from [Pexels](https://www.pexels.com) (including
  cottonbro studio), used under the [Pexels License](https://www.pexels.com/license/). They are
  streamed from our CloudFront distribution for playback only. They are not redistributed in this
  repository.
- The dialogue, show names, people (other than the public figures named above) and cases in the
  demo episodes are fictional, written for this demo. The *More maps* examples are transcripts
  written by StudioX and labelled as such in the app.
- Episode posters and backdrops (`src/assets/episodes/`) are frames from that footage.

## Software

The app is built on React Native for Vega and the `@amazon-devices/*` packages, under their own
licences. The other dependencies are listed in `package.json`, `backend/**/package.json` and
`backend/**/pyproject.toml`.
