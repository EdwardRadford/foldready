// The job store's poll handling under overlap. Found 4 Oct 2026 in the Cloud Run log: two polls
// that both saw the engine finish both collected the job; the second hit 404s after the first had
// dropped the engine's copy, and a 404 marks a job "stopped". These tests run the real store
// against SQLite with the real migrations, and a fake engine whose responses the test controls.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createD1Store } from '@/web/store-d1';
import { ENGINE_VERSION } from '@/engine/device';
import { fakeD1 } from './fake-d1';

const JOB = 'abcde12345';
const ENGINE_JOB = 'engine-1';
const URL_CHECKED = 'https://example.com/';

type EngineReply = () => Promise<Response>;

let db: D1Database;
let pending: Promise<unknown>[];
let jobReplies: EngineReply[];
let engineDeleted: boolean;

const result = {
  id: ENGINE_JOB,
  engineVersion: ENGINE_VERSION,
  url: URL_CHECKED,
  finalUrl: URL_CHECKED,
  checkedAt: '2026-10-05T10:00:00.000Z',
  durationMs: 1000,
  outcome: 'passes',
  score: 100,
  summary: 'ok',
  findings: [],
  shots: [{ file: 'folded.png' }, { file: 'unfolded.png' }],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const engineDone: EngineReply = async () => json({ id: ENGINE_JOB, state: 'done', progress: 'Done', result });
const engineRunning: EngineReply = async () => json({ id: ENGINE_JOB, state: 'running', progress: 'Rendering' });

function store() {
  const renders = {
    put: async () => ({}),
    list: async () => ({ objects: [], truncated: false }),
    delete: async () => {},
  } as unknown as R2Bucket;
  const env = { DB: db, RENDERS: renders, ENGINE_URL: 'https://engine.test' } as unknown as CloudflareEnv;
  const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p) } as unknown as ExecutionContext;
  return createD1Store(env, ctx);
}

async function row() {
  return db.prepare('SELECT state, error FROM jobs WHERE id = ?').bind(JOB).first<{ state: string; error: string | null }>();
}

async function events(kind: string) {
  await Promise.all(pending);
  const r = await db.prepare('SELECT count(*) AS n FROM events WHERE kind = ?').bind(kind).first<{ n: number }>();
  return r?.n ?? 0;
}

beforeEach(async () => {
  db = fakeD1();
  pending = [];
  jobReplies = [];
  engineDeleted = false;
  await db
    .prepare(
      `INSERT INTO jobs (id, url, state, progress, engine_job_id, engine_version, created_at)
       VALUES (?, ?, 'running', 'Rendering', ?, ?, ?)`,
    )
    .bind(JOB, URL_CHECKED, ENGINE_JOB, ENGINE_VERSION, new Date().toISOString())
    .run();

  vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (init?.method === 'DELETE') {
      engineDeleted = true;
      return new Response(null, { status: 204 });
    }
    if (engineDeleted) return new Response('gone', { status: 404 });
    if (path.includes('/files/')) return new Response(new Uint8Array([1, 2, 3]));
    const next = jobReplies.shift();
    return next ? next() : engineDone();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('job store under overlapping polls', () => {
  it('two polls that both see the engine finish leave one finished job and count it once', async () => {
    const s = store();
    const [a, b] = await Promise.all([s.getJob(JOB), s.getJob(JOB)]);
    expect(a?.state).toBe('done');
    expect(b?.state).toBe('done');
    expect((await row())?.state).toBe('done');
    expect(await events('check_done')).toBe(1);
    expect(await events('check_stopped')).toBe(0);
  });

  it('a poll that finds the engine copy gone after another collected it reports done, not stopped', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    jobReplies.push(async () => {
      await gate;
      return new Response('gone', { status: 404 }); // answered after the other poll's DELETE
    });
    const s = store();
    const late = s.getJob(JOB); // reads the row as running, then waits on the engine
    await new Promise((r) => setTimeout(r, 0));
    await s.getJob(JOB); // collects and deletes the engine copy meanwhile
    expect(engineDeleted).toBe(true);
    release();
    expect((await late)?.state).toBe('done');
    expect((await row())?.state).toBe('done');
    expect(await events('check_stopped')).toBe(0);
  });

  it('a slow progress poll cannot drag a finished job back to running', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    jobReplies.push(async () => {
      await gate;
      return engineRunning();
    });
    const s = store();
    const slow = s.getJob(JOB); // reads the row as running, then waits on the engine
    await new Promise((r) => setTimeout(r, 0));
    await s.getJob(JOB); // finishes the job meanwhile
    release();
    await slow;
    expect((await row())?.state).toBe('done');
    // And the next poll still reads it as done, even though the engine copy is gone.
    expect((await s.getJob(JOB))?.state).toBe('done');
    expect(await events('check_stopped')).toBe(0);
  });

  it('a job the engine really lost is marked stopped and counted once', async () => {
    engineDeleted = true; // the engine never heard of it
    const s = store();
    const job = await s.getJob(JOB);
    expect(job?.state).toBe('error');
    expect((await row())?.state).toBe('error');
    await s.getJob(JOB);
    expect(await events('check_stopped')).toBe(1);
  });
});
