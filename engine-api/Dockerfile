# Fold Ready render engine — Cloud Run service.
# Two-stage build: compile TypeScript to CommonJS in a full build image, run the
# compiled output in a clean copy of the same Playwright base (browsers included).
# Both stages install from engine-api/package.json + engine-api/package-lock.json —
# the engine's own minimal dependency set, not the whole repo's (Next.js, Wrangler, etc).

FROM mcr.microsoft.com/playwright:v1.63.0-noble AS builder
WORKDIR /app

COPY engine-api/package.json engine-api/package-lock.json ./
RUN npm ci

COPY src/engine ./src/engine
COPY engine-api ./engine-api

RUN npx tsc -p engine-api/tsconfig.json && node engine-api/write-dist-pkg.mjs


FROM mcr.microsoft.com/playwright:v1.63.0-noble AS runtime
WORKDIR /app

# The base image's browsers already live here; PLAYWRIGHT_BROWSERS_PATH must match
# before `npm ci` installs the `playwright` package, so its postinstall skips downloading.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PORT=8080
ENV NODE_ENV=production

COPY engine-api/package.json engine-api/package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 8080
CMD ["node", "dist/engine-api/server.js"]
