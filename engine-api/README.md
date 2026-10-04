# Fold Ready render engine — Cloud Run service

HTTP wrapper around `src/engine/` (Playwright WebKit + ffmpeg). Contract:
`documents/ENGINE-API.md`. This directory does not touch `src/engine/`, `app/`, or `src/web/` —
it only imports from `src/engine/` unchanged.

## Local development

```
npm i                                  # once, installs hono + @hono/node-server too
ENGINE_SECRET=dev-secret npm run engine:dev
```

Runs `engine-api/server.ts` directly via `tsx`. Listens on `$PORT`, defaulting to `8791` when
`PORT` is unset (Cloud Run always sets `PORT`, so this default only matters locally). Jobs are
written under `os.tmpdir()/foldready-jobs/<id>/`, which works on both Windows and Linux.

Quick check:

```
curl http://localhost:8791/healthz
curl -X POST http://localhost:8791/check \
  -H "Authorization: Bearer dev-secret" -H "content-type: application/json" \
  -d '{"url":"https://example.com"}'
curl -H "Authorization: Bearer dev-secret" http://localhost:8791/jobs/<id>
curl -H "Authorization: Bearer dev-secret" http://localhost:8791/jobs/<id>/files/folded.png -o folded.png
curl -X DELETE -H "Authorization: Bearer dev-secret" http://localhost:8791/jobs/<id>
```

## Build (compiled, no tsx at runtime)

```
npm run engine:build     # tsc -p engine-api/tsconfig.json, emits to dist/, then writes dist/package.json
npm run engine:start     # node dist/engine-api/server.js
```

`engine-api/tsconfig.json` compiles `engine-api/` and `src/engine/` to CommonJS
(`module: CommonJS`, `moduleResolution: bundler` — TypeScript 7 dropped the old `node10`
resolver, and `nodenext`/`node16` would force every relative import in `src/engine/` to carry an
explicit extension, which we can't add since that tree is read-only). Because the repo root
`package.json` has `"type": "module"`, plain `.js` files under `dist/` would otherwise be
interpreted as ESM by Node and fail to resolve the extensionless `require()`-style imports that
`tsc` emits for `src/engine/`'s relative imports. `write-dist-pkg.mjs` drops a
`dist/package.json` with `{ "type": "commonjs" }` to override that for the compiled tree only.

## Docker image

Base image: `mcr.microsoft.com/playwright:v1.63.0-noble` (WebKit, ffmpeg, system libs
pre-installed; browsers cached under `/ms-playwright`). Two-stage build — a builder stage with
full dependencies compiles `engine-api/` and `src/engine/` to `dist/`; the runtime stage is a
clean copy of the same base image with only production dependencies and the compiled `dist/`.

Both stages install from `engine-api/package.json` + `engine-api/package-lock.json` — the
engine's own minimal dependency set (`playwright` pinned to the exact version the root uses,
`pixelmatch`, `pngjs`, `hono`, `@hono/node-server`, plus `typescript`/`@types/node` as dev
dependencies for the build stage), not the whole repo's `next`/`react`/`wrangler`/etc. The
lockfile was generated with `npm install --package-lock-only` run inside `engine-api/`; it is
independent of the root `package-lock.json` and should be regenerated the same way (from inside
`engine-api/`) if `engine-api/package.json`'s versions change.

```
docker build -t foldready-engine -f engine-api/Dockerfile .
docker run --rm -e ENGINE_SECRET=dev-secret -p 8792:8080 foldready-engine
```

Built and run locally on 2026-09-13. With the shared root manifest the image was ~4.2 GB; with `engine-api/` installing from its own `package.json`/`package-lock.json` (playwright, pixelmatch, pngjs, hono, @hono/node-server and the two type packages for the build stage) it measures 0.96 GB (`docker image inspect`). Verified inside the rebuilt container: `/healthz` 200 and a full `POST /check` against https://example.com finishing with 8 shots and 2 clips.

