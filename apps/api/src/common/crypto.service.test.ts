import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { CryptoService } from './crypto.service';

describe('CryptoService', () => {
  const svc = new CryptoService(randomBytes(32).toString('base64'));

  it('round-trips secrets', () => {
    const env = svc.encrypt('refresh-token-value');
    expect(env.startsWith('v1.')).toBe(true);
    expect(env).not.toContain('refresh-token-value');
    expect(svc.decrypt(env)).toBe('refresh-token-value');
  });

  it('uses a fresh IV per encryption', () => {
    expect(svc.encrypt('x')).not.toEqual(svc.encrypt('x'));
  });

  it('rejects tampered ciphertext', () => {
    const env = svc.encrypt('secret');
    const parts = env.split('.');
    const ct = Buffer.from(parts[3]!, 'base64url');
    ct[0] = ct[0]! ^ 0xff;
    parts[3] = ct.toString('base64url');
    expect(() => svc.decrypt(parts.join('.'))).toThrow();
  });

  it('rejects a different key', () => {
    const other = new CryptoService(randomBytes(32).toString('base64'));
    expect(() => other.decrypt(svc.encrypt('secret'))).toThrow();
  });
});
