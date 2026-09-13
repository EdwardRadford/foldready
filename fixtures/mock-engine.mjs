// A stand-in for the render engine (engine-api/) so the Workers front end can be tested without
// a browser, a container or a cloud account. Implements documents/ENGINE-API.md:
//
//   GET    /healthz                  no auth
//   POST   /check      { url }       202 { id }
//   GET    /jobs/:id                 queued -> running -> done over about four seconds
//   GET    /jobs/:id/files/:name     the PNGs and clips, with Range support
//   DELETE /jobs/:id                 204
//
// The result is fixtures/sample-result.json with the id, url and timestamp swapped in. Files come
// from out/rr5/ when a real run is sitting there, otherwise from any folder under data/jobs that
// has one, otherwise a 1x1 PNG so the shape of the flow can still be checked.
//
// Run: node fixtures/mock-engine.mjs   (PORT and ENGINE_SECRET from the environment)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT ?? 8791);
const SECRET = process.env.ENGINE_SECRET ?? 'test';
const ENGINE_VERSION = 4;
const QUEUED_MS = 800;
const RUNNING_MS = 4000;

const root = path.resolve(path.join(import.meta.dirname, '..'));
const sample = JSON.parse(fs.readFileSync(path.join(root, 'fixtures', 'sample-result.json'), 'utf8'));

const SHOT_FILES = new Set([
  'folded.png',
  'unfolded.png',
  'split.png',
  'fold-transition.png',
  'fold-back.png',
  'other-iphone.png',
  'other-ipad.png',
  'other-laptop.png',
  'folded.webm',
  'unfolded.webm',
]);

// 1x1 transparent PNG, for when nothing real is on disk.
const BLANK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** id -> { url, startedAt } */
const jobs = new Map();

function stateOf(job) {
  const age = Date.now() - job.startedAt;
  if (age < QUEUED_MS) return 'queued';
  if (age < QUEUED_MS + RUNNING_MS) return 'running';
  return 'done';
}

function progressOf(state, job) {
  if (state === 'queued') return 'Waiting for a browser';
  if (state === 'done') return 'Done';
  const age = Date.now() - job.startedAt - QUEUED_MS;
  const steps = ['Starting a browser', 'Rendering folded view', 'Opening the phone', 'Rendering other screens'];
  return steps[Math.min(steps.length - 1, Math.floor((age / RUNNING_MS) * steps.length))];
}

function resultFor(id, job) {
  return {
    ...sample,
    id,
    engineVersion: ENGINE_VERSION,
    url: job.url,
    finalUrl: job.url,
    checkedAt: new Date(job.startedAt + QUEUED_MS + RUNNING_MS).toISOString(),
  };
}

function jobJson(id) {
  const job = jobs.get(id);
  if (!job) return undefined;
  const state = stateOf(job);
  return {
    id,
    url: job.url,
    state,
    progress: progressOf(state, job),
    createdAt: new Date(job.startedAt).toISOString(),
    ...(state === 'done' ? { result: resultFor(id, job) } : {}),
  };
}

/** Where a render lives on this machine, if anywhere. */
function fileFor(name) {
  const fromRun = path.join(root, 'out', 'rr5', name);
  if (fs.existsSync(fromRun)) return fromRun;
  const jobsDir = path.join(root, 'data', 'jobs');
  let dirs = [];
  try {
    dirs = fs.readdirSync(jobsDir);
  } catch {
    return undefined;
  }
  for (const dir of dirs) {
    const candidate = path.join(jobsDir, dir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': Buffer.isBuffer(payload) ? 'application/octet-stream' : 'application/json',
    ...headers,
  });
  res.end(payload ?? undefined);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

function serveFile(req, res, name) {
  const type = name.endsWith('.webm') ? 'video/webm' : 'image/png';
  const file = fileFor(name);
  if (!file) {
    if (name.endsWith('.webm')) return send(res, 404, { error: 'not found' });
    return send(res, 200, BLANK_PNG, { 'content-type': type, 'accept-ranges': 'bytes' });
  }
  const size = fs.statSync(file).size;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range) {
    const start = range[1] === '' ? Math.max(0, size - Number(range[2])) : Number(range[1]);
    const end = range[1] === '' || range[2] === '' ? size - 1 : Math.min(Number(range[2]), size - 1);
    if (!(start >= 0 && start <= end && start < size)) {
      return send(res, 416, '', { 'content-range': `bytes */${size}` });
    }
    res.writeHead(206, {
      'content-type': type,
      'content-length': String(end - start + 1),
      'content-range': `bytes ${start}-${end}/${size}`,
      'accept-ranges': 'bytes',
    });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, {
    'content-type': type,
    'content-length': String(size),
    'accept-ranges': 'bytes',
  });
  return fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const parts = url.pathname.split('/').filter(Boolean);

  if (req.method === 'GET' && url.pathname === '/healthz') {
    const running = [...jobs.values()].filter((j) => stateOf(j) === 'running').length;
    const queued = [...jobs.values()].filter((j) => stateOf(j) === 'queued').length;
    return send(res, 200, { ok: true, engineVersion: ENGINE_VERSION, queued, running });
  }

  if (req.headers.authorization !== `Bearer ${SECRET}`) {
    return send(res, 401, { error: 'unauthorised' });
  }

  if (req.method === 'POST' && url.pathname === '/check') {
    const body = await readBody(req);
    if (typeof body.url !== 'string' || !/^https?:\/\//.test(body.url)) {
      return send(res, 400, { error: 'That does not look like a web address.' });
    }
    const id = randomUUID();
    jobs.set(id, { url: body.url, startedAt: Date.now() });
    console.log(`[mock-engine] check ${body.url} -> ${id}`);
    return send(res, 202, { id });
  }

  if (parts[0] === 'jobs' && parts[1]) {
    const id = decodeURIComponent(parts[1]);
    if (req.method === 'GET' && parts.length === 2) {
      const job = jobJson(id);
      return job ? send(res, 200, job) : send(res, 404, { error: 'not found' });
    }
    if (req.method === 'GET' && parts[2] === 'files' && parts[3]) {
      const name = decodeURIComponent(parts[3]);
      if (!jobs.has(id)) return send(res, 404, { error: 'not found' });
      if (!SHOT_FILES.has(name)) return send(res, 404, { error: 'not found' });
      return serveFile(req, res, name);
    }
    if (req.method === 'DELETE' && parts.length === 2) {
      if (!jobs.has(id)) return send(res, 404, { error: 'not found' });
      jobs.delete(id);
      console.log(`[mock-engine] deleted ${id}`);
      res.writeHead(204);
      return res.end();
    }
  }

  return send(res, 404, { error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-engine] listening on http://127.0.0.1:${PORT}`);
});
