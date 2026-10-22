# Prompt: build the StudioX phone web app ("Link")

Paste everything below the line into the coding agent.

---

You are building **StudioX Link**, the phone companion web app for StudioX. StudioX is an AI
co-viewer for podcasts on Fire TV. The TV plays an episode and shows AI cards beside it: fact checks,
who is being talked about, protocols. The phone is a **second screen**. It pairs with the TV once,
then gives the viewer a private chat-style thread with their TV. In it they can **ask a question
about what's playing**, **upload a video** to the TV, and **receive cards the TV sends them** (a
protocol checklist, a list of names with sources, a reminder).

Work only inside `webapp/link/` in the repository `/home/xspace/StudioX`. Do not touch any other
folder. The API contract is in `docs/ARCHITECTURE.md` (section "API contract v1"); it is repeated
below. Follow it exactly.

## Hard constraints

- **Plain HTML, CSS and JavaScript (ES2022 modules). No framework, no npm packages, no build step.**
  The folder is uploaded as-is to S3 and served by CloudFront at `https://<domain>/link/`.
- Files: `index.html`, `app.js` (router + state), `api.js` (all network calls), `upload.js`
  (multipart upload), `cards.js` (card rendering + `.ics`), `mock.js` (fake backend),
  `style.css`, `manifest.webmanifest`, `sw.js`, `icons/` (SVG + 192/512 PNG generated from the
  SVG).
- **Single-page app with history routing:** `/link/` (home: thread or "not paired") and
  `/link/p/<CODE>` (pair). CloudFront already rewrites every `/link/...` path without a file
  extension to `/link/index.html`. Use **absolute asset paths** (`/link/style.css`).
- Same-origin API at `/v1/...`. Auth is an **HttpOnly cookie set by the server**: always send
  `credentials: 'same-origin'`. Never store tokens in JS or localStorage.
- **Mock mode:** with `?mock=1`, or when running on `localhost`, `api.js` routes every call to
  `mock.js`. The mock is an in-memory fake that simulates pairing, the thread, TV and AI replies
  after a delay, upload progress, and a "now playing" state. Persist it in `sessionStorage`. Every
  screen must be fully testable with `python3 -m http.server` from `webapp/` and opening
  `http://localhost:8000/link/?mock=1`. Show a small `MOCK` chip in the header in mock mode.
- Must work on iOS Safari 17+ and Android Chrome. Mobile-first, works one-handed, respects
  `env(safe-area-inset-*)`, uses `100dvh`, and handles the on-screen keyboard (the composer stays
  above it).
- Accessibility: semantic HTML, real buttons, labels on inputs, visible focus, `aria-live="polite"`
  on the thread for new messages, 44 px minimum touch targets, WCAG AA contrast.
- **Service worker:** cache only the app shell (html, css, js, icons) with a versioned cache name.
  **Never cache `/v1/` responses.**
- No analytics, no third-party fonts, no external requests except the same-origin API and S3
  presigned upload URLs.

## Design language: "Cold Signal"

This must look like a piece of quietly sinister consumer technology from *Black Mirror*, **not** a
generic AI app. No purple gradients, glowing orbs, sparkle icons, frosted glass, drop shadows or
rounded-everything.

- Colours:

  | Token | Value | Use |
  | --- | --- | --- |
  | void | `#000000` | Background |
  | glass | `#07080A` | Panels |
  | rule | `#23262B` | Hairlines |
  | bone | `#ECE9E2` | Primary text, your own bubbles |
  | ash | `#9A9DA3` | Secondary text |
  | smoke | `#5E6268` | Tertiary text |
  | **crimson** | `#E0182D` | The ONLY accent: the X in the wordmark, live/alert states, the send button when active, verdict stamps |
  | amber | `#E2A43B` | Warnings only |

- Type:
  - **Sans** (system UI stack) for content.
  - **Mono** (`ui-monospace, "SF Mono", "Roboto Mono", Menlo, monospace`) for system speech:
    status lines, timestamps, codes, labels. Mono labels are uppercase with wide tracking
    (`letter-spacing: .2–.3em`, 11–12 px).
- Wordmark: `STUDIO` in bone + `X` in crimson, heavy, letter-spaced, top left.
- Header status chip on the right, mono, with a 7 px square indicator: `NOT LINKED` (smoke),
  `LINKED TO <TV NAME>` (bone), `OFFLINE` (crimson).
- Square-ish shapes: radius 4–6 px at most; 1 px hairline borders.
- Motion is rare and short (150–220 ms opacity/transform). Use a blinking block cursor `▍` in
  status lines while waiting. Respect `prefers-reduced-motion`.
- Copy is short, declarative and slightly cold: `AWAITING TV`, `LINK ESTABLISHED`,
  `UPLOADING 64%`, `ANALYSING 3/17`, `READY TO WATCH`. Content text is plain and friendly.

## Screens and behaviour

### 1. Pair: `/link/p/<CODE>`

- Header tag `LINK // PAIR`. Headline "Link this phone to your TV." The code is shown large in
  mono (`K7Q-4XZ` style: 6 characters, shown as 3-3).
