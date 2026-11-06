import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { SMTPServer } from 'smtp-server';
import type { AddressInfo } from 'node:net';
import { PrismaClient } from '@operaflow/db';
import { createTestApp, createUser, login, ORIGIN, resetDatabase, seedRegistry } from './helpers';

interface Captured {
  to: string[];
  raw: string;
}
const inbox: Captured[] = [];
const smtp = new SMTPServer({
  authOptional: true,
  disabledCommands: ['STARTTLS'],
  logger: false,
  onRcptTo(address, _session, cb) {
    if (address.address.startsWith('bounce')) return cb(new Error('550 mailbox unavailable'));
    cb();
  },
  onData(stream, session, cb) {
    let raw = '';
    stream.on('data', (c: Buffer) => (raw += c.toString()));
    stream.on('end', () => {
      inbox.push({ to: session.envelope.rcptTo.map((r) => r.address), raw });
      cb();
    });
  },
});

const prisma = new PrismaClient();
let app: INestApplication;
let admin: string;
let manager: string;
let reg: Awaited<ReturnType<typeof seedRegistry>>;
const http = () => request(app.getHttpServer());
const post = (path: string, cookie: string, body: object = {}) => http().post(path).set('Origin', ORIGIN).set('Cookie', cookie).send(body);

beforeAll(async () => {
  await new Promise<void>((r) => smtp.listen(0, '127.0.0.1', r));
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = String((smtp.server.address() as AddressInfo).port);
  process.env.SMTP_FROM = 'OPERAFlow <reports@operaflow.test>';
  process.env.SMTP_ALLOW_INSECURE = 'true';
  process.env.APP_BASE_URL = 'https://ops.example.test';
  const { resetEnvCache } = await import('../src/config/env');
  resetEnvCache();
  app = await createTestApp();
});
afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
  await new Promise<void>((r) => smtp.close(() => r()));
});
beforeEach(async () => {
  inbox.length = 0;
  await resetDatabase(prisma);
  reg = await seedRegistry(prisma);
  const a = await createUser(prisma, 'ADMIN');
  const m = await createUser(prisma, 'OPS_MANAGER');
  admin = await login(app, a.email);
  manager = await login(app, m.email);

  // Two bookings made on 6 Nov (Dubai time), one on 7 Nov, in two currencies; one has a formula-like guest name and no cost.
  const base = { sourceId: reg.sources.tbo.id, channel: 'OFFLINE' as const, checkIn: new Date('2026-12-01'), checkOut: new Date('2026-12-03'), hotelId: reg.hotel.id };
  await prisma.booking.createMany({
    data: [
      { ...base, internalRef: 'OF-2026-000101', leadGuestName: 'Jane Doe', bookingDate: new Date('2026-11-06T10:00:00Z'), currency: 'AED', sellingAmount: 2450, costAmount: 1980, supplierId: reg.supplier.id, confirmationStatus: 'CONFIRMED', confirmationNumber: 'C-1', status: 'CONFIRMED' },
      { ...base, internalRef: 'OF-2026-000102', leadGuestName: '=HYPERLINK("http://x")', bookingDate: new Date('2026-11-06T19:30:00Z'), currency: 'USD', sellingAmount: 500 },
      { ...base, internalRef: 'OF-2026-000103', leadGuestName: 'Next Day', bookingDate: new Date('2026-11-06T20:30:00Z'), currency: 'AED', sellingAmount: 100, costAmount: 50 },
    ],
  });
});

async function approvedSchedule(recipients: string[]) {
  for (const email of recipients) expect((await post('/reports/recipients', admin, { email })).status).toBe(201);
  const res = await post('/reports/schedules', manager, {
    name: 'Daily operations',
    timeOfDay: '08:00',
    daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    timezone: 'Asia/Dubai',
    formats: ['XLSX', 'PDF'],
    recipients,
  });
  expect(res.status).toBe(201);
  return res.body as { id: string; cron: string; isEnabled: boolean };
}

