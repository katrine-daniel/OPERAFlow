import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Booking } from '@operaflow/db';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser, RequestMeta } from '../common/auth-context';
import { missingDataWhere, missingFields } from './booking-view';

type Slim = Pick<Booking, 'id' | 'internalRef' | 'externalRef' | 'channel' | 'status' | 'confirmationStatus' | 'sellingAmount' | 'currency' | 'dedupeKey'> & {
  source: { code: string; name: string };
};

const describe = (b: Slim) => ({
  id: b.id,
  internalRef: b.internalRef,
  externalRef: b.externalRef,
  channel: b.channel,
  source: b.source.name,
  status: b.status,
  sellingAmount: b.sellingAmount?.toFixed(2) ?? null,
  currency: b.currency,
});

const inactive = (b: Slim) => b.status === 'CANCELLED' || b.status === 'FAILED';

/**
 * Compares the registry against itself across sources:
 *  - DUPLICATE_SUSPECT: two active bookings share the guest/hotel/dates fingerprint.
 *  - AMOUNT_MISMATCH / STATUS_MISMATCH: the same stay recorded online AND offline with different price/currency or status
 *    (e.g. cancelled online but still active offline).
 *  - MISSING_REQUIRED_DATA: active bookings lacking amounts, supplier, hotel, owner or confirmation number.
 * Issues have a unique fingerprint, so re-running never duplicates them, and dismissed issues stay dismissed.
 */
