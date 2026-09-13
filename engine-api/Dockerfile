# Fold Ready render engine — Cloud Run service.
# Two-stage build: compile TypeScript to CommonJS in a full build image, run the
# compiled output in a clean copy of the same Playwright base (browsers included).

FROM mcr.microsoft.com/playwright:v1.63.0-noble AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/engine ./src/engine
COPY engine-api ./engine-api

RUN npm run engine:build


FROM mcr.microsoft.com/playwright:v1.63.0-noble AS runtime
WORKDIR /app

# The base image's browsers already live here; PLAYWRIGHT_BROWSERS_PATH must match
# before `npm ci` installs the `playwright` package, so its postinstall skips downloading.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PORT=8080
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 8080
CMD ["node", "dist/engine-api/server.js"]
