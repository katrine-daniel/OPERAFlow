import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { env } from './config/env';

/** Shared HTTP hardening applied in production and in integration tests alike. */
export function configureApp(app: INestApplication): void {
  const express = app as NestExpressApplication;
  const trust = env().TRUST_PROXY;
  express.set('trust proxy', /^\d+$/.test(trust) ? Number(trust) : trust === 'true' ? true : trust);
  express.disable('x-powered-by');
  app.use(helmet());
  app.use(cookieParser());
  express.useBodyParser('json', { limit: '1mb' });
  app.enableShutdownHooks();
}
