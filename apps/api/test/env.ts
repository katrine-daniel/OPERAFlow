// Loaded before every test file. Points the API at the dedicated test database.
import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://operaflow:operaflow_local_dev@127.0.0.1:5433/operaflow_test';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
process.env.WEB_ORIGINS = 'http://localhost:3000';
process.env.LOGIN_RATE_LIMIT_PER_MINUTE ??= '1000';
process.env.RATE_LIMIT_PER_MINUTE ??= '10000';
process.env.STORAGE_DIR = join(tmpdir(), 'operaflow-test-storage');
process.env.DEFAULT_TIMEZONE = 'Asia/Dubai';
