// Job store for the web app. In-memory Map plus a job.json per job on disk.
// Single worker, concurrency 1: one browser run at a time.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import type { Job, Result } from '@/engine/types';
import { UrlError, normaliseUrl, assertPublicHost } from '@/engine/url';
// device.ts is plain constants: importing it here does not pull Playwright into a route bundle.
import { ENGINE_VERSION } from '@/engine/device';

const DATA_ROOT = path.join(process.cwd(), 'data', 'jobs');

const CACHE_MS = 24 * 60 * 60 * 1000; // a done job for the same address is reused for a day
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 5;
const ID_RE = /^[a-z0-9]{10}$/;

export class RateLimitError extends Error {
  readonly code = 'rate-limit';
}

interface Store {
  jobs: Map<string, Job>;
  queue: string[];
  hits: Map<string, number[]>; // ip -> timestamps of new jobs
  working: boolean;
  hydrated: boolean;
}

// Survive Next's dev hot reloads.
const g = globalThis as unknown as { __foldReadyJobs?: Store };
const store: Store =
  g.__foldReadyJobs ??
  (g.__foldReadyJobs = {
    jobs: new Map<string, Job>(),
    queue: [],
    hits: new Map<string, number[]>(),
    working: false,
    hydrated: false,
  });

export function jobDir(id: string): string {
  return path.join(DATA_ROOT, id);
}

function jobFile(id: string): string {
  return path.join(DATA_ROOT, id, 'job.json');
}

function newId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 10; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

async function save(job: Job): Promise<void> {
  try {
    await fs.mkdir(jobDir(job.id), { recursive: true });
    await fs.writeFile(jobFile(job.id), JSON.stringify(job, null, 2), 'utf8');
  } catch {
    // Disk is a convenience here; the in-memory job is the source of truth while the process lives.
  }
}

async function load(id: string): Promise<Job | undefined> {
  try {
    const raw = await fs.readFile(jobFile(id), 'utf8');
    return JSON.parse(raw) as Job;
  } catch {
    return undefined;
  }
}

/** Read every job.json once per process so the 24h cache survives a restart. */
async function hydrate(): Promise<void> {
  if (store.hydrated) return;
  store.hydrated = true;
  let ids: string[] = [];
  try {
    ids = await fs.readdir(DATA_ROOT);
  } catch {
    return;
  }
  for (const id of ids) {
    if (!ID_RE.test(id) || store.jobs.has(id)) continue;
    const job = await load(id);
    if (!job) continue;
    // A job left mid-flight by a restart is not coming back.
    if (job.state === 'queued' || job.state === 'running') {
      job.state = 'error';
      job.error = 'That check stopped before it finished. Run it again.';
    }
    store.jobs.set(id, job);
  }
}

