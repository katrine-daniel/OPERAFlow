// Runs a real PostgreSQL server locally (no Docker required) for development and tests.
// Uses the `embedded-postgres` package, which ships official PostgreSQL binaries via npm.
// Data lives in ./.data/pg (gitignored). Stop with Ctrl+C.
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const port = Number(process.env.DEV_PG_PORT ?? 5433);
const user = process.env.DEV_PG_USER ?? 'operaflow';
const password = process.env.DEV_PG_PASSWORD ?? 'operaflow_local_dev';
const dataDir = resolve(process.cwd(), '.data', 'pg');

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user,
  password,
  port,
  persistent: true,
  // UTF-8 is mandatory: guest and hotel names routinely contain non-Latin characters.
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
});

const fresh = !existsSync(resolve(dataDir, 'PG_VERSION'));
if (fresh) await pg.initialise();
await pg.start();

for (const db of ['operaflow', 'operaflow_test']) {
  try {
    await pg.createDatabase(db);
    console.log(`created database ${db}`);
  } catch {
    // already exists
  }
}

console.log(`PostgreSQL ready on 127.0.0.1:${port} (databases: operaflow, operaflow_test)`);

const shutdown = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
setInterval(() => {}, 1 << 30);
