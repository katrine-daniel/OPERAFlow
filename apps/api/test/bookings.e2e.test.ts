import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@operaflow/db';
import { createTestApp, createUser, login, ORIGIN, resetDatabase, seedRegistry } from './helpers';

const prisma = new PrismaClient();
let app: INestApplication;
let reg: Awaited<ReturnType<typeof seedRegistry>>;
let staffCookie: string;
let staffId: string;

const http = () => request(app.getHttpServer());
const post = (path: string, body: unknown, cookie = staffCookie) => http().post(path).set('Origin', ORIGIN).set('Cookie', cookie).send(body as object);
const patch = (path: string, body: unknown, cookie = staffCookie) => http().patch(path).set('Origin', ORIGIN).set('Cookie', cookie).send(body as object);

const offline = () => ({
  sourceId: reg.sources.tbo.id,
  externalRef: 'TBO-1001',
  supplierId: reg.supplier.id,
  hotelId: reg.hotel.id,
  leadGuestName: 'Jane Doe',
  guestEmail: 'Jane@Example.com',
  checkIn: '2026-12-01',
  checkOut: '2026-12-04',
  currency: 'aed',
  sellingAmount: '2450.00',
  costAmount: '1980',
});

beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDatabase(prisma);
  reg = await seedRegistry(prisma);
  const staff = await createUser(prisma, 'OPS_STAFF');
  staffId = staff.id;
  staffCookie = await login(app, staff.email);
});

describe('offline booking creation', () => {
  it('creates a booking with an internal reference, computed margin and history', async () => {
    const res = await post('/bookings', { ...offline(), assignedToId: staffId });
    expect(res.status).toBe(201);
    expect(res.body.internalRef).toMatch(/^OF-\d{4}-\d{6}$/);
    expect(res.body.channel).toBe('OFFLINE');
    expect(res.body.currency).toBe('AED');
    expect(res.body.guestEmail).toBe('jane@example.com');

    const detail = await http().get(`/bookings/${res.body.id}`).set('Cookie', staffCookie);
    expect(detail.body.margin).toBe('470.00');
    expect(detail.body.nights).toBe(3);
    expect(detail.body.missing).toEqual([]);
    expect(detail.body.changes[0].changeType).toBe('CREATED');
    expect(await prisma.auditLog.count({ where: { action: 'booking.created', entityId: res.body.id } })).toBe(1);
  });

  it('keeps missing amounts as NULL and reports them, with no margin', async () => {
    const res = await post('/bookings', { ...offline(), sellingAmount: '', costAmount: '' });
    const detail = await http().get(`/bookings/${res.body.id}`).set('Cookie', staffCookie);
    expect(detail.body.sellingAmount).toBeNull();
    expect(detail.body.margin).toBeNull();
    expect(detail.body.missing).toEqual(expect.arrayContaining(['sellingAmount', 'costAmount', 'assignedTo']));
    const filtered = await http().get('/bookings?missingData=true').set('Cookie', staffCookie);
    expect(filtered.body.total).toBe(1);
  });

  it('warns about duplicates across sources and only saves after confirmation', async () => {
    expect((await post('/bookings', offline())).status).toBe(201);
    const dup = await post('/bookings', { ...offline(), sourceId: reg.sources.direct.id, externalRef: null, leadGuestName: 'DOE, Jane' });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('DUPLICATE_SUSPECTED');
    expect(dup.body.duplicates).toHaveLength(1);
    const confirmed = await post('/bookings', { ...offline(), sourceId: reg.sources.direct.id, externalRef: null, leadGuestName: 'DOE, Jane', confirmDuplicate: true });
    expect(confirmed.status).toBe(201);
    expect(await prisma.booking.count()).toBe(2);
  });

  it('rejects the same supplier reference twice for one source', async () => {
    await post('/bookings', offline());
    const again = await post('/bookings', { ...offline(), checkIn: '2027-01-01', checkOut: '2027-01-02' });
    expect(again.status).toBe(409);
  });

  it('refuses manual entry for integration-fed sources and validates input', async () => {
    expect((await post('/bookings', { ...offline(), sourceId: reg.sources.webhook.id })).status).toBe(400);
    expect((await post('/bookings', { ...offline(), sourceId: reg.sources.websiteApi.id })).status).toBe(400);
    const bad = await post('/bookings', { ...offline(), checkOut: '2026-11-30', currency: 'dirhams' });
    expect(bad.status).toBe(400);
    expect(bad.body.issues.map((i: { path: string }) => i.path)).toEqual(expect.arrayContaining(['checkOut', 'currency']));
  });

  it('forbids QA from reading or writing bookings', async () => {
    const qa = await createUser(prisma, 'QA');
    const qaCookie = await login(app, qa.email);
    expect((await http().get('/bookings').set('Cookie', qaCookie)).status).toBe(403);
    expect((await post('/bookings', offline(), qaCookie)).status).toBe(403);
  });
});

