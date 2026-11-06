import { existsSync } from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';

const apiUrl = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';

// Local dev: share the repo-root .env (DEFAULT_TIMEZONE etc.) with the web server.
const rootEnv = path.join(__dirname, '..', '..', '.env');
if (process.env.NODE_ENV !== 'production' && existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const dev = process.env.NODE_ENV !== 'production';
// Next.js hydration needs inline scripts; everything else is same-origin only. No third-party origins at all.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${dev ? ' ws: wss:' : ''}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const config: NextConfig = {
  output: 'standalone',
  // Lets the E2E dev server run beside a normal dev server without sharing build output.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
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
