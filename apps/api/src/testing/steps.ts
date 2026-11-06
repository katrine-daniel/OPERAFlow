import { z } from 'zod';

/**
 * Scenario step language. Scenarios are data (configured per booking website), not code, so QA can adapt
 * selectors without a deployment and every step is validated before a browser is started.
 */
const selector = z.string().trim().min(1).max(500);
const base = { name: z.string().max(120).optional(), timeoutMs: z.number().int().min(100).max(120_000).optional() };

export const stepSchema = z.discriminatedUnion('action', [
  z.object({ ...base, action: z.literal('goto'), path: z.string().min(1).max(2000) }),
  z.object({ ...base, action: z.literal('fill'), selector, value: z.string().max(2000) }),
  z.object({ ...base, action: z.literal('select'), selector, value: z.string().max(500) }),
  z.object({ ...base, action: z.literal('check'), selector }),
  z.object({ ...base, action: z.literal('click'), selector }),
  z.object({ ...base, action: z.literal('press'), selector: selector.optional(), key: z.string().min(1).max(50) }),
  z.object({ ...base, action: z.literal('waitFor'), selector, state: z.enum(['visible', 'hidden', 'attached']).default('visible') }),
  z.object({ ...base, action: z.literal('expectVisible'), selector }),
  z.object({ ...base, action: z.literal('expectHidden'), selector }),
  z.object({ ...base, action: z.literal('expectText'), selector, contains: z.string().min(1).max(500) }),
  z.object({ ...base, action: z.literal('expectCount'), selector, min: z.number().int().min(0), max: z.number().int().min(0).optional() }),
  z.object({ ...base, action: z.literal('expectUrl'), contains: z.string().min(1).max(500) }),
  z.object({ ...base, action: z.literal('extract'), selector, as: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/) }),
  z.object({ ...base, action: z.literal('screenshot'), name: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/) }),
]);
export type Step = z.infer<typeof stepSchema>;

export const scenarioConfigSchema = z.object({
  variables: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/), z.string().max(500)).default({}),
  steps: z.array(stepSchema).min(1, 'Add at least one step').max(100),
});
export type ScenarioConfig = z.infer<typeof scenarioConfigSchema>;

export const environmentConfigSchema = z.object({
  /** Extra hosts the browser may reach (e.g. "*.stripe.com" for a payment provider's test mode). Everything else is blocked. */
  allowedHosts: z.array(z.string().regex(/^(\*\.)?[a-z0-9.-]+$/i)).max(50).default([]),
  /** PRODUCTION_READONLY only: same-origin paths where non-GET requests are permitted (e.g. a search endpoint). */
  allowedWritePaths: z.array(z.string().startsWith('/').max(300)).max(20).default([]),
});
export type EnvironmentConfig = z.infer<typeof environmentConfigSchema>;

// ─────────────────────────────── Interpolation ───────────────────────────────

export interface InterpolationContext {
  variables: Record<string, string>;
  secrets: Record<string, string>;
  extracted: Record<string, string>;
  now: Date;
}

function fmtDate(d: Date, pattern: string): string {
  const yyyy = String(d.getUTCFullYear());
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return pattern.replace('YYYY', yyyy).replace('MM', mm).replace('DD', dd);
}

/**
 * {{name}} variables, {{secret.key}} environment credentials, {{extracted.name}} values captured by extract steps,
 * {{date:+30}} or {{date:+30:DD/MM/YYYY}} relative dates (so stays are always in the future).
 */
