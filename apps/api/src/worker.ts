import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppModule } from './app.module';
import { env } from './config/env';
import { PrismaService } from './prisma/prisma.service';
import { buildHandlers, executeTracked, QUEUES } from './worker/jobs';

const rootEnv = resolve(__dirname, '..', '..', '..', '.env');
if (existsSync(rootEnv) && process.env.NODE_ENV !== 'production') process.loadEnvFile(rootEnv);

const log = new Logger('Worker');
const SYNC_MS = 60_000;
const HEARTBEAT_MS = 30_000;

/**
 * Background worker: BullMQ queues on Redis.
 *  - reports: one job scheduler per enabled ScheduledReport (cron + timezone), kept in sync with the database.
 *  - maintenance: nightly reconciliation.
 * Jobs are idempotent (report runs keyed by schedule+day, deliveries unique per recipient), so queue retries are safe.
 */
async function main() {
  const config = env();
  if (!config.REDIS_URL) {
    log.error('REDIS_URL is not set. Scheduled reports and nightly reconciliation are INACTIVE. Manual runs from the UI still work.');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'warn', 'error'] });
  app.enableShutdownHooks();
  const prisma = app.get(PrismaService);
  const handlers = buildHandlers(app);

  const connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });
  const queues = { reports: new Queue(QUEUES.reports, { connection }), maintenance: new Queue(QUEUES.maintenance, { connection }) };
  const jobDefaults = { attempts: 3, backoff: { type: 'exponential', delay: 60_000 }, removeOnComplete: 1000, removeOnFail: 5000 };

  const processor = (queue: string) => async (job: Job) => {
    // Repeatable jobs are created ahead of time with a delay; timestamp + delay is the scheduled fire time.
    const firedAt = new Date(job.timestamp + (job.opts.delay ?? 0));
    return executeTracked(prisma, handlers, queue, job.name, String(job.id), job.data ?? {}, firedAt, job.attemptsMade + 1);
  };
  const workers = [
    new Worker(QUEUES.reports, processor(QUEUES.reports), { connection, concurrency: 2 }),
    new Worker(QUEUES.maintenance, processor(QUEUES.maintenance), { connection, concurrency: 1 }),
  ];
  for (const w of workers) {
    w.on('failed', (job, err) => log.error(`${w.name}/${job?.name} ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`));
    w.on('completed', (job) => log.log(`${w.name}/${job.name} ${job.id} completed`));
  }

  async function syncSchedules() {
    const enabled = await prisma.scheduledReport.findMany({ where: { isEnabled: true }, select: { id: true, cron: true, timezone: true } });
    const wanted = new Set<string>();
    for (const s of enabled) {
      const key = `report:${s.id}`;
      wanted.add(key);
      await queues.reports.upsertJobScheduler(key, { pattern: s.cron, tz: s.timezone }, { name: 'scheduled-report', data: { scheduleId: s.id }, opts: jobDefaults });
    }
    for (const existing of await queues.reports.getJobSchedulers()) {
      if (existing.key.startsWith('report:') && !wanted.has(existing.key)) await queues.reports.removeJobScheduler(existing.key);
    }
    await queues.maintenance.upsertJobScheduler('reconciliation', { pattern: config.RECONCILIATION_CRON, tz: config.DEFAULT_TIMEZONE }, { name: 'reconciliation', data: {}, opts: jobDefaults });
    // Follow-up checks: no retries at queue level (the engine records its own per-thread failures and retries next tick).
    await queues.maintenance.upsertJobScheduler('followup-tick', { every: config.FOLLOWUP_POLL_MINUTES * 60_000 }, { name: 'followup-tick', data: {}, opts: { attempts: 1, removeOnComplete: 500, removeOnFail: 1000 } });
  }

  async function heartbeat() {
    const value = { at: new Date().toISOString(), queues: Object.values(QUEUES), pid: process.pid };
    await prisma.systemSetting.upsert({ where: { key: 'worker.heartbeat' }, create: { key: 'worker.heartbeat', value }, update: { value } });
  }

  const safe = (name: string, fn: () => Promise<void>) => () => fn().catch((err) => log.error(`${name} failed: ${(err as Error).message}`));
  await safe('schedule sync', syncSchedules)();
  await safe('heartbeat', heartbeat)();
  const timers = [setInterval(safe('schedule sync', syncSchedules), SYNC_MS), setInterval(safe('heartbeat', heartbeat), HEARTBEAT_MS)];
  log.log('OPERAFlow worker started');

  const shutdown = async () => {
    timers.forEach(clearInterval);
    await Promise.all(workers.map((w) => w.close()));
    await Promise.all(Object.values(queues).map((q) => q.close()));
    await connection.quit();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main();
