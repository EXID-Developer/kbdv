import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { LANGS, reportKey, type Lang, type ReportEvents } from '../../shared/types.ts';
import { ADMIN_TOKEN, DIST_DIR, HOST, PORT, publicSettings, resetSettings, settings, updateSettings, validatePatch } from './config.ts';
import { addClient, broadcast } from './hub.ts';
import { isFresh, joinGeneration } from './jobs.ts';
import { chat } from './llm.ts';
import { market } from './market.ts';
import { prewarmState, startPrewarm, stopPrewarm } from './prewarm.ts';
import { answer, MAX_QUESTION, resolveQuestion, type AnswerRequest } from './qa.ts';
import { clearReports, exportReports, getReport, importReports, loadReports, summaries } from './store.ts';
import type { Subject } from './pipeline.ts';
import { findPlaceSubject, loadPlaces, MAX_PROMPT, normalizePrompt, topicSubject } from './subjects.ts';

class HttpError extends Error {
  // A declared field rather than a parameter property: Node's built-in TypeScript support strips types only.
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const JSON_LIMIT = 64 * 1024;
const IMPORT_LIMIT = 200 * 1024 * 1024;
const HEARTBEAT_MS = 20_000;
const TEXT_FLUSH_MS = 100;

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

/**
 * Reads a JSON body. Requiring the JSON content type makes browsers send a CORS preflight for cross-site
 * requests, which this server never approves, so other web pages cannot trigger these endpoints.
 */
async function readJson(req: IncomingMessage, limit = JSON_LIMIT): Promise<unknown> {
  if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) throw new HttpError(415, 'Expected application/json');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Request body too large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

const digest = (s: string) => createHash('sha256').update(s).digest();

function requireAdmin(req: IncomingMessage) {
  if (!ADMIN_TOKEN) return;
  const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';
  // Comparing digests keeps the comparison constant-time regardless of token length.
  if (!timingSafeEqual(digest(token), digest(ADMIN_TOKEN))) throw new HttpError(401, 'Admin token required');
}

/** Starts a Server-Sent Events response; `onClose` runs when the client goes away before the stream ends. */
function openSse(res: ServerResponse, onClose?: () => void) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  const heartbeat = setInterval(() => res.write(':\n\n'), HEARTBEAT_MS);
  res.on('close', () => {
    clearInterval(heartbeat);
    if (!res.writableFinished) onClose?.();
  });
  return (event: string, data: unknown) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
}

const parseLang = (v: string | null): Lang => {
  if (!LANGS.includes(v as Lang)) throw new HttpError(400, 'lang must be ko or en');
  return v as Lang;
};

function reportStream(req: IncomingMessage, res: ServerResponse, q: URLSearchParams) {
  const lang = parseLang(q.get('lang'));
  const scope = q.get('scope');
  let subject: Subject | null;
  if (scope === 'topic') {
    const prompt = normalizePrompt(q.get('prompt') ?? '');
    if (!prompt || prompt.length > MAX_PROMPT) throw new HttpError(400, `prompt must be 1 to ${MAX_PROMPT} characters`);
    subject = topicSubject(prompt);
  } else if (scope === 'country' || scope === 'region') {
    subject = findPlaceSubject(scope, q.get('code') ?? '');
    if (!subject) throw new HttpError(404, 'Unknown place');
  } else {
    throw new HttpError(400, 'scope must be country, region or topic');
  }

  const cached = getReport(reportKey(subject.scope, subject.code, lang));
  let leave = () => {};
  const send = openSse(res, () => leave());
  if (cached && q.get('force') !== '1' && isFresh(cached)) {
    send('done', { report: cached, cached: true } satisfies ReportEvents['done']);
    res.end();
    return;
  }
  leave = joinGeneration(subject, lang, (event, data) => {
    send(event, data);
    if (event === 'done' || event === 'error') {
      leave();
      res.end();
    }
  });
}

async function answerStream(req: IncomingMessage, res: ServerResponse) {
  const body = (await readJson(req)) as Record<string, unknown> | null;
  const report = typeof body?.key === 'string' ? getReport(body.key) : undefined;
  if (!report) throw new HttpError(404, 'Unknown report');
  let request: AnswerRequest;
  if (typeof body?.issue === 'string') request = { issue: body.issue };
  else if (typeof body?.question === 'string' && body.question.trim() && body.question.length <= MAX_QUESTION) request = { question: body.question.trim() };
  else throw new HttpError(400, `Send an issue label or a question of 1 to ${MAX_QUESTION} characters`);
  if (!resolveQuestion(report, request)) throw new HttpError(404, 'Unknown issue');

  const ctrl = new AbortController();
  const send = openSse(res, () => ctrl.abort());
  let last = 0;
  try {
    const text = await answer(
      report,
      request,
      (t) => {
        const now = Date.now();
        if (now - last < TEXT_FLUSH_MS) return;
        last = now;
        send('text', t);
      },
      ctrl.signal,
    );
    send('done', text);
  } catch (e) {
    if (!ctrl.signal.aborted) send('error', { message: e instanceof Error ? e.message : String(e) });
  } finally {
    res.end();
  }
}

function events(res: ServerResponse) {
  let remove = () => {};
  const send = openSse(res, () => remove());
  send('summaries', summaries());
  send('prewarm', prewarmState());
  remove = addClient(send);
}

