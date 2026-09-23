// Fold Ready render engine, packaged as an HTTP service for Cloud Run.
// Contract: documents/ENGINE-API.md. Imports the engine from src/engine/ unchanged.
import { promises as fs, createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { serve } from '@hono/node-server';
import { runCheck, closeBrowser, SHOT_FILES, VIDEO_FILES, ENGINE_VERSION } from '../src/engine/index';
import type { Job } from '../src/engine/types';
import { normaliseUrl, assertPublicHost, UrlError } from '../src/engine/url';

const ENGINE_SECRET = process.env.ENGINE_SECRET;
if (!ENGINE_SECRET) {
  console.error('WARNING: ENGINE_SECRET is not set; every authenticated request will 401.');
}

const PORT = Number(process.env.PORT) || 8791;
const TMP_ROOT = path.join(os.tmpdir(), 'foldready-jobs');
const MAX_QUEUED = 20;
const SWEEP_MS = 60 * 60 * 1000; // 60 minutes after completion
const SHUTDOWN_GRACE_MS = 20_000;

interface JobRecord {
  job: Job;
  outDir: string;
  completedAt?: number;
}

const jobs = new Map<string, JobRecord>();
const queueOrder: string[] = [];
const sweepTimers = new Map<string, NodeJS.Timeout>();
let runningJobId: string | null = null;
let shuttingDown = false;

function countByState(state: Job['state']): number {
  let n = 0;
  for (const r of jobs.values()) if (r.job.state === state) n++;
  return n;
}

function scheduleSweep(id: string) {
  clearSweep(id);
  const t = setTimeout(() => {
    sweepTimers.delete(id);
    const record = jobs.get(id);
    if (!record) return;
    jobs.delete(id);
    void fs.rm(record.outDir, { recursive: true, force: true }).catch(() => {});
  }, SWEEP_MS);
  t.unref?.();
  sweepTimers.set(id, t);
}

function clearSweep(id: string) {
  const t = sweepTimers.get(id);
  if (t) {
    clearTimeout(t);
    sweepTimers.delete(id);
  }
}

async function processQueue(): Promise<void> {
  if (runningJobId) return;
  const nextId = queueOrder.shift();
  if (!nextId) return;
  const record = jobs.get(nextId);
  if (!record) {
    void processQueue();
    return;
  }
  runningJobId = nextId;
  record.job.state = 'running';
  record.job.progress = '';
  try {
    const result = await runCheck(record.job.url, {
      id: nextId,
      outDir: record.outDir,
      onProgress: (m) => {
        record.job.progress = m;
      },
    });
    record.job.result = result;
    if (result.error) {
      record.job.state = 'error';
      record.job.error = result.error;
    } else {
      record.job.state = 'done';
    }
  } catch (e) {
    record.job.state = 'error';
    record.job.error = e instanceof Error ? e.message : String(e);
  } finally {
    record.completedAt = Date.now();
    scheduleSweep(nextId);
    runningJobId = null;
    void processQueue();
  }
}

const app = new Hono();

// One line per request: method, path, status, ms. No headers or body logged.
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${ms}ms`);
});

// Bearer auth on everything except the health routes.
app.use('*', async (c, next) => {
  if (c.req.path === '/health' || c.req.path === '/healthz') return next();
  const auth = c.req.header('authorization');
  if (!ENGINE_SECRET || auth !== `Bearer ${ENGINE_SECRET}`) {
    return c.json({ error: 'unauthorised' }, 401);
  }
  return next();
});

// Cloud Run's front end answers /healthz itself and never passes it to the container, so /health
// is the route that works in production. /healthz stays for local runs and other hosts.
const health = (c: Context) =>
  c.json({ ok: true, engineVersion: ENGINE_VERSION, queued: countByState('queued'), running: countByState('running') });

app.get('/health', health);
app.get('/healthz', health);

app.post('/check', async (c) => {
  if (shuttingDown) return c.json({ error: 'shutting down' }, 503);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body.' }, 400);
  }
  const input = (body as { url?: unknown } | null)?.url;
  if (typeof input !== 'string' || !input.trim()) {
    return c.json({ error: 'A url is required.' }, 400);
  }

  let url: URL;
  try {
    url = normaliseUrl(input);
    await assertPublicHost(url);
  } catch (e) {
    if (e instanceof UrlError) return c.json({ error: e.message }, 400);
    throw e;
  }

  if (countByState('queued') >= MAX_QUEUED) {
    return c.json({ error: 'Too many jobs queued. Try again shortly.' }, 429);
  }

  const id = randomUUID();
  const outDir = path.join(TMP_ROOT, id);
  const job: Job = { id, url: url.toString(), state: 'queued', progress: '', createdAt: new Date().toISOString() };
  jobs.set(id, { job, outDir });
  queueOrder.push(id);
  void processQueue();

  return c.json({ id }, 202);
});

app.get('/jobs/:id', (c) => {
  const record = jobs.get(c.req.param('id'));
  if (!record) return c.json({ error: 'not found' }, 404);
  return c.json(record.job);
});

app.delete('/jobs/:id', async (c) => {
  const id = c.req.param('id');
  const record = jobs.get(id);
  if (!record) return c.json({ error: 'not found' }, 404);
  clearSweep(id);
  jobs.delete(id);
  await fs.rm(record.outDir, { recursive: true, force: true }).catch(() => {});
  return c.body(null, 204);
});

const ALL_FILES = new Set<string>([...SHOT_FILES, ...VIDEO_FILES]);

app.get('/jobs/:id/files/:name', async (c) => {
  const id = c.req.param('id');
  const name = c.req.param('name');
  const record = jobs.get(id);
  if (!record || !ALL_FILES.has(name)) return c.json({ error: 'not found' }, 404);

  const filePath = path.join(record.outDir, name);
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return c.json({ error: 'not found' }, 404);
  }

  const ext = path.extname(name);
  const contentType = ext === '.png' ? 'image/png' : ext === '.webm' ? 'video/webm' : 'application/octet-stream';
  const range = c.req.header('range');

  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!m || (!m[1] && !m[2])) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
    }
    let start: number;
    let end: number;
    if (!m[1]) {
      // suffix range: bytes=-N (last N bytes)
      start = stat.size - parseInt(m[2], 10);
      end = stat.size - 1;
    } else {
      start = parseInt(m[1], 10);
      end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
    }
    if (start < 0) start = 0;
    end = Math.min(end, stat.size - 1);
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stat.size) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
    }
    const stream = createReadStream(filePath, { start, end });
    return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
      status: 206,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
      },
    });
  }

  const stream = createReadStream(filePath);
  return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(stat.size),
      'Accept-Ranges': 'bytes',
    },
  });
});

async function main() {
  await fs.mkdir(TMP_ROOT, { recursive: true });

  const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`foldready-engine listening on :${info.port} (engineVersion ${ENGINE_VERSION})`);
  });

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('SIGTERM received: no longer accepting new jobs, waiting for the running job to finish');
    server.close();
    const deadline = Date.now() + SHUTDOWN_GRACE_MS;
    while (runningJobId && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
    }
    try {
      await closeBrowser();
    } catch {
      /* best effort */
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown());
}

void main();