@Injectable()
export class ReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async run(actor: AuthUser | null, meta?: RequestMeta) {
    const job = await this.prisma.jobExecution.create({
      data: { queue: 'reconciliation', jobName: 'bookings.reconcile', status: 'RUNNING', attempts: 1, startedAt: new Date(), payload: { trigger: actor ? 'manual' : 'scheduled' } },
    });
    try {
      const groups = await this.prisma.booking.groupBy({
        by: ['dedupeKey'],
        where: { dedupeKey: { not: null }, status: { not: 'FAILED' } },
        having: { dedupeKey: { _count: { gt: 1 } } },
      });
      const keys = groups.map((g) => g.dedupeKey!).filter(Boolean);
      const candidates: Slim[] = keys.length
        ? await this.prisma.booking.findMany({
            where: { dedupeKey: { in: keys }, status: { not: 'FAILED' } },
            select: {
              id: true, internalRef: true, externalRef: true, channel: true, status: true, confirmationStatus: true,
              sellingAmount: true, currency: true, dedupeKey: true, source: { select: { code: true, name: true } },
            },
            orderBy: { createdAt: 'asc' },
          })
        : [];

      const issues: Prisma.ReconciliationIssueCreateManyInput[] = [];
      const byKey = new Map<string, Slim[]>();
      for (const b of candidates) byKey.set(b.dedupeKey!, [...(byKey.get(b.dedupeKey!) ?? []), b]);

      for (const [key, group] of byKey) {
        const list = group.slice(0, 20);
        for (let i = 0; i < list.length; i++) {
          for (let j = i + 1; j < list.length; j++) {
            const a = list[i]!;
            const b = list[j]!;
            const pair = [a.id, b.id].sort().join(':');
            const details = { dedupeKey: key, bookings: [describe(a), describe(b)] };
            const crossChannel = a.channel !== b.channel;

            if (!inactive(a) && !inactive(b)) {
              issues.push({ type: 'DUPLICATE_SUSPECT', fingerprint: `DUPLICATE_SUSPECT:${pair}`, bookingId: a.id, matchedBookingId: b.id, details: { ...details, crossChannel } });
            }
            if (crossChannel) {
              const amountDiffers =
                a.currency !== b.currency ||
                (a.sellingAmount !== null && b.sellingAmount !== null && !a.sellingAmount.equals(b.sellingAmount));
              if (amountDiffers) {
                issues.push({ type: 'AMOUNT_MISMATCH', fingerprint: `AMOUNT_MISMATCH:${pair}`, bookingId: a.id, matchedBookingId: b.id, details });
              }
              if (inactive(a) !== inactive(b) || a.confirmationStatus !== b.confirmationStatus) {
                issues.push({ type: 'STATUS_MISMATCH', fingerprint: `STATUS_MISMATCH:${pair}`, bookingId: a.id, matchedBookingId: b.id, details });
              }
            }
          }
        }
      }

      const incomplete = await this.prisma.booking.findMany({ where: missingDataWhere, take: 5000 });
      for (const b of incomplete) {
        issues.push({ type: 'MISSING_REQUIRED_DATA', fingerprint: `MISSING_REQUIRED_DATA:${b.id}`, bookingId: b.id, details: { internalRef: b.internalRef, fields: missingFields(b) } });
      }

      const created = await this.prisma.reconciliationIssue.createMany({ data: issues, skipDuplicates: true });

      // Auto-resolve issues whose cause has gone away.
      const open = await this.prisma.reconciliationIssue.findMany({
        where: { status: 'OPEN', type: { in: ['MISSING_REQUIRED_DATA', 'DUPLICATE_SUSPECT'] } },
        select: { id: true, fingerprint: true },
      });
      const current = new Set(issues.map((i) => i.fingerprint));
      const stale = open.filter((o) => !current.has(o.fingerprint)).map((o) => o.id);
      const autoResolved = stale.length
        ? (
            await this.prisma.reconciliationIssue.updateMany({
              where: { id: { in: stale } },
              data: { status: 'RESOLVED', resolvedAt: new Date(), resolutionNote: 'Auto-resolved: condition no longer present' },
            })
          ).count
        : 0;

      const result = { detected: issues.length, newIssues: created.count, autoResolved, bookingsCompared: candidates.length };
      await this.prisma.jobExecution.update({ where: { id: job.id }, data: { status: 'SUCCEEDED', finishedAt: new Date(), result } });
      await this.audit.log({ actorId: actor?.id ?? null, action: 'reconciliation.run', entityType: 'job', entityId: job.id, metadata: result, meta });
      return result;
    } catch (err) {
      await this.prisma.jobExecution.update({ where: { id: job.id }, data: { status: 'FAILED', finishedAt: new Date(), error: (err as Error).message.slice(0, 1000) } });
      throw err;
    }
  }

  async list(status?: string, type?: string) {
    const where: Prisma.ReconciliationIssueWhereInput = {
      ...(status && { status: status as never }),
      ...(type && { type: type as never }),
    };
    const [items, counts, lastRun] = await Promise.all([
      this.prisma.reconciliationIssue.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 500,
        include: {
          booking: { select: { id: true, internalRef: true, channel: true, status: true } },
          matchedBooking: { select: { id: true, internalRef: true, channel: true, status: true } },
          resolvedBy: { select: { name: true } },
        },
      }),
      this.prisma.reconciliationIssue.groupBy({ by: ['type', 'status'], _count: true }),
      this.prisma.jobExecution.findFirst({ where: { queue: 'reconciliation' }, orderBy: { createdAt: 'desc' } }),
    ]);
    return { items, counts, lastRun };
  }

  async resolve(id: string, status: 'RESOLVED' | 'DISMISSED', note: string, actor: AuthUser, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      const issue = await tx.reconciliationIssue.findUnique({ where: { id } });
      if (!issue) throw new NotFoundException();
      if (issue.status !== 'OPEN') throw new BadRequestException('Issue is already closed');
      const updated = await tx.reconciliationIssue.update({
        where: { id },
        data: { status, resolutionNote: note, resolvedById: actor.id, resolvedAt: new Date() },
      });
      await this.audit.log(
        { actorId: actor.id, action: `reconciliation.issue_${status.toLowerCase()}`, entityType: 'reconciliation_issue', entityId: id, metadata: { type: issue.type, note }, meta },
        tx,
      );
      return updated;
    });
  }
}
