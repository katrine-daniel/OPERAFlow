import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaClient, type Role } from '@operaflow/db';
import { hashPassword } from '../src/auth/password';

export const ORIGIN = 'http://localhost:3000';
export const TEST_PASSWORD = 'Test-Passw0rd-123';

export async function createTestApp(): Promise<INestApplication> {
  // Imported lazily so a test file can adjust process.env before the app module is evaluated.
  const { AppModule } = await import('../src/app.module');
  const { configureApp } = await import('../src/bootstrap');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, rawBody: true, logger: ['error'] });
  configureApp(app);
  await app.init();
  return app;
}

export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  // Safety: never truncate anything but a dedicated *_test database, whatever the environment says.
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  if (!db.endsWith('_test')) throw new Error(`Refusing to reset database "${db}": tests may only run against a *_test database`);
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

let cachedHash: Promise<string> | undefined;
export async function createUser(prisma: PrismaClient, role: Role, email = `${role.toLowerCase()}@test.local`) {
  cachedHash ??= hashPassword(TEST_PASSWORD);
  return prisma.user.create({ data: { email, name: `Test ${role}`, role, passwordHash: await cachedHash } });
}

/** Reference data equivalent to the production seed (subset used by tests). */
export async function seedRegistry(prisma: PrismaClient) {
  const mk = (code: string, channel: 'ONLINE' | 'OFFLINE', adapter: 'API' | 'WEBHOOK' | 'CSV_IMPORT' | 'MANUAL') =>
    prisma.bookingSource.create({ data: { code, name: code, channel, adapter } });
  const [webhook, websiteApi, tbo, direct] = await Promise.all([
    mk('WEBSITE_WEBHOOK', 'ONLINE', 'WEBHOOK'),
    mk('WEBSITE_API', 'ONLINE', 'API'),
    mk('TBO_MANUAL', 'OFFLINE', 'MANUAL'),
    mk('DIRECT_HOTEL', 'OFFLINE', 'MANUAL'),
  ]);
  const supplier = await prisma.supplier.create({ data: { code: 'SUP1', name: 'Supplier One', type: 'WHOLESALER' } });
  const hotel = await prisma.hotel.create({ data: { name: 'Marina Hotel', city: 'Dubai', country: 'AE' } });
  return { sources: { webhook, websiteApi, tbo, direct }, supplier, hotel };
}

/** Logs in and returns the session cookie header value. */
export async function login(app: INestApplication, email: string, password = TEST_PASSWORD): Promise<string> {
  const res = await request(app.getHttpServer()).post('/auth/login').set('Origin', ORIGIN).send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('of_session='));
  if (!cookie) throw new Error('no session cookie');
  return cookie.split(';')[0]!;
}
