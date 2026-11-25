// OPERAFlow interactive demo. Runs entirely in the browser with fictional data (see data.js).
// Nothing is sent anywhere: no emails, no bookings, no network calls.
'use strict';

const KEY = 'operaflow-demo-v1';
const ROLE_KEY = 'operaflow-demo-role';
let S = loadState();
let role = loadRole();
const F = { q: '', channel: '', status: '', missing: false };
const UI = { pendingBooking: null, issueTab: 'OPEN', fuTab: 'ACTION', reportDay: ofDayISO(-1) };

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.version === 1) return s;
  } catch (e) { /* fresh start */ }
  return ofSeed();
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage unavailable: demo still works for this visit */ }
}
function loadRole() {
  try { const r = localStorage.getItem(ROLE_KEY); if (r && OF_ROLES[r]) return r; } catch (e) { /* default */ }
  return 'OPS_MANAGER';
}

// ── Helpers ──
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const can = (p) => OF_ROLES[role].perms.includes(p);
const me = () => OF_ROLES[role].name;
const hotel = (id) => S.hotels.find((h) => h.id === id);
const supplier = (id) => S.suppliers.find((s) => s.id === id);
const source = (code) => OF_SOURCES.find((s) => s.code === code);
const money = (n, cur) => (n == null ? '<span class="miss">Missing</span>' : `<span class="num">${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>${cur ? ` <span class="sub" style="display:inline">${esc(cur)}</span>` : ''}`);
const fmtDate = (iso) => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso + 'T00:00:00Z'));
const fmtDT = (iso) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: OF_TZ }).format(new Date(iso));
const dayOf = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: OF_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const active = (b) => b.status !== 'CANCELLED';

function audit(action, entity) {
  S.audit.unshift({ at: new Date().toISOString(), who: me(), action, entity });
  S.audit = S.audit.slice(0, 200);
}
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3600);
}
const TONE = {
  CONFIRMED: 'ok', PAID: 'ok', PASSED: 'ok', REPLIED: 'ok', RESOLVED: 'ok', TRACKING: 'info',
  PENDING: 'warn', ON_REQUEST: 'warn', UNPAID: 'warn', PARTIALLY_PAID: 'warn', AWAITING_APPROVAL: 'warn', NEEDS_REVIEW: 'warn', OPEN: 'warn', BLOCKED_SAFETY: 'warn',
  CANCELLED: 'n', DISMISSED: 'n', EXHAUSTED: 'n', FAILED: 'bad', ONLINE: 'info', OFFLINE: 'brand',
};
const LABEL2 = { AWAITING_APPROVAL: 'Draft to review', NEEDS_REVIEW: 'Needs review', TRACKING: 'Waiting for reply', REPLIED: 'Replied', EXHAUSTED: 'No reply (limit)', BLOCKED_SAFETY: 'Blocked (safety)', PASSED: 'Passed', FAILED: 'Failed', OPEN: 'Open', RESOLVED: 'Resolved', DISMISSED: 'Dismissed' };
const badge = (v, label) => `<span class="badge b-${TONE[v] || 'n'}">${esc(label || OF_LABEL[v] || LABEL2[v] || v)}</span>`;
const ph = (title, desc, actions = '') => `<div class="ph"><div><h1>${esc(title)}</h1>${desc ? `<p>${desc}</p>` : ''}</div>${actions ? `<div class="row">${actions}</div>` : ''}</div>`;
const card = (title, body, aside = '') => `<section class="card">${title ? `<header><h2>${esc(title)}</h2>${aside}</header>` : ''}${body}</section>`;
const stat = (l, v, h = '', tone = '', href = '') => `<${href ? `a href="${href}"` : 'div'} class="stat"><div class="l">${esc(l)}</div><div class="v num ${tone}">${v}</div>${h ? `<div class="h">${h}</div>` : ''}</${href ? 'a' : 'div'}>`;
const forbidden = () => card('', '<div class="empty"><b>You don\'t have access to this page</b><br>Switch the role at the top right to see how each team member\'s view differs.</div>');

// ── Navigation ──
const NAV = [
  ['Operations', [['#/', 'Dashboard', 'dashboard'], ['#/bookings', 'Booking registry', 'bookings'], ['#/reconciliation', 'Reconciliation', 'reconcile'], ['#/follow-ups', 'Supplier follow-ups', 'followups'], ['#/reports', 'Daily reports', 'reports']]],
  ['Quality', [['#/tests', 'Booking-site tests', 'tests']]],
  ['Directory', [['#/suppliers', 'Suppliers', 'suppliers']]],
  ['Administration', [['#/audit', 'Audit log', 'audit']]],
];
function renderNav(path) {
  $('#menu').innerHTML = NAV.map(([h, items]) => {
    const vis = items.filter((i) => can(i[2]));
    if (!vis.length) return '';
    return `<h6>${h}</h6>` + vis.map(([href, label]) => {
      const on = href === '#/' ? path === '/' : path.startsWith(href.slice(1));
      return `<a href="${href}" class="${on ? 'active' : ''}">${label}</a>`;
    }).join('');
  }).join('');
}

