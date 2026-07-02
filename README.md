# filedrop

Drop **files or a folder** in the browser → get a **short URL + QR** → download it from any other machine (single file directly, or the whole thing as a ZIP). Files are stored byte-for-byte, so anything inside them (e.g. URLs in a CSV) is never altered.

## Run it

```bash
cd filedrop
npm install
npm start
# → http://localhost:3000
```

Open the page, drag in files/a folder, click **Upload & get link**.

## Make the link work "anywhere"

The link only works where the server is reachable. Pick one:

| Reach | How |
|---|---|
| **Same machine** | `http://localhost:3000` |
| **Same Wi‑Fi / LAN** | share `http://<your-LAN-ip>:3000` (find it with `ipconfig getifaddr en0` on macOS) |
| **Anywhere on the internet** (no account) | run a tunnel and hand the app its public URL: |

```bash
# one-time: brew install cloudflared   (or: npm i -g localtunnel / use ngrok)
cloudflared tunnel --url http://localhost:3000
# copy the https://xxxx.trycloudflare.com URL it prints, then restart the app with it:
BASE_URL=https://xxxx.trycloudflare.com npm start
```

Setting `BASE_URL` makes the generated links use the public hostname so the QR/URL works on the other machine.

### Deploy to Render (public, always-on)

This repo includes `render.yaml`. On [render.com](https://render.com): **New → Blueprint → connect this repo → Apply**. Render builds it, gives you `https://<name>.onrender.com`, and the download links it generates use that public host automatically (via `RENDER_EXTERNAL_URL`). No config needed.

Caveats on Render's **free** plan: the disk is **ephemeral** (uploaded files are cleared on each redeploy/restart), and the service **sleeps after ~15 min idle** (first request is slow). Great for quick transfers. For durable uploads, add a Render **persistent disk** mounted at `/app/data` (paid add-on) or use Fly.io with a volume.

**Any other host:** deploy the included `Dockerfile` to Railway, Fly.io, or a VPS. Mount a volume at `/app/data` to persist uploads. `BASE_URL` is picked up from the request host automatically behind a proxy.

## Config (env vars)

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | port to listen on |
| `BASE_URL` | _(auto)_ | public base for generated links (set when behind a tunnel) |
| `MAX_MB` | `4096` | per-file upload limit (MB) |
| `EXPIRY_HOURS` | `0` | auto-delete uploads older than N hours (`0` = keep forever) |
| `DATA_DIR` | `./data` | where uploads are stored |

## Notes / security

- A link is a **capability**: anyone with the URL can download. It's an unguessable ~8-char id, but treat it like a password. For sensitive data, set `EXPIRY_HOURS` and/or run it only on your LAN.
- No accounts, no database — uploads live under `data/<id>/`. Delete a share by removing its folder.
- Folder uploads keep their structure and come back as a `.zip`.
