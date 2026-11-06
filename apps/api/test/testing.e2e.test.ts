import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { PrismaClient, type TestJourney } from '@operaflow/db';
import { createTestApp, createUser, login, ORIGIN, resetDatabase } from './helpers';
import { SANDBOX_SCENARIOS, startSandboxSite } from './fixtures/sandbox-site';

const prisma = new PrismaClient();
let app: INestApplication;
let site: { url: string; server: Server; bookings: Map<string, { status: string }> };
let qa: string;
let staff: string;
let testing: import('../src/testing/testing.service').TestingService;

const http = () => request(app.getHttpServer());
const post = (path: string, cookie: string, body: object = {}) => http().post(path).set('Origin', ORIGIN).set('Cookie', cookie).send(body);

beforeAll(async () => {
  process.env.TEST_RUNNER_MODE = 'inline';
  site = await startSandboxSite();
  app = await createTestApp();
  const { TestingService } = await import('../src/testing/testing.service');
  testing = app.get(TestingService);
}, 60_000);
afterAll(async () => {
  await app?.close();
  site?.server.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  site.bookings.clear();
  await resetDatabase(prisma);
  qa = await login(app, (await createUser(prisma, 'QA')).email);
  staff = await login(app, (await createUser(prisma, 'OPS_STAFF')).email);
  await createUser(prisma, 'ADMIN');
});

async function env(kind: 'SANDBOX' | 'STAGING' | 'PRODUCTION_READONLY', allowBookingMutations = false) {
  const res = await post('/testing/environments', qa, { name: `${kind} env`, baseUrl: site.url, kind, allowBookingMutations, secrets: { guestEmail: 'qa.sandbox@example.com' } });
  expect(res.status).toBe(201);
  return res.body as { id: string; hasSecrets: boolean };
}
async function scenario(journey: TestJourney, config: object, isCritical = false) {
  const s = await prisma.testScenario.create({ data: { key: `s-${journey.toLowerCase()}-${Math.random().toString(36).slice(2, 7)}`, name: journey, journey, isCritical, mutatesBookings: ['BOOKING_CREATE', 'BOOKING_CANCEL'].includes(journey), viewports: ['desktop'], config } });
  return s;
}
async function runAndWait(scenarioId: string, environmentId: string, viewports?: string[]) {
  const res = await post(`/testing/scenarios/${scenarioId}/run`, qa, { environmentId, ...(viewports && { viewports }) });
  expect(res.status).toBe(201);
  await testing.drain();
  return Promise.all((res.body.runs as { id: string }[]).map((r) => prisma.testRun.findUniqueOrThrow({ where: { id: r.id }, include: { artifacts: true } })));
}

describe('environments', () => {
  it('stores credentials write-only and refuses mutations outside SANDBOX', async () => {
    const e = await env('STAGING');
    expect(e.hasSecrets).toBe(true);
    const list = await http().get('/testing/environments').set('Cookie', qa);
    expect(JSON.stringify(list.body)).not.toContain('qa.sandbox@example.com');
    const bad = await post('/testing/environments', qa, { name: 'x', baseUrl: site.url, kind: 'STAGING', allowBookingMutations: true });
    expect(bad.status).toBe(400);
    expect((await post('/testing/environments', staff, { name: 'y', baseUrl: site.url, kind: 'SANDBOX' })).status).toBe(403);
  });
});