export function interpolate(text: string, ctx: InterpolationContext): string {
  return text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, expr: string) => {
    if (expr.startsWith('date:')) {
      const [, offset, pattern] = /^date:([+-]?\d+)(?::(.+))?$/.exec(expr) ?? [];
      if (offset === undefined) throw new ConfigError(`Bad date expression {{${expr}}}`);
      const d = new Date(Date.UTC(ctx.now.getUTCFullYear(), ctx.now.getUTCMonth(), ctx.now.getUTCDate() + Number(offset)));
      return fmtDate(d, pattern ?? 'YYYY-MM-DD');
    }
    if (expr.startsWith('secret.')) {
      const v = ctx.secrets[expr.slice(7)];
      if (v === undefined) throw new ConfigError(`Environment has no secret "${expr.slice(7)}"`);
      return v;
    }
    if (expr.startsWith('extracted.')) {
      const v = ctx.extracted[expr.slice(10)];
      if (v === undefined) throw new ConfigError(`Nothing extracted as "${expr.slice(10)}" yet`);
      return v;
    }
    const v = ctx.variables[expr];
    if (v === undefined) throw new ConfigError(`Unknown variable {{${expr}}}`);
    return interpolate(v, { ...ctx, variables: {} });
  });
}

// ─────────────────────────────── Safety ───────────────────────────────

export class SafetyError extends Error {}
export class ConfigError extends Error {}
export class AssertionFailure extends Error {}
export class HttpError extends Error {}

/** Published test card numbers of common payment providers (Stripe, Adyen, Checkout.com, Braintree, PayPal sandbox). */
export const KNOWN_TEST_CARDS = new Set([
  '4242424242424242', '4000056655665556', '5555555555554444', '2223003122003222', '5200828282828210', '378282246310005',
  '371449635398431', '6011111111111117', '3056930009020004', '36227206271667', '3566002020360505', '6200000000000005',
  '4000000000003220', '4000002500003155', '4000000000009995', '4000000000000002', '4111111111111111', '5500000000000004',
  '5454545454545454', '4917610000000000', '4988438843884305', '5101180000000007', '2222400070000005', '4035501000000008',
  '4242424242424241', '4543474002249996', '5436031030606378', '4012888888881881', '5105105105105100',
]);

function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Throws if the value contains something that looks like a real payment card (valid Luhn, not a known test card). */
export function assertNoRealCard(value: string): void {
  for (const m of value.matchAll(/(?:\d[ -]?){13,19}/g)) {
    const digits = m[0].replace(/[ -]/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits) && !KNOWN_TEST_CARDS.has(digits)) {
      throw new SafetyError('Refused to enter a card number that is not a published test card number');
    }
  }
}

export function hostAllowed(host: string, baseHost: string, patterns: string[]): boolean {
  const h = host.toLowerCase();
  if (h === baseHost || h.endsWith(`.${baseHost}`)) return true;
  return patterns.some((p) => (p.startsWith('*.') ? h === p.slice(2) || h.endsWith(p.slice(1)) : h === p.toLowerCase()));
}

/** Loopback / private / link-local targets (SSRF guard for a browser running on the server). */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) || /^0\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
  return false;
}

export type FailureClass = 'ASSERTION' | 'TIMEOUT' | 'NETWORK' | 'HTTP_ERROR' | 'ENVIRONMENT' | 'SAFETY_GUARD' | 'UNKNOWN';

export function classifyFailure(err: unknown): FailureClass {
  if (err instanceof SafetyError) return 'SAFETY_GUARD';
  if (err instanceof AssertionFailure) return 'ASSERTION';
  if (err instanceof HttpError) return 'HTTP_ERROR';
  if (err instanceof ConfigError) return 'ENVIRONMENT';
  const e = err as { name?: string; message?: string };
  const msg = e?.message ?? '';
  if (e?.name === 'TimeoutError' || /Timeout \d+ms exceeded/.test(msg)) return 'TIMEOUT';
  if (/net::ERR_|ECONNREFUSED|ENOTFOUND|ECONNRESET|ERR_NAME_NOT_RESOLVED/.test(msg)) return 'NETWORK';
  if (/Executable doesn't exist|browserType\.launch|Failed to launch/.test(msg)) return 'ENVIRONMENT';
  return 'UNKNOWN';
}

/** Removes secret values and card-like numbers from text that will be stored or displayed. */
export function redact(text: string, secrets: Record<string, string>): string {
  let out = text;
  for (const v of Object.values(secrets)) if (v && v.length >= 3) out = out.split(v).join('***');
  return out.replace(/(?:\d[ -]?){13,19}/g, '[card]');
}
