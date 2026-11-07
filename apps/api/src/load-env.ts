// Must be the first import of every entry point (main.ts, worker.ts): modules read configuration while they
// load, so the repo-root .env has to be in process.env before anything else is required.
// Local development only — in containers configuration comes from the real environment.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const rootEnv = resolve(__dirname, '..', '..', '..', '.env');
if (process.env.NODE_ENV !== 'production' && existsSync(rootEnv)) process.loadEnvFile(rootEnv);
