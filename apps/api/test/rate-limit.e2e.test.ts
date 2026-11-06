import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@operaflow/db';
import { createTestApp, ORIGIN, resetDatabase } from './helpers';

// Must be set before the app module (and its @Throttle decorators) is evaluated.
process.env.LOGIN_RATE_LIMIT_PER_MINUTE = '3';

const prisma = new PrismaClient();
let app: INestApplication;

beforeAll(async () => {
  const { resetEnvCache } = await import('../src/config/env');
  resetEnvCache();
  await resetDatabase(prisma);
  app = await createTestApp();
});
afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

describe('login rate limiting', () => {
  it('returns 429 once the per-minute limit is exceeded', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .set('Origin', ORIGIN)
        .send({ email: `nobody${i}@test.local`, password: 'x' });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
    expect(statuses.slice(3)).toEqual([429, 429]);
  });
});
