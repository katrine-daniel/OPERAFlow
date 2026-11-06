import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@operaflow/db';
import { redactSecrets } from '@operaflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestMeta } from '../common/auth-context';

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  meta?: RequestMeta;
}

type Tx = Prisma.TransactionClient | PrismaService;

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Writes an audit record. Pass `tx` to make the audit entry part of the caller's transaction,
   * so a change and its audit record commit (or roll back) together.
   */
  async log(entry: AuditEntry, tx: Tx = this.prisma): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorType: entry.actorId ? 'USER' : 'SYSTEM',
        actorId: entry.actorId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        metadata: entry.metadata ? (redactSecrets(entry.metadata) as Prisma.InputJsonValue) : Prisma.JsonNull,
        ipAddress: entry.meta?.ipAddress ?? null,
        userAgent: entry.meta?.userAgent ?? null,
      },
    });
  }

  /** Best-effort variant for paths where an audit failure must not break the request (e.g. failed logins). */
  async logSafe(entry: AuditEntry): Promise<void> {
    try {
      await this.log(entry);
    } catch (err) {
      this.logger.error(`audit write failed for ${entry.action}`, err as Error);
    }
  }
}
