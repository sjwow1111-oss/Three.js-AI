#!/usr/bin/env node
/**
 * 개발용 정적 서버 + 선택적 API 프록시 (외부 의존성 없음).
 *
 *   node server/serve.mjs            → http://localhost:5173
 *   PORT=8080 node server/serve.mjs
 *
 * /api/proxy?url=<인코딩된 대상 URL> 로 들어온 요청은 대상 AI 엔드포인트로 그대로 중계한다.
 * CORS를 허용하지 않는 엔드포인트를 브라우저에서 쓰기 위한 통로이며,
 * API 키는 요청 헤더로 지나갈 뿐 서버에 저장되지 않는다.
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

// 프록시가 대상 서버로 전달하는 헤더 (인증 관련만 선별)
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
    res.end('잘못된 url 파라미터입니다.');
    return;
  }
  if (!/^https?:$/.test(target.protocol)) {
    res.writeHead(400).end('http/https URL만 중계할 수 있습니다.');
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
    res.end(JSON.stringify({ error: { message: '대상 서버에 연결하지 못했습니다: ' + err.message } }));
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
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('금지됨'); return; }

  try {
    const info = await stat(file);
    if (info.isDirectory()) { res.writeHead(302, { location: pathname + '/' }).end(); return; }
    res.writeHead(200, {
      'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': info.size,
      'cache-control': 'no-cache',
      // 샌드박스 iframe은 opaque origin이라 로컬 three.js를 쓰려면 CORS 허용이 필요하다
      'access-control-allow-origin': '*',
    });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 · 파일을 찾을 수 없습니다: ' + rel);
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
  console.log(`  프록시 엔드포인트    →  http://localhost:${PORT}/api/proxy?url=...`);
});