// ── Views ──
function viewDashboard() {
  const today = ofDayISO();
  const bToday = S.bookings.filter((b) => dayOf(b.bookedAt) === today);
  const pending = S.bookings.filter((b) => active(b) && b.confirmation === 'PENDING');
  const missing = S.bookings.filter((b) => ofMissing(b).length);
  const fuDue = S.followups.filter((f) => ['AWAITING_APPROVAL', 'NEEDS_REVIEW'].includes(f.status));
  const failed = S.tests.runs.filter((r) => r.status === 'FAILED' && Date.now() - new Date(r.at) < 86400000);
  const crit = failed.filter((r) => S.tests.scenarios.find((s) => s.id === r.scenario)?.critical);
  const stats = [
    can('bookings') && stat('Bookings today', bToday.length, `${bToday.filter((b) => b.channel === 'ONLINE').length} online · ${bToday.filter((b) => b.channel === 'OFFLINE').length} offline`, '', '#/bookings'),
    can('bookings') && stat('Pending confirmations', pending.length, 'Not yet confirmed by hotel', pending.length ? 'warn' : '', '#/bookings'),
    can('bookings') && stat('Missing booking data', missing.length, 'Amounts, supplier or owner', missing.length ? 'warn' : '', '#/bookings?missing=1'),
    can('followups') && stat('Follow-ups due', fuDue.length, `${S.followups.filter((f) => f.status === 'NEEDS_REVIEW').length} need review`, '', '#/follow-ups'),
    can('tests') && stat('Failed tests (24h)', failed.length, `${crit.length} critical`, crit.length ? 'bad' : '', '#/tests'),
    can('reports') && stat('Scheduled reports', 1, 'Daily at 08:00 Dubai', '', '#/reports'),
  ].filter(Boolean).join('');

  // Last 7 days, online vs offline.
  const days = [...Array(7)].map((_, i) => ofDayISO(i - 6));
  const counts = days.map((d) => ({ d, on: S.bookings.filter((b) => dayOf(b.bookedAt) === d && b.channel === 'ONLINE').length, off: S.bookings.filter((b) => dayOf(b.bookedAt) === d && b.channel === 'OFFLINE').length }));
  const max = Math.max(1, ...counts.map((c) => c.on + c.off));
  const chart = `<div class="pad"><div style="display:flex;align-items:flex-end;gap:10px;height:150px">${counts.map((c) => `
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;height:100%;justify-content:flex-end" title="${fmtDate(c.d)}: ${c.on} online, ${c.off} offline">
        <span class="num" style="font-size:11.5px;color:var(--ink-3)">${c.on + c.off || ''}</span>
        <div style="width:100%;max-width:34px;display:flex;flex-direction:column;border-radius:4px;overflow:hidden">
          <div style="height:${(c.off / max) * 110}px;background:#0f5c6e"></div><div style="height:${(c.on / max) * 110}px;background:#5fb7c9"></div>
        </div>
        <span style="font-size:11px;color:var(--ink-3)">${new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(new Date(c.d + 'T00:00:00Z'))}</span>
      </div>`).join('')}</div>
      <div class="row" style="margin-top:10px;font-size:12px;color:var(--ink-3)"><span><span class="dot" style="background:#5fb7c9;width:10px;height:10px"></span> Online</span><span><span class="dot" style="background:#0f5c6e;width:10px;height:10px"></span> Offline</span></div></div>`;

  const arrivals = S.bookings.filter((b) => active(b) && b.checkIn >= ofDayISO() && b.checkIn <= ofDayISO(14)).sort((a, b) => a.checkIn.localeCompare(b.checkIn)).slice(0, 6);
  const arrivalsList = arrivals.length ? `<ul class="list">${arrivals.map((b) => `<li><span><a href="#/bookings/${b.id}">${esc(b.guest)}</a><span class="sub">${esc(hotel(b.hotelId)?.name || 'Hotel missing')}</span></span><span class="right">${fmtDate(b.checkIn)}<span class="sub">${b.confirmation === 'CONFIRMED' ? 'Confirmed' : '<span class="miss">Unconfirmed</span>'}</span></span></li>`).join('')}</ul>` : '<div class="empty">No arrivals in the next 14 days</div>';

  const activity = can('audit')
    ? `<div class="tw"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Item</th></tr></thead><tbody>${S.audit.slice(0, 8).map((a) => `<tr><td class="sub" style="display:table-cell">${fmtDT(a.at)}</td><td>${esc(a.who)}</td><td class="mono">${esc(a.action)}</td><td>${esc(a.entity)}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty">Activity is visible to administrators and managers</div>';

  const health = `<ul class="list">
    <li><span>Scheduler / worker</span>${badge('n', 'Demo: not running')}</li>
    <li><span>Report email</span>${badge('n', 'Demo: nothing is sent')}</li>
    <li><span>Mailbox (Gmail / Microsoft 365)</span>${badge('n', 'Demo: not connected')}</li>
    <li><span>Booking website webhook</span>${badge('ONLINE', 'Sample bookings')}</li>
    <li><span>Test environments</span><span class="num">1 sandbox</span></li></ul>
    <p class="pad sub" style="margin:0">In the real system these show live status of the worker, SMTP relay, OAuth mailboxes and webhooks.</p>`;

  return ph('Operations overview', `${new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeZone: OF_TZ }).format(new Date())} · figures computed live in ${OF_TZ}`) +
    `<div class="grid g-stats">${stats}</div>
     <div class="grid g-main" style="margin-top:14px">
       <div class="grid">${can('bookings') ? card('Bookings, last 7 days', chart) : ''}${card('Recent activity', activity, can('audit') ? '<a href="#/audit" style="font-size:12.5px">Full audit log</a>' : '')}</div>
       <div class="grid" style="align-content:start">${can('bookings') ? card('Upcoming arrivals (14 days)', arrivalsList) : ''}${card('Automation health', health)}</div>
     </div>`;
}

