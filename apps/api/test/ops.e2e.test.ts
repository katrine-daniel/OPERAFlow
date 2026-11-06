import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@operaflow/db';
import { createTestApp, createUser, login, ORIGIN, resetDatabase, seedRegistry } from './helpers';

const METRICS_TOKEN = 'metrics-token-for-tests-1234567890';
const prisma = new PrismaClient();
let app: INestApplication;
const http = () => request(app.getHttpServer());
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

beforeAll(async () => {
  process.env.METRICS_TOKEN = METRICS_TOKEN;
  const { resetEnvCache } = await import('../src/config/env');
  resetEnvCache();
  app = await createTestApp();
});
afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});
beforeEach(() => resetDatabase(prisma));

describe('notifications', () => {
  it('lists and marks only the current user’s notifications', async () => {
    const a = await createUser(prisma, 'OPS_STAFF', 'a@test.local');
    const b = await createUser(prisma, 'OPS_STAFF', 'b@test.local');
    const nb = await prisma.notification.create({ data: { userId: b.id, type: 'x', title: 'for b' } });
    await prisma.notification.create({ data: { userId: a.id, type: 'x', title: 'for a' } });
    const cookie = await login(app, a.email);
    const list = await http().get('/notifications').set('Cookie', cookie);
    expect(list.body).toMatchObject({ unread: 1, items: [{ title: 'for a' }] });
    expect((await http().post(`/notifications/${nb.id}/read`).set('Origin', ORIGIN).set('Cookie', cookie)).status).toBe(404);
    expect((await http().post('/notifications/read-all').set('Origin', ORIGIN).set('Cookie', cookie)).body).toEqual({ updated: 1 });
  });
});

describe('global search', () => {
  it('returns only what the role may see', async () => {
    const reg = await seedRegistry(prisma);
    await prisma.booking.create({ data: { internalRef: 'OF-2026-777777', sourceId: reg.sources.tbo.id, channel: 'OFFLINE', leadGuestName: 'Searchable Guest', bookingDate: new Date(), checkIn: new Date('2026-12-01'), checkOut: new Date('2026-12-02'), currency: 'AED' } });
    const staff = await login(app, (await createUser(prisma, 'OPS_STAFF')).email);
    const qa = await login(app, (await createUser(prisma, 'QA')).email);
    const s = await http().get('/search?q=searchable').set('Cookie', staff);
    expect(s.body.bookings).toHaveLength(1);
    expect(s.body.bookings[0].leadGuestName).toBe('Searchable Guest');
    const q = await http().get('/search?q=searchable').set('Cookie', qa);
    expect(q.body.bookings).toEqual([]);
    expect((await http().get('/search?q=a').set('Cookie', staff)).status).toBe(400);
  });
});

describe('data retention', () => {
  it('enforces minimums and purges only expired operational data, never bookings', async () => {
    const admin = await createUser(prisma, 'ADMIN');
    const cookie = await login(app, admin.email);
    const tooLow = await http().patch('/settings/retention').set('Origin', ORIGIN).set('Cookie', cookie).send({ 'retention.auditLogDays': 30 });
    expect(tooLow.status).toBe(400);
    const ok = await http().patch('/settings/retention').set('Origin', ORIGIN).set('Cookie', cookie).send({ 'retention.notificationDays': 10 });
    expect(ok.body['retention.notificationDays']).toBe(10);

    const reg = await seedRegistry(prisma);
    await prisma.booking.create({ data: { internalRef: 'OF-OLD-1', sourceId: reg.sources.tbo.id, channel: 'OFFLINE', leadGuestName: 'Old', bookingDate: daysAgo(4000), checkIn: new Date('2015-01-01'), checkOut: new Date('2015-01-02'), currency: 'AED', createdAt: daysAgo(4000) } });
    await prisma.session.create({ data: { tokenHash: 'old', userId: admin.id, expiresAt: daysAgo(60), createdAt: daysAgo(61) } });
    await prisma.notification.create({ data: { userId: admin.id, type: 'x', title: 'old read', readAt: daysAgo(20) } });
    await prisma.notification.create({ data: { userId: admin.id, type: 'x', title: 'old unread', createdAt: daysAgo(20) } });
    await prisma.auditLog.create({ data: { actorType: 'SYSTEM', action: 'ancient', entityType: 'x', createdAt: daysAgo(800) } });

    const run = await http().post('/settings/retention/run').set('Origin', ORIGIN).set('Cookie', cookie);
    expect(run.status).toBe(200);
    expect(run.body).toMatchObject({ sessions: 1, notifications: 1, auditLogs: 1 });
    expect(await prisma.booking.count()).toBe(1);
    expect(await prisma.notification.count({ where: { title: 'old unread' } })).toBe(1); // unread kept
    expect(await prisma.auditLog.count({ where: { action: 'retention.run' } })).toBe(1);

    const staff = await login(app, (await createUser(prisma, 'OPS_STAFF')).email);
    expect((await http().post('/settings/retention/run').set('Origin', ORIGIN).set('Cookie', staff)).status).toBe(403);
  });
});

describe('observability', () => {
  it('adds a request id to every response and accepts a well-formed incoming one', async () => {
    const res = await http().get('/health');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const echo = await http().get('/health').set('X-Request-Id', 'trace-abc-12345');
    expect(echo.headers['x-request-id']).toBe('trace-abc-12345');
    const bad = await http().get('/health').set('X-Request-Id', 'bad id with spaces <script>');
    expect(bad.headers['x-request-id']).not.toContain('<');
  });

  it('error responses carry the request id', async () => {
    const res = await http().get('/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });

  it('protects /metrics with a bearer token and exposes counters and gauges', async () => {
    expect((await http().get('/metrics')).status).toBe(401);
    expect((await http().get('/metrics').set('Authorization', 'Bearer wrong-token-000000000')).status).toBe(401);
    await http().get('/health');
    const ok = await http().get('/metrics').set('Authorization', `Bearer ${METRICS_TOKEN}`);
    expect(ok.status).toBe(200);
    expect(ok.text).toContain('operaflow_http_requests_total{method="GET",status="2xx"}');
    expect(ok.text).toContain('operaflow_reconciliation_issues_open 0');
    expect(ok.text).toContain('operaflow_worker_heartbeat_age_seconds -1');
  });

  it('readiness reports database ok and Redis not configured', async () => {
    const res = await http().get('/health/ready');
    expect(res.body).toMatchObject({ status: 'ok', database: 'ok', redis: 'not configured' });
  });
});
