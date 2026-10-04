import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The '@/' alias from tsconfig.json, so tests can import the web store the way the app does.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
