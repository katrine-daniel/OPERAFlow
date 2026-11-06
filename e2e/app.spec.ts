import { expect, test } from '@playwright/test';
import { creds, field, signIn } from './helpers';

test.describe.configure({ mode: 'serial' });

test('rejects a wrong password with a generic message and keeps credentials out of the URL', async ({ page }) => {
  await page.goto('/login');
  await field(page, 'Work email').fill(creds('staff').email);
  await field(page, 'Password').fill('definitely-wrong');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Invalid' })).toHaveText('Invalid email or password');
  expect(page.url()).not.toContain('definitely-wrong');
});

test('redirects anonymous visitors to sign-in', async ({ page }) => {
  await page.goto('/bookings');
  await expect(page).toHaveURL(/\/login\?next=%2Fbookings/);
});

test('QA sees only testing areas and is refused booking data', async ({ page }) => {
  await signIn(page, 'qa');
  const nav = page.getByRole('navigation');
  await expect(nav.getByRole('link', { name: 'Booking-site tests' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Booking registry' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Users & roles' })).toHaveCount(0);
  await page.goto('/bookings');
  await expect(page.getByText("You don't have access to that page")).toBeVisible();
});

test('staff create an offline booking; missing data is flagged and a duplicate needs confirmation', async ({ page }) => {
  await signIn(page, 'staff');
  await page.getByRole('navigation').getByRole('link', { name: 'Booking registry' }).click();
  await page.getByRole('link', { name: 'New offline booking' }).click();

  await field(page, 'Source / channel').selectOption({ label: 'Direct hotel call' });
  await field(page, 'Supplier booking reference').fill('HTL-E2E-1');
  await field(page, 'Supplier').selectOption({ label: 'E2E Wholesaler (E2E-WHL)' });
  await field(page, 'Lead guest name').fill('Zoë E2E Guest');
  await page.getByRole('button', { name: 'Add hotel' }).click();
  await field(page, 'Hotel name').fill('E2E Harbour Hotel');
  await field(page, 'City').fill('Dubai');
  await field(page, 'Country').fill('AE');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(field(page, 'Hotel')).toHaveValue(/.+/);
  await field(page, 'Check-in').fill('2027-01-10');
  await field(page, 'Check-out').fill('2027-01-13');
  await field(page, 'Selling price').fill('3,150.00');
  await page.getByRole('button', { name: 'Create booking' }).click();

  await expect(page.getByRole('heading', { name: /^OF-\d{4}-\d{6}$/ })).toBeVisible();
  await expect(page.getByText('Missing: Supplier cost, Owner')).toBeVisible();
  await expect(page.getByText('3 nights')).toBeVisible();

  // Same guest/hotel/dates via another channel, name written differently â†’ warning.
  await page.goto('/bookings/new');
  await field(page, 'Source / channel').selectOption({ label: 'Supplier email' });
  await field(page, 'Lead guest name').fill('e2e guest, ZOE');
  await field(page, 'Hotel').selectOption({ label: 'E2E Harbour Hotel, Dubai (AE)' });
  await field(page, 'Check-in').fill('2027-01-10');
  await field(page, 'Check-out').fill('2027-01-13');
  await page.getByRole('button', { name: 'Create booking' }).click();
  await expect(page.getByText('Possible duplicate')).toBeVisible();
  await page.getByRole('button', { name: 'Go back' }).click();
});

test('managers import a CSV with preview before anything is written', async ({ page }) => {
  await signIn(page, 'manager');
  await page.goto('/imports');
  await field(page, 'Source / channel').selectOption({ label: 'TBO (manual entry / CSV — no live API configured)' });
  const csv = 'external_ref,guest_name,hotel_name,hotel_city,hotel_country,check_in,check_out,currency,selling_amount,cost_amount\r\nTBO-E2E-1,Ali E2E,Creek E2E Hotel,Dubai,AE,2027-02-01,2027-02-03,AED,900,700\r\nTBO-E2E-2,,Creek E2E Hotel,Dubai,AE,2027-02-01,2027-01-30,AED,-1,\r\n';
  await field(page, 'CSV or .xlsx file').setInputFiles({ name: 'tbo.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByText('1 new')).toBeVisible();
  await expect(page.getByText('1 with errors')).toBeVisible();
  await page.getByRole('button', { name: /Import 1 valid rows, skip 1/ }).click();
  await expect(page.getByText(/Imported: 1 created/)).toBeVisible();
  await page.goto('/bookings?q=TBO-E2E-1');
  await expect(page.getByRole('cell', { name: /TBO-E2E-1/ })).toBeVisible();
});

test('reconciliation and global search work across the registry', async ({ page }) => {
  await signIn(page, 'manager');
  await page.goto('/reconciliation');
  await page.getByRole('button', { name: 'Run reconciliation' }).click();
  await expect(page.getByText(/new issue\(s\)/)).toBeVisible();
  await page.getByRole('searchbox', { name: 'Global search' }).fill('Harbour');
  await page.getByRole('searchbox', { name: 'Global search' }).press('Enter');
  await expect(page.getByRole('heading', { name: /^Results for .Harbour.$/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /^OF-\d{4}-\d{6}$/ }).first()).toBeVisible();
});

test('admins approve a recipient, preview a report and download the Excel file', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/reports');
  await page.getByPlaceholder('name@company.com').fill('ops-e2e@example.com');
  await page.getByRole('button', { name: 'Approve address' }).click();
  await expect(page.getByText('ops-e2e@example.com').first()).toBeVisible();
  await page.getByRole('button', { name: 'Create schedule' }).click();
  await expect(page.getByText('Saved. Generate a preview, then enable it.')).toBeVisible();
  await page.getByRole('button', { name: 'Preview' }).first().click();
  await expect(page.getByText(/Preview ready \(\d+ bookings\)/)).toBeVisible();
  await page.getByRole('link', { name: 'Open' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download XLSX' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^operaflow-.*\.xlsx$/);
});

test('notifications open and sign-out ends the session', async ({ page }) => {
  await signIn(page, 'admin');
  await page.getByRole('button', { name: /Notifications/ }).click();
  await expect(page.getByText('Notifications', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /System Administrator/ }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
});