describe('Playwright runs against the demo sandbox (real Chromium)', () => {
  it('runs a search journey on desktop and mobile, stores trace and screenshots, and blocks third-party hosts', async () => {
    const e = await env('STAGING');
    const s = await scenario('HOTEL_SEARCH', SANDBOX_SCENARIOS.search);
    const runs = await runAndWait(s.id, e.id, ['desktop', 'mobile']);
    expect(runs.map((r) => [r.viewport, r.status])).toEqual([['desktop', 'PASSED'], ['mobile', 'PASSED']]);
    for (const r of runs) {
      expect(r.durationMs).toBeGreaterThan(0);
      expect(r.artifacts.map((a) => a.kind).sort()).toEqual(['SCREENSHOT', 'TRACE']);
      const diag = r.diagnostics as { blockedRequests: { url: string }[] };
      expect(diag.blockedRequests.some((b) => b.url.includes('analytics.example.com'))).toBe(true);
      expect((r.steps as { status: string }[]).every((st) => st.status === 'passed')).toBe(true);
    }
    const shot = runs[0]!.artifacts.find((a) => a.kind === 'SCREENSHOT')!;
    const img = await http().get(`/testing/runs/${runs[0]!.id}/artifacts/${shot.id}`).set('Cookie', qa);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
  }, 120_000);

  it('blocks booking-mutating scenarios outside an enabled sandbox, without opening a browser', async () => {
    const staging = await env('STAGING');
    const s = await scenario('BOOKING_CREATE', SANDBOX_SCENARIOS.bookAndCancel, true);
    const [r] = await runAndWait(s.id, staging.id);
    expect(r).toMatchObject({ status: 'BLOCKED_SAFETY', failureClass: 'SAFETY_GUARD' });
    expect(r!.artifacts).toHaveLength(0);
    expect(site.bookings.size).toBe(0);
    // Critical scenario → admins and QA are alerted.
    expect(await prisma.notification.count({ where: { type: 'test.critical_failed' } })).toBe(2);
  }, 60_000);

  it('creates, confirms and cancels a booking in an enabled sandbox, using environment secrets', async () => {
    const sandbox = await env('SANDBOX', true);
    const s = await scenario('BOOKING_CANCEL', SANDBOX_SCENARIOS.bookAndCancel);
    const [r] = await runAndWait(s.id, sandbox.id);
    expect(r!.errorMessage).toBeNull();
    expect(r!.status).toBe('PASSED');
    const diag = r!.diagnostics as { extracted: Record<string, string> };
    expect(diag.extracted.ref).toMatch(/^SBX-\d+$/);
    expect(site.bookings.get(diag.extracted.ref!)!.status).toBe('CANCELLED');
  }, 120_000);

  it('refuses to type a real-looking card number', async () => {
    const sandbox = await env('SANDBOX', true);
    const cfg = structuredClone(SANDBOX_SCENARIOS.bookAndCancel);
    cfg.steps = cfg.steps.map((st) => (st.action === 'fill' && st.selector === '#card' ? { ...st, value: '4539 1488 0343 6467' } : st));
    const s = await scenario('BOOKING_CREATE', cfg);
    const [r] = await runAndWait(s.id, sandbox.id);
    expect(r).toMatchObject({ status: 'BLOCKED_SAFETY', failureClass: 'SAFETY_GUARD' });
    expect(r!.errorMessage).not.toContain('4539');
    expect(site.bookings.size).toBe(0);
  }, 60_000);

  it('classifies assertion failures, timeouts and HTTP errors with failure screenshots', async () => {
    const e = await env('STAGING');
    const assertion = await scenario('NEGATIVE_INPUTS', {
      steps: [{ action: 'goto', path: '/search?destination=Nowhere&checkin={{date:+5}}&checkout={{date:+6}}' }, { action: 'expectCount', selector: '.hotel-card', min: 1, timeoutMs: 800 }],
    });
    const timeout = await scenario('ROOM_AVAILABILITY', { steps: [{ action: 'goto', path: '/' }, { action: 'click', selector: '#does-not-exist', timeoutMs: 500 }] });
    const http500 = await scenario('RATE_SELECTION', { steps: [{ action: 'goto', path: '/broken' }] });
    const unconfigured = await scenario('GUEST_VALIDATION', {});

    const [a] = await runAndWait(assertion.id, e.id);
    expect(a).toMatchObject({ status: 'FAILED', failureClass: 'ASSERTION' });
    expect(a!.errorMessage).toContain('found 0');
    expect(a!.artifacts.some((x) => x.kind === 'SCREENSHOT')).toBe(true);
    const steps = a!.steps as { status: string }[];
    expect(steps.map((s) => s.status)).toEqual(['passed', 'failed']);

    const [t] = await runAndWait(timeout.id, e.id);
    expect(t).toMatchObject({ status: 'FAILED', failureClass: 'TIMEOUT' });
    const [h] = await runAndWait(http500.id, e.id);
    expect(h).toMatchObject({ status: 'FAILED', failureClass: 'HTTP_ERROR' });
    const [u] = await runAndWait(unconfigured.id, e.id);
    expect(u).toMatchObject({ status: 'ERROR', failureClass: 'ENVIRONMENT' });
  }, 120_000);

  it('validates guest details client-side (negative input journey)', async () => {
    const e = await env('STAGING');
    const s = await scenario('GUEST_VALIDATION', {
      steps: [
        { action: 'goto', path: '/book?hotel=1&room=DLX' },
        { action: 'fill', selector: '#first', value: 'Test' },
        { action: 'fill', selector: '#last', value: 'Guest' },
        { action: 'fill', selector: '#email', value: 'not-an-email' },
        { action: 'click', selector: '#confirm' },
        { action: 'expectText', selector: '#form-error', contains: 'valid email' },
        { action: 'expectUrl', contains: '/book' },
      ],
    });
    const [r] = await runAndWait(s.id, e.id);
    expect(r!.status).toBe('PASSED');
  }, 60_000);

  it('a production read-only environment blocks form submissions', async () => {
    const e = await env('PRODUCTION_READONLY');
    const s = await scenario('GUEST_VALIDATION', {
      steps: [
        { action: 'goto', path: '/book?hotel=1&room=DLX' },
        { action: 'fill', selector: '#first', value: 'A' },
        { action: 'fill', selector: '#last', value: 'B' },
        { action: 'fill', selector: '#email', value: 'a@b.co' },
        { action: 'fill', selector: '#card', value: '4242424242424242' },
        { action: 'click', selector: '#confirm' },
        { action: 'expectText', selector: '#booking-ref', contains: 'SBX', timeoutMs: 1500 },
      ],
    });
    const [r] = await runAndWait(s.id, e.id);
    expect(r!.status).toBe('FAILED');
    expect((r!.diagnostics as { blockedRequests: { reason: string }[] }).blockedRequests.some((b) => b.reason.includes('POST blocked'))).toBe(true);
    expect(site.bookings.size).toBe(0);
  }, 60_000);
});
