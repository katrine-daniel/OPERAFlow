import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@operaflow/db';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../bookings/storage.service';

export const RETENTION_DEFAULTS = {
  'retention.auditLogDays': 730,
  'retention.sessionDays': 30,
  'retention.testArtifactDays': 30,
  'retention.reportFileDays': 365,
  'retention.notificationDays': 90,
  'retention.jobExecutionDays': 90,
} as const;
export type RetentionKey = keyof typeof RETENTION_DEFAULTS;
/** Lower bounds that protect against accidental mass deletion through a typo. */
export const RETENTION_MINIMUMS: Record<RetentionKey, number> = {
  'retention.auditLogDays': 365,
  'retention.sessionDays': 1,
  'retention.testArtifactDays': 7,
  'retention.reportFileDays': 30,
  'retention.notificationDays': 7,
  'retention.jobExecutionDays': 7,
};

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

/**
 * Applies the configured retention periods. Bookings and their history are never deleted here:
 * they are business records. What is purged is operational data that only needs a bounded lifetime.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async settings(): Promise<Record<RetentionKey, number>> {
    const rows = await this.prisma.systemSetting.findMany({ where: { key: { in: Object.keys(RETENTION_DEFAULTS) } } });
    const out = { ...RETENTION_DEFAULTS } as Record<RetentionKey, number>;
    for (const r of rows) if (typeof r.value === 'number') out[r.key as RetentionKey] = r.value;
    return out;
  }

  async run() {
    const s = await this.settings();
    const result: Record<string, number> = {};

    result.sessions = (await this.prisma.session.deleteMany({ where: { OR: [{ expiresAt: { lt: daysAgo(s['retention.sessionDays']) } }, { revokedAt: { lt: daysAgo(s['retention.sessionDays']) } }] } })).count;
    result.notifications = (await this.prisma.notification.deleteMany({ where: { readAt: { lt: daysAgo(s['retention.notificationDays']) } } })).count;
    result.jobExecutions = (await this.prisma.jobExecution.deleteMany({ where: { createdAt: { lt: daysAgo(s['retention.jobExecutionDays']) }, status: { in: ['SUCCEEDED', 'FAILED', 'CANCELLED'] } } })).count;

    // Test artifacts: delete files first, then rows (rows are only removed when the file is gone).
    const artifacts = await this.prisma.testArtifact.findMany({ where: { createdAt: { lt: daysAgo(s['retention.testArtifactDays']) } }, select: { id: true, storageKey: true }, take: 5000 });
    let removedArtifacts = 0;
    for (const a of artifacts) {
      try {
        await this.storage.remove(a.storageKey);
        await this.prisma.testArtifact.delete({ where: { id: a.id } });
        removedArtifacts++;
      } catch (err) {
        this.logger.warn(`artifact ${a.id} not removed: ${(err as Error).message}`);
      }
    }
    result.testArtifacts = removedArtifacts;

    // Report files: remove the files but keep the run record (summary, deliveries) as history.
    const oldRuns = await this.prisma.reportRun.findMany({ where: { createdAt: { lt: daysAgo(s['retention.reportFileDays']) }, NOT: { files: { equals: [] } } }, select: { id: true, files: true }, take: 2000 });
    for (const r of oldRuns) {
      for (const f of (r.files as { storageKey: string }[]) ?? []) await this.storage.remove(f.storageKey).catch(() => undefined);
      await this.prisma.reportRun.update({ where: { id: r.id }, data: { files: [] as Prisma.InputJsonValue } });
    }
    result.reportFiles = oldRuns.length;

    // Audit log last, so this run's own record survives.
    result.auditLogs = (await this.prisma.auditLog.deleteMany({ where: { createdAt: { lt: daysAgo(s['retention.auditLogDays']) } } })).count;

    await this.audit.log({ action: 'retention.run', entityType: 'system', metadata: { ...result, settings: s } });
    return result;
  }
}
