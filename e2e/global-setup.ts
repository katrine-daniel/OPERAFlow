import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';

const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgresql://operaflow:operaflow_local_dev@127.0.0.1:5433/operaflow_test';
const root = resolve(__dirname, '..');

/** Fresh *_test database with reference data and one user per role (random passwords, kept in e2e/.auth). */
export default async function globalSetup() {
  const dbName = new URL(TEST_DB).pathname.slice(1);
  if (!dbName.endsWith('_test')) throw new Error(`Refusing to run E2E against "${dbName}"`);
  const env = { ...process.env, DATABASE_URL: TEST_DB };
  execSync('npx prisma migrate deploy', { cwd: resolve(root, 'packages/db'), env, stdio: 'inherit' });

  const prisma = new PrismaClient({ datasourceUrl: TEST_DB });
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  await prisma.$disconnect();

  const password = () => `${randomBytes(12).toString('base64url')}-Aa1`;
  const creds = { admin: password(), manager: password(), staff: password(), qa: password() };
  execSync('npx tsx prisma/seed.ts', {
    cwd: resolve(root, 'packages/db'),
    env: { ...env, SEED_ADMIN_EMAIL: 'admin@e2e.test', SEED_ADMIN_PASSWORD: creds.admin, SEED_DEMO_USERS: 'false', DEFAULT_TIMEZONE: 'Asia/Dubai' },
    stdio: 'inherit',
  });

  const p = new PrismaClient({ datasourceUrl: TEST_DB });
  for (const [role, email, pw] of [['OPS_MANAGER', 'manager@e2e.test', creds.manager], ['OPS_STAFF', 'staff@e2e.test', creds.staff], ['QA', 'qa@e2e.test', creds.qa]] as const) {
    await p.user.create({ data: { email, name: `E2E ${role}`, role, passwordHash: await hash(pw, { algorithm: 2 }) } });
  }
  await p.supplier.create({ data: { code: 'E2E-WHL', name: 'E2E Wholesaler', type: 'WHOLESALER', contacts: { create: [{ email: 'rates@e2e-wholesaler.test', isPrimary: true }] } } });
  await p.$disconnect();

  mkdirSync(resolve(__dirname, '.auth'), { recursive: true });
  writeFileSync(resolve(__dirname, '.auth', 'creds.json'), JSON.stringify(creds));
}
