import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@operaflow/db';
import { createUser, resetDatabase } from './helpers';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
beforeEach(() => resetDatabase(prisma));

async function source() {
  return prisma.bookingSource.create({ data: { code: 'DIRECT_HOTEL', name: 'Direct', channel: 'OFFLINE', adapter: 'MANUAL' } });
}
const baseBooking = (sourceId: string) => ({
  internalRef: 'OF-TEST-1',
  sourceId,
  channel: 'OFFLINE' as const,
  leadGuestName: 'Zoë Ağaoğlu 李雷',
  bookingDate: new Date(),
  checkIn: new Date('2026-12-01'),
  checkOut: new Date('2026-12-04'),
  currency: 'AED',
});

describe('database integrity constraints', () => {
  it('stores non-Latin guest names intact (UTF-8)', async () => {
    const s = await source();
    const b = await prisma.booking.create({ data: baseBooking(s.id) });
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).leadGuestName).toBe('Zoë Ağaoğlu 李雷');
  });

  it('rejects check-out on or before check-in', async () => {
    const s = await source();
    await expect(prisma.booking.create({ data: { ...baseBooking(s.id), checkOut: new Date('2026-12-01') } })).rejects.toThrow(/bookings_dates_chk/);
  });

  it('rejects negative amounts and malformed currency', async () => {
    const s = await source();
    await expect(prisma.booking.create({ data: { ...baseBooking(s.id), sellingAmount: -1 } })).rejects.toThrow(/bookings_amounts_chk/);
    await expect(prisma.booking.create({ data: { ...baseBooking(s.id), currency: 'aed' } })).rejects.toThrow(/bookings_currency_chk/);
  });

  it('refuses AUTO_SEND follow-up rules without administrator approval', async () => {
    const t = await prisma.followUpTemplate.create({ data: { name: 't', subjectTemplate: 's', bodyTemplate: 'b' } });
    await expect(
      prisma.followUpRule.create({ data: { name: 'r', delayHours: 24, templateId: t.id, sendMode: 'AUTO_SEND' } }),
    ).rejects.toThrow(/autosend_approval_chk/);
  });

  it('only allows booking mutations against SANDBOX environments', async () => {
    await expect(
      prisma.testEnvironment.create({ data: { name: 'stg', baseUrl: 'https://staging.example.test', kind: 'STAGING', allowBookingMutations: true } }),
    ).rejects.toThrow(/mutation_sandbox_chk/);
  });

  it('refuses to enable a report schedule that was never previewed', async () => {
    await expect(
      prisma.scheduledReport.create({ data: { name: 'daily', cron: '0 8 * * *', timezone: 'UTC', formats: ['XLSX'], isEnabled: true } }),
    ).rejects.toThrow(/preview_chk/);
  });

  it('makes the audit log append-only', async () => {
    const u = await createUser(prisma, 'ADMIN');
    const log = await prisma.auditLog.create({ data: { actorType: 'USER', actorId: u.id, action: 'x', entityType: 'y' } });
    await expect(prisma.auditLog.update({ where: { id: log.id }, data: { action: 'tampered' } })).rejects.toThrow(/append-only/);
    // The FK's ON DELETE SET NULL is the one permitted change.
    await prisma.user.delete({ where: { id: u.id } });
    expect((await prisma.auditLog.findUniqueOrThrow({ where: { id: log.id } })).actorId).toBeNull();
  });
});
