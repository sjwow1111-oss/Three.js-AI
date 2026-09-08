#!/usr/bin/env node
/**
 * Dev static server with an optional API proxy (no dependencies).
 *
 *   node server/serve.mjs            → http://localhost:5173
 *   PORT=8080 node server/serve.mjs
 *
 * Requests to /api/proxy?url=<encoded target URL> are relayed as-is to that AI
 * endpoint. It exists so browsers can reach endpoints that do not allow CORS;
 * the API key only passes through in the request headers and is never stored.
 */
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';

const ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const PORT = Number(process.env.PORT) || 5173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
};

// headers the proxy forwards upstream (auth-related only)
const FORWARD_HEADERS = [
  'authorization', 'x-api-key', 'anthropic-version', 'anthropic-beta',
  'content-type', 'accept', 'openai-organization', 'openai-project',
  'http-referer', 'x-title', 'api-key',
];

async function proxy(req, res, targetUrl) {
  let target;
  try {
    target = new URL(targetUrl);
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Invalid url parameter.');
    return;
  }
  if (!/^https?:$/.test(target.protocol)) {
    res.writeHead(400).end('Only http/https URLs can be relayed.');
    return;
  }

  const headers = {};
  for (const name of FORWARD_HEADERS) {
    if (req.headers[name]) headers[name] = req.headers[name];
  }

  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;

  let upstream;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
      redirect: 'follow',
    });
  } catch (err) {
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { message: 'Could not reach the target server: ' + err.message } }));
    return;
  }

  const out = { 'access-control-allow-origin': '*' };
  for (const name of ['content-type', 'cache-control']) {
    const v = upstream.headers.get(name);
    if (v) out[name] = v;
  }
  res.writeHead(upstream.status, out);
  if (upstream.body) Readable.fromWeb(upstream.body).pipe(res);
  else res.end();
}

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = join(ROOT, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }

  try {
    const info = await stat(file);
    if (info.isDirectory()) { res.writeHead(302, { location: pathname + '/' }).end(); return; }
    res.writeHead(200, {
      'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': info.size,
      'cache-control': 'no-cache',
      // the sandbox iframe is an opaque origin, so serving three.js locally needs CORS
      'access-control-allow-origin': '*',
    });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 · Not found: ' + rel);
  }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/proxy') {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': FORWARD_HEADERS.join(','),
        'access-control-max-age': '86400',
      }).end();
      return;
    }
    await proxy(req, res, url.searchParams.get('url') || '');
    return;
  }

  await serveStatic(req, res, url.pathname === '/' ? '/index.html' : url.pathname);
}).listen(PORT, () => {
  console.log(`▶ Three.js AI Studio  →  http://localhost:${PORT}`);
  console.log(`  proxy endpoint      →  http://localhost:${PORT}/api/proxy?url=...`);
});
