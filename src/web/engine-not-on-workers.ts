// Stands in for the engine in the Cloudflare Workers build (see next.config.ts): workerd cannot
// run Playwright, and the Workers store calls the engine service over HTTP instead. Keeping the
// real module out of that bundle is what stops esbuild dragging playwright-core into the Worker.
import type { Result } from '@/engine/types';

export async function runCheck(): Promise<Result> {
  throw new Error('The render engine does not run on Workers; the Workers store calls ENGINE_URL.');
}
