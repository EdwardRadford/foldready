// Runs after tsc emits to dist/. dist/ is CommonJS output, but the repo root package.json
// has "type": "module" — this override makes Node treat dist/**/*.js as CommonJS again.
import { writeFileSync } from 'node:fs';

writeFileSync(new URL('../dist/package.json', import.meta.url), JSON.stringify({ type: 'commonjs' }) + '\n');
