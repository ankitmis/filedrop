import express from 'express';
import multer from 'multer';
import archiver from 'archiver';
import QRCode from 'qrcode';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- config (all overridable via env) ----------------------------------
const PORT         = parseInt(process.env.PORT || '3000', 10);
const DATA         = process.env.DATA_DIR || path.join(__dirname, 'data');
const BASE_URL     = process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || ''; // public base for links
const MAX_MB       = parseInt(process.env.MAX_MB || '4096', 10); // per-file size limit
const EXPIRY_HOURS = parseInt(process.env.EXPIRY_HOURS || '0', 10); // 0 = keep forever

fs.mkdirSync(DATA, { recursive: true });

// ---- helpers -----------------------------------------------------------
const newId = () => crypto.randomBytes(6).toString('base64url');   // ~8 url-safe chars
const ID_RE = /^[A-Za-z0-9_-]{6,16}$/;

function safeRel(name) {
  // strip drive letters, leading slashes, and any ".." segments
  const parts = String(name).split(/[\\/]+/).filter(p => p && p !== '.' && p !== '..');
  return parts.join('/') || 'file';
}
function baseUrl(req) {
  if (BASE_URL) return BASE_URL.replace(/\/+$/, '');
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host  = req.headers['x-forwarded-host']  || req.headers.host;
  return `${proto}://${host}`;
}
function filesDir(id) { return path.join(DATA, id, 'files'); }
// The relative path travels in the (unsanitized) multipart field name, url-encoded,
// because multer 2.x strips directories from file.originalname.
function relOf(file) {
  try { return safeRel(decodeURIComponent(file.fieldname)); }
  catch { return safeRel(file.originalname); }
}
function readMeta(id) {
  if (!ID_RE.test(id)) return null;
  try { return JSON.parse(fs.readFileSync(path.join(DATA, id, 'meta.json'), 'utf8')); }
  catch { return null; }
}
function fmt(bytes) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0, n = bytes;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}
const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- app ---------------------------------------------------------------
const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const dir = path.join(filesDir(req.uploadId), path.dirname(relOf(file)));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) { cb(null, path.basename(relOf(file))); },
});
const upload = multer({ storage, limits: { fileSize: MAX_MB * 1024 * 1024 } });
const assignId = (req, _res, next) => { req.uploadId = newId(); next(); };

// ---- upload ------------------------------------------------------------
app.post('/api/upload', assignId, upload.any(), async (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'no files received' });
  const files = req.files.map(f => ({ path: relOf(f), size: f.size }));
  const total = files.reduce((s, f) => s + f.size, 0);
  const label = (req.body.label || '').trim() ||
    (files.length === 1 ? path.basename(files[0].path) : `${files.length} files`);
  const meta = { id: req.uploadId, label, created: Date.now(), total, files };
  fs.writeFileSync(path.join(DATA, req.uploadId, 'meta.json'), JSON.stringify(meta));
  const url = `${baseUrl(req)}/d/${req.uploadId}`;
  const qr  = await QRCode.toDataURL(url, { margin: 1, width: 220 });
  res.json({ id: req.uploadId, url, qr, files, total });
});

// ---- download page -----------------------------------------------------
app.get('/d/:id', async (req, res) => {
  const meta = readMeta(req.params.id);
  if (!meta) return res.status(404).send(page('Not found', '<h1>Link not found or expired</h1>'));
  const id = req.params.id;
  const url = `${baseUrl(req)}/d/${id}`;
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 180 });
  const rows = meta.files.map(f => {
    const href = `/d/${id}/file/${f.path.split('/').map(encodeURIComponent).join('/')}`;
    return `<li><a href="${esc(href)}" download>${esc(f.path)}</a><span>${fmt(f.size)}</span></li>`;
  }).join('');
  const zipBtn = `<a class="btn" href="/d/${id}/zip">⬇ Download ${meta.files.length > 1 ? 'all as ZIP' : 'ZIP'} · ${fmt(meta.total)}</a>`;
  const body = `
    <h1>${esc(meta.label)}</h1>
    <p class="muted">${meta.files.length} file(s) · ${fmt(meta.total)} · uploaded ${new Date(meta.created).toLocaleString()}</p>
    <div class="actions">${zipBtn}</div>
    <ul class="files">${rows}</ul>
    <img class="qr" src="${qr}" alt="QR to this page"/>
    <p class="muted small">Scan to open this page on another device.</p>`;
  res.send(page(meta.label, body));
});

