import { Controller, Get, Header, Headers, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import IORedis from 'ioredis';
import { env } from '../config/env';
import { Public } from '../common/auth-context';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { metricsText } from '../ops/observability';

@Controller()
@SkipThrottle()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness + database. Used by container health checks. */
  @Public()
  @Get('health')
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({ status: 'error', database: 'unreachable' });
    }
    return { status: 'ok', database: 'ok', time: new Date().toISOString() };
  }

  /** Readiness: database, and Redis when configured. */
  @Public()
  @Get('health/ready')
  async ready() {
    const checks: Record<string, string> = {};
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = 'ok';
    } catch {
      checks.database = 'unreachable';
    }
    if (env().REDIS_URL) {
      const r = new IORedis(env().REDIS_URL!, { lazyConnect: true, connectTimeout: 2000, maxRetriesPerRequest: 0 });
      try {
        await r.connect();
        checks.redis = (await r.ping()) === 'PONG' ? 'ok' : 'error';
      } catch {
        checks.redis = 'unreachable';
      } finally {
        r.disconnect();
      }
    } else checks.redis = 'not configured';
    const ok = checks.database === 'ok' && checks.redis !== 'unreachable' && checks.redis !== 'error';
    if (!ok) throw new ServiceUnavailableException({ status: 'error', ...checks });
    return { status: 'ok', ...checks };
  }

  /** Prometheus metrics. Disabled unless METRICS_TOKEN is set; requires "Authorization: Bearer <token>". */
  @Public()
  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4')
  async metrics(@Headers('authorization') auth?: string) {
    const token = env().METRICS_TOKEN;
    if (!token) throw new NotFoundException();
    if (!auth?.startsWith('Bearer ') || !CryptoService.safeEqual(auth.slice(7), token)) throw new UnauthorizedException();
    const dayAgo = new Date(Date.now() - 86_400_000);
    const [failedJobs, openIssues, followupsAction, failedDeliveries, failedTests, hb] = await Promise.all([
      this.prisma.jobExecution.count({ where: { status: 'FAILED', createdAt: { gte: dayAgo } } }),
      this.prisma.reconciliationIssue.count({ where: { status: 'OPEN' } }),
      this.prisma.emailConversation.count({ where: { status: { in: ['AWAITING_APPROVAL', 'NEEDS_REVIEW', 'FOLLOWUP_DUE'] } } }),
      this.prisma.reportDelivery.count({ where: { status: 'FAILED' } }),
      this.prisma.testRun.count({ where: { status: { in: ['FAILED', 'ERROR'] }, queuedAt: { gte: dayAgo } } }),
      this.prisma.systemSetting.findUnique({ where: { key: 'worker.heartbeat' } }),
    ]);
    const at = (hb?.value as { at?: string } | undefined)?.at;
    return metricsText({
      operaflow_jobs_failed_24h: failedJobs,
      operaflow_reconciliation_issues_open: openIssues,
      operaflow_followups_needing_action: followupsAction,
      operaflow_report_deliveries_failed: failedDeliveries,
      operaflow_test_runs_failed_24h: failedTests,
      operaflow_worker_heartbeat_age_seconds: at ? Math.round((Date.now() - new Date(at).getTime()) / 1000) : -1,
    });
  }
}
