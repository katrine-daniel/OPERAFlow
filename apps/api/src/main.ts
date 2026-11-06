import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { env } from './config/env';

// Local development convenience: load the repo-root .env if present. In containers,
// configuration comes from the real environment and this file does not exist.
const rootEnv = resolve(__dirname, '..', '..', '..', '.env');
if (existsSync(rootEnv) && process.env.NODE_ENV !== 'production') process.loadEnvFile(rootEnv);

async function main() {
  const config = env(); // fail fast on bad configuration
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false, rawBody: true });
  configureApp(app);
  await app.listen(config.API_PORT);
  new Logger('Bootstrap').log(`OPERAFlow API listening on :${config.API_PORT} (${config.NODE_ENV})`);
}

void main();
