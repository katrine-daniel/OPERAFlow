// OPERAFlow interactive demo — sample data and the same business rules the real app uses.
// Everything here is fictional and lives only in the visitor's browser (localStorage).
'use strict';

const OF_TZ = 'Asia/Dubai';

const OF_ROLES = {
  ADMIN: { label: 'Administrator', name: 'Sara Admin', perms: ['dashboard', 'bookings', 'write', 'reconcile', 'followups', 'reports', 'tests', 'suppliers', 'audit'] },
  OPS_MANAGER: { label: 'Operations Manager', name: 'Omar Manager', perms: ['dashboard', 'bookings', 'write', 'reconcile', 'followups', 'reports', 'tests', 'suppliers', 'audit'] },
  OPS_STAFF: { label: 'Operations Staff', name: 'Nadia Staff', perms: ['dashboard', 'bookings', 'write', 'followups', 'reports', 'suppliers'] },
  QA: { label: 'QA Engineer', name: 'Quinn QA', perms: ['dashboard', 'tests'] },
};

const OF_SOURCES = [
  { code: 'WEBSITE_WEBHOOK', name: 'Booking website (webhook)', channel: 'ONLINE', manual: false },
  { code: 'TBO_MANUAL', name: 'TBO (manual entry / CSV)', channel: 'OFFLINE', manual: true },
  { code: 'DIRECT_HOTEL', name: 'Direct hotel call', channel: 'OFFLINE', manual: true },
  { code: 'SUPPLIER_EMAIL', name: 'Supplier email', channel: 'OFFLINE', manual: true },
  { code: 'OTHER_OFFLINE', name: 'Other authorised channel', channel: 'OFFLINE', manual: true },
];

const OF_LABEL = {
  PENDING: 'Pending', CONFIRMED: 'Confirmed', ON_REQUEST: 'On request', CANCELLED: 'Cancelled', UNPAID: 'Unpaid', PAID: 'Paid',
  PARTIALLY_PAID: 'Partially paid', ONLINE: 'Online', OFFLINE: 'Offline', DUPLICATE_SUSPECT: 'Possible duplicate',
  AMOUNT_MISMATCH: 'Amount mismatch', STATUS_MISMATCH: 'Status mismatch', MISSING_REQUIRED_DATA: 'Missing required data',
};

const OF_FIELD = { sellingAmount: 'selling price', costAmount: 'supplier cost', supplier: 'supplier', hotel: 'hotel', assignedTo: 'owner', confirmationNumber: 'confirmation number' };

