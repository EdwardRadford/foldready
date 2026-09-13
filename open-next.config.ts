// OpenNext adapter config for Cloudflare Workers. Defaults only: no incremental cache override
// yet (nothing in the app is statically revalidated), nothing that needs a Cloudflare account.
import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// Read by next.config.ts in the child `next build` process (the CLI loads this file first and
// passes its environment on), so the Workers build swaps the Playwright engine for a stub.
process.env.FOLDREADY_CF_BUILD = '1';

const config = defineCloudflareConfig();

// `npm run build` in this repo is the engine's tsc build, not the web build.
config.buildCommand = 'npm run web:build';

export default config;
