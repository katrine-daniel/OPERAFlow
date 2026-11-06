import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type RoleKey = 'admin' | 'manager' | 'staff' | 'qa';
const EMAIL: Record<RoleKey, string> = { admin: 'admin@e2e.test', manager: 'manager@e2e.test', staff: 'staff@e2e.test', qa: 'qa@e2e.test' };

export function creds(role: RoleKey) {
  const all = JSON.parse(readFileSync(resolve(__dirname, '.auth', 'creds.json'), 'utf8')) as Record<RoleKey, string>;
  return { email: EMAIL[role], password: all[role] };
}

/** The control inside the form field whose visible label text is exactly `label`. */
export function field(page: Page, label: string) {
  return page.locator('label', { has: page.locator('span', { hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`) }) }).locator('input, select, textarea').first();
}

export async function signIn(page: Page, role: RoleKey) {
  const c = creds(role);
  await page.goto('/login');
  await page.getByLabel('Work email').fill(c.email);
  await page.getByLabel('Password').fill(c.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Operations overview' })).toBeVisible();
}
