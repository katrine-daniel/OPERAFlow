import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@operaflow/db';
import { createHash } from 'node:crypto';
import { createTestApp, createUser, login, ORIGIN, resetDatabase, TEST_PASSWORD } from './helpers';

const prisma = new PrismaClient();
let app: INestApplication;
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDatabase(prisma);
});

describe('health', () => {
  it('is public and checks the database', async () => {
    const res = await http().get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'ok' });
  });
});

describe('authentication', () => {
  it('rejects unauthenticated access', async () => {
    expect((await http().get('/auth/me')).status).toBe(401);
    expect((await http().get('/dashboard/summary')).status).toBe(401);
  });

  it('logs in with an httpOnly SameSite cookie and stores only a token hash', async () => {
    const user = await createUser(prisma, 'OPS_STAFF');
    const res = await http().post('/auth/login').set('Origin', ORIGIN).send({ email: user.email, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('of_session='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    const token = cookie.split(';')[0]!.split('=')[1]!;

    const sessions = await prisma.session.findMany({ where: { userId: user.id } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(sessions[0]!.tokenHash).not.toContain(token);

    const me = await http().get('/auth/me').set('Cookie', cookie.split(';')[0]!);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ email: user.email, role: 'OPS_STAFF' });
    expect(me.body.permissions).toContain('bookings:write');
    expect(me.body.permissions).not.toContain('users:manage');

    const audit = await prisma.auditLog.findFirst({ where: { action: 'auth.login', actorId: user.id } });
    expect(audit).not.toBeNull();
  });

  it('returns a generic error for unknown email and wrong password, and audits both', async () => {
    const user = await createUser(prisma, 'OPS_STAFF');
    const a = await http().post('/auth/login').set('Origin', ORIGIN).send({ email: 'nobody@test.local', password: 'x' });
    const b = await http().post('/auth/login').set('Origin', ORIGIN).send({ email: user.email, password: 'wrong' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.message).toBe(b.body.message);
    expect(await prisma.auditLog.count({ where: { action: 'auth.login_failed' } })).toBe(2);
  });

  it('locks the account after repeated failures, even for the correct password', async () => {
    const user = await createUser(prisma, 'OPS_STAFF');
    for (let i = 0; i < 5; i++) {
      await http().post('/auth/login').set('Origin', ORIGIN).send({ email: user.email, password: 'wrong' });
    }
    const locked = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(locked.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    const res = await http().post('/auth/login').set('Origin', ORIGIN).send({ email: user.email, password: TEST_PASSWORD });
    expect(res.status).toBe(401);
    expect(await prisma.auditLog.count({ where: { action: 'auth.account_locked' } })).toBe(1);
  });

  it('blocks inactive users', async () => {
    const user = await createUser(prisma, 'OPS_STAFF');
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    const res = await http().post('/auth/login').set('Origin', ORIGIN).send({ email: user.email, password: TEST_PASSWORD });
    expect(res.status).toBe(401);
  });

  it('logout revokes the session server-side', async () => {
    const user = await createUser(prisma, 'OPS_STAFF');
    const cookie = await login(app, user.email);
    expect((await http().post('/auth/logout').set('Origin', ORIGIN).set('Cookie', cookie)).status).toBe(200);
    expect((await http().get('/auth/me').set('Cookie', cookie)).status).toBe(401);
  });

  it('expires idle sessions', async () => {
    const user = await createUser(prisma, 'OPS_STAFF');
    const cookie = await login(app, user.email);
    await prisma.session.updateMany({ where: { userId: user.id }, data: { lastSeenAt: new Date(Date.now() - 2 * 3600_000) } });
    expect((await http().get('/auth/me').set('Cookie', cookie)).status).toBe(401);
  });

  it('change-password revokes other sessions but keeps the current one', async () => {
    const user = await createUser(prisma, 'OPS_STAFF');
    const a = await login(app, user.email);
    const b = await login(app, user.email);
    const res = await http()
      .post('/auth/change-password')
      .set('Origin', ORIGIN)
      .set('Cookie', a)
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'Another-Passw0rd-456' });
    expect(res.status).toBe(200);
    expect((await http().get('/auth/me').set('Cookie', a)).status).toBe(200);
    expect((await http().get('/auth/me').set('Cookie', b)).status).toBe(401);
  });
});

describe('CSRF origin check', () => {
  it('rejects state-changing requests without or with a foreign Origin', async () => {
    const user = await createUser(prisma, 'OPS_STAFF');
    const none = await http().post('/auth/login').send({ email: user.email, password: TEST_PASSWORD });
    const evil = await http().post('/auth/login').set('Origin', 'https://evil.example').send({ email: user.email, password: TEST_PASSWORD });
    expect(none.status).toBe(403);
    expect(evil.status).toBe(403);
  });

  it('allows GET without Origin', async () => {
    const user = await createUser(prisma, 'OPS_STAFF');
    const cookie = await login(app, user.email);
    expect((await http().get('/auth/me').set('Cookie', cookie)).status).toBe(200);
  });
});

describe('RBAC and user management', () => {
  it('forbids non-admins from managing users', async () => {
    const staff = await createUser(prisma, 'OPS_STAFF');
    const qa = await createUser(prisma, 'QA');
    const staffCookie = await login(app, staff.email);
    const qaCookie = await login(app, qa.email);
    expect((await http().get('/users').set('Cookie', staffCookie)).status).toBe(403);
    expect((await http().get('/audit-logs').set('Cookie', qaCookie)).status).toBe(403);
    const create = await http()
      .post('/users')
      .set('Origin', ORIGIN)
      .set('Cookie', staffCookie)
      .send({ email: 'x@test.local', name: 'X', role: 'ADMIN', password: 'Strong-Passw0rd-1' });
    expect(create.status).toBe(403);
    expect(await prisma.user.count({ where: { email: 'x@test.local' } })).toBe(0);
  });

  it('lets an admin create users with validation, duplicates rejected, and audit recorded', async () => {
    const admin = await createUser(prisma, 'ADMIN');
    const cookie = await login(app, admin.email);
    const body = { email: 'New.Staff@Test.local', name: 'New Staff', role: 'OPS_STAFF', password: 'Strong-Passw0rd-1' };

    const weak = await http().post('/users').set('Origin', ORIGIN).set('Cookie', cookie).send({ ...body, password: 'weak' });
    expect(weak.status).toBe(400);

    const ok = await http().post('/users').set('Origin', ORIGIN).set('Cookie', cookie).send(body);
    expect(ok.status).toBe(201);
    expect(ok.body.email).toBe('new.staff@test.local');
    expect(ok.body).not.toHaveProperty('passwordHash');

    const dup = await http().post('/users').set('Origin', ORIGIN).set('Cookie', cookie).send(body);
    expect(dup.status).toBe(409);

    const audit = await prisma.auditLog.findFirst({ where: { action: 'user.created', entityId: ok.body.id } });
    expect(audit?.actorId).toBe(admin.id);
    expect(JSON.stringify(audit?.metadata)).not.toContain('Strong-Passw0rd-1');
  });

  it('revokes sessions immediately when a role changes', async () => {
    const admin = await createUser(prisma, 'ADMIN');
    const staff = await createUser(prisma, 'OPS_STAFF');
    const adminCookie = await login(app, admin.email);
    const staffCookie = await login(app, staff.email);
    const res = await http().patch(`/users/${staff.id}`).set('Origin', ORIGIN).set('Cookie', adminCookie).send({ role: 'QA' });
    expect(res.status).toBe(200);
    expect((await http().get('/auth/me').set('Cookie', staffCookie)).status).toBe(401);
  });

  it('prevents an admin from demoting themselves or removing the last admin', async () => {
    const admin = await createUser(prisma, 'ADMIN');
    const cookie = await login(app, admin.email);
    const res = await http().patch(`/users/${admin.id}`).set('Origin', ORIGIN).set('Cookie', cookie).send({ role: 'OPS_STAFF' });
    expect(res.status).toBe(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).role).toBe('ADMIN');
  });

  it('serves role-scoped dashboard data from the database', async () => {
    const qa = await createUser(prisma, 'QA');
    const cookie = await login(app, qa.email);
    const res = await http().get('/dashboard/summary').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.bookings).toBeNull(); // QA has no booking access
    expect(res.body.tests).toMatchObject({ failedLast24h: 0, environmentsConfigured: 0 });
  });
});
