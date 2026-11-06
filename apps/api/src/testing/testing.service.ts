import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { Prisma, type TestTrigger } from '@operaflow/db';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser, RequestMeta } from '../common/auth-context';
import { allowPrivateTargets, preflight, RunnerService } from './runner.service';
import { environmentConfigSchema, isPrivateHost } from './steps';

export const TESTS_QUEUE = 'tests';

/**
 * Run dispatch: with Redis, runs go to the worker's "tests" queue; without it, they execute in this process,
 * one at a time (a browser per run is heavy). Either way the run row is the source of truth.
 */
@Injectable()
export class TestingService implements OnModuleDestroy {
  private readonly logger = new Logger(TestingService.name);
  private inline: Promise<void> = Promise.resolve();
  private queue?: Queue;
  private connection?: IORedis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: RunnerService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  async onModuleDestroy() {
    await this.queue?.close();
    await this.connection?.quit().catch(() => undefined);
  }

  mode(): 'queue' | 'inline' {
    return env().REDIS_URL && process.env.TEST_RUNNER_MODE !== 'inline' ? 'queue' : 'inline';
  }

  validateBaseUrl(raw: string) {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      throw new BadRequestException('Base URL is not valid');
    }
    if (isPrivateHost(u.hostname) && !allowPrivateTargets()) throw new BadRequestException('Private/internal network targets are not allowed');
    if (u.protocol !== 'https:' && !(isPrivateHost(u.hostname) && allowPrivateTargets())) throw new BadRequestException('Base URL must use https');
    if (u.username || u.password) throw new BadRequestException('Put credentials in the environment secrets, not the URL');
    return `${u.origin}${u.pathname.replace(/\/$/, '')}`;
  }

  async saveEnvironment(
    input: { id?: string; name: string; baseUrl: string; kind: 'SANDBOX' | 'STAGING' | 'PRODUCTION_READONLY'; allowBookingMutations: boolean; config?: unknown; isActive?: boolean; secrets?: Record<string, string> | null },
    actor: AuthUser,
    meta: RequestMeta,
  ) {
    const baseUrl = this.validateBaseUrl(input.baseUrl);
    const config = environmentConfigSchema.parse(input.config ?? {});
    if (input.allowBookingMutations && input.kind !== 'SANDBOX') throw new BadRequestException('Booking mutations can only be enabled on a SANDBOX environment');
    const data: Prisma.TestEnvironmentUncheckedCreateInput = {
      name: input.name,
      baseUrl,
      kind: input.kind,
      allowBookingMutations: input.allowBookingMutations,
      config: config as Prisma.InputJsonValue,
      isActive: input.isActive ?? true,
      ...(input.secrets !== undefined && { encryptedSecret: input.secrets && Object.keys(input.secrets).length ? this.crypto.encrypt(JSON.stringify(input.secrets)) : null }),
    };
    const saved = input.id ? await this.prisma.testEnvironment.update({ where: { id: input.id }, data }) : await this.prisma.testEnvironment.create({ data });
    await this.audit.log({
      actorId: actor.id,
      action: input.id ? 'test_environment.updated' : 'test_environment.created',
      entityType: 'test_environment',
      entityId: saved.id,
      metadata: { name: saved.name, kind: saved.kind, allowBookingMutations: saved.allowBookingMutations, secretsChanged: input.secrets !== undefined },
      meta,
    });
    const { encryptedSecret, ...rest } = saved;
    return { ...rest, hasSecrets: Boolean(encryptedSecret) };
  }

  /** Creates one run per viewport and dispatches them. Safety pre-checks are also applied again at execution time. */
  async requestRuns(scenarioId: string, environmentId: string, viewports: string[] | undefined, trigger: TestTrigger, actorId: string | null, idempotencyPrefix?: string) {
    const [scenario, environment] = await Promise.all([
      this.prisma.testScenario.findUnique({ where: { id: scenarioId } }),
      this.prisma.testEnvironment.findUnique({ where: { id: environmentId } }),
    ]);
    if (!scenario || !scenario.isActive) throw new NotFoundException('Scenario not found or inactive');
    if (!environment) throw new NotFoundException('Environment not found');
    const problems = preflight(scenario, environment);
    const list = (viewports?.length ? viewports : scenario.viewports).filter((v) => v === 'desktop' || v === 'mobile');
    if (!list.length) throw new BadRequestException('Choose desktop and/or mobile');

    const runs = [];
    for (const viewport of list) {
      const idempotencyKey = idempotencyPrefix ? `${idempotencyPrefix}:${viewport}` : null;
      if (idempotencyKey) {
        const existing = await this.prisma.testRun.findUnique({ where: { idempotencyKey } });
        if (existing) {
          runs.push(existing);
          continue;
        }
      }
      runs.push(
        await this.prisma.testRun.create({
          data: { scenarioId, environmentId, trigger, triggeredById: actorId, viewport, idempotencyKey, diagnostics: problems.length ? { safety: problems } : {} },
        }),
      );
    }
    for (const r of runs) if (r.status === 'QUEUED') await this.dispatch(r.id);
    if (actorId) await this.audit.log({ actorId, action: 'test_run.requested', entityType: 'test_scenario', entityId: scenarioId, metadata: { environment: environment.name, viewports: list } });
    return runs;
  }

  private async dispatch(runId: string) {
    if (this.mode() === 'queue') {
      this.connection ??= new IORedis(env().REDIS_URL!, { maxRetriesPerRequest: null });
      this.queue ??= new Queue(TESTS_QUEUE, { connection: this.connection });
      await this.queue.add('test-run', { runId }, { jobId: `run-${runId}`, attempts: 1, removeOnComplete: 1000, removeOnFail: 1000 });
      return;
    }
    this.inline = this.inline.then(() => this.runner.execute(runId)).catch((err) => this.logger.error(`inline run ${runId} failed`, err as Error));
  }

  /** For tests and the worker: wait until inline runs have finished. */
  drain() {
    return this.inline;
  }

  /** Scheduled entry point (worker). One set of runs per scenario per fire time, even if the job is retried. */
  async runScheduled(scenarioId: string, firedAt: Date) {
    const scenario = await this.prisma.testScenario.findUnique({ where: { id: scenarioId } });
    if (!scenario?.isActive || !scenario.cron || !scenario.environmentId) return { skipped: 'not scheduled' };
    const runs = await this.requestRuns(scenarioId, scenario.environmentId, undefined, 'SCHEDULED', null, `sched:${scenarioId}:${firedAt.toISOString().slice(0, 16)}`);
    await this.drain();
    return { runs: runs.map((r) => r.id) };
  }
}
