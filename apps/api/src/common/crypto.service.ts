import { Global, Module } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';

const VERSION = 'v1';

/**
 * AES-256-GCM envelope for integration secrets (OAuth refresh tokens, API keys).
 * Format: v1.<iv>.<authTag>.<ciphertext>, each part base64url.
 */
export class CryptoService {
  private readonly key: Buffer;

  constructor(keyBase64: string) {
    this.key = Buffer.from(keyBase64, 'base64');
    if (this.key.length !== 32) throw new Error('Encryption key must be 32 bytes');
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv, tag, ct].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
  }

  decrypt(envelope: string): string {
    const [version, iv, tag, ct] = envelope.split('.');
    if (version !== VERSION || !iv || !tag || ct === undefined) throw new Error('Unsupported secret envelope');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
  }

  static randomToken(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }

  static sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  static safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    return ab.length === bb.length && timingSafeEqual(ab, bb);
  }
}

@Global()
@Module({
  providers: [{ provide: CryptoService, useFactory: () => new CryptoService(env().ENCRYPTION_KEY) }],
  exports: [CryptoService],
})
export class CryptoModule {}