describe('approved recipients and schedule safeguards', () => {
  it('only administrators can approve recipients; schedules reject unapproved addresses', async () => {
    expect((await post('/reports/recipients', manager, { email: 'ops@example.test' })).status).toBe(403);
    const bad = await post('/reports/schedules', manager, { name: 'X report', timeOfDay: '08:00', daysOfWeek: [1], timezone: 'Asia/Dubai', formats: ['XLSX'], recipients: ['nope@example.test'] });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toContain('nope@example.test');
  });

  it('creates schedules disabled, refuses enabling before a preview, then enables with upcoming run times', async () => {
    const s = await approvedSchedule(['ops@example.test']);
    expect(s).toMatchObject({ cron: '0 8 * * *', isEnabled: false });
    expect((await post(`/reports/schedules/${s.id}/enable`, manager)).status).toBe(400);
    const preview = await post(`/reports/schedules/${s.id}/preview`, manager, { date: '2026-11-06' });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ status: 'GENERATED', isPreview: true, rowCount: 2 });
    expect(inbox).toHaveLength(0); // previews are never sent
    const enabled = await post(`/reports/schedules/${s.id}/enable`, manager);
    expect(enabled.status).toBe(200);
    expect(enabled.body.nextRuns).toHaveLength(3);
    // 08:00 Dubai = 04:00 UTC
    expect(enabled.body.nextRuns[0]).toMatch(/T04:00:00\.000Z$/);
    // A rename touches nothing else: recipients, filters and the enabled state survive.
    const renamed = await http().patch(`/reports/schedules/${s.id}`).set('Origin', ORIGIN).set('Cookie', manager).send({ name: 'Daily operations (renamed)' });
    expect(renamed.body).toMatchObject({ isEnabled: true, recipients: ['ops@example.test'], filters: { period: 'PREVIOUS_DAY', dateField: 'bookingDate' } });
    // Changing report content disables it again until re-previewed.
    const upd = await http().patch(`/reports/schedules/${s.id}`).set('Origin', ORIGIN).set('Cookie', manager).send({ formats: ['PDF'] });
    expect(upd.body).toMatchObject({ isEnabled: false, lastPreviewedAt: null });
  });
});

