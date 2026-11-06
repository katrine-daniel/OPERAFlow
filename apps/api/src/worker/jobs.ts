import type { INestApplicationContext } from '@nestjs/common';
import { Prisma } from '@operaflow/db';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';
import { ReconciliationService } from '../bookings/reconciliation.service';
import { FollowupsService } from '../followups/followups.service';
import { RunnerService } from '../testing/runner.service';
import { TestingService } from '../testing/testing.service';

export const QUEUES = { reports: 'reports', maintenance: 'maintenance', tests: 'tests' } as const;
export type JobName = 'scheduled-report' | 'reconciliation' | 'retention';

export interface JobHandlers {
  [name: string]: (data: Record<string, unknown>, firedAt: Date) => Promise<unknown>;
}

/** Handlers are plain functions over Nest services, so they are testable without Redis. */
export function buildHandlers(app: INestApplicationContext): JobHandlers {
  const reports = app.get(ReportsService);
  const recon = app.get(ReconciliationService);
  const followups = app.get(FollowupsService);
  const runner = app.get(RunnerService);
  const testing = app.get(TestingService);
  return {
    'scheduled-report': (data, firedAt) => reports.runScheduled(String(data.scheduleId), firedAt),
    reconciliation: () => recon.run(null),
    'followup-tick': () => followups.tick(),
    'test-run': async (data) => {
      await runner.execute(String(data.runId));
      return { runId: data.runId };
    },
    'scheduled-test': (data, firedAt) => testing.runScheduled(String(data.scenarioId), firedAt),
  };
}

/**
 * Runs a handler and records it in job_executions under a deterministic key, so the history of every
 * background job (including retries) is queryable from the UI and the audit trail.
 */
export async function executeTracked(
  prisma: PrismaService,
  handlers: JobHandlers,
  queue: string,
  jobName: string,
  jobId: string,
  data: Record<string, unknown>,
  firedAt: Date,
  attempt: number,
) {
  const handler = handlers[jobName];
  if (!handler) throw new Error(`No handler for job ${jobName}`);
  const idempotencyKey = `bull:${queue}:${jobId}`;
  const exec = await prisma.jobExecution.upsert({
    where: { idempotencyKey },
    create: { queue, jobName, jobId, idempotencyKey, status: 'RUNNING', attempts: attempt, startedAt: new Date(), payload: data as Prisma.InputJsonValue },
    update: { status: 'RUNNING', attempts: attempt, startedAt: new Date(), error: null },
  });
  try {
    const result = await handler(data, firedAt);
    await prisma.jobExecution.update({
      where: { id: exec.id },
      data: { status: 'SUCCEEDED', finishedAt: new Date(), result: (result ?? null) as Prisma.InputJsonValue },
    });
    return result;
  } catch (err) {
    await prisma.jobExecution.update({
      where: { id: exec.id },
      data: { status: 'FAILED', finishedAt: new Date(), error: (err as Error).message.slice(0, 1000) },
    });
    throw err;
  }
}
