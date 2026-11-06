import { describe, expect, it } from 'vitest';
import { hasPermission, ROLE_PERMISSIONS, PERMISSIONS } from './permissions';
import { maskEmail, maskName, maskPhone, redactSecrets } from './masking';
import { createUserSchema, passwordSchema } from './schemas';

describe('permissions', () => {
  it('gives admins every permission', () => {
    expect(ROLE_PERMISSIONS.ADMIN).toEqual(PERMISSIONS);
  });
  it('restricts unattended follow-up approval to admins', () => {
    expect(hasPermission('ADMIN', 'followups:approve-autosend')).toBe(true);
    expect(hasPermission('OPS_MANAGER', 'followups:approve-autosend')).toBe(false);
    expect(hasPermission('OPS_STAFF', 'followups:approve-autosend')).toBe(false);
  });
  it('keeps QA away from booking PII and user management', () => {
    expect(hasPermission('QA', 'bookings:read')).toBe(false);
    expect(hasPermission('QA', 'bookings:view-pii')).toBe(false);
    expect(hasPermission('QA', 'users:manage')).toBe(false);
    expect(hasPermission('QA', 'tests:run')).toBe(true);
  });
  it('lets staff manage bookings but not users', () => {
    expect(hasPermission('OPS_STAFF', 'bookings:write')).toBe(true);
    expect(hasPermission('OPS_STAFF', 'users:read')).toBe(false);
  });
});

describe('masking', () => {
  it('masks emails', () => {
    expect(maskEmail('jane.doe@example.com')).toBe('ja******@example.com');
    expect(maskEmail(null)).toBeNull();
    expect(maskEmail('bad')).toBe('***');
  });
  it('masks phones keeping last 4 digits', () => {
    expect(maskPhone('+971 50 123 4567')).toBe('********4567');
  });
  it('masks names', () => {
    expect(maskName('Jane Doe')).toBe('J*** D**');
  });
  it('redacts secret-looking keys recursively', () => {
    expect(redactSecrets({ user: 'a', password: 'x', nested: { accessToken: 'y', ok: 1 } })).toEqual({
      user: 'a',
      password: '[REDACTED]',
      nested: { accessToken: '[REDACTED]', ok: 1 },
    });
  });
});

describe('schemas', () => {
  it('enforces password policy', () => {
    expect(passwordSchema.safeParse('short').success).toBe(false);
    expect(passwordSchema.safeParse('alllowercaseletters').success).toBe(false);
    expect(passwordSchema.safeParse('Longer-Passw0rd').success).toBe(true);
  });
  it('normalises email on user creation', () => {
    const r = createUserSchema.parse({ email: ' Ops@Example.COM ', name: 'Ops', role: 'OPS_STAFF', password: 'Longer-Passw0rd' });
    expect(r.email).toBe('ops@example.com');
  });
});
