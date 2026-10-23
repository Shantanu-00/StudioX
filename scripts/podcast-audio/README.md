# Voice audio for the two demo episodes

The demo clips (`crime-case104`, `science-ep42`) have an audio track that is digital silence
(measured 2026-10-23: `volumedetect` max −91.0 dB, `ebur128` −70.0 LUFS, peak −inf; AAC-LC 48 kHz
stereo at about 2.3 kb/s). These scripts give them a real voice track timed to the transcript
captions, and write new files next to the originals, which they never modify:

| Step | Script | Output |
| --- | --- | --- |
| 1. Lines | `lines.py` | `media/audio/<id>/lines.json` (id, speaker, voice, t0, t1, window, text, SSML) and `lines.md` (table for ElevenLabs) |
| 2. Speech | `polly.sh` (Amazon Polly) or ElevenLabs by hand | `media/audio/<id>/lines/01.mp3`, `02.mp3`, ... |
| 3. Assemble | `assemble.py` | `media/tv/<id>.voiced.mp4`, `media/tv/<id>.voiced.frag.mp4`, timing report in `media/audio/<id>/build/report.json` |

`media/` is git-ignored. The assembler copies the H.264 stream untouched (it checks the packet MD5
against the original) and re-creates the fragment layout of the existing TV files with the same
command that made them: `-c copy -movflags +frag_keyframe+empty_moov+default_base_moof` (ftyp, moov,
19 × moof+mdat with one video and one audio traf each, 2 s fragments on the 2 s GOP, mfra). The
voice track is AAC-LC 48 kHz stereo, so the TV's MSE check
`video/mp4; codecs="avc1.640029, mp4a.40.2"` is unchanged.

Every ffmpeg call takes `~/.cache/studiox-heavy.lock` and runs with `-threads 2`; do not also wrap
the scripts in `flock`.

## Voices

| Speaker | Amazon Polly (generative; neural fallback) | ElevenLabs suggestion | Why |
| --- | --- | --- | --- |
| Narrator (crime) | Stephen, en-US male | Brian or Bill | Low, measured US read for a true-crime voiceover set in a US city |
| Dr. Julian (science) | Brian, en-GB male | Daniel or George | Calm British expert; the accent separates him from the US host at a glance |
| Elena (science) | Ruth, en-US female | Sarah or Matilda | Conversational host for short interjections |

All three Polly voices exist in both the generative and neural engines (Polly docs, available voices,
checked 2026-10-23). Not auditioned: Polly could not be called from this workstation. Swap a voice
with `lines.py --voice "Narrator=Matthew"`. ElevenLabs names are premade-library suggestions; check
that they still exist in your library.

## Route A: Amazon Polly (preferred)

Needs an AWS profile allowed to call `polly:SynthesizeSpeech` (the `claude-code` IAM user is not).
`polly.sh` passes `--profile "$AWS_PROFILE"` explicitly: the AWS CLI prefers `AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY` in the environment over `AWS_PROFILE`, so a shell with those exported would
otherwise run as the wrong user.

```bash
python3 scripts/podcast-audio/lines.py                                   # both episodes
AWS_PROFILE=studiox AWS_REGION=us-east-1 scripts/podcast-audio/polly.sh  # 15 requests, ~1,100 characters
python3 scripts/podcast-audio/assemble.py                                # prints the timing report
```

Then listen to `media/tv/<id>.voiced.mp4`. To tune a line, re-run `lines.py` for that episode with a
speaking rate (Polly `<prosody rate>`; the generative engine applies it to whole sentences, which is
how the SSML is built) and re-synthesise:

```bash
python3 scripts/podcast-audio/lines.py science-ep42 --rate 10=120 --rate 3=115
AWS_PROFILE=studiox FORCE=1 scripts/podcast-audio/polly.sh science-ep42
python3 scripts/podcast-audio/assemble.py science-ep42
```

`ENGINE=neural` forces the neural engine; a line that fails with generative is retried with neural.

## Route B: ElevenLabs (or any other TTS)

1. `python3 scripts/podcast-audio/lines.py`
2. Open `media/audio/<id>/lines.md`. For each row, paste **Text to speak** into ElevenLabs with that
   speaker's voice, download, and save as the **Save as** name in `media/audio/<id>/lines/`
   (`01.mp3`, `02.mp3`, ...; `.wav`, `.m4a`, `.ogg`, `.flac` also work). The text already spells out
   times ("ten fourteen P M") and "R ninety", so the voice reads them as the captions intend.
3. `python3 scripts/podcast-audio/assemble.py`

Silence at the start and end of each file is trimmed, so the export settings do not matter.

## What the assembler does

- Each line starts at its caption time `t0` (plus `--offset`, default 0.05 s, at a speaker change) at
  natural speed.
- If it is too long it is sped up with `atempo`, at most `--max-tempo 1.25`. Inside one speaker turn
  a line may run into its neighbour's window when that neighbour starts no more than `--max-lag`
  (0.35 s) after its caption. The science episode's windows inside one paragraph were split by
  character count (`backend/scripts/make_transcripts.py`), so this sharing is closer to the real
  script timing. `--strict-windows` turns it off.
