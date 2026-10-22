# StudioX companion

A zero-dependency Node 22 server plus the phone web pages. It issues the temporary links the TV
shows as QR codes, receives phone uploads, and records the phone camera state. Protocol details:
[docs/product/architecture.md](../docs/product/architecture.md#pairing-protocol-phase-1).

## Run

```bash
node companion/server.mjs
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8787` | Listen port |
| `HOST` | `0.0.0.0` | Listen address |
| `PUBLIC_URL` | `http://<first LAN IPv4>:PORT` | Base URL placed in QR codes; must be reachable from the phone |
| `UPLOAD_DIR` | `companion/uploads` | Where uploaded videos are written (git-ignored) |
| `MAX_UPLOAD_BYTES` | 2 GiB | Upload size cap |

The TV reaches the server at `COMPANION_API_URL` in `src/config.ts`. The phone uses `PUBLIC_URL`.
They can differ, for example when the Virtual Device sees the workstation on another interface.

## Demo media

`GET /media/<name>.mp4` streams the TV encodes from `media/tv/` (override with `MEDIA_DIR`) with
HTTP byte ranges, which the Vega player needs for seeking.

## Camera needs HTTPS

Phone browsers only allow `getUserMedia` on secure pages. Uploads work over LAN HTTP; the camera
page will show `HTTPS REQUIRED`. For development, put the server behind an HTTPS tunnel and pass its
URL, for example with Cloudflare's quick tunnel (installs a third-party tool and exposes the server
publicly while it runs):

```bash
cloudflared tunnel --url http://localhost:8787   # prints https://<random>.trycloudflare.com
PUBLIC_URL=https://<random>.trycloudflare.com node companion/server.mjs
```

## Limits

- Sessions are held in memory; restarting the server invalidates every link.
- A link is scannable for ten minutes, locks to the first phone, and accepts one video.
- No authentication beyond the unguessable link and the per-session TV and phone tokens. Do not
  expose it publicly longer than a demo needs.
