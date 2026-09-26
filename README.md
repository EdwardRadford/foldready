# Fold Ready

[![CI](https://github.com/EdwardRadford/foldready/actions/workflows/ci.yml/badge.svg)](https://github.com/EdwardRadford/foldready/actions/workflows/ci.yml)

Renders a website at the three screen sizes of a foldable phone and reports what breaks.

Live at **[foldready.co.uk](https://foldready.co.uk)**. Paste a URL, get back screenshots and a
plain-English list of what fails when the device folds and unfolds.

Start with `src/engine/render.ts` — it loads the page folded, resizes to unfolded *without a
reload*, and resizes back, capturing all three plus any script errors thrown during the resize.
`src/engine/checks/index.ts` turns those captures into findings.

Foldables are the first mainstream device where one browser changes viewport mid-session. A layout
can pass every normal responsive test and still break the moment the phone opens, because the fold
is a *resize without a reload*: no navigation, no fresh render, just a different box. So the check
simulates it that way rather than loading the page twice at two widths, which is what most
responsive tooling does and which would miss the entire class of bug.

## How it is built

Two halves, because they want opposite things.

**The front end** is a Next.js app on Cloudflare Workers via OpenNext, with D1 for jobs and R2 for
screenshots and clips. Workers are cheap, start instantly and sit close to the user. What they
cannot do is run a browser.

**The render engine** is a container on Google Cloud Run: Playwright driving WebKit, because the
target device runs WebKit and rendering in Chromium and hoping is not a test. It is a separate
service with its own API, authenticated with a shared secret, so the front end never has to host a
browser and the engine never has to know about jobs, billing or users.

The engine is also published standalone as
[foldready-engine](https://github.com/EdwardRadford/foldready-engine).

## Things that only broke in production

Worth writing down because none of them show up locally.

**`node:net` does not work on workerd.** The SSRF guard used `net.isIP()` and friends to decide
whether a resolved address was private. On Cloudflare Workers those helpers do not behave, so every
resolver answer read as private and the guard refused any host behind a CNAME: `www.gov.uk`,
`www.bbc.co.uk`, `www.theguardian.com`. Apex domains passed, which is exactly why it looked fine in
testing. The guard now parses addresses with regex and the Worker no longer trusts `node:dns`.

**Cloud Run only grants CPU during a request.** The engine returns `202` and then does the actual
rendering from a queue, which meant the CPU was taken away precisely when the work happened. Checks
crawled and timed out. Fixed with `--no-cpu-throttling`.

**Cloud Run answers `/healthz` itself** and never passes it to the container, which makes it a
useless health path. The engine's health route is `/health`.

**A failed build is silent if you do not read the output.** One deploy failed with "could not find
compiled OpenNext config" and reported success loudly enough to look fine. The live Worker was
still the previous bundle, with the SSRF bug in it, for longer than it should have been.

## Running it

```bash
npm install
npm run dev          # localhost:3000, file store, in-process engine
```

For the Cloudflare path you will need your own `wrangler.jsonc` values: `account_id` and the D1
`database_id` are placeholders in this repo and must be filled in before `wrangler deploy` will
work. You will also need your own Cloud Run deployment of `engine-api/`, and the secrets
`ENGINE_SECRET` and `ADMIN_TOKEN`.

## Licence

No open licence. Published to be read, not reused: it is a running product. Ask if you want to do
something with it.

Built by [Edward Radford](https://edwardradford.co.uk).