- Field: "Name this phone" (prefilled e.g. "My phone", max 30 characters). Button **LINK**.
- `POST /v1/pairings/{code}/redeem {phoneName}`.
  - **200:** a brief `LINK ESTABLISHED` state, then go to the thread.
  - **404/410:** "This code has expired. Show a new code on the TV." with a **Scan again** hint.
  - **409:** already used.
- If the user is already paired (`GET /v1/me` is 200), show "Already linked to <TV>" with
  **Open thread** and **Link to this TV instead**.

### 2. Home `/link/` when not paired

- A short explanation: "On your TV, open StudioX → LINK and scan the code."
- A manual code input (6 characters, auto-uppercase, ambiguous characters rejected) → goes to the
  pair screen.

### 3. Thread (home when paired). The main screen

- iMessage-style but in the Cold Signal look:
  - **Your messages** on the right: bone background, black text.
  - **TV**, **AI CO-VIEWER** and **SYSTEM** messages on the left: glass background, hairline
    border, a mono sender label above (`TV`, `AI CO-VIEWER`, `SYSTEM`).
  - Mono timestamps; group by day.
- A **Now playing** strip pinned under the header, from `GET /v1/links/{id}/now`, polled every 5 s:
  - mono `NOW PLAYING · <title> · 12:41`, with a live crimson square when `playing` is true;
  - hidden when nothing is playing.
- Polling `GET /v1/links/{id}/messages?after=<cursor>`:
  - every 2 s while the tab is visible, every 15 s when hidden, paused offline;
  - de-duplicate by `id`; never drop messages;
  - scroll to the newest only if the user is already at the bottom; otherwise show a `NEW ↓` pill.
- Message kinds:
  - `text`: plain bubble.
  - `question`: your bubble, with a mono `ASKED AT 12:41` line when `t` is present.
  - `answer` (from `ai`): left bubble labelled `AI CO-VIEWER`. Render `[mm:ss]` timestamps in the
    text as mono chips. Show sources, if present, as a compact list of links.
  - `status` (from `system`): a full-width mono system line, not a bubble:
    `UPLOADING 64%` with a thin progress bar, `PROCESSING ▍`, `ANALYSING 3/17`, `READY TO WATCH`,
    `FAILED: <reason>`. Update the same line in place for the same `mediaId`.
  - `share` (from `tv`): a **card** (§5).
- Pull-to-refresh is not needed. Show an inline `OFFLINE · RETRYING` line when requests fail, with
  backoff.

### 4. Composer, at the bottom

- A text field, autosizing up to 4 lines, max 2,000 characters.
- A toggle between **MESSAGE** and **ASK** (segmented, mono). ASK is the default when something is
  playing. In ASK mode:
  - the placeholder is "Ask about what's playing…";
  - send `{kind: "question", text}`;
  - show a pending left bubble `AI CO-VIEWER ▍` until the `answer` arrives (via polling), with a
    timeout state after 30 s: "No answer yet. It will appear here."
- Send button: crimson when there is text, otherwise smoke.
- A **+** button opens a small sheet with **Upload a video**. Never show unfinished or
  "coming soon" options.

### 5. Cards sent from the TV (`kind: "share"`, `card.type`)

- `checklist`: title + items with tick boxes. The state is stored in localStorage per message ID.
  Plus **Add reminder** if the card has times.
- `list`: title + rows (`name`, one-line `detail`), plus a `SOURCES` footer with links.
- `person`: portrait (if an image URL is given), name, role, up to 3 facts, plus the image credit
  line.
- `link`: title, domain and URL, opening in a new tab.
- `reminder`: title, time and repeat rule. The button **Add to calendar** generates and downloads an
  `.ics` file client-side (VEVENT; include an RRULE if `repeat` is given).
- Every card has a mono header `FROM TV · <time>` and a **Copy** action (plain-text version).

### 6. Upload a video (implements `POST /v1/uploads` → parts → complete)

1. Pick a file with `<input type="file" accept="video/*">`. Show the name and size; reject files
   over 4 GiB or of a non-video type.
2. `POST /v1/uploads {name, size, type}` returns `{mediaId, partSize, parts:[{n, url}]}`.
   `partSize` is 16 MiB; the part count is `ceil(size / partSize)`.
3. Upload parts with **up to 4 in parallel**, using `fetch(url, {method: 'PUT', body:
   file.slice(...)})` straight to S3. **No auth header and no cookies on these requests.**
   - Read the `ETag` response header (keep the quotes as returned).
   - Fetch more URLs with `POST /v1/uploads/{mediaId}/parts {numbers:[...]}` as needed.
   - Retry a failed part up to 3 times with backoff.
   - Presigned URLs expire after 1 hour, so ask for new ones on a 403.
4. Show progress: an upload row in the thread (`UPLOADING 64% · 210 / 330 MB`), plus a cancel
   button that aborts the `fetch`es and marks the upload cancelled.
5. When all parts are done, call `POST /v1/uploads/{mediaId}/complete {parts:[{n, etag}]}` with the
   parts sorted by `n`. The status line becomes `PROCESSING ▍`. Later status messages from the
   server take over the same line.
