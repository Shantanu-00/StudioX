# StudioX Link

**StudioX Link** is the second-screen phone companion web app for StudioX (AI co-viewer for podcasts on Fire TV).
The phone pairs once with the TV, then provides a private, real-time thread to ask questions about the current episode, transmit video files to the TV, and receive structured cards sent from the TV (checklists, people, lists, links, reminders).

Built in the **"Cold Signal"** design language: dark, austere, precision-engineered consumer technology from *Black Mirror*.

---

## Running Locally in Mock Mode

No node build step or npm installation required. Run directly with Python's HTTP server:

```bash
cd webapp   # from the repository root
python3 -m http.server 8000
```

Open in your browser:
**`http://localhost:8000/link/?mock=1`**

> **Note:** Whenever accessed on `localhost` or with `?mock=1`, the client automatically routes all `/v1/...` calls to the in-memory fake backend (`mock.js`), which persists state across tabs in `sessionStorage` and displays a `MOCK` chip in the header.

### Testing Flows in Mock Mode:
1. **Thread & Cards**: Opening the URL loads the seeded thread linked to `LIVING ROOM TV`, displaying:
   - System status: `LINK ESTABLISHED`
   - TV `share` checklist card ("Evening routine, as described") with persistent interactive checkboxes and `ADD REMINDER` button (.ics download)
   - TV `share` reminder card ("Morning light, 10 min") with `ADD TO CALENDAR` button (.ics download)
   - Q&A interaction with a `[0:05]` timestamp chip and external source link
   - Additional featured guest person card and biomarker list card
   - Top `NOW PLAYING` strip ticking with the episode time
2. **Asking a Question**:
   - Toggle composer to `ASK` mode (automatically active when playing).
   - Type a question (e.g., "What supplements were mentioned?") and tap Send (crimson button).
   - An `AI CO-VIEWER ▍` pending bubble appears.
   - After 1.5 seconds, the AI co-viewer responds with a quoted answer, an inline `[mm:ss]` timestamp chip, and source references.
3. **Uploading Video**:
   - Tap the `+` button in the composer to open the upload sheet.
   - Choose any video file (e.g. sample `.mp4`).
   - Tap `TRANSMIT TO TV`.
   - The thread displays live upload progress (`UPLOADING 64% · 210 / 330 MB`) with a thin progress bar and `CANCEL` option.
   - Upon completion, the status line transitions sequentially in place: `PROCESSING ▍` → `ANALYSING 1/3` → `ANALYSING 3/3` → `READY TO WATCH`.
4. **Unlinking & Pairing**:
   - Tap the gear icon in the header → tap `UNLINK THIS PHONE`.
   - The app transitions to the `NOT LINKED` home screen.
   - Enter a 6-character code (e.g., `K7Q-4XZ`) or navigate directly to `/link/p/K7Q4XZ`.
   - Name the phone and tap `LINK` to establish pairing.
   - Test expired code handling with code `EXPIRE` and already-used handling with `USE409`.

---

## File Map

```
webapp/link/
├── index.html            # App shell, PWA meta tags, safe area, SW registration
├── style.css             # "Cold Signal" design tokens, mobile-first layout, 100dvh
├── app.js                # SPA history router, global state, UI renderer, polling
├── api.js                # Same-origin /v1/ API client with credentials & mock routing
├── upload.js             # Multipart upload manager (16 MiB parts, max 4 parallel, resume, wake lock)
├── voice.js              # Voice input state machine (Web Speech API) + spoken answers (speechSynthesis)
├── voice.test.mjs        # Node test for the voice state machine (fake recogniser): node voice.test.mjs
├── cards.js              # Safe DOM renderers for TV cards (textContent only) & .ics generator
├── mock.js               # sessionStorage-backed fake backend simulating all endpoints & events
├── sw.js                 # Service worker caching app shell (strictly never caching /v1/)
├── manifest.webmanifest  # PWA manifest (standalone, black background, icons)
├── icons/
│   ├── icon.svg          # Precision vector icon
│   ├── icon-192.png      # 192x192 PNG icon
│   └── icon-512.png      # 512x512 PNG icon
└── README.md             # This documentation
```

---

## API Contract Mapping (v1)

All calls target `/v1/...` with `credentials: 'same-origin'`.