async function api(req: IncomingMessage, res: ServerResponse, url: URL) {
  const route = `${req.method} ${url.pathname}`;
  const q = url.searchParams;
  switch (route) {
    case 'GET /api/health':
      return json(res, 200, { ok: true });
    case 'GET /api/events':
      return events(res);
    case 'GET /api/report':
      return reportStream(req, res, q);
    case 'POST /api/qa':
      return answerStream(req, res);
    case 'GET /api/settings':
      return json(res, 200, { settings: publicSettings(), adminProtected: !!ADMIN_TOKEN });
    case 'PUT /api/settings': {
      requireAdmin(req);
      const result = validatePatch(await readJson(req));
      if (!result.ok) throw new HttpError(400, result.error);
      await updateSettings(result.patch);
      broadcast('settings', publicSettings());
      return json(res, 200, { settings: publicSettings() });
    }
    case 'DELETE /api/settings':
      requireAdmin(req);
      await resetSettings();
      broadcast('settings', publicSettings());
      return json(res, 200, { settings: publicSettings() });
    case 'POST /api/admin/llm-test': {
      requireAdmin(req);
      const start = performance.now();
      try {
        const reply = await chat(settings(), [{ role: 'user', content: 'Reply with the single word OK.' }], {
          maxTokens: 20,
          signal: AbortSignal.timeout(60_000),
        });
        return json(res, 200, { ok: true, seconds: (performance.now() - start) / 1000, reply: reply.trim().slice(0, 40) });
      } catch (e) {
        return json(res, 200, { ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
    case 'GET /api/admin/export':
      requireAdmin(req);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="kbdv-reports-${new Date().toISOString().slice(0, 10)}.json"`,
      });
      return void res.end(exportReports());
    case 'POST /api/admin/import': {
      requireAdmin(req);
      const data = await readJson(req, IMPORT_LIMIT);
      try {
        return json(res, 200, { count: await importReports(data) });
      } catch (e) {
        throw new HttpError(400, e instanceof Error ? e.message : String(e));
      }
    }
    case 'DELETE /api/admin/reports':
      requireAdmin(req);
      await clearReports();
      return json(res, 200, { ok: true });
    case 'POST /api/admin/prewarm': {
      requireAdmin(req);
      const body = (await readJson(req)) as Record<string, unknown> | null;
      void startPrewarm(body?.skipExisting !== false, parseLang(typeof body?.lang === 'string' ? body.lang : null));
      return json(res, 202, prewarmState());
    }
    case 'DELETE /api/admin/prewarm':
      requireAdmin(req);
      stopPrewarm();
      return json(res, 200, { ok: true });
  }
  const marketMatch = req.method === 'GET' && /^\/api\/market\/([A-Z]{3})$/.exec(url.pathname);
  if (marketMatch) return json(res, 200, await market(marketMatch[1]));
  throw new HttpError(404, 'Not found');
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.geojson', '.map', '.svg', '.txt']);

const files = new Map<string, { mtime: number; body: Buffer; gzip: Buffer | null }>();

/** Built frontend, with gzip so the map data (several MB) loads quickly on every screen. */
async function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
  let path: string;
  try {
    path = resolve(DIST_DIR, `.${decodeURIComponent(pathname)}`);
  } catch {
    throw new HttpError(400, 'Bad path');
  }
  if (path !== DIST_DIR && !path.startsWith(DIST_DIR + sep)) throw new HttpError(403, 'Forbidden');

  let info = await stat(path).catch(() => null);
  if (!info?.isFile()) {
    // Unknown routes without an extension get the app shell; missing assets stay 404.
    if (extname(path)) throw new HttpError(404, 'Not found');
    path = join(DIST_DIR, 'index.html');
    info = await stat(path).catch(() => null);
    if (!info?.isFile()) throw new HttpError(404, 'Frontend is not built. Run `pnpm build`, or use `pnpm dev` while developing.');
  }

  const ext = extname(path).toLowerCase();
  let entry = files.get(path);
  if (!entry || entry.mtime !== info.mtimeMs) {
    const body = await readFile(path);
    entry = { mtime: info.mtimeMs, body, gzip: COMPRESSIBLE.has(ext) && body.length > 1024 ? gzipSync(body) : null };
    files.set(path, entry);
  }
  const gzip = entry.gzip && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? '')) ? entry.gzip : null;
  const immutable = path.startsWith(join(DIST_DIR, 'assets') + sep);
  res.writeHead(200, {
    'Content-Type': TYPES[ext] ?? 'application/octet-stream',
    'Content-Length': (gzip ?? entry.body).length,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    Vary: 'Accept-Encoding',
    ...(gzip ? { 'Content-Encoding': 'gzip' } : {}),
  });
  res.end(req.method === 'HEAD' ? undefined : (gzip ?? entry.body));
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const handler = url.pathname.startsWith('/api/') ? api(req, res, url) : serveStatic(req, res, url.pathname);
  Promise.resolve(handler).catch((e: unknown) => {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(`${req.method} ${req.url}:`, e);
    if (res.headersSent) return void res.end();
    json(res, status, { error: e instanceof HttpError ? e.message : 'Internal server error' });
  });
});

await loadPlaces();
const count = await loadReports();
server.listen(PORT, HOST, () => {
  const lan = Object.values(networkInterfaces())
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => `http://${n!.address}:${PORT}`);
  console.log(`KBDV backend on http://localhost:${PORT} (${count} cached reports)`);
  if (lan.length) console.log(`Other computers: ${lan.join(', ')}`);
  if (!ADMIN_TOKEN) console.warn('ADMIN_TOKEN is not set: anyone on the network can change settings and clear the cache.');
});