## Deploy

`gcloud run deploy --source engine-api` does **not** work here: Cloud Run's source deploy uses the
given directory as the build context, but `engine-api/Dockerfile` needs `src/engine/`, which sits
outside `engine-api/`. Build with Cloud Build from the repo root instead, using
`engine-api/cloudbuild.yaml` (context `.`, so `src/engine/` is visible), then deploy the pushed
image:

```
# one-time: create the Artifact Registry repo
gcloud artifacts repositories create foldready --repository-format=docker --location=europe-west2

# from the repo root
gcloud builds submit --config engine-api/cloudbuild.yaml .

gcloud run deploy foldready-engine \
  --image europe-west2-docker.pkg.dev/<project>/foldready/foldready-engine:latest \
  --region europe-west2 \
  --memory 4Gi --cpu 2 --no-cpu-throttling --concurrency 10 --timeout 300 \
  --min-instances 0 --max-instances 1 \
  --set-secrets ENGINE_SECRET=foldready-engine-secret:latest \
  --allow-unauthenticated
```

`engine-api/cloudbuild.yaml` builds `-f engine-api/Dockerfile .` and pushes to
`${_REGION}-docker.pkg.dev/${PROJECT_ID}/${_REPO}/${_IMAGE_NAME}:${_TAG}` (all overridable via
`--substitutions`, e.g. `--substitutions=_TAG=$(git rev-parse --short HEAD)`).

Env/secret names:
- `ENGINE_SECRET` — bearer token every request must present (`Authorization: Bearer <secret>`),
  except `/healthz`. Comes from Secret Manager as `foldready-engine-secret` per the contract.
- `PORT` — set by Cloud Run automatically (8080). No other env vars required.

The front end (Workers) needs the deployed service URL as `ENGINE_URL` and the same secret value
as `ENGINE_SECRET` — see `documents/ENGINE-API.md`'s "Workers front end" section.

## Behaviour notes

- In-process queue, concurrency 1. One Playwright browser per process, reused across jobs
  (`closeBrowser()` only runs on shutdown).
- **Max instances must stay at 1.** Jobs live in this process's memory and disk, so a second
  instance answers `404` for every job it did not start, and the front end reads a `404` as "the
  check stopped". With max 3, a heavy render pushed CPU up, Cloud Run started a second instance,
  routed polls to it, and real sites never finished (found 2 Oct 2026). The browser work is
  serialised by the in-process queue, not by request concurrency, so `--concurrency 10` only lets
  polls and file fetches overlap a running check.
- Jobs and their files live under `os.tmpdir()/foldready-jobs/<id>/` and are swept 60 minutes
  after the job finishes (or immediately on `DELETE /jobs/:id`). The container is ephemeral — the
  front end must copy files into R2 before that window closes.
- `POST /check` validates the URL synchronously (`normaliseUrl` + `assertPublicHost` from
  `src/engine/url.ts`) before queueing, so a bad or private address gets a `400` on the `POST`
  itself rather than surfacing later as a failed job.
- `GET /jobs/:id/files/:name` only serves names in `SHOT_FILES`/`VIDEO_FILES`
  (`src/engine/index.ts`), honours `Range: bytes=start-end` and suffix ranges (`bytes=-N`) with a
  206 + `Content-Range` response, and sets `Accept-Ranges: bytes` on every response.
- `SIGTERM`: stops accepting new connections, waits up to 20s for the in-flight job to finish,
  calls `closeBrowser()`, then exits. Verified the process exits on both a real SIGTERM (Linux
  container) and an external kill on Windows (where `process.on('SIGTERM')` isn't reliably
  invoked by an outside kill — Windows has no native SIGTERM; Node can only observe it when the
  signal originates from within the process tree, e.g. Docker Desktop's Linux VM sending it to
  the containerized process). The code path is exercised in the container network too.
