import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { createHmac } from 'node:crypto';
import { PrismaClient } from '@operaflow/db';
import { createTestApp, createUser, login, ORIGIN, resetDatabase, seedRegistry } from './helpers';

const prisma = new PrismaClient();
let app: INestApplication;
let reg: Awaited<ReturnType<typeof seedRegistry>>;
let manager: string;

const http = () => request(app.getHttpServer());

const CSV_HEADER = 'External Ref,Guest Name,Hotel Name,Hotel City,Hotel Country,Supplier Code,Check In,Check Out,Currency,Selling Amount,Cost Amount,Status,Unknown Column\r\n';

function upload(csv: string | Buffer, sourceId: string, filename = 'tbo.csv') {
  return http()
    .post('/booking-imports')
    .set('Origin', ORIGIN)
    .set('Cookie', manager)
    .field('sourceId', sourceId)
    .attach('file', Buffer.isBuffer(csv) ? csv : Buffer.from(csv), { filename });
}
const commit = (id: string, skipInvalid = false) =>
  http().post(`/booking-imports/${id}/commit`).set('Origin', ORIGIN).set('Cookie', manager).send({ skipInvalid });

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
  const m = await createUser(prisma, 'OPS_MANAGER');
  manager = await login(app, m.email);
});

describe('CSV/Excel import', () => {
  it('previews with row-level errors, then commits only after confirmation', async () => {
    const csv =
      CSV_HEADER +
      'TBO-1,Jane Doe,Sea View,Dubai,ae,SUP1,01/12/2026,04/12/2026,AED,"2,450.00",1980,confirmed,x\r\n' +
      'TBO-2,Ali Raza,Sea View,Dubai,AE,NOPE,2026-12-10,2026-12-12,AED,900,,PENDING,x\r\n' +
      'TBO-3,,Sea View,Dubai,AE,,2026-12-10,2026-12-09,AED,-5,,,x\r\n' +
      'TBO-1,Dup Row,Sea View,Dubai,AE,,2026-12-10,2026-12-12,AED,1,1,,x\r\n';
    const pre = await upload(csv, reg.sources.tbo.id);
    expect(pre.status).toBe(201);
    expect(pre.body).toMatchObject({ status: 'READY', totalRows: 4, readyRows: 1, errorRows: 3, wouldCreate: 1, unmappedColumns: ['Unknown Column'] });
    const fields = pre.body.errors.map((e: { row: number; field: string }) => `${e.row}:${e.field}`);
    expect(fields).toEqual(expect.arrayContaining(['3:supplierCode', '4:checkOut', '4:sellingAmount', '5:externalRef']));
    expect(await prisma.booking.count()).toBe(0); // preview writes nothing

    expect((await commit(pre.body.id)).status).toBe(400); // errors present, not confirmed
    const done = await commit(pre.body.id, true);
    expect(done.status).toBe(201);
    expect(done.body).toMatchObject({ created: 1, updated: 0, skippedInvalid: 3 });

    const b = await prisma.booking.findFirstOrThrow({ include: { hotel: true } });
    expect(b).toMatchObject({ externalRef: 'TBO-1', channel: 'OFFLINE', status: 'CONFIRMED', currency: 'AED', supplierId: reg.supplier.id });
    expect(b.checkIn.toISOString().slice(0, 10)).toBe('2026-12-01'); // DD/MM/YYYY understood
    expect(b.sellingAmount!.toFixed(2)).toBe('2450.00');
    expect(b.hotel).toMatchObject({ name: 'Sea View', country: 'AE' });

    expect((await commit(pre.body.id, true)).status).toBe(409); // cannot commit twice
    const again = await upload(csv, reg.sources.tbo.id);
    expect(again.status).toBe(409); // identical file already imported
  });

  it('updates existing bookings without wiping fields the file leaves blank', async () => {
    const first = await upload(CSV_HEADER + 'TBO-9,Jane Doe,Sea View,Dubai,AE,SUP1,2026-12-01,2026-12-04,AED,2450,1980,PENDING,\r\n', reg.sources.tbo.id);
    await commit(first.body.id);
    const second = await upload(CSV_HEADER + 'TBO-9,,,,,,,,,,,CONFIRMED,\r\n', reg.sources.tbo.id);
    expect(second.body).toMatchObject({ wouldCreate: 0, wouldUpdate: 1, errorRows: 0 });
    expect((await commit(second.body.id)).body).toMatchObject({ created: 0, updated: 1 });
    const b = await prisma.booking.findFirstOrThrow();
    expect(b.status).toBe('CONFIRMED');
    expect(b.costAmount!.toFixed(2)).toBe('1980.00'); // blank cell did not erase it
    expect(b.supplierId).toBe(reg.supplier.id);
  });

  it('reads .xlsx files including real date cells', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Bookings');
    ws.addRow(['external_ref', 'guest_name', 'hotel_name', 'hotel_city', 'hotel_country', 'check_in', 'check_out', 'currency', 'selling_amount']);
    ws.addRow(['X-1', 'Li Lei 李雷', 'Sea View', 'Dubai', 'AE', new Date(Date.UTC(2026, 11, 1)), new Date(Date.UTC(2026, 11, 3)), 'USD', 500]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const pre = await upload(buf, reg.sources.tbo.id, 'tbo.xlsx');
    expect(pre.body).toMatchObject({ readyRows: 1, errorRows: 0 });
    await commit(pre.body.id);
    const b = await prisma.booking.findFirstOrThrow();
    expect(b.leadGuestName).toBe('Li Lei 李雷');
    expect(b.checkOut.toISOString().slice(0, 10)).toBe('2026-12-03');
  });

  it('rejects imports into integration-fed sources and for staff without import rights', async () => {
    expect((await upload(CSV_HEADER, reg.sources.webhook.id)).status).toBe(400);
    const staff = await createUser(prisma, 'OPS_STAFF');
    const staffCookie = await login(app, staff.email);
    const res = await http()
      .post('/booking-imports')
      .set('Origin', ORIGIN)
      .set('Cookie', staffCookie)
      .field('sourceId', reg.sources.tbo.id)
      .attach('file', Buffer.from(CSV_HEADER), { filename: 'a.csv' });
    expect(res.status).toBe(403);
  });
});

