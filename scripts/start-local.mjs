// One command to run OPERAFlow locally: database → build → API → website.
//   npm run local        (or double-click start-operaflow.cmd on Windows)
// Stop everything with Ctrl+C.
import { spawn, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const children = [];
const log = (msg) => console.log(`\x1b[36m[operaflow]\x1b[0m ${msg}`);

const portOpen = (port) =>
  new Promise((ok) => {
    const s = createConnection({ port, host: '127.0.0.1' });
    s.once('connect', () => (s.destroy(), ok(true)));
    s.once('error', () => ok(false));
  });

async function waitFor(port, name, seconds = 120) {
  for (let i = 0; i < seconds; i++) {
    if (await portOpen(port)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${name} did not start on port ${port}`);
}

function start(name, cmd, args, cwd = root, extraEnv = {}) {
  const child = spawn(cmd, args, { cwd, shell: process.platform === 'win32', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = (line) => `\x1b[90m[${name}]\x1b[0m ${line}`;
  child.stdout.on('data', (d) => String(d).split('\n').filter(Boolean).forEach((l) => console.log(prefix(l))));
  child.stderr.on('data', (d) => String(d).split('\n').filter(Boolean).forEach((l) => console.error(prefix(l))));
  child.on('exit', (code) => code && log(`${name} exited with code ${code}`));
  children.push(child);
  return child;
}

function run(cmd, label) {
  log(label);
  execSync(cmd, { cwd: root, stdio: 'inherit', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
}

function shutdown() {
  log('stopping…');
  for (const c of children) {
    try {
      if (process.platform === 'win32') execSync(`taskkill /pid ${c.pid} /T /F`, { stdio: 'ignore' });
      else c.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
  if (!existsSync(resolve(root, '.env'))) {
    console.error('Missing .env — copy .env.example to .env and set ENCRYPTION_KEY first (see README).');
    process.exit(1);
  }
  if (!existsSync(resolve(root, 'node_modules'))) run('npm install', 'installing dependencies (first run)…');

  for (const p of [4000, 3000]) {
    if (await portOpen(p)) {
      console.error(`Port ${p} is already in use — OPERAFlow may already be running (open http://localhost:3000), or close the other program.`);
      process.exit(1);
    }
  }

  if (await portOpen(5433)) log('database already running on :5433');
  else {
    log('starting database…');
    start('db', 'node', ['scripts/dev-postgres.mjs']);
    await waitFor(5433, 'PostgreSQL');
  }

  run('npm run db:generate', 'preparing database client…');
  run('npm run build -w @operaflow/shared && npm run build -w @operaflow/db', 'building shared packages…');
  run('npm run db:migrate', 'applying database migrations…');
  run('npm run build -w @operaflow/api', 'building API…');

  log('starting API on :4000…');
  start('api', 'node', ['apps/api/dist/main.js']);
  await waitFor(4000, 'API');

  log('starting website on :3000 (first load compiles pages, give it ~30s)…');
  start('web', 'npx', ['next', 'dev', '-p', '3000'], resolve(root, 'apps/web'));
  await waitFor(3000, 'website', 180);

  log('──────────────────────────────────────────────');
  log('OPERAFlow is running:  http://localhost:3000');
  log('Local login details:   .local/seed-credentials.txt (newest ADMIN line)');
  log('Press Ctrl+C to stop.');
  log('──────────────────────────────────────────────');
} catch (err) {
  console.error(`\n[operaflow] could not start: ${err.message}`);
  shutdown();
}