// ── Date helpers (organisation timezone) ──
function ofDayISO(offset = 0) {
  const d = new Date(Date.now() + offset * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: OF_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function ofAddDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function ofNights(ci, co) {
  return Math.round((new Date(co + 'T00:00:00Z') - new Date(ci + 'T00:00:00Z')) / 86400000);
}

// ── Business rules (same as the real API) ──
function ofNormalizeName(name) {
  return name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/).filter((t) => t && !['mr', 'mrs', 'ms', 'miss', 'dr'].includes(t)).sort().join(' ');
}
function ofDedupeKey(b) {
  return b.hotelId ? [b.hotelId, ofNormalizeName(b.guest), b.checkIn, b.checkOut].join('|') : null;
}
function ofMissing(b) {
  if (b.status === 'CANCELLED') return [];
  const out = [];
  if (b.sell == null) out.push('sellingAmount');
  if (b.cost == null) out.push('costAmount');
  if (!b.supplierId) out.push('supplier');
  if (!b.hotelId) out.push('hotel');
  if (!b.owner) out.push('assignedTo');
  if (b.confirmation === 'CONFIRMED' && !b.confirmationNumber) out.push('confirmationNumber');
  return out;
}
function ofMargin(b) {
  return b.sell == null || b.cost == null ? null : Math.round((b.sell - b.cost) * 100) / 100;
}

// ── Sample data ──
function ofSeed() {
  const suppliers = [
    { id: 's1', code: 'GLOBALBEDS', name: 'GlobalBeds Wholesale', type: 'Wholesaler', tz: 'Asia/Dubai', contacts: ['rates@globalbeds.example'] },
    { id: 's2', code: 'DESERTDMC', name: 'Desert Routes DMC', type: 'DMC', tz: 'Asia/Dubai', contacts: ['contracting@desertroutes.example'] },
    { id: 's3', code: 'HARBOURHTL', name: 'Harbour View Hotel', type: 'Hotel direct', tz: 'Asia/Dubai', contacts: ['reservations@harbourview.example'] },
  ];
  const hotels = [
    { id: 'h1', name: 'Harbour View Hotel', city: 'Dubai', country: 'AE', stars: 5 },
    { id: 'h2', name: 'Palm Garden Resort', city: 'Dubai', country: 'AE', stars: 4 },
    { id: 'h3', name: 'Old Town Courtyard', city: 'Abu Dhabi', country: 'AE', stars: 4 },
    { id: 'h4', name: 'Corniche Suites', city: 'Doha', country: 'QA', stars: 5 },
    { id: 'h5', name: 'Marina Lights Hotel', city: 'Muscat', country: 'OM', stars: 3 },
  ];
  const rows = [
    ['WEBSITE_WEBHOOK', 'Amira Haddad', 'h1', 's3', 0, 12, 3, 'AED', 2850, 2280, 'CONFIRMED', 'CONFIRMED', 'PAID', 'Nadia Staff', 'WEB-48211'],
    ['WEBSITE_WEBHOOK', 'Lukas Brenner', 'h2', 's1', 0, 20, 5, 'AED', 4100, 3350, 'CONFIRMED', 'PENDING', 'PAID', 'Omar Manager', 'WEB-48214'],
    ['TBO_MANUAL', 'Priya Natarajan', 'h3', 's1', 0, 9, 2, 'AED', 1540, null, 'ON_REQUEST', 'PENDING', 'UNPAID', 'Nadia Staff', 'TBO-771920'],
    ['DIRECT_HOTEL', 'Omar Al Farsi', 'h5', null, 0, 4, 4, 'OMR', 380, 300, 'PENDING', 'PENDING', 'UNPAID', null, null],
    ['SUPPLIER_EMAIL', 'Chen Wei', 'h4', 's2', -1, 15, 3, 'QAR', 3900, 3120, 'CONFIRMED', 'CONFIRMED', 'PARTIALLY_PAID', 'Omar Manager', 'DR-20415'],
    ['WEBSITE_WEBHOOK', 'Sofia Marquez', 'h1', 's3', -1, 30, 2, 'AED', 1980, 1600, 'CONFIRMED', 'CONFIRMED', 'PAID', 'Nadia Staff', 'WEB-48190'],
    ['TBO_MANUAL', 'Johan Lindqvist', 'h2', 's1', -1, 6, 7, 'AED', 6720, 5480, 'CONFIRMED', 'CONFIRMED', 'PAID', 'Nadia Staff', 'TBO-771881'],
    ['WEBSITE_WEBHOOK', 'Fatima Zahra Benali', 'h3', 's1', -2, 3, 2, 'AED', 1450, 1180, 'CANCELLED', 'CONFIRMED', 'PAID', 'Nadia Staff', 'WEB-48160'],
    ['DIRECT_HOTEL', 'Fatima Zahra Benali', 'h3', 's1', -2, 3, 2, 'AED', 1450, 1180, 'CONFIRMED', 'CONFIRMED', 'PAID', 'Omar Manager', null],
    ['WEBSITE_WEBHOOK', 'Daniel Okafor', 'h2', 's1', -2, 22, 3, 'AED', 2610, 2150, 'CONFIRMED', 'CONFIRMED', 'PAID', 'Nadia Staff', 'WEB-48155'],
    ['TBO_MANUAL', 'Daniel Okafor', 'h2', 's1', -2, 22, 3, 'AED', 2390, 2150, 'CONFIRMED', 'CONFIRMED', 'UNPAID', 'Nadia Staff', 'TBO-771860'],
    ['SUPPLIER_EMAIL', 'Hana Kobayashi', 'h4', 's2', -3, 18, 4, 'QAR', 5200, 4310, 'CONFIRMED', 'CONFIRMED', 'PAID', 'Omar Manager', 'DR-20402'],
    ['WEBSITE_WEBHOOK', 'Marco Bellini', 'h1', 's3', -3, 2, 1, 'AED', 990, 820, 'CONFIRMED', 'CONFIRMED', 'PAID', 'Nadia Staff', 'WEB-48120'],
    ['OTHER_OFFLINE', 'Aisha Rahman', 'h5', null, -4, 25, 3, 'OMR', null, null, 'PENDING', 'PENDING', 'UNPAID', null, null],
    ['TBO_MANUAL', 'Noah Schmidt', 'h3', 's1', -5, 11, 2, 'AED', 1620, 1290, 'CONFIRMED', 'CONFIRMED', 'PAID', 'Omar Manager', 'TBO-771799'],
    ['WEBSITE_WEBHOOK', 'Layla Nasser', 'h2', 's1', -6, 40, 6, 'AED', 5340, 4400, 'CONFIRMED', 'CONFIRMED', 'PAID', 'Nadia Staff', 'WEB-48042'],
  ];
  let n = 1;
  const year = ofDayISO().slice(0, 4);
  const bookings = rows.map(([src, guest, hotelId, supplierId, booked, ci, nights, cur, sell, cost, status, confirmation, payment, owner, ext], i) => {
    const source = OF_SOURCES.find((s) => s.code === src);
    const checkIn = ofDayISO(ci);
    const bookedAt = new Date(Date.now() + booked * 86400000 - (i % 5) * 3600000).toISOString();
    const b = {
      id: 'b' + n, ref: `OF-${year}-${String(n++).padStart(6, '0')}`, ext, source: src, channel: source.channel, guest, email: guest.split(' ')[0].toLowerCase() + '@guest.example',
      hotelId, supplierId, bookedAt, checkIn, checkOut: ofAddDays(checkIn, nights), currency: cur, sell, cost, status, confirmation, payment, owner,
      confirmationNumber: confirmation === 'CONFIRMED' ? 'HC-' + (482000 + i * 137) : null, roomType: nights > 4 ? 'Junior Suite' : 'Deluxe King', board: 'BB', adults: 2,
      history: [{ at: bookedAt, who: source.channel === 'ONLINE' ? 'Booking website' : owner || 'Nadia Staff', what: source.channel === 'ONLINE' ? 'Synced from booking website' : 'Created' }],
    };
    if (status === 'CANCELLED') b.history.unshift({ at: new Date(Date.now() - 3600000).toISOString(), who: 'Booking website', what: 'Cancelled at the source' });
    return b;
  });

  const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
  const followups = [
    { id: 'f1', subject: 'Group rates request — 12 rooms, December', supplierId: 's1', to: 'rates@globalbeds.example', owner: 'Nadia Staff', status: 'AWAITING_APPROVAL', sentAt: ago(27), count: 0, max: 2, rule: '24h follow-up (draft review)',
      messages: [{ from: 'reservations@demo-agency.example', kind: 'Original request', at: ago(27) }],
      draft: 'Dear GlobalBeds Wholesale,\n\nFollowing up on our request below sent yesterday. Could you please share an update at your earliest convenience?\n\nKind regards,\nNadia Staff' },
    { id: 'f2', subject: 'Allotment renewal Q1 — Palm Garden', supplierId: 's1', to: 'rates@globalbeds.example', owner: 'Omar Manager', status: 'TRACKING', sentAt: ago(6), count: 0, max: 2, rule: '24h follow-up (draft review)', next: ago(-18),
      messages: [{ from: 'reservations@demo-agency.example', kind: 'Original request', at: ago(6) }] },
    { id: 'f3', subject: 'Desert safari + hotel package quotation', supplierId: 's2', to: 'contracting@desertroutes.example', owner: 'Nadia Staff', status: 'REPLIED', sentAt: ago(30), count: 1, max: 2, rule: '24h follow-up (draft review)',
      messages: [{ from: 'reservations@demo-agency.example', kind: 'Original request', at: ago(30) }, { from: 'reservations@demo-agency.example', kind: 'Our follow-up', at: ago(5) }, { from: 'rates@desertroutes.example', kind: 'Out of office (ignored)', at: ago(5) }, { from: 'contracting@desertroutes.example', kind: 'Supplier reply', at: ago(2) }] },
    { id: 'f4', subject: 'Early check-in confirmation — Haddad', supplierId: 's3', to: 'reservations@harbourview.example', owner: 'Omar Manager', status: 'NEEDS_REVIEW', sentAt: ago(20), count: 0, max: 2, rule: '24h follow-up (draft review)', reason: 'Delivery failure (bounce) received',
      messages: [{ from: 'reservations@demo-agency.example', kind: 'Original request', at: ago(20) }, { from: 'mailer-daemon@mx.harbourview.example', kind: 'Bounce', at: ago(1) }] },
    { id: 'f5', subject: 'Winter contract rates 2027', supplierId: 's2', to: 'contracting@desertroutes.example', owner: 'Nadia Staff', status: 'EXHAUSTED', sentAt: ago(120), count: 2, max: 2, rule: '48h follow-up (draft review)',
      messages: [{ from: 'reservations@demo-agency.example', kind: 'Original request', at: ago(120) }, { from: 'reservations@demo-agency.example', kind: 'Our follow-up', at: ago(72) }, { from: 'reservations@demo-agency.example', kind: 'Our follow-up', at: ago(24) }] },
  ];

  const step = (action, target, ms, status = 'passed', error) => ({ action, target, ms, status, error });
  const tests = {
    scenarios: [
      { id: 't1', name: 'Hotel search by destination and dates', critical: true, sandboxOnly: false },
      { id: 't2', name: 'Booking creation & cancellation (sandbox)', critical: true, sandboxOnly: true },
      { id: 't3', name: 'Guest information validation', critical: false, sandboxOnly: false },
      { id: 't4', name: 'Room availability search', critical: true, sandboxOnly: false },
      { id: 't5', name: 'Refund and cancellation-policy validation', critical: false, sandboxOnly: false, unconfigured: true },
    ],
    runs: [
      { id: 'r1', scenario: 't1', viewport: 'desktop', status: 'PASSED', at: ago(2), ms: 508, steps: [step('goto', '/', 50), step('fill', '#destination', 30), step('fill', '#checkin', 10), step('fill', '#checkout', 9), step('click', '#search', 70), step('expectCount', '.hotel-card ≥ 1', 30), step('screenshot', 'results', 42)], blocked: ['https://analytics.example.com/tracker.js'] },
      { id: 'r2', scenario: 't1', viewport: 'mobile', status: 'PASSED', at: ago(2), ms: 445, steps: [step('goto', '/', 44), step('fill', '#destination', 28), step('fill', '#checkin', 9), step('fill', '#checkout', 9), step('click', '#search', 66), step('expectCount', '.hotel-card ≥ 1', 27), step('screenshot', 'results', 40)], blocked: ['https://analytics.example.com/tracker.js'] },
      { id: 'r3', scenario: 't2', viewport: 'desktop', status: 'PASSED', at: ago(2), ms: 1900, extracted: 'SBX-1001', steps: [step('goto', '/search?destination=Dubai…', 39), step('click', '.hotel-card .view', 165), step('expectText', '#policy contains "Free cancellation"', 155), step('click', '.room[DLX] .select-rate', 36), step('fill', '#first', 101), step('fill', '#last', 8), step('fill', '#email ({{secret.guestEmail}})', 8), step('fill', '#card (test card 4242…)', 36), step('click', '#confirm', 828), step('extract', '#booking-ref → ref', 54), step('expectText', '#status contains "CONFIRMED"', 6), step('goto', '/manage/{{extracted.ref}}', 15), step('click', '#cancel', 70), step('expectText', '#status contains "CANCELLED"', 25), step('expectVisible', '#refund', 3)], blocked: ['https://analytics.example.com/tracker.js'] },
      { id: 'r4', scenario: 't3', viewport: 'desktop', status: 'PASSED', at: ago(2), ms: 612, steps: [step('goto', '/book?hotel=1&room=DLX', 41), step('fill', '#first', 22), step('fill', '#last', 8), step('fill', '#email = not-an-email', 9), step('click', '#confirm', 60), step('expectText', '#form-error contains "valid email"', 18)], blocked: [] },
      { id: 'r5', scenario: 't4', viewport: 'desktop', status: 'FAILED', failure: 'ASSERTION', at: ago(2), ms: 2210, error: 'Expected 3+ × .room, found 2', steps: [step('goto', '/search?destination=Dubai…', 40), step('click', '.hotel-card .view', 120), step('expectCount', '.room ≥ 3', 1502, 'failed', 'Expected 3+ × .room, found 2')], blocked: [] },
      { id: 'r6', scenario: 't2', viewport: 'desktop', status: 'BLOCKED_SAFETY', failure: 'SAFETY_GUARD', at: ago(26), ms: 3, env: 'Staging', error: 'This scenario creates, modifies or cancels bookings and may only run against a SANDBOX environment with booking mutations enabled', steps: [], blocked: [] },
    ],
  };

  return {
    version: 1,
    suppliers, hotels, bookings, followups, tests,
    issues: [],
    reconciledAt: null,
    recipients: ['ops-team@demo-agency.example'],
    audit: [
      { at: ago(2), who: 'Sara Admin', action: 'test_run.requested', entity: 'Hotel search by destination and dates' },
      { at: ago(3), who: 'Sara Admin', action: 'report_schedule.enabled', entity: 'Daily operations report' },
      { at: ago(5), who: 'Booking website', action: 'webhook.booking_synced', entity: 'WEB-48214' },
      { at: ago(8), who: 'Omar Manager', action: 'booking.confirmed', entity: 'OF-' + year + '-000005' },
      { at: ago(26), who: 'Sara Admin', action: 'auth.login', entity: 'user' },
    ],
    nextRef: n,
  };
}