function viewBookings(query) {
  if (!can('bookings')) return forbidden();
  if (query.get('missing')) F.missing = true;
  const q = F.q.trim().toLowerCase();
  const list = S.bookings.filter((b) => {
    if (F.channel && b.channel !== F.channel) return false;
    if (F.status && b.status !== F.status) return false;
    if (F.missing && !ofMissing(b).length) return false;
    if (q) {
      const h = hotel(b.hotelId);
      const hay = [b.ref, b.ext, b.guest, b.confirmationNumber, h && h.name, h && h.city].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }).sort((a, b) => b.bookedAt.localeCompare(a.bookedAt));
  const sel = (name, opts, val) => `<select class="input" data-filter="${name}">${opts.map(([v, l]) => `<option value="${v}" ${v === val ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const filters = `<div class="filters">
    <input class="input" style="width:240px" data-filter="q" placeholder="Ref, guest, hotel, confirmation no." value="${esc(F.q)}">
    ${sel('channel', [['', 'All channels'], ['ONLINE', 'Online'], ['OFFLINE', 'Offline']], F.channel)}
    ${sel('status', [['', 'Any status'], ['PENDING', 'Pending'], ['ON_REQUEST', 'On request'], ['CONFIRMED', 'Confirmed'], ['CANCELLED', 'Cancelled']], F.status)}
    <label class="row" style="font-size:12.5px;color:var(--ink-2)"><input type="checkbox" data-filter="missing" ${F.missing ? 'checked' : ''}> Missing data</label>
    ${F.q || F.channel || F.status || F.missing ? '<button class="btn sm" data-action="clear-filters">Clear</button>' : ''}</div>`;
  const rows = list.map((b) => {
    const h = hotel(b.hotelId);
    const m = ofMissing(b);
    const mg = ofMargin(b);
    return `<tr class="click" data-href="#/bookings/${b.id}">
      <td><a href="#/bookings/${b.id}" class="mono"><b>${esc(b.ref)}</b></a>${b.ext ? `<span class="sub mono">${esc(b.ext)}</span>` : ''}</td>
      <td>${esc(b.guest)}</td>
      <td>${h ? `${esc(h.name)}<span class="sub">${esc(h.city)}, ${esc(h.country)}</span>` : '<span class="miss">Missing</span>'}</td>
      <td style="white-space:nowrap">${fmtDate(b.checkIn)}<span class="sub">${ofNights(b.checkIn, b.checkOut)} nights</span></td>
      <td>${badge(b.channel)}<span class="sub">${esc(source(b.source).name)}</span></td>
      <td>${b.supplierId ? esc(supplier(b.supplierId).name) : '<span class="miss">Missing</span>'}</td>
      <td class="right" style="white-space:nowrap">${money(b.sell, b.currency)}</td>
      <td class="right num">${mg == null ? '<span class="sub" style="display:inline">—</span>' : mg.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
      <td>${badge(b.status)}${active(b) && b.confirmation !== 'CONFIRMED' ? '<span class="sub miss">Unconfirmed</span>' : ''}</td>
      <td>${b.owner ? esc(b.owner) : '<span class="miss">Unassigned</span>'}${m.length ? `<span class="sub">${badge('PENDING', m.length + ' missing')}</span>` : ''}</td></tr>`;
  }).join('');
  return ph('Booking registry', 'Online and offline bookings in one place. Amounts that were never provided are shown as missing, not zero.', can('write') ? '<a class="btn primary" href="#/bookings/new">New offline booking</a>' : '') +
    card('', filters + (list.length ? `<div class="tw"><table><thead><tr><th>Reference</th><th>Guest</th><th>Hotel</th><th>Stay</th><th>Source</th><th>Supplier</th><th class="right">Selling</th><th class="right">Margin</th><th>Status</th><th>Owner</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty">No bookings match these filters</div>') +
      `<div class="pad sub" style="border-top:1px solid var(--line)">${list.length} of ${S.bookings.length} bookings</div>`);
}

function viewBooking(id) {
  if (!can('bookings')) return forbidden();
  const b = S.bookings.find((x) => x.id === id);
  if (!b) return card('', '<div class="empty">Booking not found</div>');
  const h = hotel(b.hotelId);
  const m = ofMissing(b);
  const mg = ofMargin(b);
  const issues = S.issues.filter((i) => i.status === 'OPEN' && (i.a === b.id || i.b === b.id));
  const actions = can('write') ? [
    active(b) && b.confirmation !== 'CONFIRMED' ? `<button class="btn primary" data-action="confirm" data-id="${b.id}">Mark confirmed</button>` : '',
    active(b) && b.channel === 'OFFLINE' ? `<button class="btn" data-action="cancel" data-id="${b.id}">Cancel booking</button>` : '',
  ].join('') : '';
  const fixable = m.filter((f) => ['costAmount', 'supplier', 'assignedTo'].includes(f) || (f === 'sellingAmount' && b.channel === 'OFFLINE'));
  const fixForm = can('write') && fixable.length ? card('Complete missing data', `<form data-form="fix" data-id="${b.id}" class="form-grid">
      ${fixable.includes('sellingAmount') ? `<label class="field"><span>Selling price (${esc(b.currency)})</span><input class="input" name="sell" inputmode="decimal" required></label>` : ''}
      ${fixable.includes('costAmount') ? `<label class="field"><span>Supplier cost (${esc(b.currency)})</span><input class="input" name="cost" inputmode="decimal" required></label>` : ''}
      ${fixable.includes('supplier') ? `<label class="field"><span>Supplier</span><select class="input" name="supplierId" required><option value="">Choose…</option>${S.suppliers.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>` : ''}
      ${fixable.includes('assignedTo') ? `<label class="field"><span>Owner</span><select class="input" name="owner" required><option value="">Choose…</option><option>Nadia Staff</option><option>Omar Manager</option></select></label>` : ''}
      <div><button class="btn primary">Save</button></div></form>`) : '';
  const kv = (items) => `<dl class="kv">${items.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
  return `<a class="back" href="#/bookings">← Booking registry</a>` +
    ph(b.ref, `${esc(source(b.source).name)}${b.ext ? ` · supplier ref ${esc(b.ext)}` : ''} · booked ${fmtDT(b.bookedAt)}`, actions) +
    `<div class="row" style="margin:-8px 0 14px">${badge(b.channel)}${badge(b.status)}${badge(b.confirmation, 'Confirmation: ' + OF_LABEL[b.confirmation])}${badge(b.payment, 'Payment: ' + OF_LABEL[b.payment])}</div>` +
    (m.length ? `<div class="note n-warn" style="margin-bottom:10px">Missing: ${m.map((f) => OF_FIELD[f] || f).join(', ')}. This is flagged in daily reports until completed.</div>` : '') +
    (issues.length ? `<div class="note n-bad" style="margin-bottom:10px">${issues.length} open reconciliation issue(s): ${[...new Set(issues.map((i) => OF_LABEL[i.type]))].join(', ')}. <a href="#/reconciliation">Review</a></div>` : '') +
    (b.channel === 'ONLINE' ? '<div class="note n-info" style="margin-bottom:14px">Online booking: guest, stay, price and status come from the booking website. Staff can set supplier, cost, owner and confirmation.</div>' : '') +
    `<div class="grid g-main"><div class="grid">
      ${card('Stay', kv([['Hotel', h ? `${esc(h.name)}, ${esc(h.city)} (${h.country})` : '<span class="miss">Missing</span>'], ['Dates', `${fmtDate(b.checkIn)} → ${fmtDate(b.checkOut)} · ${ofNights(b.checkIn, b.checkOut)} nights`], ['Room', `${esc(b.roomType)} · ${esc(b.board)}`], ['Occupancy', `${b.adults} adults`]]))}
      ${card('Rates', kv([['Selling price', money(b.sell, b.currency)], ['Supplier cost', money(b.cost, b.currency)], ['Margin', mg == null ? '<span class="sub" style="display:inline">Needs price and cost</span>' : money(mg, b.currency)], ['Guest', `${esc(b.guest)}<span class="sub">${esc(b.email)}</span>`]]))}
      ${fixForm}
      ${card('History', `<ul class="list">${b.history.map((x) => `<li><span><b>${esc(x.who)}</b> <span class="sub" style="display:inline">· ${esc(x.what)}</span></span><span class="sub" style="display:inline">${fmtDT(x.at)}</span></li>`).join('')}</ul>`)}
    </div><div class="grid" style="align-content:start">
      ${card('Operations', kv([['Supplier', b.supplierId ? esc(supplier(b.supplierId).name) : '<span class="miss">Missing</span>'], ['Confirmation no.', esc(b.confirmationNumber || '—')], ['Owner', b.owner ? esc(b.owner) : '<span class="miss">Unassigned</span>'], ['Source', esc(source(b.source).name)]]))}
      ${card('Documents', '<div class="empty" style="padding:18px">Vouchers and confirmations are uploaded and stored by the server in the full app.</div>')}
    </div></div>`;
}

function viewNewBooking() {
  if (!can('write')) return forbidden();
  const p = UI.pendingBooking;
  const v = (k, d = '') => esc(p && p.values[k] != null ? p.values[k] : d);
  const err = (k) => (p && p.errors[k] ? `<small>${esc(p.errors[k])}</small>` : '');
  const fc = (k) => `field${p && p.errors[k] ? ' err' : ''}`;
  const dup = p && p.duplicates ? `<div class="note n-warn" style="margin-top:14px"><b>Possible duplicate.</b> A booking for the same guest, hotel and dates already exists:
      <ul>${p.duplicates.map((d) => `<li><a href="#/bookings/${d.id}" class="mono">${esc(d.ref)}</a> · ${esc(source(d.source).name)} · ${OF_LABEL[d.status]}</li>`).join('')}</ul>
      <div class="row"><button type="button" class="btn primary" data-action="save-anyway">It's a separate booking, save it</button><button type="button" class="btn" data-action="dup-back">Go back</button></div></div>` : '';
  return `<a class="back" href="#/bookings">← Booking registry</a>` +
    ph('New offline booking', 'For bookings made through TBO, direct hotel calls, supplier email or another authorised channel. Leave unknown amounts blank: they are flagged, never treated as zero.') +
    `<form data-form="new-booking">
      ${card('Source and guest', `<div class="form-grid fg3">
        <label class="${fc('source')}"><span>Source / channel</span><select class="input" name="source"><option value="">Choose…</option>${OF_SOURCES.filter((s) => s.manual).map((s) => `<option value="${s.code}" ${v('source') === s.code ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>${err('source')}</label>
        <label class="field"><span>Supplier booking reference</span><input class="input" name="ext" value="${v('ext')}" placeholder="e.g. TBO reference"></label>
        <label class="field"><span>Supplier</span><select class="input" name="supplierId"><option value="">Not set</option>${S.suppliers.map((s) => `<option value="${s.id}" ${v('supplierId') === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
        <label class="${fc('guest')}"><span>Lead guest name</span><input class="input" name="guest" value="${v('guest')}">${err('guest')}</label>
        <label class="field"><span>Guest email</span><input class="input" name="email" type="email" value="${v('email')}"></label>
        <label class="field"><span>Owner</span><select class="input" name="owner"><option value="">Unassigned</option>${['Nadia Staff', 'Omar Manager'].map((o) => `<option ${v('owner') === o ? 'selected' : ''}>${o}</option>`).join('')}</select></label></div>`)}
      <div style="height:14px"></div>
      ${card('Hotel, stay and rates', `<div class="form-grid fg3">
        <label class="field"><span>Hotel</span><select class="input" name="hotelId"><option value="">Not set</option>${S.hotels.map((h) => `<option value="${h.id}" ${v('hotelId') === h.id ? 'selected' : ''}>${esc(h.name)}, ${esc(h.city)}</option>`).join('')}</select></label>
        <label class="${fc('checkIn')}"><span>Check-in</span><input class="input" type="date" name="checkIn" value="${v('checkIn', ofDayISO(14))}">${err('checkIn')}</label>
        <label class="${fc('checkOut')}"><span>Check-out</span><input class="input" type="date" name="checkOut" value="${v('checkOut', ofDayISO(17))}">${err('checkOut')}</label>
        <label class="${fc('currency')}"><span>Currency</span><input class="input" name="currency" maxlength="3" value="${v('currency', 'AED')}" style="text-transform:uppercase">${err('currency')}</label>
        <label class="${fc('sell')}"><span>Selling price</span><input class="input" name="sell" inputmode="decimal" value="${v('sell')}" placeholder="Leave blank if unknown">${err('sell')}</label>
        <label class="${fc('cost')}"><span>Supplier cost</span><input class="input" name="cost" inputmode="decimal" value="${v('cost')}" placeholder="Leave blank if unknown">${err('cost')}</label></div>`)}
      ${dup}
      <div class="row" style="margin-top:14px"><button class="btn primary">Create booking</button><a class="btn" href="#/bookings">Cancel</a></div>
      <p class="sub" style="margin-top:10px">Try it: enter the same guest, hotel and dates as an existing booking (even written differently, e.g. "naser, LAYLA") to see duplicate detection.</p>
    </form>`;
}

function parseMoney(raw) {
  const s = String(raw || '').replace(/,/g, '').trim();
  if (!s) return { value: null };
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(s)) return { error: 'Non-negative number, up to 2 decimals' };
  return { value: Number(s) };
}

function submitNewBooking(values, force) {
  const errors = {};
  if (!values.source) errors.source = 'Choose a source';
  if (!values.guest.trim()) errors.guest = 'Guest name is required';
  if (!values.checkIn) errors.checkIn = 'Required';
  if (!values.checkOut) errors.checkOut = 'Required';
  else if (values.checkIn && values.checkOut <= values.checkIn) errors.checkOut = 'Check-out must be after check-in';
  if (!/^[A-Za-z]{3}$/.test(values.currency.trim())) errors.currency = '3-letter code, e.g. AED';
  const sell = parseMoney(values.sell);
  const cost = parseMoney(values.cost);
  if (sell.error) errors.sell = sell.error;
  if (cost.error) errors.cost = cost.error;
  if (Object.keys(errors).length) {
    UI.pendingBooking = { values, errors };
    return render();
  }
  const draft = { hotelId: values.hotelId || null, guest: values.guest.trim(), checkIn: values.checkIn, checkOut: values.checkOut };
  const key = ofDedupeKey(draft);
  const duplicates = key ? S.bookings.filter((b) => active(b) && ofDedupeKey(b) === key) : [];
  if (duplicates.length && !force) {
    UI.pendingBooking = { values, errors: {}, duplicates };
    return render();
  }
  const src = source(values.source);
  const id = 'b' + Date.now();
  const ref = `OF-${ofDayISO().slice(0, 4)}-${String(S.nextRef++).padStart(6, '0')}`;
  const now = new Date().toISOString();
  S.bookings.push({
    id, ref, ext: values.ext.trim() || null, source: values.source, channel: src.channel, guest: draft.guest, email: values.email.trim() || '—',
    hotelId: draft.hotelId, supplierId: values.supplierId || null, bookedAt: now, checkIn: values.checkIn, checkOut: values.checkOut,
    currency: values.currency.trim().toUpperCase(), sell: sell.value, cost: cost.value, status: 'PENDING', confirmation: 'PENDING', payment: 'UNPAID',
    owner: values.owner || null, confirmationNumber: null, roomType: 'Deluxe King', board: 'BB', adults: 2,
    history: [{ at: now, who: me(), what: duplicates.length ? `Created (duplicate warning acknowledged: ${duplicates.map((d) => d.ref).join(', ')})` : 'Created' }],
  });
  audit('booking.created', ref);
  UI.pendingBooking = null;
  save();
  toast(`Booking ${ref} created`);
  location.hash = '#/bookings/' + id;
}

function runReconciliation() {
  const prev = Object.fromEntries(S.issues.map((i) => [i.fp, i]));
  const found = [];
  const groups = {};
  S.bookings.forEach((b) => { const k = ofDedupeKey(b); if (k) (groups[k] = groups[k] || []).push(b); });
  Object.values(groups).filter((g) => g.length > 1).forEach((g) => {
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
      const a = g[i], b = g[j];
      const pair = [a.id, b.id].sort().join(':');
      const detail = `${a.ref} (${source(a.source).name}) and ${b.ref} (${source(b.source).name})`;
      if (active(a) && active(b)) found.push({ fp: 'DUP:' + pair, type: 'DUPLICATE_SUSPECT', a: a.id, b: b.id, detail: `Same guest, hotel and dates: ${detail}` });
      if (a.channel !== b.channel) {
        if (a.currency !== b.currency || (a.sell != null && b.sell != null && a.sell !== b.sell)) found.push({ fp: 'AMT:' + pair, type: 'AMOUNT_MISMATCH', a: a.id, b: b.id, detail: `Selling price differs: ${a.sell} ${a.currency} vs ${b.sell} ${b.currency} (${detail})` });
        if (active(a) !== active(b) || a.confirmation !== b.confirmation) found.push({ fp: 'STS:' + pair, type: 'STATUS_MISMATCH', a: a.id, b: b.id, detail: `Status differs: ${OF_LABEL[a.status]} vs ${OF_LABEL[b.status]} (${detail})` });
      }
    }
  });
  S.bookings.forEach((b) => { const m = ofMissing(b); if (m.length) found.push({ fp: 'MISS:' + b.id, type: 'MISSING_REQUIRED_DATA', a: b.id, b: null, detail: `${b.ref}: missing ${m.map((f) => OF_FIELD[f]).join(', ')}` }); });
  let created = 0, resolved = 0;
  const now = new Date().toISOString();
  const next = found.map((f) => {
    const old = prev[f.fp];
    if (!old) created++;
    return old ? { ...old, detail: f.detail } : { ...f, status: 'OPEN', at: now };
  });
  S.issues.forEach((old) => {
    if (!found.some((f) => f.fp === old.fp)) {
      if (old.status === 'OPEN') { resolved++; next.push({ ...old, status: 'RESOLVED', note: 'Auto-resolved: condition no longer present' }); } else next.push(old);
    }
  });
  S.issues = next;
  S.reconciledAt = now;
  audit('reconciliation.run', `${created} new, ${resolved} auto-resolved`);
  save();
  toast(`Reconciliation: ${created} new issue(s), ${resolved} auto-resolved`);
  render();
}

function viewReconciliation() {
  if (!can('bookings')) return forbidden();
  const tabs = ['OPEN', 'RESOLVED', 'DISMISSED', 'ALL'];
  const list = S.issues.filter((i) => UI.issueTab === 'ALL' || i.status === UI.issueTab);
  const count = (t) => S.issues.filter((i) => i.type === t && i.status === 'OPEN').length;
  return ph('Reconciliation', 'Cross-checks online and offline records: possible duplicates, price or status disagreements for the same stay, and bookings missing data.', can('reconcile') ? '<button class="btn primary" data-action="reconcile">Run reconciliation</button>' : '') +
    `<p class="sub" style="margin:-10px 0 14px">${S.reconciledAt ? 'Last run ' + fmtDT(S.reconciledAt) : 'Never run. Click "Run reconciliation" to check the sample data.'}</p>
     <div class="grid g4" style="margin-bottom:14px">${['DUPLICATE_SUSPECT', 'AMOUNT_MISMATCH', 'STATUS_MISMATCH', 'MISSING_REQUIRED_DATA'].map((t) => stat(OF_LABEL[t], count(t), 'open', count(t) ? (t === 'MISSING_REQUIRED_DATA' ? 'warn' : 'bad') : '')).join('')}</div>` +
    card(`${list.length} issue(s)`, list.length ? `<div class="tw"><table><thead><tr><th>Type</th><th>Detail</th><th>Status</th><th></th></tr></thead><tbody>${list.map((i) => `<tr>
        <td>${badge(i.type === 'MISSING_REQUIRED_DATA' ? 'PENDING' : 'FAILED', OF_LABEL[i.type])}</td>
        <td>${esc(i.detail)}${i.note ? `<span class="sub">“${esc(i.note)}”</span>` : ''}<span class="sub"><a href="#/bookings/${i.a}">Open booking</a>${i.b ? ` · <a href="#/bookings/${i.b}">Open matched booking</a>` : ''}</span></td>
        <td>${badge(i.status)}</td>
        <td class="right">${i.status === 'OPEN' && can('reconcile') ? `<div class="row" style="justify-content:flex-end"><button class="btn sm" data-action="issue" data-fp="${esc(i.fp)}" data-to="RESOLVED">Resolve</button><button class="btn sm" data-action="issue" data-fp="${esc(i.fp)}" data-to="DISMISSED">Dismiss</button></div>` : ''}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">${S.reconciledAt ? 'Nothing here' : 'Run reconciliation to find issues'}</div>`,
      `<div class="tabs">${tabs.map((t) => `<a href="#" data-action="issue-tab" data-tab="${t}" class="${UI.issueTab === t ? 'on' : ''}">${t[0] + t.slice(1).toLowerCase()}</a>`).join('')}</div>`);
}

function viewFollowups() {
  if (!can('followups')) return forbidden();
  const tabs = [['ACTION', 'Needs action'], ['TRACKING', 'Waiting'], ['REPLIED', 'Replied'], ['EXHAUSTED', 'No reply'], ['ALL', 'All']];
  const list = S.followups.filter((f) => UI.fuTab === 'ALL' || (UI.fuTab === 'ACTION' ? ['AWAITING_APPROVAL', 'NEEDS_REVIEW'].includes(f.status) : f.status === UI.fuTab));
  return ph('Supplier follow-ups', 'Tracked quotation and rate-request threads. When a supplier doesn\'t reply in time, a follow-up is drafted for review. Out-of-office replies don\'t count; bounces go to review.') +
    `<div class="grid g-main"><div>` +
    card('Conversations', list.length ? `<div class="tw"><table><thead><tr><th>Subject</th><th>Supplier</th><th>Owner</th><th>Status</th><th>Sent</th><th>Follow-ups</th></tr></thead><tbody>${list.map((f) => `<tr class="click" data-href="#/follow-ups/${f.id}">
        <td><a href="#/follow-ups/${f.id}"><b>${esc(f.subject)}</b></a><span class="sub">${esc(f.to)}</span></td><td>${esc(supplier(f.supplierId).name)}</td><td>${esc(f.owner)}</td>
        <td>${badge(f.status)}${f.reason ? `<span class="sub">${esc(f.reason)}</span>` : ''}</td><td class="sub" style="display:table-cell">${fmtDT(f.sentAt)}</td><td class="num">${f.count}/${f.max}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Nothing needs your attention</div>',
      `<div class="tabs">${tabs.map(([t, l]) => `<a href="#" data-action="fu-tab" data-tab="${t}" class="${UI.fuTab === t ? 'on' : ''}">${l}</a>`).join('')}</div>`) +
    `</div><div class="grid" style="align-content:start">${card('Follow-up rules', `<ul class="list">${['24h', '48h', '72h'].map((h) => `<li><span><b>${h} follow-up</b><span class="sub">Mon–Fri 09:00–18:00 · Asia/Dubai · max 2</span></span>${badge('CONFIRMED', 'Draft review')}</li>`).join('')}</ul><p class="pad sub" style="margin:0">Unattended sending can only be switched on by an administrator, and is revoked automatically if the rule or template changes.</p>`)}</div></div>`;
}

function viewFollowup(id) {
  if (!can('followups')) return forbidden();
  const f = S.followups.find((x) => x.id === id);
  if (!f) return card('', '<div class="empty">Not found</div>');
  const kindTone = { 'Original request': 'ONLINE', 'Our follow-up': 'ONLINE', 'Supplier reply': 'CONFIRMED', Bounce: 'FAILED', 'Out of office (ignored)': 'n' };
  const draft = f.status === 'AWAITING_APPROVAL' ? card(`Follow-up #${f.count + 1} awaiting your review`, `<div class="pad"><div><span class="sub" style="display:inline">To:</span> ${esc(f.to)}</div><div><span class="sub" style="display:inline">Subject:</span> RE: ${esc(f.subject)}</div><pre class="draft">${esc(f.draft)}</pre>
      <p class="sub">Before sending, the thread is checked again. If the supplier has replied, nothing is sent.</p>
      <div class="row"><button class="btn primary" data-action="fu-approve" data-id="${f.id}">Approve &amp; send</button><button class="btn" data-action="fu-skip" data-id="${f.id}">Skip this follow-up</button></div></div>`) : '';
  return `<a class="back" href="#/follow-ups">← Follow-ups</a>` +
    ph(f.subject, `${esc(supplier(f.supplierId).name)} · ${esc(f.to)} · owner ${esc(f.owner)}`, f.status !== 'REPLIED' ? `<button class="btn" data-action="fu-replied" data-id="${f.id}">Mark replied</button>` : '') +
    `<div class="row" style="margin:-8px 0 14px">${badge(f.status)}<span class="sub" style="display:inline">Rule: ${esc(f.rule)} · follow-ups ${f.count}/${f.max}${f.next ? ' · next due ' + fmtDT(f.next) : ''}</span></div>` +
    (f.reason ? `<div class="note n-warn" style="margin-bottom:14px">${esc(f.reason)}: check the address with the supplier before resuming.</div>` : '') +
    draft + `<div class="grid g2" style="margin-top:14px">${card('Thread activity', `<ul class="list">${f.messages.map((mm) => `<li><span>${esc(mm.from)}</span><span class="right">${badge(kindTone[mm.kind] || 'n', mm.kind)}<span class="sub">${fmtDT(mm.at)}</span></span></li>`).join('')}</ul>`)}
      ${card('How replies are classified', '<ul class="list"><li><span>From the supplier or a colleague at the same company</span>' + badge('CONFIRMED', 'Stops follow-ups') + '</li><li><span>Out-of-office / auto-reply</span>' + badge('n', 'Ignored') + '</li><li><span>Bounce or unknown sender</span>' + badge('PENDING', 'Needs review') + '</li><li><span>Internal colleague</span>' + badge('n', 'Ignored') + '</li></ul>')}</div>`;
}

function reportData(day) {
  const rows = S.bookings.filter((b) => dayOf(b.bookedAt) === day).sort((a, b) => a.bookedAt.localeCompare(b.bookedAt));
  const cur = {};
  rows.filter(active).forEach((b) => {
    const t = cur[b.currency] || (cur[b.currency] = { n: 0, sell: 0, cost: 0, margin: 0, excl: 0 });
    t.n++; if (b.sell != null) t.sell += b.sell; if (b.cost != null) t.cost += b.cost;
    const mg = ofMargin(b); if (mg == null) t.excl++; else t.margin += mg;
  });
  const warnings = rows.filter((b) => ofMissing(b).length).map((b) => `${b.ref}: missing ${ofMissing(b).map((f) => OF_FIELD[f]).join(', ')}`);
  if (Object.keys(cur).length > 1) warnings.push(`Bookings are in ${Object.keys(cur).length} currencies; totals are shown per currency and not converted`);
  return { rows, cur, warnings };
}

function viewReports() {
  if (!can('reports')) return forbidden();
  const d = reportData(UI.reportDay);
  const fmt = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return ph('Daily operations reports', 'Built from the booking registry for one day in your timezone. Missing values are never invented: they are listed as warnings and excluded from totals.') +
    `<div class="grid g-main"><div class="grid">` +
    card('Report preview', `<div class="filters"><label class="row" style="font-size:12.5px">Report day <input class="input" type="date" data-report-day value="${UI.reportDay}"></label><span class="sub" style="display:inline">Bookings made that day (Asia/Dubai)</span><span style="flex:1"></span><button class="btn sm" data-action="report-csv">Download CSV</button></div>
      <div class="grid g4 pad">${stat('Bookings', d.rows.length)}${stat('Online', d.rows.filter((b) => b.channel === 'ONLINE').length)}${stat('Offline', d.rows.filter((b) => b.channel === 'OFFLINE').length)}${stat('Missing data', d.rows.filter((b) => ofMissing(b).length).length, '', d.rows.some((b) => ofMissing(b).length) ? 'warn' : '')}</div>
      ${Object.keys(d.cur).length ? `<div class="tw"><table><thead><tr><th>Currency</th><th class="right">Bookings</th><th class="right">Selling</th><th class="right">Cost</th><th class="right">Margin</th></tr></thead><tbody>${Object.entries(d.cur).map(([c, t]) => `<tr><td><b>${c}</b></td><td class="right num">${t.n}</td><td class="right num">${fmt(t.sell)}</td><td class="right num">${fmt(t.cost)}</td><td class="right num">${fmt(t.margin)}${t.excl ? ` <span class="miss">(${t.excl} excluded)</span>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No bookings on this day. Try another date.</div>'}
      ${d.warnings.length ? `<div class="pad"><b style="font-size:13px">Data-quality warnings</b><ul style="margin:6px 0 0;padding-left:18px;color:var(--warn)">${d.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}`) +
    (d.rows.length ? card('Bookings in this report', `<div class="tw"><table><thead><tr><th>Ref</th><th>Guest</th><th>Hotel</th><th>Source</th><th class="right">Selling</th><th class="right">Cost</th><th>Status</th></tr></thead><tbody>${d.rows.map((b) => `<tr><td class="mono">${esc(b.ref)}</td><td>${esc(b.guest)}</td><td>${esc(hotel(b.hotelId)?.name || '—')}</td><td>${badge(b.channel)}</td><td class="right">${money(b.sell, b.currency)}</td><td class="right">${money(b.cost, b.currency)}</td><td>${badge(b.status)}</td></tr>`).join('')}</tbody></table></div>`) : '') +
    `</div><div class="grid" style="align-content:start">${card('Schedule', `<ul class="list"><li><span><b>Daily operations report</b><span class="sub">Every day at 08:00 · Asia/Dubai · Excel + PDF</span></span>${badge('CONFIRMED', 'Enabled')}</li><li><span>Recipients (approved only)</span><span class="sub" style="display:inline">${esc(S.recipients.join(', '))}</span></li><li><span>Covers</span><span class="sub" style="display:inline">Previous day</span></li></ul><p class="pad sub" style="margin:0">In the full app the server generates Excel and PDF files and emails them; every delivery is tracked and retried without duplicates. This demo builds the same figures in your browser.</p>`)}</div></div>`;
}

function downloadCsv() {
  const d = reportData(UI.reportDay);
  const safe = (v) => { const s = String(v == null ? '' : v); const t = /^[=+\-@\t\r]/.test(s) ? "'" + s : s; return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const head = ['Booking ref', 'Supplier ref', 'Guest', 'Hotel', 'Check-in', 'Check-out', 'Channel', 'Source', 'Supplier', 'Status', 'Selling', 'Cost', 'Currency', 'Margin', 'Payment', 'Owner', 'Missing data'];
  const lines = d.rows.map((b) => [b.ref, b.ext, b.guest, hotel(b.hotelId)?.name || 'MISSING', b.checkIn, b.checkOut, b.channel, source(b.source).name, b.supplierId ? supplier(b.supplierId).name : 'MISSING', b.status, b.sell == null ? 'MISSING' : b.sell, b.cost == null ? 'MISSING' : b.cost, b.currency, ofMargin(b) ?? '', b.payment, b.owner || 'Unassigned', ofMissing(b).join(' ')].map(safe).join(','));
  const blob = new Blob(['﻿' + [head.join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `operaflow-demo-report-${UI.reportDay}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  audit('report.downloaded', `CSV ${UI.reportDay}`);
  save();
}

const FAILURE_HELP = { ASSERTION: 'The page loaded but did not show what the scenario expects.', SAFETY_GUARD: 'OPERAFlow refused to run this: it would change bookings outside an enabled sandbox.' };
function viewTests() {
  if (!can('tests')) return forbidden();
  const T = S.tests;
  const dot = (r) => `<a href="#/tests/${r.id}" class="dot" title="${r.status} · ${r.viewport}" style="background:${r.status === 'PASSED' ? 'var(--ok)' : r.status === 'BLOCKED_SAFETY' ? 'var(--warn)' : 'var(--bad)'}"></a>`;
  return ph('Booking-site test automation', 'Playwright journeys against an authorised sandbox of the booking website, on desktop and mobile. Booking changes only run in a sandbox; real card numbers are refused; other hosts are blocked.') +
    `<div class="note n-info" style="margin-bottom:14px">Tests run a real browser on the OPERAFlow server. This demo shows <b>recorded runs</b> from the demo sandbox; the Run button works in the full app.</div>
     <div class="grid g4" style="margin-bottom:14px">${stat('Runs (24h)', T.runs.filter((r) => Date.now() - new Date(r.at) < 86400000).length)}${stat('Passed', T.runs.filter((r) => r.status === 'PASSED').length)}${stat('Failed / blocked', T.runs.filter((r) => r.status !== 'PASSED').length, '', 'bad')}${stat('Environments', 1, 'Demo sandbox')}</div>` +
    card('Scenarios', `<div class="tw"><table><thead><tr><th>Scenario</th><th>Recent runs</th><th></th></tr></thead><tbody>${T.scenarios.map((s) => `<tr><td><b>${esc(s.name)}</b><div class="row" style="margin-top:3px">${s.critical ? badge('FAILED', 'Critical') : ''}${s.sandboxOnly ? badge('PENDING', 'Sandbox only') : ''}${s.unconfigured ? badge('n', 'Steps not configured') : ''}</div></td>
      <td><div class="dots">${T.runs.filter((r) => r.scenario === s.id).map(dot).join('') || '<span class="sub" style="display:inline">never run</span>'}</div></td>
      <td class="right"><button class="btn sm" data-action="run-test">Run</button></td></tr>`).join('')}</tbody></table></div>`) +
    `<div style="height:14px"></div>` +
    card('Recent runs', `<div class="tw"><table><thead><tr><th>When</th><th>Scenario</th><th>Viewport</th><th>Result</th><th class="right">Duration</th></tr></thead><tbody>${T.runs.map((r) => `<tr class="click" data-href="#/tests/${r.id}"><td class="sub" style="display:table-cell">${fmtDT(r.at)}</td><td><a href="#/tests/${r.id}">${esc(T.scenarios.find((s) => s.id === r.scenario).name)}</a></td><td>${r.viewport}</td><td>${badge(r.status)}${r.failure ? `<span class="sub">${r.failure.toLowerCase().replace('_', ' ')}</span>` : ''}</td><td class="right num">${(r.ms / 1000).toFixed(1)}s</td></tr>`).join('')}</tbody></table></div>`);
}

function viewTestRun(id) {
  if (!can('tests')) return forbidden();
  const r = S.tests.runs.find((x) => x.id === id);
  if (!r) return card('', '<div class="empty">Not found</div>');
  const sc = S.tests.scenarios.find((s) => s.id === r.scenario);
  return `<a class="back" href="#/tests">← Test automation</a>` +
    ph(sc.name, `${r.env || 'Demo sandbox'} · ${r.viewport} · ${fmtDT(r.at)} · recorded run`, badge(r.status)) +
    (r.failure ? `<div class="note n-bad" style="margin-bottom:14px"><b>${r.failure.toLowerCase().replace('_', ' ')}:</b> ${esc(FAILURE_HELP[r.failure] || '')}<div class="mono" style="margin-top:4px">${esc(r.error)}</div></div>` : '') +
    `<div class="grid g-main">` +
    card(`Steps (${(r.ms / 1000).toFixed(1)}s)`, r.steps.length ? `<div class="tw"><table><thead><tr><th>#</th><th>Action</th><th>Target</th><th>Result</th><th class="right">Time</th></tr></thead><tbody>${r.steps.map((s, i) => `<tr><td class="num sub" style="display:table-cell">${i + 1}</td><td class="mono"><b>${esc(s.action)}</b></td><td class="mono" style="color:var(--ink-3)">${esc(s.target)}</td><td>${badge(s.status === 'passed' ? 'PASSED' : 'FAILED', s.status)}${s.error ? `<span class="sub" style="color:var(--bad)">${esc(s.error)}</span>` : ''}</td><td class="right num">${s.ms} ms</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Stopped before a browser was opened</div>') +
    card('Diagnostics', `<div class="pad"><b style="font-size:13px">Blocked requests (${r.blocked.length})</b><ul style="margin:4px 0 12px;padding-left:18px;color:var(--ink-3)">${r.blocked.map((u) => `<li>host not allowed: ${esc(u)}</li>`).join('') || '<li>none</li>'}</ul>${r.extracted ? `<b style="font-size:13px">Captured values</b><div class="mono" style="color:var(--ink-3)">ref = ${esc(r.extracted)}</div>` : ''}<p class="sub" style="margin-top:12px">The full app also stores a screenshot and a Playwright trace for every run.</p></div>`) + `</div>`;
}

function viewSuppliers() {
  if (!can('suppliers')) return forbidden();
  return ph('Suppliers', 'Only the contact addresses listed here can ever receive automated follow-up emails.') +
    `<div class="grid g2">${S.suppliers.map((s) => card(s.name, `<dl class="kv"><div><dt>Code</dt><dd class="mono">${esc(s.code)}</dd></div><div><dt>Type</dt><dd>${esc(s.type)}</dd></div><div><dt>Timezone</dt><dd>${esc(s.tz)}</dd></div><div><dt>Bookings</dt><dd class="num">${S.bookings.filter((b) => b.supplierId === s.id).length}</dd></div><div><dt>Approved contacts</dt><dd>${s.contacts.map(esc).join('<br>')}</dd></div></dl>`)).join('')}</div>`;
}

function viewAudit() {
  if (!can('audit')) return forbidden();
  return ph('Audit log', 'Append-only record of sign-ins, configuration changes and data changes. In this demo your own actions appear here too.') +
    card(`${S.audit.length} events`, `<div class="tw"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Item</th></tr></thead><tbody>${S.audit.map((a) => `<tr><td class="sub" style="display:table-cell">${fmtDT(a.at)}</td><td>${esc(a.who)}</td><td class="mono">${esc(a.action)}</td><td>${esc(a.entity)}</td></tr>`).join('')}</tbody></table></div>`);
}

// ── Router ──
function render() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  const query = new URLSearchParams(qs || '');
  renderNav(path);
  let html;
  let m;
  if (path === '/') html = viewDashboard();
  else if (path === '/bookings') html = viewBookings(query);
  else if (path === '/bookings/new') html = viewNewBooking();
  else if ((m = path.match(/^\/bookings\/([\w-]+)$/))) html = viewBooking(m[1]);
  else if (path === '/reconciliation') html = viewReconciliation();
  else if (path === '/follow-ups') html = viewFollowups();
  else if ((m = path.match(/^\/follow-ups\/([\w-]+)$/))) html = viewFollowup(m[1]);
  else if (path === '/reports') html = viewReports();
  else if (path === '/tests') html = viewTests();
  else if ((m = path.match(/^\/tests\/([\w-]+)$/))) html = viewTestRun(m[1]);
  else if (path === '/suppliers') html = viewSuppliers();
  else if (path === '/audit') html = viewAudit();
  else html = card('', '<div class="empty">Page not found. <a href="#/">Go to the dashboard</a></div>');
  $('#content').innerHTML = `<div class="inner">${html}</div>`;
  document.body.classList.remove('nav-open');
}

// ── Events ──
document.addEventListener('click', (e) => {
  const row = e.target.closest('tr[data-href]');
  if (row && !e.target.closest('a,button')) { location.hash = row.dataset.href; return; }
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  const id = el.dataset.id;
  if (['issue-tab', 'fu-tab'].includes(a)) e.preventDefault();
  const booking = () => S.bookings.find((b) => b.id === id);
  const fu = () => S.followups.find((f) => f.id === id);
  switch (a) {
    case 'clear-filters': Object.assign(F, { q: '', channel: '', status: '', missing: false }); location.hash = '#/bookings'; render(); break;
    case 'confirm': {
      const no = prompt('Hotel / supplier confirmation number:');
      if (!no || !no.trim()) return;
      const b = booking();
      Object.assign(b, { confirmation: 'CONFIRMED', confirmationNumber: no.trim(), status: b.status === 'PENDING' || b.status === 'ON_REQUEST' ? 'CONFIRMED' : b.status });
      b.history.unshift({ at: new Date().toISOString(), who: me(), what: `Confirmed (no. ${no.trim()})` });
      audit('booking.confirmed', b.ref); save(); toast('Booking confirmed'); render(); break;
    }
    case 'cancel': {
      const reason = prompt('Reason for cancelling (recorded in history):');
      if (!reason || reason.trim().length < 3) return;
      const b = booking();
      Object.assign(b, { status: 'CANCELLED' });
      b.history.unshift({ at: new Date().toISOString(), who: me(), what: `Cancelled: ${reason.trim()}` });
      audit('booking.cancelled', b.ref); save(); toast('Booking cancelled'); render(); break;
    }
    case 'save-anyway': submitNewBooking(UI.pendingBooking.values, true); break;
    case 'dup-back': UI.pendingBooking.duplicates = null; render(); break;
    case 'reconcile': runReconciliation(); break;
    case 'issue-tab': UI.issueTab = el.dataset.tab; render(); break;
    case 'issue': {
      const note = prompt(el.dataset.to === 'RESOLVED' ? 'What was done?' : 'Why is this not a problem?');
      if (!note || note.trim().length < 3) return;
      const i = S.issues.find((x) => x.fp === el.dataset.fp);
      Object.assign(i, { status: el.dataset.to, note: `${note.trim()} — ${me()}` });
      audit(`reconciliation.issue_${el.dataset.to.toLowerCase()}`, OF_LABEL[i.type]); save(); render(); break;
    }
    case 'fu-tab': UI.fuTab = el.dataset.tab; render(); break;
    case 'fu-approve': {
      const f = fu();
      f.messages.push({ from: 'reservations@demo-agency.example', kind: 'Our follow-up', at: new Date().toISOString() });
      Object.assign(f, { status: 'TRACKING', count: f.count + 1, next: new Date(Date.now() + 24 * 3600000).toISOString() });
      audit('followup.sent', f.subject); save();
      toast('Approved. In the real app this is sent from your connected mailbox; the demo sends nothing.'); render(); break;
    }
    case 'fu-skip': { const f = fu(); Object.assign(f, { status: 'TRACKING', count: f.count + 1, next: new Date(Date.now() + 24 * 3600000).toISOString() }); audit('followup.skipped', f.subject); save(); render(); break; }
    case 'fu-replied': { const f = fu(); Object.assign(f, { status: 'REPLIED', next: null, reason: null }); audit('followup.mark-replied', f.subject); save(); render(); break; }
    case 'report-csv': downloadCsv(); break;
    case 'run-test': toast('Test runs drive a real browser on the OPERAFlow server. This demo shows recorded runs.'); break;
    case 'reset':
      if (!confirm('Reset all demo data to the original sample?')) return;
      S = ofSeed(); UI.pendingBooking = null; save(); toast('Demo data reset'); render(); break;
    case 'menu': document.body.classList.toggle('nav-open'); break;
    case 'theme': {
      const r = document.documentElement;
      const dark = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
      r.dataset.theme = dark ? 'light' : 'dark';
      try { localStorage.setItem('of-theme', r.dataset.theme); } catch (err) { /* ignore */ }
      break;
    }
  }
});

document.addEventListener('submit', (e) => {
  const form = e.target;
  e.preventDefault();
  if (form.id === 'search') {
    F.q = form.q.value; location.hash = '#/bookings'; render(); return;
  }
  const data = Object.fromEntries(new FormData(form).entries());
  if (form.dataset.form === 'new-booking') submitNewBooking(data, false);
  if (form.dataset.form === 'fix') {
    const b = S.bookings.find((x) => x.id === form.dataset.id);
    const changes = [];
    if ('sell' in data) { const p = parseMoney(data.sell); if (p.error || p.value == null) return toast('Selling price: ' + (p.error || 'required')); b.sell = p.value; changes.push('selling price'); }
    if ('cost' in data) { const p = parseMoney(data.cost); if (p.error || p.value == null) return toast('Supplier cost: ' + (p.error || 'required')); b.cost = p.value; changes.push('supplier cost'); }
    if (data.supplierId) { b.supplierId = data.supplierId; changes.push('supplier'); }
    if (data.owner) { b.owner = data.owner; changes.push('owner'); }
    b.history.unshift({ at: new Date().toISOString(), who: me(), what: `Updated ${changes.join(', ')}` });
    audit('booking.updated', b.ref); save(); toast('Saved'); render();
  }
});

document.addEventListener('input', (e) => {
  const f = e.target.dataset.filter;
  if (f) {
    F[f] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    clearTimeout(window.__ft);
    window.__ft = setTimeout(() => {
      const pos = e.target.selectionStart;
      render();
      const again = document.querySelector(`[data-filter="${f}"]`);
      if (again && again.type !== 'checkbox' && again.tagName === 'INPUT') { again.focus(); again.setSelectionRange(pos, pos); }
    }, 180);
  }
  if (e.target.matches('[data-report-day]') && e.target.value) { UI.reportDay = e.target.value; render(); }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'role') {
    role = e.target.value;
    try { localStorage.setItem(ROLE_KEY, role); } catch (err) { /* ignore */ }
    $('#avatar').textContent = OF_ROLES[role].name.split(' ').map((p) => p[0]).join('');
    toast(`Now viewing as ${OF_ROLES[role].label}`);
    render();
  }
  if (e.target.dataset.filter && e.target.tagName === 'SELECT') { F[e.target.dataset.filter] = e.target.value; render(); }
});
window.addEventListener('hashchange', render);

// ── Boot ──
try { const t = localStorage.getItem('of-theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* ignore */ }
$('#role').innerHTML = Object.entries(OF_ROLES).map(([k, r]) => `<option value="${k}" ${k === role ? 'selected' : ''}>${r.label}</option>`).join('');
$('#avatar').textContent = OF_ROLES[role].name.split(' ').map((p) => p[0]).join('');
render();
