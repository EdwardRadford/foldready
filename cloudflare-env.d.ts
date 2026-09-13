// Bridges wrangler's generated bindings (worker-configuration.d.ts, from wrangler.jsonc) into the
// CloudflareEnv type the OpenNext adapter hands back from getCloudflareContext().
// Regenerate the bindings with `npx wrangler types` after editing wrangler.jsonc.
declare global {
  interface CloudflareEnv extends Env {
    ENGINE_URL?: string;
    ENGINE_SECRET?: string;
    ADMIN_TOKEN?: string;
  }
}

export {};