describe('signed booking webhook', () => {
  let secret: string;

  beforeEach(async () => {
    const admin = await createUser(prisma, 'ADMIN');
    const cookie = await login(app, admin.email);
    const res = await http().post(`/booking-sources/${reg.sources.webhook.id}/webhook-secret`).set('Origin', ORIGIN).set('Cookie', cookie);
    expect(res.status).toBe(201);
    secret = res.body.secret;
    // The secret is never persisted in plaintext.
    const integ = await prisma.integration.findFirstOrThrow({ where: { kind: 'BOOKING_WEBHOOK' } });
    expect(integ.encryptedSecret).not.toContain(secret);
    expect(integ.status).toBe('NOT_CONFIGURED');
  });

  const event = (over: Record<string, unknown> = {}, booking: Record<string, unknown> = {}) => ({
    eventId: 'evt-1',
    eventType: 'booking.created',
    occurredAt: '2026-11-07T08:00:00Z',
    ...over,
    booking: {
      externalRef: 'WEB-500',
      leadGuestName: 'Jane Doe',
      hotelName: 'Marina Hotel',
      hotelCity: 'Dubai',
      hotelCountry: 'AE',
      checkIn: '2026-12-01',
      checkOut: '2026-12-04',
      currency: 'AED',
      sellingAmount: '2600.00',
      status: 'CONFIRMED',
      updatedAt: '2026-11-07T08:00:00Z',
      ...booking,
    },
  });
  const send = (body: object, opts: { secret?: string; ts?: number } = {}) => {
    const raw = JSON.stringify(body);
    const ts = opts.ts ?? Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', opts.secret ?? secret).update(`${ts}.${raw}`).digest('hex');
    return http()
      .post('/webhooks/bookings/WEBSITE_WEBHOOK')
      .set('Content-Type', 'application/json')
      .set('X-OperaFlow-Timestamp', String(ts))
      .set('X-OperaFlow-Signature', `sha256=${sig}`)
      .send(raw);
  };

  it('rejects bad signatures and old timestamps, and audits the rejection', async () => {
    expect((await send(event(), { secret: 'wrong' })).status).toBe(401);
    expect((await send(event(), { ts: Math.floor(Date.now() / 1000) - 3600 })).status).toBe(401);
    expect(await prisma.booking.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'webhook.rejected' } })).toBe(2);
  });

  it('creates, deduplicates replays, ignores stale updates and applies cancellations', async () => {
    const first = await send(event());
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ status: 'processed', result: { action: 'created' } });
    const b = await prisma.booking.findFirstOrThrow();
    expect(b).toMatchObject({ channel: 'ONLINE', externalRef: 'WEB-500', hotelId: reg.hotel.id });

    expect((await send(event())).body.status).toBe('duplicate');

    const stale = await send(event({ eventId: 'evt-0', eventType: 'booking.updated' }, { updatedAt: '2026-11-06T00:00:00Z', sellingAmount: '1.00' }));
    expect(stale.body.result.action).toBe('stale');

    const cancel = await send(event({ eventId: 'evt-2', eventType: 'booking.cancelled' }, { updatedAt: '2026-11-07T09:00:00Z' }));
    expect(cancel.body.result.action).toBe('updated');
    const after = await prisma.booking.findFirstOrThrow();
    expect(after).toMatchObject({ status: 'CANCELLED', cancellationStatus: 'CANCELLED' });
    expect(after.sellingAmount!.toFixed(2)).toBe('2600.00');

    const integ = await prisma.integration.findFirstOrThrow({ where: { kind: 'BOOKING_WEBHOOK' } });
    expect(integ.status).toBe('CONNECTED');
    expect(await prisma.jobExecution.count({ where: { queue: 'webhooks', status: 'SUCCEEDED' } })).toBe(3);
  });

  it('returns 422 for incomplete new bookings and allows a corrected redelivery of the same event', async () => {
    const bad = await send(event({}, { leadGuestName: undefined }));
    expect(bad.status).toBe(422);
    expect(await prisma.jobExecution.count({ where: { status: 'FAILED' } })).toBe(1);
    const fixed = await send(event());
    expect(fixed.body.status).toBe('processed');
  });

  it('staff cannot edit source-owned fields of online bookings', async () => {
    await send(event());
    const b = await prisma.booking.findFirstOrThrow();
    const staff = await createUser(prisma, 'OPS_STAFF');
    const cookie = await login(app, staff.email);
    const res = await http().patch(`/bookings/${b.id}`).set('Origin', ORIGIN).set('Cookie', cookie).send({ version: b.version, sellingAmount: '1.00' });
    expect(res.status).toBe(400);
    const ok = await http().patch(`/bookings/${b.id}`).set('Origin', ORIGIN).set('Cookie', cookie).send({ version: b.version, costAmount: '2100', supplierId: reg.supplier.id });
    expect(ok.status).toBe(200);
  });
});

