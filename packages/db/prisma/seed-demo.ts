/**
 * DEMO DATA for presentations and screenshots. Everything created here is fictional and flagged:
 * bookings/suppliers/hotels have isDemo = true, the mailbox integration is mode DEMO (never contacted),
 * guest emails use example.com. Remove it all with:  npm run seed:demo -- --remove
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const rootEnv = resolve(__dirname, '..', '..', '..', '.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
const prisma = new PrismaClient();
const DEMO_MAILBOX = 'reservations@demo-agency.example';

async function remove() {
  const demoIds = (await prisma.booking.findMany({ where: { isDemo: true }, select: { id: true } })).map((b) => b.id);
  await prisma.reconciliationIssue.deleteMany({ where: { OR: [{ bookingId: { in: demoIds } }, { matchedBookingId: { in: demoIds } }] } });
  await prisma.booking.deleteMany({ where: { isDemo: true } });
  const integ = await prisma.integration.findFirst({ where: { mailboxAddress: DEMO_MAILBOX } });
  if (integ) {
    await prisma.emailConversation.deleteMany({ where: { integrationId: integ.id } });
    await prisma.integration.delete({ where: { id: integ.id } });
  }
  await prisma.supplier.deleteMany({ where: { isDemo: true } });
  await prisma.hotel.deleteMany({ where: { isDemo: true, bookings: { none: {} } } });
  console.log('demo data removed');
}

const day = (offset: number, hourUtc = 7) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  d.setUTCHours(hourUtc, 15, 0, 0);
  return d;
};
const dateOnly = (offset: number) => new Date(day(offset).toISOString().slice(0, 10) + 'T00:00:00Z');
const norm = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean).sort().join(' ');

async function nextRef() {
  const [r] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT nextval('booking_ref_seq') AS n`;
  return `OF-${new Date().getUTCFullYear()}-${String(r!.n).padStart(6, '0')}`;
}

async function create() {
  if (await prisma.booking.count({ where: { isDemo: true } })) {
    console.log('demo data already present (run with --remove first to recreate)');
    return;
  }
  const sources = Object.fromEntries((await prisma.bookingSource.findMany()).map((s) => [s.code, s]));
  const users = Object.fromEntries((await prisma.user.findMany({ where: { isActive: true } })).map((u) => [u.email, u]));
  const staff = users['staff@operaflow.local'] ?? Object.values(users)[0]!;
  const manager = users['manager@operaflow.local'] ?? staff;

  const suppliers = await Promise.all(
    [
      { code: 'DEMO-GLOBALBEDS', name: 'GlobalBeds Wholesale (demo)', type: 'WHOLESALER' as const, email: 'rates@globalbeds.example' },
      { code: 'DEMO-DESERTDMC', name: 'Desert Routes DMC (demo)', type: 'DMC' as const, email: 'contracting@desertroutes.example' },
      { code: 'DEMO-HARBOURHTL', name: 'Harbour View Hotel (demo)', type: 'HOTEL_DIRECT' as const, email: 'reservations@harbourview.example' },
    ].map((s) =>
      prisma.supplier.create({
        data: { code: s.code, name: s.name, type: s.type, timezone: 'Asia/Dubai', isDemo: true, contacts: { create: [{ email: s.email, isPrimary: true, name: 'Reservations desk' }] } },
      }),
    ),
  );
  const hotels = await Promise.all(
    [
      ['Harbour View Hotel (demo)', 'Dubai', 'AE', 5],
      ['Palm Garden Resort (demo)', 'Dubai', 'AE', 4],
      ['Old Town Courtyard (demo)', 'Abu Dhabi', 'AE', 4],
      ['Corniche Suites (demo)', 'Doha', 'QA', 5],
      ['Marina Lights Hotel (demo)', 'Muscat', 'OM', 3],
    ].map(([name, city, country, stars]) =>
      prisma.hotel.upsert({
        where: { name_city_country: { name: name as string, city: city as string, country: country as string } },
        update: {},
        create: { name: name as string, city: city as string, country: country as string, starRating: stars as number, isDemo: true },
      }),
    ),
  );

  type Row = {
    src: string; guest: string; hotel: number; sup: number | null; booked: number; ci: number; nights: number; cur: string; sell: number | null; cost: number | null;
    status?: 'PENDING' | 'CONFIRMED' | 'ON_REQUEST' | 'CANCELLED'; conf?: 'PENDING' | 'CONFIRMED'; pay?: 'UNPAID' | 'PAID' | 'PARTIALLY_PAID'; owner?: 'staff' | 'manager' | null; ext?: string;
  };
  const rows: Row[] = [
    { src: 'WEBSITE_WEBHOOK', guest: 'Amira Haddad', hotel: 0, sup: 2, booked: 0, ci: 12, nights: 3, cur: 'AED', sell: 2850, cost: 2280, status: 'CONFIRMED', conf: 'CONFIRMED', pay: 'PAID', owner: 'staff', ext: 'WEB-48211' },
    { src: 'WEBSITE_WEBHOOK', guest: 'Lukas Brenner', hotel: 1, sup: 0, booked: 0, ci: 20, nights: 5, cur: 'AED', sell: 4100, cost: 3350, status: 'CONFIRMED', conf: 'PENDING', pay: 'PAID', owner: 'manager', ext: 'WEB-48214' },
    { src: 'TBO_MANUAL', guest: 'Priya Natarajan', hotel: 2, sup: 0, booked: 0, ci: 9, nights: 2, cur: 'AED', sell: 1540, cost: null, status: 'ON_REQUEST', conf: 'PENDING', pay: 'UNPAID', owner: 'staff', ext: 'TBO-771920' },
    { src: 'DIRECT_HOTEL', guest: 'Omar Al Farsi', hotel: 4, sup: null, booked: 0, ci: 4, nights: 4, cur: 'OMR', sell: 380, cost: 300, status: 'PENDING', conf: 'PENDING', pay: 'UNPAID', owner: null },
    { src: 'SUPPLIER_EMAIL', guest: 'Chen Wei', hotel: 3, sup: 1, booked: -1, ci: 15, nights: 3, cur: 'QAR', sell: 3900, cost: 3120, status: 'CONFIRMED', conf: 'CONFIRMED', pay: 'PARTIALLY_PAID', owner: 'manager', ext: 'DR-20415' },
    { src: 'WEBSITE_WEBHOOK', guest: 'Sofia Marquez', hotel: 0, sup: 2, booked: -1, ci: 30, nights: 2, cur: 'AED', sell: 1980, cost: 1600, status: 'CONFIRMED', conf: 'CONFIRMED', pay: 'PAID', owner: 'staff', ext: 'WEB-48190' },
    { src: 'TBO_MANUAL', guest: 'Johan Lindqvist', hotel: 1, sup: 0, booked: -1, ci: 6, nights: 7, cur: 'AED', sell: 6720, cost: 5480, status: 'CONFIRMED', conf: 'CONFIRMED', pay: 'PAID', owner: 'staff', ext: 'TBO-771881' },
    { src: 'WEBSITE_WEBHOOK', guest: 'Fatima Zahra Benali', hotel: 2, sup: 0, booked: -2, ci: 3, nights: 2, cur: 'AED', sell: 1450, cost: 1180, status: 'CANCELLED', conf: 'CONFIRMED', pay: 'PAID', owner: 'staff', ext: 'WEB-48160' },
    { src: 'DIRECT_HOTEL', guest: 'Fatima Zahra Benali', hotel: 2, sup: 0, booked: -2, ci: 3, nights: 2, cur: 'AED', sell: 1450, cost: 1180, status: 'CONFIRMED', conf: 'CONFIRMED', pay: 'PAID', owner: 'manager' },
    { src: 'WEBSITE_WEBHOOK', guest: 'Daniel Okafor', hotel: 1, sup: 0, booked: -2, ci: 22, nights: 3, cur: 'AED', sell: 2610, cost: 2150, status: 'CONFIRMED', conf: 'CONFIRMED', pay: 'PAID', owner: 'staff', ext: 'WEB-48155' },
    { src: 'TBO_MANUAL', guest: 'Daniel Okafor', hotel: 1, sup: 0, booked: -2, ci: 22, nights: 3, cur: 'AED', sell: 2390, cost: 2150, status: 'CONFIRMED', conf: 'CONFIRMED', pay: 'UNPAID', owner: 'staff', ext: 'TBO-771860' },
    { src: 'SUPPLIER_EMAIL', guest: 'Hana Kobayashi', hotel: 3, sup: 1, booked: -3, ci: 18, nights: 4, cur: 'QAR', sell: 5200, cost: 4310, status: 'CONFIRMED', conf: 'CONFIRMED', pay: 'PAID', owner: 'manager', ext: 'DR-20402' },
    { src: 'WEBSITE_WEBHOOK', guest: 'Marco Bellini', hotel: 0, sup: 2, booked: -3, ci: 2, nights: 1, cur: 'AED', sell: 990, cost: 820, status: 'CONFIRMED', conf: 'CONFIRMED', pay: 'PAID', owner: 'staff', ext: 'WEB-48120' },
    { src: 'OTHER_OFFLINE', guest: 'Aisha Rahman', hotel: 4, sup: null, booked: -4, ci: 25, nights: 3, cur: 'OMR', sell: null, cost: null, status: 'PENDING', conf: 'PENDING', pay: 'UNPAID', owner: null },
    { src: 'TBO_MANUAL', guest: 'Noah Schmidt', hotel: 2, sup: 0, booked: -5, ci: 11, nights: 2, cur: 'AED', sell: 1620, cost: 1290, status: 'CONFIRMED', conf: 'CONFIRMED', pay: 'PAID', owner: 'manager', ext: 'TBO-771799' },
    { src: 'WEBSITE_WEBHOOK', guest: 'Layla Nasser', hotel: 1, sup: 0, booked: -6, ci: 40, nights: 6, cur: 'AED', sell: 5340, cost: 4400, status: 'CONFIRMED', conf: 'CONFIRMED', pay: 'PAID', owner: 'staff', ext: 'WEB-48042' },
  ];

  for (const r of rows) {
    const src = sources[r.src]!;
    const hotel = hotels[r.hotel]!;
    const checkIn = dateOnly(r.ci);
    const checkOut = dateOnly(r.ci + r.nights);
    const owner = r.owner === 'staff' ? staff.id : r.owner === 'manager' ? manager.id : null;
    const b = await prisma.booking.create({
      data: {
        internalRef: await nextRef(),
        externalRef: r.ext ?? null,
        sourceId: src.id,
        channel: src.channel,
        supplierId: r.sup === null ? null : suppliers[r.sup]!.id,
        hotelId: hotel.id,
        leadGuestName: r.guest,
        guestEmail: `${r.guest.split(' ')[0]!.toLowerCase()}@guest.example`,
        adults: 2,
        rooms: 1,
        roomType: r.nights > 4 ? 'Junior Suite' : 'Deluxe King',
        boardBasis: 'BB',
        bookingDate: day(r.booked, 5 + (r.ci % 8)),
        checkIn,
        checkOut,
        currency: r.cur,
        sellingAmount: r.sell === null ? null : new Prisma.Decimal(r.sell),
        costAmount: r.cost === null ? null : new Prisma.Decimal(r.cost),
        status: r.status ?? 'PENDING',
        confirmationStatus: r.conf ?? 'PENDING',
        confirmationNumber: r.conf === 'CONFIRMED' ? `HC-${Math.floor(100000 + Math.random() * 899999)}` : null,
        cancellationStatus: r.status === 'CANCELLED' ? 'CANCELLED' : 'NONE',
        paymentStatus: r.pay ?? 'UNPAID',
        assignedToId: owner,
        createdById: src.channel === 'OFFLINE' ? owner : null,
        dedupeKey: `${hotel.id}|${norm(r.guest)}|${checkIn.toISOString().slice(0, 10)}|${checkOut.toISOString().slice(0, 10)}`,
        isDemo: true,
        notes: src.channel === 'OFFLINE' ? 'Demo booking for presentation' : null,
      },
    });
    await prisma.bookingChange.create({ data: { bookingId: b.id, changedById: src.channel === 'OFFLINE' ? owner : null, changeType: src.channel === 'ONLINE' ? 'SYNCED' : 'CREATED', origin: src.channel === 'ONLINE' ? 'WEBHOOK' : 'UI', diff: { source: src.code, demo: true } } });
  }

  // Follow-ups: a DEMO mailbox that is never contacted (mode DEMO is skipped by the engine).
  const integ = await prisma.integration.create({
    data: { kind: 'GMAIL', name: 'Demo mailbox (not connected)', mailboxAddress: DEMO_MAILBOX, mode: 'DEMO', status: 'NOT_CONFIGURED', config: { demo: true } },
  });
  const rule = await prisma.followUpRule.findFirst({ where: { delayHours: 24 } });
  const convs: { subject: string; sup: number; status: 'TRACKING' | 'AWAITING_APPROVAL' | 'REPLIED' | 'NEEDS_REVIEW' | 'EXHAUSTED'; sentAgoH: number; count: number; reason?: string }[] = [
    { subject: 'Group rates request — 12 rooms, December', sup: 0, status: 'AWAITING_APPROVAL', sentAgoH: 27, count: 0 },
    { subject: 'Allotment renewal Q1 — Palm Garden', sup: 0, status: 'TRACKING', sentAgoH: 6, count: 0 },
    { subject: 'Desert safari + hotel package quotation', sup: 1, status: 'REPLIED', sentAgoH: 30, count: 1 },
    { subject: 'Early check-in confirmation — Haddad', sup: 2, status: 'NEEDS_REVIEW', sentAgoH: 20, count: 0, reason: 'Delivery failure (bounce) received' },
    { subject: 'Winter contract rates 2027', sup: 1, status: 'EXHAUSTED', sentAgoH: 120, count: 2 },
  ];
  for (const [i, c] of convs.entries()) {
    const sent = new Date(Date.now() - c.sentAgoH * 3600_000);
    const contact = (await prisma.supplierContact.findFirst({ where: { supplierId: suppliers[c.sup]!.id } }))!;
    const conv = await prisma.emailConversation.create({
      data: {
        integrationId: integ.id, providerThreadId: `demo-thread-${i}`, originalMessageId: `demo-msg-${i}`, subject: c.subject,
        supplierId: suppliers[c.sup]!.id, ownerId: i % 2 ? manager.id : staff.id, ruleId: rule?.id ?? null, recipients: [contact.email],
        status: c.status, originalSentAt: sent, followUpCount: c.count, lastCheckedAt: new Date(),
        nextFollowUpAt: c.status === 'TRACKING' ? new Date(sent.getTime() + 24 * 3600_000) : null,
        lastExternalReplyAt: c.status === 'REPLIED' ? new Date(Date.now() - 2 * 3600_000) : null,
        pausedReason: c.reason ?? null,
        messages: {
          create: [
            { providerMessageId: `demo-msg-${i}`, direction: 'OUTBOUND', fromAddress: DEMO_MAILBOX, subject: c.subject, classification: 'ORIGINAL', receivedAt: sent },
            ...(c.status === 'REPLIED' ? [{ providerMessageId: `demo-r-${i}`, direction: 'INBOUND' as const, fromAddress: contact.email, subject: `RE: ${c.subject}`, classification: 'QUALIFYING_REPLY' as const, receivedAt: new Date(Date.now() - 2 * 3600_000) }] : []),
            ...(c.status === 'NEEDS_REVIEW' ? [{ providerMessageId: `demo-b-${i}`, direction: 'INBOUND' as const, fromAddress: 'mailer-daemon@mx.harbourview.example', subject: `Undeliverable: ${c.subject}`, classification: 'BOUNCE' as const, receivedAt: new Date(Date.now() - 3600_000) }] : []),
          ],
        },
      },
    });
    if (c.status === 'AWAITING_APPROVAL') {
      await prisma.followUpExecution.create({
        data: {
          conversationId: conv.id, sequence: 1, idempotencyKey: `${conv.id}:1`, status: 'AWAITING_APPROVAL', scheduledFor: new Date(), recipients: [contact.email],
          subject: `RE: ${c.subject}`, body: `Dear ${suppliers[c.sup]!.name},\n\nFollowing up on our request below. Could you please share an update at your earliest convenience?\n\nKind regards,\nDemo Ops Staff`,
        },
      });
      await prisma.notification.create({ data: { userId: staff.id, type: 'followup.draft_ready', title: `Follow-up #1 drafted for review: ${c.subject}`, link: `/follow-ups/${conv.id}` } });
    }
  }
  console.log(`demo data created: ${rows.length} bookings, ${suppliers.length} suppliers, ${hotels.length} hotels, ${convs.length} follow-up threads`);
}

(process.argv.includes('--remove') ? remove() : create())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
