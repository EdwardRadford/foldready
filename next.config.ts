import type { NextConfig } from 'next';
const config: NextConfig = {
  serverExternalPackages: ['playwright', 'playwright-core', 'pixelmatch', 'pngjs'],
  agentRules: false,
};
export default config;
