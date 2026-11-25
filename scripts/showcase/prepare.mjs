// Prepares a locally running OPERAFlow (npm run local + npm run seed:demo) for showcase screenshots by using
// the app's own API: reconciliation run, report schedule + preview, and real Playwright test runs against
// the local DEMO sandbox site. Requires AUTO_LOGIN_EMAIL in .env (local only).
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const API = 'http://127.0.0.1:4000';
const ORIGIN = 'http://localhost:3000';
const root = resolve(import.meta.dirname, '..', '..');
let cookie = '';

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { origin: ORIGIN, cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set?.startsWith('of_session=')) cookie = set.split(';')[0];
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}

const sandbox = spawn('npx', ['tsx', 'apps/api/test/fixtures/sandbox-site.ts'], { cwd: root, shell: true, env: { ...process.env, PORT: '4500' }, stdio: 'ignore' });
try {
  await call('POST', '/auth/auto-login');
  console.log('signed in as', (await call('GET', '/auth/me')).email);

  console.log('reconciliation:', await call('POST', '/reconciliation/run'));

  const recipients = await call('GET', '/reports/recipients');
  if (!recipients.some((r) => r.email === 'ops-team@demo-agency.example')) await call('POST', '/reports/recipients', { email: 'ops-team@demo-agency.example', label: 'Ops team (demo)' });
  let schedule = (await call('GET', '/reports/schedules')).find((s) => s.name === 'Daily operations report');
  schedule ??= await call('POST', '/reports/schedules', {
    name: 'Daily operations report', timeOfDay: '08:00', daysOfWeek: [1, 2, 3, 4, 5, 6, 7], timezone: 'Asia/Dubai', formats: ['XLSX', 'PDF'], recipients: ['ops-team@demo-agency.example'],
  });
  if (!schedule.recipients.includes('ops-team@demo-agency.example')) {
    schedule = await call('PATCH', `/reports/schedules/${schedule.id}`, { recipients: [...schedule.recipients, 'ops-team@demo-agency.example'] });
  }
  const preview = await call('POST', `/reports/schedules/${schedule.id}/preview`, {});
  await call('POST', `/reports/schedules/${schedule.id}/enable`);
  console.log('report preview rows:', preview.rowCount);

  // Test automation against the local DEMO sandbox (wait for it to listen).
  for (let i = 0; i < 30; i++) {
    try {
      await fetch('http://127.0.0.1:4500/');
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  let env = (await call('GET', '/testing/environments')).find((e) => e.name === 'Demo sandbox (local)');
  env ??= await call('POST', '/testing/environments', { name: 'Demo sandbox (local)', baseUrl: 'http://127.0.0.1:4500', kind: 'SANDBOX', allowBookingMutations: true, secrets: { guestEmail: 'qa.bot@demo-agency.example' } });
  const scenarios = await call('GET', '/testing/scenarios');
  const byKey = Object.fromEntries(scenarios.map((s) => [s.key, s]));
  const configs = {
    'search.destination-dates': { variables: { city: 'Dubai' }, steps: [
      { action: 'goto', path: '/' }, { action: 'fill', selector: '#destination', value: '{{city}}' },
      { action: 'fill', selector: '#checkin', value: '{{date:+30}}' }, { action: 'fill', selector: '#checkout', value: '{{date:+33}}' },
      { action: 'click', selector: '#search' }, { action: 'expectCount', selector: '.hotel-card', min: 1 }, { action: 'screenshot', name: 'results' } ] },
    'booking.cancel-sandbox': { variables: {}, steps: [
      { action: 'goto', path: '/search?destination=Dubai&checkin={{date:+40}}&checkout={{date:+42}}' }, { action: 'click', selector: '.hotel-card .view' },
      { action: 'expectText', selector: '#policy', contains: 'Free cancellation' }, { action: 'click', selector: '.room[data-code=DLX] .select-rate' },
      { action: 'fill', selector: '#first', value: 'Test' }, { action: 'fill', selector: '#last', value: 'Guest' },
      { action: 'fill', selector: '#email', value: '{{secret.guestEmail}}' }, { action: 'fill', selector: '#card', value: '4242 4242 4242 4242' },
      { action: 'click', selector: '#confirm' }, { action: 'extract', selector: '#booking-ref', as: 'ref' },
      { action: 'expectText', selector: '#status', contains: 'CONFIRMED' }, { action: 'goto', path: '/manage/{{extracted.ref}}' },
      { action: 'click', selector: '#cancel' }, { action: 'expectText', selector: '#status', contains: 'CANCELLED' }, { action: 'expectVisible', selector: '#refund' } ] },
    'guest.validation': { variables: {}, steps: [
      { action: 'goto', path: '/book?hotel=1&room=DLX' }, { action: 'fill', selector: '#first', value: 'Test' }, { action: 'fill', selector: '#last', value: 'Guest' },
      { action: 'fill', selector: '#email', value: 'not-an-email' }, { action: 'click', selector: '#confirm' },
      { action: 'expectText', selector: '#form-error', contains: 'valid email' } ] },
    'availability.rooms': { variables: {}, steps: [
      { action: 'goto', path: '/search?destination=Dubai&checkin={{date:+5}}&checkout={{date:+6}}' }, { action: 'click', selector: '.hotel-card .view' },
      { action: 'expectCount', selector: '.room', min: 3, timeoutMs: 1500 } ] }, // deliberately strict: shows a classified failure
  };
  for (const [key, config] of Object.entries(configs)) {
    if (!byKey[key]) continue;
    await call('PATCH', `/testing/scenarios/${byKey[key].id}`, { config });
    await call('POST', `/testing/scenarios/${byKey[key].id}/run`, { environmentId: env.id });
  }
  // Inline runs execute one at a time in the API; wait until none are queued or running.
  for (let i = 0; i < 90; i++) {
    const runs = await call('GET', '/testing/runs');
    if (!runs.some((r) => r.status === 'QUEUED' || r.status === 'RUNNING')) {
      console.log('test runs:', runs.map((r) => `${r.scenario.name}/${r.viewport}=${r.status}`).join(', '));
      break;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
} finally {
  sandbox.kill();
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(sandbox.pid), '/T', '/F'], { stdio: 'ignore' });
}