6. **Keep the screen awake while uploading** (Screen Wake Lock API, where available). Warn before
   leaving the page with `beforeunload` while an upload is in progress.
7. Resume: keep `{mediaId, done parts with ETags}` in sessionStorage. If the page reloads mid-upload
   and the user picks the same file (same name and size), continue from the remaining parts.

### 7. Settings (gear in the header)

- Shows this phone's name and the linked TV name.
- **Unlink this phone** → `DELETE /v1/me` → the not-paired home screen.
- An about line: `STUDIOX LINK · v0.1`.

## API contract v1 (same-origin, `/v1`)

Errors: `{"error":{"code","message"}}`. Status 401 → the not-paired home screen.

| Method & path | Request | Response |
| --- | --- | --- |
| `POST /v1/pairings/{code}/redeem` | `{phoneName}` | Sets the HttpOnly cookie; `{linkId, tvName}` |
| `GET /v1/me` | — | `{linkId, phoneName, tvName}`, or 401 |
| `DELETE /v1/me` | — | 204 |
| `GET /v1/links/{linkId}/messages?after=<id>` | — | `{messages: Message[], cursor}`, oldest first, ≤ 50 per call (loop while 50 come back) |
| `POST /v1/links/{linkId}/messages` | `{kind: "text" \| "question", text}` | `Message` |
| `GET /v1/links/{linkId}/now` | — | `{mediaId, title, t, playing, updatedAt}`, or `{}` |
| `POST /v1/uploads` | `{name, size, type}` | `{mediaId, partSize, parts:[{n, url}]}` |
| `POST /v1/uploads/{mediaId}/parts` | `{numbers:[n]}` | `{parts:[{n, url}]}` |
| `POST /v1/uploads/{mediaId}/complete` | `{parts:[{n, etag}]}` | `{mediaId, status: "PROCESSING"}` |
| `GET /v1/media/{mediaId}` | — | `{mediaId, title, status, progress?, playable, packageUrl?}` |

Media status: `UPLOADING` → `PROCESSING` → `ANALYSING` → `READY`, or `FAILED`.

```json
Message = {"id": "01J...", "at": "2026-10-22T10:15:02Z",
  "from": {"kind": "phone" | "tv" | "ai" | "system", "name": "Ari's phone"},
  "kind": "text" | "question" | "answer" | "share" | "status",
  "text": "…", "mediaId": "…", "t": 734.2,
  "card": {"type": "checklist" | "list" | "person" | "link" | "reminder", "title": "…", "items": [...], "sources": [{"title": "…", "url": "…"}]},
  "status": {"mediaId": "…", "state": "PROCESSING", "progress": 0.4}}
```

Card item shapes:

| `card.type` | Item shape |
| --- | --- |
| `checklist` | `{text, time?}` |
| `list` | `{name, detail}` |
| `person` | `card.person = {name, role, imageUrl?, credit?, facts: [string]}` |
| `link` | `card.url` |
| `reminder` | `card.reminder = {title, start: ISO, repeat?: "daily" \| "weekly"}` |

Treat every string from the API as **untrusted**: render with `textContent`, never `innerHTML`.
Allow only `https:` URLs in links and images.

## Mock data, so the demo looks real in mock mode

- A TV named `LIVING ROOM TV`.
- Now playing: "The science of sleep, ep. 42" at a ticking `t`.
- A seeded thread with:
  - a system line `LINK ESTABLISHED`;
  - a TV `share` checklist card "Evening routine, as described" (Magnesium L-threonate · 145 mg in
    the evening; Apigenin · 50 mg; Cool the room to 18 °C; Plan five 90-minute cycles);
  - a TV `share` reminder "Morning light, 10 min", daily at 07:30;
  - one earlier `question` + `answer` with a `[0:05]` chip and one source link.
- Asking anything in mock mode returns, after 1.5 s, an `answer` that quotes the question and
  includes a timestamp chip.
- Uploading in mock mode fakes part progress over about 6 s, then `PROCESSING`, `ANALYSING 1/3`,
  `ANALYSING 3/3` and `READY TO WATCH`, 2 s apart.

## Done when

- Every screen above works in mock mode on a phone-sized viewport (390 × 844) and a small one
  (360 × 640), in portrait.
- Pairing, sending, asking, receiving each card type, uploading with progress, cancel, resume,
  unlink and offline handling can each be demonstrated in mock mode.
- No console errors. No `innerHTML` with API data. The service worker never caches `/v1/`.
- A short `webapp/link/README.md`: how to run it locally in mock mode, the file map, and how the app
  maps to the API contract.

When you finish, append one dated entry to `submission/scorebook.md` §6 (the only file outside
`webapp/link/` you may edit). Say what works in mock mode, the screen list, and which screenshots
are worth taking (phone thread, upload progress, a received checklist card). Use status BUILT (not
LIVE: it has not run against the real backend). Keep it factual.

Do not invent backend features beyond the contract. If something is missing from the contract, keep
it in the mock only and list it in the README under "Needs backend".
