import { describe, expect, it } from 'vitest';
import {
  AssertionFailure,
  assertNoRealCard,
  classifyFailure,
  ConfigError,
  hostAllowed,
  interpolate,
  isPrivateHost,
  redact,
  SafetyError,
  scenarioConfigSchema,
} from './steps';

const ctx = { variables: { city: 'Dubai', stay: '{{date:+3}}' }, secrets: { password: 'S3cret!pw' }, extracted: { ref: 'SBX-1' }, now: new Date('2026-11-07T10:00:00Z') };

describe('step config', () => {
  it('validates steps and rejects unknown actions', () => {
    expect(scenarioConfigSchema.safeParse({ steps: [{ action: 'goto', path: '/' }, { action: 'expectCount', selector: '.x', min: 1 }] }).success).toBe(true);
    expect(scenarioConfigSchema.safeParse({ steps: [{ action: 'evaluate', script: 'alert(1)' }] }).success).toBe(false);
    expect(scenarioConfigSchema.safeParse({ steps: [] }).success).toBe(false);
  });
});

describe('interpolate', () => {
  it('resolves variables, nested dates, secrets and extracted values', () => {
    expect(interpolate('{{city}} {{date:+30}} {{date:-1:DD/MM/YYYY}}', ctx)).toBe('Dubai 2026-12-07 06/11/2026');
    expect(interpolate('{{stay}}', ctx)).toBe('2026-11-10');
    expect(interpolate('{{secret.password}}/{{extracted.ref}}', ctx)).toBe('S3cret!pw/SBX-1');
  });
  it('fails loudly on unknown references', () => {
    expect(() => interpolate('{{nope}}', ctx)).toThrow(ConfigError);
    expect(() => interpolate('{{secret.missing}}', ctx)).toThrow(ConfigError);
  });
});

describe('safety', () => {
  it('allows published test cards but refuses real-looking card numbers', () => {
    expect(() => assertNoRealCard('4242 4242 4242 4242')).not.toThrow();
    expect(() => assertNoRealCard('4111-1111-1111-1111')).not.toThrow();
    expect(() => assertNoRealCard('4539 1488 0343 6467')).toThrow(SafetyError); // Luhn-valid, not a test card
    expect(() => assertNoRealCard('Booking 1234567890123')).not.toThrow(); // not Luhn-valid
  });
  it('limits hosts to the environment and its allow-list', () => {
    expect(hostAllowed('sandbox.site.com', 'sandbox.site.com', [])).toBe(true);
    expect(hostAllowed('cdn.sandbox.site.com', 'sandbox.site.com', [])).toBe(true);
    expect(hostAllowed('js.stripe.com', 'sandbox.site.com', ['*.stripe.com'])).toBe(true);
    expect(hostAllowed('evil-stripe.com', 'sandbox.site.com', ['*.stripe.com'])).toBe(false);
    expect(hostAllowed('analytics.example.com', 'sandbox.site.com', [])).toBe(false);
  });
  it('detects private targets', () => {
    for (const h of ['localhost', '127.0.0.1', '10.1.2.3', '192.168.0.10', '172.20.1.1', '169.254.169.254', '[::1]', 'db.internal']) expect(isPrivateHost(h)).toBe(true);
    for (const h of ['sandbox.booking.com', '8.8.8.8', '172.32.0.1']) expect(isPrivateHost(h)).toBe(false);
  });
  it('classifies failures and redacts secrets', () => {
    expect(classifyFailure(new AssertionFailure('x'))).toBe('ASSERTION');
    expect(classifyFailure(Object.assign(new Error('locator.click: Timeout 500ms exceeded'), { name: 'TimeoutError' }))).toBe('TIMEOUT');
    expect(classifyFailure(new Error('page.goto: net::ERR_CONNECTION_REFUSED'))).toBe('NETWORK');
    expect(classifyFailure(new Error("browserType.launch: Executable doesn't exist"))).toBe('ENVIRONMENT');
    expect(redact('fill("S3cret!pw") card 4242 4242 4242 4242', ctx.secrets)).toBe('fill("***") card [card]');
  });
});