function rateCheck(ip: string): void {
  const now = Date.now();
  const seen = (store.hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (seen.length >= RATE_MAX) {
    const waitMs = RATE_WINDOW_MS - (now - seen[0]);
    const mins = Math.max(1, Math.ceil(waitMs / 60000));
    store.hits.set(ip, seen);
    throw new RateLimitError(
      `That is ${RATE_MAX} checks in ten minutes from this connection. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`,
    );
  }
  seen.push(now);
  store.hits.set(ip, seen);
}

function checkedAtMs(job: Job): number {
  const at = Date.parse(job.result?.checkedAt ?? job.createdAt);
  return Number.isFinite(at) ? at : 0;
}

async function findCached(url: string): Promise<Job | undefined> {
  const cutoff = Date.now() - CACHE_MS;
  const candidates = [...store.jobs.values()]
    .filter(
      (job) =>
        job.state === 'done' &&
        job.url === url &&
        // A result from an older engine is missing whole sections; re-run it rather than serve it.
        job.result?.engineVersion === ENGINE_VERSION &&
        checkedAtMs(job) >= cutoff,
    )
    .sort((a, b) => checkedAtMs(b) - checkedAtMs(a));

  for (const job of candidates) {
    try {
      // A job whose screenshots have been cleaned up is not a usable cache hit.
      await fs.access(jobFile(job.id));
      return job;
    } catch {
      store.jobs.delete(job.id);
    }
  }
  return undefined;
}

/**
 * Queue a check. Returns an existing recent result for the same address instead of
 * running the browser twice, unless `fresh` is set or the cached result came from an older
 * engine. Throws UrlError (plain English) or RateLimitError.
 */
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // permalinks live a month; then the folder goes
const SWEEP_EVERY_MS = 60 * 60 * 1000;
let lastSweep = 0;

/** Delete finished jobs older than the retention window. Runs at most hourly, never blocks a check. */
async function sweep(): Promise<void> {
  const now = Date.now();
  if (now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  for (const job of [...store.jobs.values()]) {
    if (job.state === 'queued' || job.state === 'running') continue;
    if (now - checkedAtMs(job) < RETENTION_MS) continue;
    store.jobs.delete(job.id);
    await fs.rm(jobDir(job.id), { recursive: true, force: true }).catch(() => {});
  }
}

export async function createJob(input: string, ip = 'unknown', fresh = false): Promise<Job> {
  await hydrate();
  void sweep();

  const u = normaliseUrl(input);
  await assertPublicHost(u);
  const url = u.toString();

  if (!fresh) {
    const cached = await findCached(url);
    if (cached) return cached;
  }

  rateCheck(ip);

  const job: Job = {
    id: newId(),
    url,
    state: 'queued',
    progress: 'Waiting for a browser',
    createdAt: new Date().toISOString(),
  };
  store.jobs.set(job.id, job);
  store.queue.push(job.id);
  await save(job);
  void pump();
  return job;
}

export async function getJob(id: string): Promise<Job | undefined> {
  if (!ID_RE.test(id)) return undefined;
  await hydrate();
  const live = store.jobs.get(id);
  if (live) return live;
  const onDisk = await load(id);
  if (onDisk) store.jobs.set(id, onDisk);
  return onDisk;
}

/** All known jobs, newest first. For the admin table. */
export async function listJobs(): Promise<Job[]> {
  await hydrate();
  return [...store.jobs.values()].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

/** Drop a job from the store and delete its folder on disk. */
export async function deleteJob(id: string): Promise<void> {
  if (!ID_RE.test(id)) return;
  store.jobs.delete(id);
  await fs.rm(jobDir(id), { recursive: true, force: true }).catch(() => {});
}

export function queuePosition(id: string): number {
  const i = store.queue.indexOf(id);
  return i < 0 ? 0 : i + 1;
}

/** Drain the queue one job at a time. */
async function pump(): Promise<void> {
  if (store.working) return;
  store.working = true;
  try {
    for (;;) {
      const id = store.queue.shift();
      if (!id) break;
      const job = store.jobs.get(id);
      if (!job || job.state !== 'queued') continue;

      job.state = 'running';
      job.progress = 'Starting a browser';
      await save(job);

      try {
        const { runCheck } = await import('@/engine/index');
        const result: Result = await runCheck(job.url, {
          id,
          outDir: jobDir(id),
          onProgress: (msg: string) => {
            job.progress = msg;
            void save(job);
          },
        });
        job.result = result;
        job.state = result.error ? 'error' : 'done';
        job.error = result.error;
        job.progress = result.error ? '' : 'Done';
      } catch (err) {
        job.state = 'error';
        job.progress = '';
        job.error =
          err instanceof UrlError
            ? err.message
            : err instanceof Error && err.message
              ? err.message
              : 'That check did not finish. Try again in a minute.';
      }
      await save(job);
    }
  } finally {
    store.working = false;
  }
}

export const SHOT_FILES = [
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
] as const;
export type ShotFile = (typeof SHOT_FILES)[number];

export function isShotFile(name: string): name is ShotFile {
  return (SHOT_FILES as readonly string[]).includes(name);
}

export function shotContentType(file: string): string {
  return file.endsWith('.webm') ? 'video/webm' : 'image/png';
}

export function shotPath(id: string, file: string): string | undefined {
  if (!ID_RE.test(id) || !isShotFile(file)) return undefined;
  return path.join(jobDir(id), file);
}
