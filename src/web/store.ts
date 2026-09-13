// Which job store the app is using.
//
// Two implementations behind one interface:
//   store-file.ts  the original: a job.json per job under data/jobs, engine in-process (localhost).
//   store-d1.ts    Cloudflare Workers: jobs in D1, renders in R2, engine over HTTP.
//
// Detection (see documents/ENGINE-API.md): the D1 store is used when the code is running on
// workerd AND a DB binding is present. The workerd part matters: `next dev` also has the
// bindings (next.config.ts calls initOpenNextCloudflareForDev), and the localhost demo must keep
// running the engine in-process exactly as before.
import type { Job } from '@/engine/types';

export class RateLimitError extends Error {
  readonly code = 'rate-limit';
}

export const ID_RE = /^[a-z0-9]{10}$/;

export const CACHE_MS = 24 * 60 * 60 * 1000; // a done job for the same address is reused for a day
export const RATE_WINDOW_MS = 10 * 60 * 1000;
export const RATE_MAX = 5;

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

/** One byte range, inclusive both ends. */
export interface ByteRange {
  start: number;
  end: number;
}

/** "bytes=0-1023", "bytes=500-", "bytes=-500" -> offsets, or null if it cannot be honoured. */
export function parseRange(header: string, size: number): ByteRange | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  let start: number;
  let end: number;
  if (rawStart === '') {
    if (rawEnd === '') return null;
    const len = Number(rawEnd);
    if (!Number.isFinite(len) || len <= 0) return null;
    start = Math.max(0, size - len);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Number(rawEnd);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

/** What a store hands the shot route: enough to write the response, nothing about HTTP. */
export type ShotResult =
  | { kind: 'not-found' }
  | { kind: 'unsatisfiable'; size: number }
  | { kind: 'full'; size: number; type: string; body: BodyInit }
  | { kind: 'partial'; size: number; type: string; body: BodyInit; range: ByteRange };

export interface StorageUsage {
  bytes: number;
  label: string; // where those bytes live, for the admin line
}

export interface JobStore {
  /** 'file' on localhost, 'd1' on Workers. Only for wording and diagnostics. */
  readonly kind: 'file' | 'd1';
  /** Queue a check, or return a recent cached one. Throws UrlError or RateLimitError. */
  createJob(input: string, ip?: string, fresh?: boolean): Promise<Job>;
  getJob(id: string): Promise<Job | undefined>;
  /** Newest first, for the admin table. */
  listJobs(): Promise<Job[]>;
  deleteJob(id: string): Promise<void>;
  /** Position in the local queue; 0 when the store has no queue of its own. */
  queuePosition(id: string): number;
  /** One shot or clip, honouring a Range header. */
  getShot(id: string, file: string, rangeHeader: string | null): Promise<ShotResult>;
  /** Bytes held by renders, for the admin page. */
  usage(): Promise<StorageUsage>;
}

/** True when this code is executing on Cloudflare's runtime rather than in Node. */
export function onWorkers(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers';
}

let cached: JobStore | undefined;

export async function getStore(): Promise<JobStore> {
  if (cached) return cached;
  if (onWorkers()) {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const { env } = await getCloudflareContext({ async: true });
    if (env.DB && env.RENDERS) {
      const { createD1Store } = await import('./store-d1');
      const d1 = createD1Store(env);
      cached = d1;
      return d1;
    }
  }
  const { fileStore } = await import('./store-file');
  cached = fileStore;
  return fileStore;
}