describe('reconciliation', () => {
  it('flags online/offline overlaps, amount and status mismatches, and missing data, without duplicating on re-run', async () => {
    const tbo = reg.sources.tbo.id;
    const dates = { checkIn: new Date('2026-12-01'), checkOut: new Date('2026-12-04') };
    const key = `${reg.hotel.id}|doe jane|2026-12-01|2026-12-04`;
    const off = await prisma.booking.create({
      data: { internalRef: 'OF-T-1', sourceId: tbo, channel: 'OFFLINE', leadGuestName: 'Jane Doe', bookingDate: new Date(), ...dates, currency: 'AED', sellingAmount: 2450, costAmount: 1980, hotelId: reg.hotel.id, supplierId: reg.supplier.id, dedupeKey: key, confirmationStatus: 'CONFIRMED', confirmationNumber: 'C1' },
    });
    await prisma.booking.create({
      data: { internalRef: 'OF-T-2', sourceId: reg.sources.webhook.id, externalRef: 'W1', channel: 'ONLINE', leadGuestName: 'Jane Doe', bookingDate: new Date(), ...dates, currency: 'AED', sellingAmount: 2600, hotelId: reg.hotel.id, dedupeKey: key, status: 'CANCELLED', cancellationStatus: 'CANCELLED' },
    });

    const run = await http().post('/reconciliation/run').set('Origin', ORIGIN).set('Cookie', manager);
    expect(run.status).toBe(200);
    const types = (await prisma.reconciliationIssue.findMany()).map((i) => i.type).sort();
    // Not a duplicate (one side cancelled) but the cancellation has not reached the offline record, and prices differ.
    expect(types).toEqual(['AMOUNT_MISMATCH', 'MISSING_REQUIRED_DATA', 'STATUS_MISMATCH']);

    const rerun = await http().post('/reconciliation/run').set('Origin', ORIGIN).set('Cookie', manager);
    expect(rerun.body.newIssues).toBe(0);

    // Completing the data auto-resolves the missing-data issue.
    const staff = await createUser(prisma, 'OPS_STAFF');
    await prisma.booking.update({ where: { id: off.id }, data: { assignedToId: staff.id } });
    const third = await http().post('/reconciliation/run').set('Origin', ORIGIN).set('Cookie', manager);
    expect(third.body.autoResolved).toBe(1);

    const issue = await prisma.reconciliationIssue.findFirstOrThrow({ where: { type: 'AMOUNT_MISMATCH' } });
    const resolve = await http()
      .post(`/reconciliation/issues/${issue.id}/resolve`)
      .set('Origin', ORIGIN)
      .set('Cookie', manager)
      .send({ status: 'DISMISSED', note: 'Online rate included breakfast' });
    expect(resolve.status).toBe(200);
    await http().post('/reconciliation/run').set('Origin', ORIGIN).set('Cookie', manager);
    expect((await prisma.reconciliationIssue.findUniqueOrThrow({ where: { id: issue.id } })).status).toBe('DISMISSED');
  });
});
