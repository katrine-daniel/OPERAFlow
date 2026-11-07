import './load-env'; // first: configuration must be loaded before any module reads it
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { env } from './config/env';
import { JsonLogger } from './ops/observability';

async function main() {
  const config = env(); // fail fast on bad configuration
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false, rawBody: true, logger: new JsonLogger() });
  configureApp(app);
  await app.listen(config.API_PORT);
  new Logger('Bootstrap').log(`OPERAFlow API listening on :${config.API_PORT} (${config.NODE_ENV})`);
}

void main();