- Speech never runs into the next speaker's time. When a turn still overruns at 1.25×, the report
  prints `NEEDS SHORTER TEXT` with the overrun and roughly how many characters to cut, and the script
  exits with status 2. The files are still written so you can listen.
- 40 ms fades per line (`--fade`, 30 to 60), mixed and then two-pass `loudnorm` to −16 LUFS integrated
  with a −2 dBTP ceiling before AAC. The report re-measures the final files (they must stay below −1 dBTP).
- Muxes `<id>.voiced.mp4` (progressive, `+faststart`, same layout as `<id>.mp4`) and remuxes it to
  `<id>.voiced.frag.mp4`, then verifies: stream layout, durations, video MD5 equal to the original,
  loudness, and fragment structure compared box by box with `<id>.frag.mp4` (`match=True`).

Report columns: `window` caption time, `audio` trimmed natural length, `stretch` atempo factor,
`start`/`end` placement, `lag` start minus `t0`, `fill` placed length divided by window.
`[Polly rate N%?]` is an optional hint: re-synthesise faster instead of using atempo, or slower to
fill a long window (the crime episode's windows are generous).

Before any TTS run, `lines.py` prints a rough estimate (4.2 syllables per second, not measured) of
lines that cannot fit their own window even at 1.25×. For science-ep42 these are #1, #2, #3, #4, #10
and #11 (the crime episode has none). #3 and #4 share Dr. Julian's 5–11 s turn with #5, and #1 and #11
may still fit once real Polly lengths are known; the assembler's report is the authority.

## Put the voiced files on the CDN (owner-run; not done by the agent)

The TV loads `https://<cloudfront>/media/<id>.frag.mp4` (`src/config.ts`, `backend/CONTRACTS.md` §1).
The bucket and distribution come from the `StudioXCore` stack, the same way as in
`backend/scripts/upload_media.sh`. Note that `upload_media.sh` uploads every `media/tv/*.mp4`, so it would
also upload the `.voiced` files under their own names (harmless, but not what the TV plays).

```bash
export PATH="$HOME/.local/bin:$HOME/.local/aws-cli/v2/current/bin:$PATH"
P=studiox; R=us-east-1
BUCKET=$(aws cloudformation describe-stacks --profile $P --region $R --stack-name StudioXCore \
  --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue" --output text)
CFDOMAIN=$(aws cloudformation describe-stacks --profile $P --region $R --stack-name StudioXCore \
  --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDomain'].OutputValue" --output text)
DIST=$(aws cloudfront list-distributions --profile $P \
  --query "DistributionList.Items[?DomainName=='$CFDOMAIN'].Id | [0]" --output text)

for id in crime-case104 science-ep42; do
  # 1. keep the silent originals on S3
  aws s3 cp --profile $P "s3://$BUCKET/media/$id.frag.mp4" "s3://$BUCKET/media/$id.silent.frag.mp4"
  aws s3 cp --profile $P "s3://$BUCKET/media/$id.mp4"      "s3://$BUCKET/media/$id.silent.mp4"
  # 2. the voiced files under the keys the TV already plays
  aws s3 cp --profile $P "media/tv/$id.voiced.frag.mp4" "s3://$BUCKET/media/$id.frag.mp4" \
    --content-type video/mp4 --cache-control "public, max-age=86400"
  aws s3 cp --profile $P "media/tv/$id.voiced.mp4" "s3://$BUCKET/media/$id.mp4" \
    --content-type video/mp4 --cache-control "public, max-age=86400"
done
aws cloudfront create-invalidation --profile $P --distribution-id "$DIST" \
  --paths /media/crime-case104.frag.mp4 /media/crime-case104.mp4 /media/science-ep42.frag.mp4 /media/science-ep42.mp4
curl -sI "https://$CFDOMAIN/media/science-ep42.frag.mp4" | grep -i content-length   # equals the local voiced size
```

To keep the silent files live and only stage the voiced ones, upload to
`s3://$BUCKET/media/$id.voiced.frag.mp4` instead; the TV would then need its media URL changed in
`src/config.ts` / `src/data/episodes.ts`. To roll back, copy the `.silent` objects back and
invalidate again. The local companion server serves `media/tv/` too: to test locally, copy the voiced
file over a working copy, never over the original.

## Licence and terms

- **Amazon Polly:** "As between you and AWS, your Polly output belongs to you", and the Polly FAQ
  lists "no restrictions on storing and reusing generated speech" (aws.amazon.com/polly/faqs,
  read 2026-10-23). You need the rights to the input text; the scripts are our own. Generative
  voices may sound slightly different after model updates, so synthesise both episodes in one sitting.
- **ElevenLabs:** depends on the plan. As far as we know (not checked today), the free plan requires
  attribution and does not grant commercial use, while paid plans do. Check the plan's terms before
  publishing, and credit the voices if required.
- **Footage:** the video stream is unchanged Pexels footage; the note in `upload_media.sh` still
  applies (in-app playback only, not offered as a download).