// ---- download one file -------------------------------------------------
app.get('/d/:id/file/*', (req, res) => {
  if (!ID_RE.test(req.params.id)) return res.status(404).end();
  const rel = safeRel(decodeURIComponent(req.params[0] || ''));
  const root = filesDir(req.params.id);
  const target = path.join(root, rel);
  if (!target.startsWith(root + path.sep) && target !== root) return res.status(400).end();
  if (!fs.existsSync(target)) return res.status(404).end();
  res.download(target, path.basename(rel));
});

// ---- download everything as a zip -------------------------------------
app.get('/d/:id/zip', (req, res) => {
  const meta = readMeta(req.params.id);
  if (!meta) return res.status(404).end();
  const name = (meta.label || 'download').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/\.zip$/i, '');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${name}.zip"`);
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', err => { console.error(err); res.status(500).end(); });
  archive.pipe(res);
  archive.directory(filesDir(req.params.id), false);
  archive.finalize();
});

// ---- multer / generic errors ------------------------------------------
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError)
    return res.status(413).json({ error: `${err.code} (per-file limit is ${MAX_MB} MB)` });
  console.error(err);
  res.status(500).json({ error: err.message || 'server error' });
});

// ---- optional expiry sweep --------------------------------------------
if (EXPIRY_HOURS > 0) {
  const sweep = () => {
    const cutoff = Date.now() - EXPIRY_HOURS * 3600_000;
    for (const id of fs.readdirSync(DATA)) {
      const m = readMeta(id);
      if (m && m.created < cutoff) fs.rmSync(path.join(DATA, id), { recursive: true, force: true });
    }
  };
  setInterval(sweep, 3600_000); sweep();
}

// ---- page shell --------------------------------------------------------
function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · filedrop</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;background:#0d1117;color:#e6edf3;
       display:flex;justify-content:center;padding:40px 16px}
  .wrap{width:100%;max-width:620px}
  h1{font-size:22px;margin:0 0 4px;word-break:break-word}
  .muted{color:#9aa4b2}.small{font-size:13px}
  .actions{margin:18px 0}
  .btn{display:inline-block;background:#2f81f7;color:#fff;text-decoration:none;padding:11px 16px;
       border-radius:9px;font-weight:600}
  .btn:hover{background:#4c94ff}
  ul.files{list-style:none;padding:0;margin:14px 0;border:1px solid #21262d;border-radius:10px;overflow:hidden}
  ul.files li{display:flex;justify-content:space-between;gap:12px;padding:10px 14px;border-top:1px solid #21262d}
  ul.files li:first-child{border-top:0}
  ul.files a{color:#e6edf3;text-decoration:none;word-break:break-all}
  ul.files a:hover{color:#2f81f7}
  ul.files span{color:#9aa4b2;white-space:nowrap}
  .qr{margin-top:22px;border-radius:10px;background:#fff;padding:6px}
</style></head><body><div class="wrap">${body}</div></body></html>`;
}

app.listen(PORT, () => {
  console.log(`\n  filedrop running → http://localhost:${PORT}`);
  if (BASE_URL) console.log(`  public base URL  → ${BASE_URL}`);
  console.log(`  data dir: ${DATA}   per-file limit: ${MAX_MB} MB   expiry: ${EXPIRY_HOURS || 'never'}h\n`);
});