describe('report content', () => {
  it('covers the organisation-local day, keeps currencies apart, flags missing data and neutralises formulas', async () => {
    const s = await approvedSchedule(['ops@example.test']);
    const { body: run } = await post(`/reports/schedules/${s.id}/preview`, manager, { date: '2026-11-06' });
    expect(run.summary).toMatchObject({ reportDate: '2026-11-06', total: 2, withMissingData: 2 });
    const cur = run.summary.currencies as { currency: string; selling: string; margin: string; marginExcluded: number }[];
    expect(cur).toEqual([
      expect.objectContaining({ currency: 'AED', selling: '2450.00', margin: '470.00', marginExcluded: 0 }),
      expect.objectContaining({ currency: 'USD', selling: '500.00', margin: '0.00', marginExcluded: 1 }),
    ]);
    expect(run.warnings.map((w: { message: string }) => w.message)).toEqual(
      expect.arrayContaining([expect.stringContaining('supplier cost'), expect.stringContaining('2 currencies')]),
    );

    const xlsx = await http().get(`/reports/runs/${run.id}/files/xlsx`).set('Cookie', manager).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(xlsx.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body);
    const sheet = wb.getWorksheet('Bookings')!;
    expect(sheet.rowCount).toBe(3); // header + 2
    const usdRow = sheet.getRow(3);
    expect(usdRow.getCell(4).value).toBe('\'=HYPERLINK("http://x")'); // not a live formula
    expect(usdRow.getCell(14).value).toBe('MISSING'); // cost not invented

    const pdf = await http().get(`/reports/runs/${run.id}/files/pdf`).set('Cookie', manager).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('scheduled run and delivery', () => {
  it('delivers once per recipient over SMTP, even when the scheduled job is retried', async () => {
    const s = await approvedSchedule(['ops@example.test', 'gm@example.test']);
    await post(`/reports/schedules/${s.id}/preview`, manager);
    await post(`/reports/schedules/${s.id}/enable`, manager);

    const { ReportsService } = await import('../src/reports/reports.service');
    const svc = app.get(ReportsService);
    const firedAt = new Date('2026-11-07T04:00:00Z'); // 08:00 Dubai on 7 Nov → reports on 6 Nov
    const first = await svc.runScheduled(s.id, firedAt);
    expect(first).toMatchObject({ reportDate: '2026-11-06', sent: 2, failed: 0 });
    expect(inbox.map((m) => m.to[0]).sort()).toEqual(['gm@example.test', 'ops@example.test']);
    expect(inbox[0]!.raw).toContain('Daily operations');
    expect(inbox[0]!.raw).toContain('.xlsx');
    const body = inbox[0]!.raw.replace(/=\r?\n/g, '').replace(/=3D/g, '='); // undo quoted-printable soft wraps
    expect(body).toContain('https://ops.example.test/reports/runs/');

    const retry = await svc.runScheduled(s.id, firedAt);
    expect(retry).toMatchObject({ runId: (first as { runId: string }).runId, sent: 0, attempted: 0 });
    expect(inbox).toHaveLength(2);
    expect(await prisma.reportRun.count({ where: { isPreview: false } })).toBe(1);
  });

  it('records failures per recipient and retries only the failed ones', async () => {
    const s = await approvedSchedule(['ops@example.test', 'bounce@example.test']);
    await post(`/reports/schedules/${s.id}/preview`, manager);
    const res = await post(`/reports/schedules/${s.id}/run`, manager, { date: '2026-11-06', deliver: true });
    expect(res.body.delivery).toMatchObject({ sent: 1, failed: 1 });
    const failed = await prisma.reportDelivery.findFirstOrThrow({ where: { status: 'FAILED' } });
    expect(failed.recipient).toBe('bounce@example.test');
    expect(failed.lastError).toMatch(/550|mailbox/i);
    expect(await prisma.notification.count({ where: { type: 'report.delivery_failed' } })).toBe(1);

    const again = await post(`/reports/runs/${res.body.run.id}/deliver`, manager);
    expect(again.body).toMatchObject({ attempted: 1, sent: 0, failed: 1 });
    expect(inbox.filter((m) => m.to[0] === 'ops@example.test')).toHaveLength(1); // never re-sent
    expect((await prisma.reportDelivery.findUniqueOrThrow({ where: { id: failed.id } })).attempts).toBe(2);
  });

  it('records worker jobs in job_executions', async () => {
    const { executeTracked, buildHandlers } = await import('../src/worker/jobs');
    const { PrismaService } = await import('../src/prisma/prisma.service');
    const handlers = buildHandlers(app);
    await executeTracked(app.get(PrismaService), handlers, 'maintenance', 'reconciliation', 'job-1', {}, new Date(), 1);
    const exec = await prisma.jobExecution.findUniqueOrThrow({ where: { idempotencyKey: 'bull:maintenance:job-1' } });
    expect(exec.status).toBe('SUCCEEDED');
    await expect(executeTracked(app.get(PrismaService), handlers, 'reports', 'nope', 'job-2', {}, new Date(), 1)).rejects.toThrow();
  });
});

describe('chat channel safety', () => {
  it('only accepts https Teams/Slack webhook hosts (no internal URLs)', async () => {
    const tries = ['http://hooks.slack.com/services/x', 'https://169.254.169.254/latest', 'https://evil.example/webhook.office.com', 'https://hooks.slack.com:8443/x'];
    for (const url of tries) {
      expect((await post('/integrations/chat-webhooks', admin, { kind: url.includes('slack') ? 'SLACK_WEBHOOK' : 'TEAMS_WEBHOOK', name: 'Ops', url })).status).toBe(400);
    }
    const ok = await post('/integrations/chat-webhooks', admin, { kind: 'SLACK_WEBHOOK', name: 'Ops channel', url: 'https://hooks.slack.com/services/T000/B000/XXXX' });
    expect(ok.status).toBe(201);
    const list = await http().get('/integrations').set('Cookie', admin);
    expect(JSON.stringify(list.body)).not.toContain('XXXX'); // URL is a secret
    expect(list.body[0]).toMatchObject({ kind: 'SLACK_WEBHOOK', hasSecret: true, status: 'NOT_CONFIGURED' });
  });
});
