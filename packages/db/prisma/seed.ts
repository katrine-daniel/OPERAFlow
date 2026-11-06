/**
 * Idempotent seed. Creates reference data only — no fake bookings.
 *
 * Credentials are never hardcoded: the admin password comes from SEED_ADMIN_PASSWORD,
 * or a random one is generated and written to <repo>/.local/seed-credentials.txt (gitignored).
 * Set SEED_DEMO_USERS=true to also create one user per role for local testing.
 */
import { PrismaClient, Role, TestJourney } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';
import { mkdirSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

const prisma = new PrismaClient();
const credsFile = resolve(__dirname, '..', '..', '..', '.local', 'seed-credentials.txt');

function generatePassword(): string {
  // 18 random bytes → 24 base64url chars, plus a suffix guaranteeing the policy's character classes.
  return `${randomBytes(18).toString('base64url')}-Aa1`;
}

async function upsertUser(email: string, name: string, role: Role, providedPassword?: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`user exists: ${email} (${role}) — password unchanged`);
    return;
  }
  const password = providedPassword ?? generatePassword();
  await prisma.user.create({
    data: { email, name, role, passwordHash: await hash(password, { algorithm: 2 }) },
  });
  if (!providedPassword) {
    mkdirSync(resolve(credsFile, '..'), { recursive: true });
    appendFileSync(credsFile, `${new Date().toISOString()}  ${role.padEnd(12)} ${email}  ${password}\n`);
  }
  console.log(`created user: ${email} (${role})${providedPassword ? '' : ' — password written to .local/seed-credentials.txt'}`);
}

async function main() {
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? 'admin@operaflow.local').toLowerCase();
  await upsertUser(adminEmail, 'System Administrator', 'ADMIN', process.env.SEED_ADMIN_PASSWORD || undefined);

  if (process.env.SEED_DEMO_USERS === 'true') {
    await upsertUser('manager@operaflow.local', 'Demo Ops Manager', 'OPS_MANAGER');
    await upsertUser('staff@operaflow.local', 'Demo Ops Staff', 'OPS_STAFF');
    await upsertUser('qa@operaflow.local', 'Demo QA Engineer', 'QA');
  }

  // Booking sources. isLive=false means no live integration backs this source yet.
  const sources = [
    { code: 'WEBSITE_API', name: 'Booking website (API sync)', channel: 'ONLINE', adapter: 'API' },
    { code: 'WEBSITE_WEBHOOK', name: 'Booking website (webhook)', channel: 'ONLINE', adapter: 'WEBHOOK' },
    { code: 'WEBSITE_EXPORT', name: 'Booking website (approved CSV export)', channel: 'ONLINE', adapter: 'CSV_IMPORT' },
    { code: 'TBO_MANUAL', name: 'TBO (manual entry / CSV — no live API configured)', channel: 'OFFLINE', adapter: 'MANUAL' },
    { code: 'DIRECT_HOTEL', name: 'Direct hotel call', channel: 'OFFLINE', adapter: 'MANUAL' },
    { code: 'SUPPLIER_EMAIL', name: 'Supplier email', channel: 'OFFLINE', adapter: 'MANUAL' },
    { code: 'OTHER_OFFLINE', name: 'Other authorised channel', channel: 'OFFLINE', adapter: 'MANUAL' },
  ] as const;
  for (const s of sources) {
    await prisma.bookingSource.upsert({ where: { code: s.code }, update: { name: s.name }, create: { ...s, isLive: false } });
  }

  const template = await prisma.followUpTemplate.upsert({
    where: { name: 'Standard rate-request follow-up' },
    update: {},
    create: {
      name: 'Standard rate-request follow-up',
      subjectTemplate: 'RE: {{originalSubject}}',
      bodyTemplate:
        'Dear {{supplierName}},\n\nFollowing up on our request below sent on {{originalSentDate}}. ' +
        'Could you please share an update at your earliest convenience?\n\nKind regards,\n{{ownerName}}',
    },
  });
  for (const hours of [24, 48, 72]) {
    await prisma.followUpRule.upsert({
      where: { name: `${hours}h follow-up (draft review)` },
      update: {},
      create: {
        name: `${hours}h follow-up (draft review)`,
        delayHours: hours,
        maxFollowUps: 2,
        templateId: template.id,
        sendMode: 'DRAFT_REVIEW',
        timezone: process.env.DEFAULT_TIMEZONE ?? 'UTC',
      },
    });
  }

  // Scenario catalogue. Environments are NOT seeded — they must be configured with real sandbox URLs.
  const scenarios: { key: string; name: string; journey: TestJourney; critical: boolean; mutates: boolean }[] = [
    { key: 'search.destination-dates', name: 'Hotel search by destination and dates', journey: 'HOTEL_SEARCH', critical: true, mutates: false },
    { key: 'availability.rooms', name: 'Room availability search', journey: 'ROOM_AVAILABILITY', critical: true, mutates: false },
    { key: 'rates.select', name: 'Room and rate selection', journey: 'RATE_SELECTION', critical: true, mutates: false },
    { key: 'guest.validation', name: 'Guest information validation', journey: 'GUEST_VALIDATION', critical: false, mutates: false },
    { key: 'booking.create-sandbox', name: 'Booking creation (sandbox)', journey: 'BOOKING_CREATE', critical: true, mutates: true },
    { key: 'booking.confirmation', name: 'Booking confirmation verification', journey: 'BOOKING_CONFIRMATION', critical: true, mutates: true },
    { key: 'booking.modify-sandbox', name: 'Booking modification (sandbox)', journey: 'BOOKING_MODIFY', critical: false, mutates: true },
    { key: 'booking.cancel-sandbox', name: 'Booking cancellation (sandbox)', journey: 'BOOKING_CANCEL', critical: true, mutates: true },
    { key: 'policy.refund-cancellation', name: 'Refund and cancellation-policy validation', journey: 'CANCELLATION_POLICY', critical: false, mutates: false },
    { key: 'negative.invalid-inputs', name: 'Invalid inputs, unavailable rooms and API errors', journey: 'NEGATIVE_INPUTS', critical: false, mutates: false },
  ];
  for (const s of scenarios) {
    await prisma.testScenario.upsert({
      where: { key: s.key },
      update: {},
      create: {
        key: s.key,
        name: s.name,
        journey: s.journey,
        isCritical: s.critical,
        mutatesBookings: s.mutates,
        viewports: ['desktop', 'mobile'],
      },
    });
  }

  const settings: Record<string, unknown> = {
    'retention.auditLogDays': 730,
    'retention.sessionDays': 30,
    'retention.testArtifactDays': 30,
    'retention.reportFileDays': 365,
    'org.defaultTimezone': process.env.DEFAULT_TIMEZONE ?? 'UTC',
    'org.defaultCurrency': 'USD',
  };
  for (const [key, value] of Object.entries(settings)) {
    await prisma.systemSetting.upsert({ where: { key }, update: {}, create: { key, value: value as never } });
  }

  console.log('seed complete');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
