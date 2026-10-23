// Where the TV app reaches its services. The TV only ever makes outgoing
// requests.

// ---- AWS (production) --------------------------------------------------------
// One CloudFront distribution serves media, episode packages and the API.
// HTTPS only, so no cleartext manifest entry is needed for it.
export const CDN = 'https://d1874v8g2yry52.cloudfront.net';
export const API = `${CDN}/v1`;

// `demo`: everything the co-viewer shows comes from the episode package (CDN,
// else bundled, else the hand-written fixtures); it works with no backend.
// `live`: the pause card is refined by the coviewer agent and Ask questions
// are answered live (POST /v1/sessions, /v1/refine, /v1/ask).
export type AppMode = 'demo' | 'live';

export const FEATURES = {
  // The Map's simulations (src/map: night, growth) replaced the old
  // playable moments; they are always compiled in.
  // Vega system toast (useToastKepler); manifest.toml declares
  // `com.amazon.notification.privilege.post`.
  systemToast: true,
} as const;

// Live mode is switched on only for the team's own recording build, with one
// optional file that is kept out of git, `src/config.local.ts`:
//   export const APP_MODE = 'live';
//   export const ACCESS_CODE = '…';   // same value as SSM /studiox/access-code
// Without that file the build is a demo build: APP_MODE 'demo', no code, and
// no live AI calls at all. A wrong code makes live calls answer 403, which the
// app treats like any failed live call (it keeps the package answer).
let localMode: AppMode = 'demo';
let localAccessCode = '';
try {
  const local = require('./config.local');
  if (local?.APP_MODE === 'live' || local?.APP_MODE === 'demo') {
    localMode = local.APP_MODE;
  }
  if (typeof local?.ACCESS_CODE === 'string') {
    localAccessCode = local.ACCESS_CODE;
  }
} catch {
  // No local config file: a demo build.
}
export const APP_MODE: AppMode = localMode;
export const ACCESS_CODE: string = localAccessCode;

// Name the TV registers with (POST /v1/devices); the phone shows it.
export const DEVICE_NAME = 'StudioX TV';

// Media: fragmented MP4 (the player feeds it through MSE, which needs
// fragments; see src/player/mseLoader.ts). Contract key media/<id>.frag.mp4.
export const cdnMediaUrl = (id: string) =>
  `${CDN}/media/${encodeURIComponent(id)}.frag.mp4`;
export const packageUrl = (id: string) =>
  `${CDN}/packages/${encodeURIComponent(id)}/latest.json`;

// ---- Local companion server (development) -----------------------------------
// companion/server.mjs on the workstation. The player falls back to it once
// when the CDN copy fails before the first frame, which is how the owner
// tests before media is uploaded to S3. The Virtual Device reaches the
// workstation through its virtual network, a real Fire TV through the LAN;
// keep the host in manifest.toml [network-traffic-policy.cleartext] while it
// is plain HTTP.
export const COMPANION_API_URL = 'http://10.49.6.101:8787';
export const MEDIA_BASE_URL = `${COMPANION_API_URL}/media`;
export const companionMediaUrl = (id: string) =>
  `${MEDIA_BASE_URL}/${encodeURIComponent(id)}.frag.mp4`;

// ---- Timing -------------------------------------------------------------------
export const PAIRING_POLL_MS = 1500;
export const REQUEST_TIMEOUT_MS = 6000;
export const PACKAGE_TIMEOUT_MS = 4000;
export const REFINE_TIMEOUT_MS = 8000;
export const ASK_TIMEOUT_MS = 12000;
export const NOW_PLAYING_MS = 5000;
// The TV inbox (Shared with you) polls the thread and uploads while visible.
export const INBOX_POLL_MS = 4000;
// An upload's package is fetched every 10 s until it exists, for 10 minutes.
export const PACKAGE_POLL_MS = 10000;
export const PACKAGE_WAIT_MS = 10 * 60 * 1000;
