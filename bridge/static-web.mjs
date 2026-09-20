import { realpathSync, statSync } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
};
const apiPaths = new Set(['/play', '/ws', '/nearby', '/verify', '/health']);
const inside = (root, target) => {
  const path = relative(root, target);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
};

/** Serve only the built browser app, alongside the existing HTTP/WebSocket APIs. */
export function createStaticWebHandler(webRoot) {
  let root;
  try {
    root = realpathSync(resolve(webRoot));
    const index = realpathSync(resolve(root, 'index.html'));
    if (!inside(root, index) || !statSync(index).isFile()) throw new Error('Missing index.html');
  } catch {
    throw new Error(`The web build is missing at ${resolve(webRoot)}. Run "npm run build:phone" before starting the web server.`);
  }

  return async function serveWeb(request, response) {
    const reply = (status, message) => {
      response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : message);
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') return reply(404, 'Not found');
    let pathname;
    try { pathname = decodeURIComponent((request.url ?? '').split('?')[0]); }
    catch { return reply(400, 'Invalid URL'); }
    // Decode before checking: URL normalization alone would hide encoded traversal.
    if (!pathname.startsWith('/') || /[\\\0]/.test(pathname)
      || pathname.split('/').some(part => part.startsWith('.')) || apiPaths.has(pathname)) {
      return reply(404, 'Not found');
    }
    const requested = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!inside(root, requested)) return reply(404, 'Not found');
    let file;
    try {
      // Assets may be symlinked during development, but never expose anything outside dist.
      const resolved = await realpath(requested);
      if (!inside(root, resolved)) return reply(404, 'Not found');
      file = await open(resolved, 'r');
      const info = await file.stat();
      if (!info.isFile()) return reply(404, 'Not found');
      const etag = `W/"${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}"`;
      const fingerprinted = /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[^.\/]+$/.test(pathname);
      const headers = {
        'content-type': contentTypes[extname(resolved).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': fingerprinted ? 'public, max-age=31536000, immutable' : 'no-cache',
        'x-content-type-options': 'nosniff',
        etag,
      };
      if (request.headers['if-none-match']?.split(',').map(value => value.trim()).includes(etag)) {
        response.writeHead(304, headers);
        response.end();
        return;
      }
      response.writeHead(200, { ...headers, 'content-length': info.size });
      if (request.method === 'HEAD') { response.end(); return; }
      await pipeline(file.createReadStream({ autoClose: false }), response);
    } catch (error) {
      if (response.destroyed) return;
      if (response.headersSent) { response.destroy(); return; }
      reply(['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code) ? 404 : 500, 'Unable to serve this file');
    } finally {
      await file?.close();
    }
  };
}
