import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

/** Applies migrations to the test database once per test run. */
export default function setup(): void {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://operaflow:operaflow_local_dev@127.0.0.1:5433/operaflow_test';
  const dbDir = resolve(__dirname, '..', '..', '..', 'packages', 'db');
  execSync('npx prisma migrate deploy', { cwd: dbDir, env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit' });
}
