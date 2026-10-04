// The Workers job store: jobs in D1, renders in R2, the browser work done by the engine service
// over HTTP. See documents/ENGINE-API.md for the contract this implements.
//
// Ids here are the front end's own (the engine's id is kept in engine_job_id), so a permalink
// never depends on a container that is swept an hour after the check.
import type { Job, Result } from '@/engine/types';
import { UrlError, normaliseUrl, assertPublicHostSyntactic, isPrivateAddress } from '@/engine/url';
import { ENGINE_VERSION } from '@/engine/device';
import {
  ID_RE,
  CACHE_MS,
  RATE_WINDOW_MS,
  RATE_MAX,
  RateLimitError,
  isShotFile,
  parseRange,
  shotContentType,
  type JobStore,
  type ShotResult,
  type StorageUsage,
} from './store';
import { dailyHash, domainOf, recordEvent, sweepEvents, type StatEvent } from './stats';

const SHOT_CACHE = 'public, max-age=86400, immutable';
const LIST_LIMIT = 200;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // permalinks live a month; then the row and its renders go
const SWEEP_EVERY_MS = 60 * 60 * 1000;
const SWEEP_BATCH = 100;
const STOPPED = 'That check stopped before it finished. Run it again.';

interface JobRow {
  id: string;
  url: string;
  state: string;
  progress: string;
  engine_job_id: string | null;
  engine_version: number | null;
  outcome: string | null;
  score: number | null;
  created_at: string;
  checked_at: string | null;
  result_json: string | null;
  error: string | null;
}

function newId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

function rowToJob(row: JobRow): Job {
  const result = row.result_json ? (JSON.parse(row.result_json) as Result) : undefined;
  return {
    id: row.id,
    url: row.url,
    state: row.state as Job['state'],
    progress: row.progress ?? '',
    createdAt: row.created_at,
    ...(result ? { result } : {}),
    ...(row.error ? { error: row.error } : {}),
  };
}

/**
 * The SSRF guard, done the way workerd can be trusted to do it: the syntactic checks, then
 * Cloudflare's DNS-over-HTTPS resolver. If the resolver cannot be reached the address goes
 * through, because the engine runs the full guard with a real resolver before it opens a browser.
 */
async function guardUrl(u: URL): Promise<void> {
  // Syntactic checks only here. node:dns is not dependable on workerd, and trusting it refused
  // real sites (www.gov.uk, www.bbc.co.uk) as "private" on 23 Sep 2026.
  assertPublicHostSyntactic(u);

  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^[\d.]+$/.test(host) || host.includes(':')) return; // an IP literal, already judged
  for (const type of ['A', 'AAAA']) {
    let data: { Status?: number; Answer?: { type: number; data: string }[] };
    try {
      const res = await fetch(
        `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`,
        { headers: { accept: 'application/dns-json' } },
      );
      if (!res.ok) return; // resolver unavailable: leave it to the engine
      data = (await res.json()) as typeof data;
    } catch {
      return; // no outbound DNS here: leave it to the engine
    }
    if (data.Status === 3) {
      throw new UrlError('That address could not be found. Check the spelling and try again.', 'dns');
    }
    const addrs = (data.Answer ?? []).filter((a) => a.type === 1 || a.type === 28).map((a) => a.data);
    if (addrs.some((a) => isPrivateAddress(a))) {
      throw new UrlError('That address points at a private network and cannot be checked.', 'private');
    }
  }
}

// Per isolate, so a busy Worker sweeps roughly hourly however many isolates are alive. Two
// isolates sweeping at once is fine: deleting a row that has gone, or an object that has gone,
// is not an error in either D1 or R2.
let lastSweep = 0;

