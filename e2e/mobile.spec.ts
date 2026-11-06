import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('mobile layout: no horizontal scroll and the navigation drawer works', async ({ page }) => {
  await signIn(page, 'staff');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'Booking registry' }).click();
  await expect(page.getByRole('heading', { name: 'Booking registry' })).toBeVisible();
  const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow2).toBeLessThanOrEqual(0);
});
