# Engine API contract (Cloud Run service) and Workers front end

Decided 13 Sep 2026. The render engine (Playwright WebKit + ffmpeg) runs as a small HTTP service in a container on Google Cloud Run. The Next.js front end runs on Cloudflare Workers via OpenNext, with D1 for jobs and R2 for renders. This file is the contract between them. Keep it additive.

## Engine service

Location in repo: `engine-api/` (server, Dockerfile, README). It imports the engine from `src/engine/` unchanged.

Auth: every request carries `Authorization: Bearer <ENGINE_SECRET>`. Missing or wrong → 401 `{ "error": "unauthorised" }`. `ENGINE_SECRET` comes from the environment.

Routes:

| Method | Path | Body / params | Response |
|---|---|---|---|
| GET | `/health` | – | 200 `{ ok: true, engineVersion, queued, running }` (no auth). Also served at `/healthz`, but **Cloud Run's front end answers `/healthz` itself and never passes it to the container**, so only `/health` works in production. |
| POST | `/check` | `{ url: string, fresh?: boolean }` | 202 `{ id }`; 400 `{ error }` for a bad or private address (UrlError message); 429 `{ error }` when more than 20 jobs are queued |
| GET | `/jobs/:id` | – | 200 Job (from `src/engine/types.ts`: state queued/running/done/error, progress, result, error); 404 |
| GET | `/jobs/:id/files/:name` | name ∈ SHOT_FILES ∪ VIDEO_FILES | 200 bytes with the right content type and `Accept-Ranges`; 404 |
| DELETE | `/jobs/:id` | – | 204; 404 |

Behaviour:
- In-process queue, concurrency 1. One Playwright browser per process, reused.
- Jobs live on the container's local disk under `/tmp/jobs/<id>/` and are swept 60 minutes after completion. The container is ephemeral: the front end MUST copy files into R2 as soon as a job is done.
- `fresh` is passed through for parity; the engine itself never caches (caching is the front end's job).
- Graceful shutdown on SIGTERM: finish the running job if it can within 20 s, then exit.

Container:
- Base image `mcr.microsoft.com/playwright:v1.63.0-noble` (matches the pinned Playwright; WebKit, ffmpeg and system libs included).
- Listens on `$PORT` (Cloud Run sets it, default 8080).
- Cloud Run settings: 4 GiB memory, 2 vCPU, CPU always allocated, concurrency 10, request timeout 300 s, min instances 0, **max instances 1** (jobs are in-process state; a second instance 404s every job it did not start, see engine-api/README.md), env `ENGINE_SECRET`.
- Deployed with `--allow-unauthenticated`, not `--no-allow-unauthenticated`: the service is reachable publicly and the bearer secret is what authorises a request. `engine-api/README.md` has the full deploy commands.

## Workers front end

Bindings (wrangler.jsonc): `DB` (D1), `RENDERS` (R2), vars `ENGINE_URL`, secrets `ENGINE_SECRET`, `ADMIN_TOKEN`.

Flow:
1. `POST /api/check` → normalise + SSRF guard (`src/engine/url.ts`, no Playwright import) → D1 cache lookup (same url, `engine_version` = current, `checked_at` within 24 h, unless `fresh`) → rate limit per IP (D1 table or in-memory per isolate; D1 preferred) → engine `POST /check` → insert D1 `jobs` row → `{ id }` (the front end's own id, distinct from the engine's).
2. `GET /api/jobs/[id]` → read D1 row; if not done, poll engine `GET /jobs/:engineId` once, mirror `state`/`progress`; when the engine reports done, copy every file listed in `result.shots` and `result.videos` into R2 at `jobs/<id>/<file>` (streaming, no buffering of whole files where possible), store `result` JSON in the row, set state done, then `DELETE` the engine job. Errors mirror to the row.
3. `GET /api/shot/[id]/[file]` → serve from R2 with Range passthrough (R2 `get` accepts a `range`), 24 h cache headers.
4. Admin pages read D1; delete removes the row and the R2 prefix.
5. Local `next dev` without bindings keeps today's behaviour (in-process engine, file store) so the localhost demo still works. Detection: presence of the `DB` binding via `getCloudflareContext()`.

D1 schema (`migrations/0001_jobs.sql`):

```sql
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  state TEXT NOT NULL,            -- queued | running | done | error
  progress TEXT NOT NULL DEFAULT '',
  engine_job_id TEXT,
  engine_version INTEGER,
  outcome TEXT,
  score INTEGER,
  created_at TEXT NOT NULL,
  checked_at TEXT,
  result_json TEXT,
  error TEXT
);
CREATE INDEX jobs_url_checked ON jobs (url, checked_at);
CREATE TABLE rate_hits (ip TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX rate_hits_ip ON rate_hits (ip, at);
```

Local development of the Workers build: `npx wrangler dev --port 8790` with local D1/R2 (no login needed), engine at `ENGINE_URL=http://localhost:8791` running via `npm run engine:dev`, or the mock engine in `fixtures/mock-engine.mjs` which serves `fixtures/sample-result.json` and the PNGs in `out/rr5/`.
