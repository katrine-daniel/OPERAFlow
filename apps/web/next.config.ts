import { existsSync } from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';

const apiUrl = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';

// Local dev: share the repo-root .env (DEFAULT_TIMEZONE etc.) with the web server.
const rootEnv = path.join(__dirname, '..', '..', '.env');
if (process.env.NODE_ENV !== 'production' && existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const config: NextConfig = {
  output: 'standalone',
  // Monorepo: trace workspace packages from the repository root for the standalone bundle.
  outputFileTracingRoot: path.join(__dirname, '..', '..'),
  poweredByHeader: false,
  transpilePackages: ['@operaflow/shared'],
  env: { NEXT_PUBLIC_ORG_TIMEZONE: process.env.DEFAULT_TIMEZONE ?? 'UTC' },
  // The browser only ever talks to this origin; /api/* is proxied to the NestJS API so
  // session cookies stay first-party and no API secrets reach the client.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/:path*` }];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default config;
