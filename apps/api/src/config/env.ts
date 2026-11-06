import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().url(),
  /** 32-byte key, base64 encoded. Generate: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" */
  ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'ENCRYPTION_KEY must be 32 bytes, base64-encoded'),
  /** Comma-separated list of browser origins allowed to make state-changing requests. */
  WEB_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((v) => v.split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean)),
  TRUST_PROXY: z.string().default('loopback'),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  SESSION_IDLE_MINUTES: z.coerce.number().positive().default(60),
  COOKIE_SECURE: bool,
  LOGIN_MAX_FAILURES: z.coerce.number().int().positive().default(5),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().positive().default(15),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
  LOGIN_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),
  DEFAULT_TIMEZONE: z.string().default('UTC'),
  /** Directory for uploaded documents and generated files. Must not be web-served. */
  STORAGE_DIR: z.string().default('./storage'),
  MAX_UPLOAD_MB: z.coerce.number().positive().max(20).default(10),
  MAX_IMPORT_ROWS: z.coerce.number().int().positive().default(5000),
  /** Allowed clock skew for signed webhooks. */
  WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().positive().default(300),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.COOKIE_SECURE) {
    throw new Error('COOKIE_SECURE must be true in production');
  }
  return parsed.data;
}

export function env(): Env {
  cached ??= loadEnv();
  return cached;
}

/** Test helper — forces re-reading process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}