| Route / Method | Function in `api.js` | Handled In | Notes |
| --- | --- | --- | --- |
| `POST /v1/pairings/{code}/redeem` | `api.redeemPairing(code, name)` | `app.js` (Pair Screen) | Sets HttpOnly cookie `sx`; returns `{linkId, tvName}` |
| `GET /v1/me` | `api.getMe()` | `app.js` (Router & Settings) | Returns `{linkId, phoneName, tvName}` or 401 |
| `DELETE /v1/me` | `api.deleteMe()` | `app.js` (Settings Modal) | 204; unlinks phone and returns to unpaired screen |
| `GET /v1/links/{id}/now` | `api.getNow(linkId)` | `app.js` (Polled every 5s) | Returns `{mediaId, title, t, playing}` |
| `GET /v1/links/{id}/messages?after=<cursor>` | `api.getMessages(linkId, after)` | `app.js` (Polled 2s/15s) | Returns `{messages, cursor}`, loops while 50 items return |
| `POST /v1/links/{id}/messages` | `api.postMessage(linkId, msg)` | `app.js` (Composer) | `{kind: "text" \| "question", text}` |
| `POST /v1/uploads` | `api.createUpload(...)` | `upload.js` | `{name, size, type}` → `{mediaId, partSize, parts}` |
| `POST /v1/uploads/{id}/parts` | `api.getUploadParts(...)` | `upload.js` | `{numbers:[...]}` → `{parts:[{n, url}]}` |
| `POST /v1/uploads/{id}/complete` | `api.completeUpload(...)` | `upload.js` | `{parts:[{n, etag}]}` → `{mediaId, status}` |
| `GET /v1/media/{id}` | `api.getMedia(mediaId)` | `api.js` | Retrieves processing status of uploaded media |

---

## Security & Reliability Guardrails

- **Zero HTML Injection (`textContent` only)**: All untrusted data from the TV, backend, and AI agents is rendered via `document.createElement` and `.textContent`. Never uses `innerHTML` with API content.
- **Strict URL Sanitization**: Links and portrait images only permit validated `https:` protocols.
- **Service Worker Caching**: Only caches static app shell assets. Requests matching `/v1/` bypass cache and are never stored in cache storage.
- **Screen Wake Lock & Leave Warnings**: The Screen Wake Lock API keeps the display active during multipart video uploads, and `beforeunload` prevents accidental tab closures.
- **Resumable Uploads**: Upload state is saved in `sessionStorage` per file fingerprint (`name` + `size`), resuming cleanly across page reloads.

---

## Needs Backend

The following capabilities are simulated cleanly in mock mode and await backend deployment:
1. **Dynamic S3 Presigned URL Slicing & CORS ETag Exposure**: Real multi-part uploads require S3 bucket CORS rules exposing `ETag` to the phone's origin.
2. **Step Functions & AgentCore Transcription Pipeline**: Background processing from `PROCESSING` to `READY TO WATCH` is simulated on the client in mock mode; the production system triggers AWS Step Functions.
3. **Live TV Co-Viewer Agent Inference**: Question responses in mock mode quote the user query and provide relevant references; in production, questions are routed to Amazon Bedrock AgentCore.

---

## Voice

- **Ask by voice**: mic button in the composer and an "ASK ABOUT THIS" button on the Now playing strip. Tap to start, tap to stop, auto-stops after 2.5 s of silence. The live transcript fills the field; the final result is sent as `{kind:'question', text}`. The mic is hidden if `SpeechRecognition`/`webkitSpeechRecognition` is missing or the page is not a secure context. Language is `navigator.language` (default `en-US`).
- **Read answers aloud**: Settings switch (localStorage `studiox.link.speakAnswers`). New `answer` messages from `ai` are spoken; `[mm:ss]` chips and URLs are stripped, sources are never read, new speech cancels old. History loaded on first poll is not spoken.
- **Mock mode**: with `?mock=1` or localhost and no real recogniser, a fake one types "What did they say about sleep" word by word. Add `&voice=denied` or `&voice=silent` to see those error states.
- **Tests**: `node webapp/link/voice.test.mjs` (also `node --check` on every `.js`).
- Map shares (`share` card with `{type:'list', items:[{name, detail}], sources}`) render through the existing `list` renderer; `reminder` cards already carry an ADD TO CALENDAR (.ics) button.

## Owner deploy

```bash
aws s3 sync webapp/link s3://studioxcore-bucket83908e77-arku6rk6ostx/link/ --delete
DIST=$(aws cloudfront list-distributions --query "DistributionList.Items[?DomainName=='d1874v8g2yry52.cloudfront.net'].Id | [0]" --output text)
aws cloudfront create-invalidation --distribution-id "$DIST" --paths '/link/*'
```

Or `npx cdk deploy StudioXCore` from `backend/infra` (BucketDeployment). The service worker cache is now `studiox-link-v2`, so existing phones pick up the new shell.
