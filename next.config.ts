import type { NextConfig } from 'next';
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';

// Set by open-next.config.ts when the OpenNext CLI is driving the build. workerd cannot run
// Playwright, so for that build the engine module is swapped for a stub: without this esbuild
// follows store-file.ts's `import('@/engine/index')` and tries to bundle playwright-core.
const forCloudflare = process.env.FOLDREADY_CF_BUILD === '1';

const config: NextConfig = {
  serverExternalPackages: ['playwright', 'playwright-core', 'pixelmatch', 'pngjs'],
  agentRules: false,
  ...(forCloudflare
    ? { turbopack: { resolveAlias: { '@/engine/index': './src/web/engine-not-on-workers.ts' } } }
    : {}),
};

// Lets `next dev` see the wrangler.jsonc bindings (local D1/R2) the same way the Worker does.
// The store still takes the file-based path in dev: see src/web/store.ts, which only switches to
// D1 when the code is actually running on workerd.
void initOpenNextCloudflareForDev();

export default config;