export function createD1Store(env: CloudflareEnv, ctx?: ExecutionContext): JobStore {
  const db = env.DB;
  const renders = env.RENDERS;

  /** Delete every object under jobs/<id>/. Safe to call for a job whose files are already gone. */
  async function removeRenders(id: string): Promise<void> {
    const prefix = `jobs/${id}/`;
    let cursor: string | undefined;
    do {
      const listed = await renders.list({ prefix, cursor });
      if (listed.objects.length > 0) {
        await renders.delete(listed.objects.map((o) => o.key));
      }
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
  }

  /**
   * Drop finished jobs past the retention window, and rate-limit hits past the window. Runs at
   * most hourly per isolate and never blocks a check: createJob hands it to waitUntil.
   */
  async function sweep(): Promise<void> {
    const now = Date.now();
    if (now - lastSweep < SWEEP_EVERY_MS) return;
    lastSweep = now;

    const cutoff = new Date(now - RETENTION_MS).toISOString();
    const { results } = await db
      .prepare(
        `SELECT id FROM jobs
          WHERE state IN ('done', 'error') AND coalesce(checked_at, created_at) < ?
          LIMIT ?`,
      )
      .bind(cutoff, SWEEP_BATCH)
      .all<{ id: string }>();

    for (const row of results ?? []) {
      try {
        await removeRenders(row.id);
        await db.prepare('DELETE FROM jobs WHERE id = ?').bind(row.id).run();
      } catch {
        // Another isolate got there first, or R2 hiccupped: the next sweep picks it up again.
      }
    }

    try {
      await db.prepare('DELETE FROM rate_hits WHERE at < ?').bind(now - RATE_WINDOW_MS).run();
    } catch {
      // Housekeeping only; rate() clears old hits on every check anyway.
    }

    try {
      await sweepEvents(db);
    } catch {
      // Housekeeping only.
    }
  }

  /** Record a stats event without holding up the response. */
  function track(ev: StatEvent): void {
    const running = recordEvent(db, ev);
    try {
      ctx?.waitUntil(running);
    } catch {
      // No live execution context: the write still runs, unsupervised.
    }
  }

  /** Run the sweep in the background, keeping the isolate alive for it where we can. */
  function startSweep(): void {
    const running = sweep().catch(() => {});
    try {
      ctx?.waitUntil(running);
    } catch {
      // No live execution context (or not this request's): the sweep still runs, unsupervised.
    }
  }

  function engineBase(): string {
    const base = env.ENGINE_URL ?? '';
    if (!base) throw new Error('ENGINE_URL is not configured.');
    return base.replace(/\/+$/, '');
  }

  function engineFetch(pathname: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (env.ENGINE_SECRET) headers.set('authorization', `Bearer ${env.ENGINE_SECRET}`);
    return fetch(`${engineBase()}${pathname}`, { ...init, headers });
  }

  async function rate(rawIp: string): Promise<void> {
    // Keyed by a salted one-day hash, never the raw address. See stats.ts.
    const ip = await dailyHash(db, 'rate', rawIp);
    const now = Date.now();
    const since = now - RATE_WINDOW_MS;
    await db.prepare('DELETE FROM rate_hits WHERE at < ?').bind(since).run();
    const row = await db
      .prepare('SELECT count(*) AS n, min(at) AS oldest FROM rate_hits WHERE ip = ? AND at >= ?')
      .bind(ip, since)
      .first<{ n: number; oldest: number | null }>();
    if (row && row.n >= RATE_MAX) {
      const waitMs = RATE_WINDOW_MS - (now - (row.oldest ?? now));
      const mins = Math.max(1, Math.ceil(waitMs / 60000));
      throw new RateLimitError(
        `That is ${RATE_MAX} checks in ten minutes from this connection. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`,
      );
    }
    await db.prepare('INSERT INTO rate_hits (ip, at) VALUES (?, ?)').bind(ip, now).run();
  }

  async function findCached(url: string): Promise<Job | undefined> {
    const cutoff = new Date(Date.now() - CACHE_MS).toISOString();
    const row = await db
      .prepare(
        `SELECT * FROM jobs
          WHERE url = ? AND state = 'done' AND engine_version = ? AND checked_at >= ?
          ORDER BY checked_at DESC LIMIT 1`,
      )
      .bind(url, ENGINE_VERSION, cutoff)
      .first<JobRow>();
    return row ? rowToJob(row) : undefined;
  }

  /** Stream one render out of the engine and into R2. Returns false if the file never arrived. */
  async function copyToR2(id: string, engineJobId: string, name: string): Promise<boolean> {
    const key = `jobs/${id}/${name}`;
    const httpMetadata = { contentType: shotContentType(name), cacheControl: SHOT_CACHE };
    const path = `/jobs/${encodeURIComponent(engineJobId)}/files/${encodeURIComponent(name)}`;
    const res = await engineFetch(path);
    if (!res.ok || !res.body) return false;
    try {
      await renders.put(key, res.body, { httpMetadata });
      return true;
    } catch {
      // Some streams have to be buffered (R2 wants a length): fetch it again and put the bytes.
      const retry = await engineFetch(path);
      if (!retry.ok) return false;
      await renders.put(key, await retry.arrayBuffer(), { httpMetadata });
      return true;
    }
  }

  /** Engine says done: pull every render into R2, store the result, drop the engine's copy. */
  async function finish(id: string, engineJobId: string, result: Result): Promise<Job> {
    const files = [...result.shots.map((s) => s.file), ...(result.videos ?? []).map((v) => v.file)]
      .filter((f, i, all) => isShotFile(f) && all.indexOf(f) === i);

    for (const name of files) {
      try {
        await copyToR2(id, engineJobId, name);
      } catch {
        // One missing render is not a failed check: the page shows what did arrive.
      }
    }

    // The permalink is ours, so the result carries our id and the shot URLs follow it.
    const stored: Result = { ...result, id };
    const checkedAt = stored.checkedAt ?? new Date().toISOString();
    // Two overlapping polls can both get here. Only the first write lands, and only it counts.
    const written = await db
      .prepare(
        `UPDATE jobs SET state = 'done', progress = 'Done', result_json = ?, outcome = ?,
           score = ?, checked_at = ?, engine_version = ?, error = NULL
         WHERE id = ? AND state NOT IN ('done', 'error')`,
      )
      .bind(
        JSON.stringify(stored),
        stored.outcome ?? null,
        stored.score ?? null,
        checkedAt,
        stored.engineVersion ?? ENGINE_VERSION,
        id,
      )
      .run();
    if ((written.meta?.changes ?? 0) > 0) {
      track({ kind: 'check_done', domain: domainOf(stored.url), jobId: id });
    }

    try {
      await engineFetch(`/jobs/${encodeURIComponent(engineJobId)}`, { method: 'DELETE' });
    } catch {
      // The container sweeps its own jobs after an hour anyway.
    }

    const row = await db.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).first<JobRow>();
    return row ? rowToJob(row) : { id, url: stored.url, state: 'done', progress: 'Done', createdAt: checkedAt, result: stored };
  }

  /** Mark a job failed, unless it already finished. Never turns a done check into an error. */
  async function fail(id: string, url: string, message: string): Promise<void> {
    const written = await db
      .prepare(
        "UPDATE jobs SET state = 'error', progress = '', error = ? WHERE id = ? AND state NOT IN ('done', 'error')",
      )
      .bind(message, id)
      .run();
    if ((written.meta?.changes ?? 0) > 0) {
      track({ kind: message === STOPPED ? 'check_stopped' : 'check_failed', domain: domainOf(url), jobId: id });
    }
  }

  return {
    kind: 'd1',

    async createJob(input: string, ip = 'unknown', fresh = false, country?: string): Promise<Job> {
      startSweep();

      const u = normaliseUrl(input);
      await guardUrl(u);
      const url = u.toString();

      if (!fresh) {
        const cached = await findCached(url);
        if (cached) {
          track({ kind: 'check_cached', domain: domainOf(url), jobId: cached.id, country });
          return cached;
        }
      }

      await rate(ip);

      const res = await engineFetch('/check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url, fresh }),
      });
      const payload = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (res.status === 400) {
        throw new UrlError(payload.error ?? 'That address cannot be checked.', 'engine');
      }
      if (res.status === 429) {
        throw new RateLimitError(payload.error ?? 'The checker is busy right now. Try again in a minute.');
      }
      if (!res.ok || !payload.id) {
        throw new Error(`The engine refused that check (${res.status}).`);
      }

      const job: Job = {
        id: newId(),
        url,
        state: 'queued',
        progress: 'Waiting for a browser',
        createdAt: new Date().toISOString(),
      };
      await db
        .prepare(
          `INSERT INTO jobs (id, url, state, progress, engine_job_id, engine_version, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(job.id, job.url, job.state, job.progress, payload.id, ENGINE_VERSION, job.createdAt)
        .run();
      track({ kind: 'check_started', domain: domainOf(url), jobId: job.id, country });
      return job;
    },

    async getJob(id: string): Promise<Job | undefined> {
      if (!ID_RE.test(id)) return undefined;
      const row = await db.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).first<JobRow>();
      if (!row) return undefined;
      if (row.state === 'done' || row.state === 'error') return rowToJob(row);
      if (!row.engine_job_id) return rowToJob(row);

      // Still in flight: mirror the engine's view of it once per poll.
      let engineJob: Job;
      try {
        const res = await engineFetch(`/jobs/${encodeURIComponent(row.engine_job_id)}`);
        if (res.status === 404) {
          // Either the engine lost the job, or an overlapping poll has just collected it and
          // dropped the engine's copy. The second case is a finished check: read it again.
          const now = await db.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).first<JobRow>();
          if (now && (now.state === 'done' || now.state === 'error')) return rowToJob(now);
          await fail(id, row.url, STOPPED);
          const after = await db.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).first<JobRow>();
          return after ? rowToJob(after) : { ...rowToJob(row), state: 'error', progress: '', error: STOPPED };
        }
        if (!res.ok) return rowToJob(row);
        engineJob = (await res.json()) as Job;
      } catch {
        return rowToJob(row); // engine unreachable this second; the poller comes back
      }

      if (engineJob.state === 'done' && engineJob.result && !engineJob.result.error) {
        return finish(id, row.engine_job_id, engineJob.result);
      }
      if (engineJob.state === 'error' || engineJob.result?.error) {
        const message =
          engineJob.error ?? engineJob.result?.error ?? 'That check did not finish. Try again in a minute.';
        await fail(id, row.url, message);
        const after = await db.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).first<JobRow>();
        return after ? rowToJob(after) : { ...rowToJob(row), state: 'error', progress: '', error: message };
      }

      const progress = engineJob.progress ?? '';
      await db
        // Conditional for the same reason as finish(): a slow poll must not drag a finished job back.
        .prepare("UPDATE jobs SET state = ?, progress = ? WHERE id = ? AND state NOT IN ('done', 'error')")
        .bind(engineJob.state, progress, id)
        .run();
      return { ...rowToJob(row), state: engineJob.state, progress };
    },

    async listJobs(): Promise<Job[]> {
      const { results } = await db
        .prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?')
        .bind(LIST_LIMIT)
        .all<JobRow>();
      return (results ?? []).map(rowToJob);
    },

    async deleteJob(id: string): Promise<void> {
      if (!ID_RE.test(id)) return;
      await db.prepare('DELETE FROM jobs WHERE id = ?').bind(id).run();
      await removeRenders(id);
    },

    queuePosition(): number {
      return 0; // the queue lives in the engine
    },

    async getShot(id: string, file: string, rangeHeader: string | null): Promise<ShotResult> {
      if (!ID_RE.test(id) || !isShotFile(file)) return { kind: 'not-found' };
      const key = `jobs/${id}/${file}`;
      const head = await renders.head(key);
      if (!head) return { kind: 'not-found' };
      const size = head.size;
      const type = head.httpMetadata?.contentType ?? shotContentType(file);

      if (rangeHeader) {
        const range = parseRange(rangeHeader, size);
        if (!range) return { kind: 'unsatisfiable', size };
        const object = await renders.get(key, {
          range: { offset: range.start, length: range.end - range.start + 1 },
        });
        if (!object || !('body' in object)) return { kind: 'not-found' };
        return { kind: 'partial', size, type, body: object.body, range };
      }

      const object = await renders.get(key);
      if (!object || !('body' in object)) return { kind: 'not-found' };
      return { kind: 'full', size, type, body: object.body };
    },

    async usage(): Promise<StorageUsage> {
      let bytes = 0;
      let cursor: string | undefined;
      do {
        const listed = await renders.list({ prefix: 'jobs/', cursor, limit: 1000 });
        for (const o of listed.objects) bytes += o.size;
        cursor = listed.truncated ? listed.cursor : undefined;
      } while (cursor);
      return { bytes, label: 'in R2' };
    },
  };
}
