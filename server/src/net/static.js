// Minimal static file server for client/dist (production): MIME types, cache headers,
// ETag/304, SPA fallback to index.html, no path traversal.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ktx2': 'image/ktx2',
  '.hdr': 'image/vnd.radiance',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

// Vite writes fingerprinted bundles directly in /assets/: name-[8 chars hash].ext. Files copied from
// client/public (e.g. /assets/camp/camp.glb) keep their name and get a short cache instead.
const HASHED = /^\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/;

export function mimeType(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

/** Returns an async (req, res) => boolean handler serving `root`; false when nothing matched. */
export function createStaticHandler(root) {
  const base = path.resolve(root);

  async function fileInfo(file) {
    try {
      const st = await stat(file);
      return st.isFile() ? st : null;
    } catch {
      return null;
    }
  }

  function send(req, res, file, st, cache) {
    const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', st.mtime.toUTCString());
    res.setHeader('Cache-Control', cache);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.headers['if-none-match'] === etag) {
      res.statusCode = 304;
      res.end();
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', mimeType(file));
    res.setHeader('Content-Length', st.size);
    if (req.method === 'HEAD') { res.end(); return; }
    const stream = createReadStream(file);
    stream.on('error', () => { if (!res.headersSent) res.statusCode = 500; res.end(); });
    stream.pipe(res);
  }

  return async function handle(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    let rel;
    try {
      rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      res.statusCode = 400;
      res.end('Requête invalide');
      return true;
    }
    if (rel.includes('\0')) { res.statusCode = 400; res.end(); return true; }
    const file = path.resolve(base, `.${path.posix.normalize(rel)}`);
    if (file !== base && !file.startsWith(base + path.sep)) { res.statusCode = 404; res.end('Introuvable'); return true; }

    let target = file;
    let st = await fileInfo(target);
    if (!st && rel.endsWith('/')) { target = path.join(file, 'index.html'); st = await fileInfo(target); }
    if (st) {
      const name = path.basename(target);
      const cache = name === 'index.html' ? 'no-cache'
        : HASHED.test(rel) ? 'public, max-age=31536000, immutable'
          : 'public, max-age=3600';
      send(req, res, target, st, cache);
      return true;
    }
    // SPA fallback: routes without extension serve index.html
    if (!path.extname(rel)) {
      const index = path.join(base, 'index.html');
      const ist = await fileInfo(index);
      if (ist) { send(req, res, index, ist, 'no-cache'); return true; }
    }
    return false;
  };
}