describe('editing, concurrency and status changes', () => {
  it('records a field diff, hides PII values in history, and enforces optimistic locking', async () => {
    const { body: b } = await post('/bookings', offline());
    const ok = await patch(`/bookings/${b.id}`, { version: 1, costAmount: '2000.00', guestEmail: 'new@example.com' });
    expect(ok.status).toBe(200);
    expect(ok.body.version).toBe(2);

    const stale = await patch(`/bookings/${b.id}`, { version: 1, notes: 'from an old tab' });
    expect(stale.status).toBe(409);

    const change = await prisma.bookingChange.findFirst({ where: { bookingId: b.id, changeType: 'UPDATED' } });
    expect(change!.diff).toEqual({ costAmount: { from: '1980.00', to: '2000.00' }, guestEmail: { changed: true } });
    expect(JSON.stringify(change!.diff)).not.toContain('new@example.com');
  });

  it('cancels with a reason and blocks further material edits', async () => {
    const { body: b } = await post('/bookings', offline());
    expect((await post(`/bookings/${b.id}/cancel`, { version: 1, withFee: true, reason: 'Guest cancelled by phone' })).status).toBe(201);
    const after = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(after.status).toBe('CANCELLED');
    expect(after.cancellationStatus).toBe('CANCELLED_WITH_FEE');
    expect((await patch(`/bookings/${b.id}`, { version: 2, checkIn: '2026-12-02' })).status).toBe(400);
    expect((await patch(`/bookings/${b.id}`, { version: 2, paymentStatus: 'REFUNDED' })).status).toBe(200);
    expect((await post(`/bookings/${b.id}/cancel`, { version: 3, reason: 'again' })).status).toBe(400);
  });

  it('confirms with a confirmation number', async () => {
    const { body: b } = await post('/bookings', offline());
    const res = await post(`/bookings/${b.id}/confirm`, { version: 1, confirmationNumber: 'HTL-55102' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'CONFIRMED', confirmationStatus: 'CONFIRMED', confirmationNumber: 'HTL-55102' });
  });
});

describe('registry search and filters', () => {
  it('filters by channel, check-in range and free text', async () => {
    await post('/bookings', offline());
    await post('/bookings', { ...offline(), externalRef: 'TBO-1002', leadGuestName: 'Ahmed Khan', checkIn: '2027-02-01', checkOut: '2027-02-03' });
    const byText = await http().get('/bookings?q=khan').set('Cookie', staffCookie);
    expect(byText.body.items.map((b: { externalRef: string }) => b.externalRef)).toEqual(['TBO-1002']);
    const byRange = await http().get('/bookings?dateField=checkIn&from=2026-11-01&to=2026-12-31').set('Cookie', staffCookie);
    expect(byRange.body.total).toBe(1);
    const online = await http().get('/bookings?channel=ONLINE').set('Cookie', staffCookie);
    expect(online.body.total).toBe(0);
  });
});

describe('supporting documents', () => {
  it('accepts a real PDF, rejects disguised content, and serves downloads as attachments', async () => {
    const { body: b } = await post('/bookings', offline());
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
    const up = await http()
      .post(`/bookings/${b.id}/documents`)
      .set('Origin', ORIGIN)
      .set('Cookie', staffCookie)
      .attach('file', pdf, { filename: 'voucher.pdf', contentType: 'application/pdf' });
    expect(up.status).toBe(201);
    expect(up.body.mimeType).toBe('application/pdf');

    const exe = await http()
      .post(`/bookings/${b.id}/documents`)
      .set('Origin', ORIGIN)
      .set('Cookie', staffCookie)
      .attach('file', Buffer.from('MZ\x90\x00binary'), { filename: 'voucher.pdf', contentType: 'application/pdf' });
    expect(exe.status).toBe(415);

    const html = await http()
      .post(`/bookings/${b.id}/documents`)
      .set('Origin', ORIGIN)
      .set('Cookie', staffCookie)
      .attach('file', Buffer.from('<html><script>alert(1)</script></html>'), { filename: 'notes.txt', contentType: 'text/plain' });
    expect(html.status).toBe(415);

    const dl = await http().get(`/bookings/${b.id}/documents/${up.body.id}`).set('Cookie', staffCookie).buffer(true);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toMatch(/^attachment;/);
    expect(Buffer.from(dl.body).equals(pdf)).toBe(true);

    const history = await prisma.bookingChange.count({ where: { bookingId: b.id, changeType: 'DOCUMENT_ADDED' } });
    expect(history).toBe(1);
  });
});
