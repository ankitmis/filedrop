# filedrop

Drop **files or a folder** in the browser → get a **public URL + QR** → download it from any other machine (single file directly, or the whole thing as a ZIP). No sign‑in for anyone. Files are stored byte‑for‑byte, so anything inside them (e.g. URLs in a CSV) is never altered, and folder structure is preserved.

---

## 1. Install & run the server (once)

```bash
cd filedrop
npm install
npm start
```

You'll see `filedrop running → http://localhost:3000`. **Leave this terminal open** — it's your server. This alone works on the same machine (`http://localhost:3000`) or across your Wi‑Fi/LAN (`http://<your-ip>:3000`, find your IP with `ipconfig getifaddr en0`).

---

## 2. Get a LIVE public link (works from anywhere)

To reach it from *another* computer over the internet, expose the running server with a Cloudflare tunnel.

**One‑time install:**
```bash
brew install cloudflared
```

**Then — and this is the part people get wrong — use TWO separate terminal tabs:**

- **Tab 1** is already running your server from step 1 (`npm start`). Leave it.
- **Tab 2** (open a new tab with ⌘T) — start the tunnel:

```bash
cloudflared tunnel --url http://localhost:3000
```

> ⚠️ Do **not** put `npm start` and `cloudflared` on the same line / same tab. `npm start` runs forever and blocks the line, so the tunnel would never start.

Tab 2 prints your live URL in a box:

```
+--------------------------------------------------------+
|  Your quick Tunnel has been created! Visit it at:      |
|  https://some-random-words.trycloudflare.com           |
+--------------------------------------------------------+
```

**That `https://…trycloudflare.com` line is your public link.** Open it on any machine, upload, and the download links it hands back use the same public host automatically (no config needed — the server reads the forwarded host).

### Keep in mind with the tunnel
- **Both tabs must stay open** and the Mac must stay awake. Close either, or let it sleep → the URL dies.
- The URL is **random and changes every time** you restart the tunnel.
- Free `trycloudflare` tunnels can be **flaky for large uploads** (they sometimes drop the *response* even though the file uploaded fine). The app now shows a "Finalizing…" status and times out with a clear error instead of hanging. If a link doesn't appear but the upload finished, the file is usually still on the server — see [Recover a lost link](#recover-a-lost-link). For reliable large transfers, use Render below.

---

## 3. Always‑on public URL — deploy to Render (recommended for keeps)

A tunnel dies when your Mac sleeps and changes URL each time. For a **fixed URL that's always up**, deploy the app (one‑time GitHub sign‑in, no cost):

1. Go to [render.com](https://render.com) → **Sign in with GitHub**.
2. **New +** → **Blueprint** → pick the **`filedrop`** repo (this repo includes `render.yaml`).
3. **Apply**. After ~2 min you get `https://filedrop-xxxx.onrender.com` — your permanent public URL.

Links it generates use that host automatically (via `RENDER_EXTERNAL_URL`). No terminals to keep open, survives reboots.

Caveats on Render's **free** plan: disk is **ephemeral** (uploads cleared on each redeploy/restart) and the service **sleeps after ~15 min idle** (first hit is slow). For durable uploads add a Render **persistent disk** at `/app/data` (paid) or deploy the included `Dockerfile` to **Fly.io** with a volume.

---

## Config (env vars)

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | port to listen on |
| `BASE_URL` | _(auto)_ | force the public base for links; usually unneeded (auto‑detected from the request/`RENDER_EXTERNAL_URL`) |
| `MAX_MB` | `4096` | per‑file upload limit (MB) |
| `EXPIRY_HOURS` | `0` | auto‑delete uploads older than N hours (`0` = keep forever) |
| `DATA_DIR` | `./data` | where uploads are stored |

Example — auto‑delete after a day, 1 GB cap: `EXPIRY_HOURS=24 MAX_MB=1024 npm start`

---

## Recover a lost link

Every upload lands under `data/<id>/`. If the browser never showed the link but the upload finished, find it on the server:

```bash
ls -t data | head            # newest share id is first
cat data/<id>/meta.json      # shows the file(s)
# your link is:  <your-public-url>/d/<id>
```

---

## Notes / security

- A link is a **capability**: anyone with the URL can download it. The id is an unguessable ~8 chars, but treat the link like a password. For sensitive data set `EXPIRY_HOURS` and/or run it on your LAN only.
- The app is intentionally **sign‑in‑free**, which means anyone with the *app* URL can upload to the host while it's running — don't post the app URL publicly.
- No accounts, no database — uploads live under `data/<id>/`. Delete a share by removing its folder. Folder uploads keep their structure and download back as a `.zip`.
