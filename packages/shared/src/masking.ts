/** Helpers for masking guest personal data in logs, exports and low-privilege views. */

export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visible = local.slice(0, Math.min(2, local.length - 1 || 1));
  return `${visible}${'*'.repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 4) return '****';
  return `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;
}

export function maskName(name: string | null | undefined): string | null {
  if (!name) return null;
  return name
    .trim()
    .split(/\s+/)
    .map((part) => (part.length <= 1 ? part : `${part[0]}${'*'.repeat(part.length - 1)}`))
    .join(' ');
}

const SENSITIVE_KEYS = /pass(word)?|secret|token|authorization|cookie|api[-_]?key|card|cvv|iban/i;

/** Deep-clones a value, redacting keys that look like credentials. Use before logging/auditing. */
export function redactSecrets<T>(value: T, depth = 0): T {
  if (depth > 8 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1)) as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEYS.test(k) ? '[REDACTED]' : redactSecrets(v, depth + 1);
  }
  return out as T;
}
