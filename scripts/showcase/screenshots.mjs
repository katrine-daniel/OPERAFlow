// Captures showcase screenshots from a locally running OPERAFlow with demo data (see prepare.mjs).
// Output: showcase/img/*.jpg (served by GitHub Pages from index.html).
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const WEB = 'http://localhost:3000';
const out = resolve(import.meta.dirname, '..', '..', 'showcase', 'img');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1600, height: 960 }, deviceScaleFactor: 1, locale: 'en-GB', timezoneId: 'Asia/Dubai' });
const page = await context.newPage();

// Local automatic sign-in (AUTO_LOGIN_EMAIL) lands on the dashboard.
await page.goto(`${WEB}/login`);
await page.waitForURL(`${WEB}/`, { timeout: 60_000 });
const api = async (path) => (await page.request.get(`${WEB}/api${path}`)).json();

const bookings = (await api('/bookings?pageSize=100')).items;
const missing = bookings.find((b) => b.missing.length && b.status !== 'CANCELLED') ?? bookings[0];
const conv = (await api('/followups/conversations')).items.find((c) => c.status === 'AWAITING_APPROVAL');
const run = (await api('/reports/runs')).find((r) => r.status === 'GENERATED');
const testRuns = await api('/testing/runs');
const passed = testRuns.find((r) => r.status === 'PASSED' && r.viewport === 'desktop' && r.scenario.name.startsWith('Booking cancellation'));
const failed = testRuns.find((r) => r.status === 'FAILED' && r.viewport === 'desktop');

const shots = [
  ['dashboard', '/'],
  ['bookings', '/bookings'],
  ['booking-detail', `/bookings/${missing.id}`],
  ['new-booking', '/bookings/new'],
  ['reconciliation', '/reconciliation'],
  ['imports', '/imports'],
  ['followups', '/follow-ups?tab=ALL'],
  ['followup-review', conv && `/follow-ups/${conv.id}`],
  ['reports', '/reports'],
  ['report-run', run && `/reports/runs/${run.id}`],
  ['testing', '/testing'],
  ['test-run-passed', passed && `/testing/runs/${passed.id}`],
  ['test-run-failed', failed && `/testing/runs/${failed.id}`],
  ['sources', '/sources'],
  ['integrations', '/integrations'],
  ['audit', '/audit'],
];

for (const [name, path] of shots) {
  if (!path) {
    console.warn(`skipped ${name} (no data)`);
    continue;
  }
  await page.goto(`${WEB}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: resolve(out, `${name}.jpg`), type: 'jpeg', quality: 82 });
  console.log(`captured ${name}`);
}

// Phone layout.
const phone = await browser.newContext({ ...devices['iPhone 13'], locale: 'en-GB', timezoneId: 'Asia/Dubai', storageState: await context.storageState() });
const p2 = await phone.newPage();
await p2.goto(`${WEB}/`, { waitUntil: 'networkidle' });
await p2.waitForTimeout(600);
await p2.screenshot({ path: resolve(out, 'mobile.jpg'), type: 'jpeg', quality: 82 });
console.log('captured mobile');

await browser.close();
