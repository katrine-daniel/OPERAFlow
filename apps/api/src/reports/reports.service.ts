import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type ReportFormat, type ReportRun } from '@operaflow/db';
import { reportFiltersSchema, type ReportFilters } from '@operaflow/shared';
import { env } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../common/crypto.service';
import { isUniqueViolation } from '../common/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../bookings/storage.service';
import { DeliveryNotConfiguredError, DeliveryService } from './delivery.service';
import { ReportDataService, resolvePeriod, type ReportDataset, type ReportPeriod } from './report-data.service';
import { renderPdf, renderXlsx } from './report-render';

export interface StoredFile {
  format: ReportFormat;
  fileName: string;
  storageKey: string;
  sizeBytes: number;
}

const CONTENT_TYPES: Record<ReportFormat, string> = {
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  PDF: 'application/pdf',
};
const STALE_SENDING_MS = 15 * 60_000;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'report';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly data: ReportDataService,
    private readonly storage: StorageService,
    private readonly delivery: DeliveryService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  contentType(format: ReportFormat) {
    return CONTENT_TYPES[format];
  }

  /**
   * Generates (or returns the already-generated) run for an idempotency key. Safe to call repeatedly:
   * a scheduled job retried by the queue never produces a second report for the same day.
   */
  async generate(opts: {
    idempotencyKey: string;
    name: string;
    scheduledReportId?: string | null;
    period: ReportPeriod;
    filters: ReportFilters;
    formats: ReportFormat[];
    isPreview: boolean;
    triggeredById?: string | null;
  }): Promise<ReportRun> {
    let run = await this.prisma.reportRun.findUnique({ where: { idempotencyKey: opts.idempotencyKey } });
    if (run?.status === 'GENERATED') return run;
    if (run?.status === 'GENERATING' && Date.now() - run.createdAt.getTime() < STALE_SENDING_MS) {
      throw new ConflictException('This report is already being generated');
    }
    const base = {
      scheduledReportId: opts.scheduledReportId ?? null,
      isPreview: opts.isPreview,
      periodStart: opts.period.start,
      periodEnd: opts.period.end,
      timezone: opts.period.timezone,
      status: 'GENERATING' as const,
      error: null,
      triggeredById: opts.triggeredById ?? null,
      summary: { reportDate: opts.period.date, filters: opts.filters } as Prisma.InputJsonValue,
    };
    if (run) {
      run = await this.prisma.reportRun.update({ where: { id: run.id }, data: base });
    } else {
      try {
        run = await this.prisma.reportRun.create({ data: { ...base, idempotencyKey: opts.idempotencyKey } });
      } catch (err) {
        if (isUniqueViolation(err)) throw new ConflictException('This report is already being generated');
        throw err;
      }
    }

    try {
      const ds = await this.data.build(opts.period, opts.filters);
      const title = `${opts.name} — ${opts.period.date}`;
      const files: StoredFile[] = [];
      for (const format of opts.formats) {
        const buf = format === 'XLSX' ? await renderXlsx(ds, title) : await renderPdf(ds, title);
        const storageKey = await this.storage.save('reports', buf);
        files.push({ format, fileName: `operaflow-${slug(opts.name)}-${opts.period.date}.${format.toLowerCase()}`, storageKey, sizeBytes: buf.length });
      }
      return await this.prisma.reportRun.update({
        where: { id: run.id },
        data: {
          status: 'GENERATED',
          generatedAt: new Date(),
          rowCount: ds.rows.length,
          warnings: ds.warnings as unknown as Prisma.InputJsonValue,
          summary: { reportDate: opts.period.date, filters: opts.filters, ...ds.summary } as unknown as Prisma.InputJsonValue,
          files: files as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.error(`report run ${run.id} failed`, err as Error);
      await this.prisma.reportRun.update({ where: { id: run.id }, data: { status: 'FAILED', error: (err as Error).message.slice(0, 1000) } });
      throw err;
    }
  }

  /** Builds a dataset without storing anything (used by the on-screen preview table). */
  dataset(period: ReportPeriod, filters: ReportFilters): Promise<ReportDataset> {
    return this.data.build(period, filters);
  }

  /**
   * Delivers a generated run to its schedule's recipients. Each (run, channel, recipient) has exactly one
   * delivery row; only PENDING/FAILED rows are attempted, and each attempt is claimed atomically, so
   * retries and concurrent workers never send the same report twice to the same recipient.
   */
  async deliver(runId: string, actorId: string | null = null) {
    const run = await this.prisma.reportRun.findUnique({
      where: { id: runId },
      include: { scheduledReport: { include: { channelIntegration: true } } },
    });
    if (!run) throw new NotFoundException();
    if (run.isPreview) throw new BadRequestException('Preview runs are never delivered');
    if (run.status !== 'GENERATED') throw new BadRequestException('Only generated reports can be delivered');
    const schedule = run.scheduledReport;
    if (!schedule) throw new BadRequestException('Ad-hoc reports have no recipients; download them instead');

    const approved = new Set((await this.prisma.approvedRecipient.findMany({ select: { email: true } })).map((r) => r.email));
    const targets: Prisma.ReportDeliveryCreateManyInput[] = schedule.recipients.map((email) => ({ reportRunId: run.id, channel: 'EMAIL', recipient: email }));
    if (schedule.channelIntegration) targets.push({ reportRunId: run.id, channel: 'INTEGRATION', recipient: schedule.channelIntegration.id });
    if (targets.length) await this.prisma.reportDelivery.createMany({ data: targets, skipDuplicates: true });

    // A worker that died mid-send leaves SENDING behind; surface it as failed (outcome unknown) rather than resending silently.
    await this.prisma.reportDelivery.updateMany({
      where: { reportRunId: run.id, status: 'SENDING', updatedAt: { lt: new Date(Date.now() - STALE_SENDING_MS) } },
      data: { status: 'FAILED', lastError: 'Interrupted during sending; outcome unknown. Check with the recipient before retrying.' },
    });

    const files = (run.files as unknown as StoredFile[]) ?? [];
    const summary = run.summary as Record<string, unknown> | null;
    const subject = `${schedule.name} · ${String(summary?.reportDate ?? '')}`;
    const link = `${env().APP_BASE_URL.replace(/\/$/, '')}/reports/runs/${run.id}`;
    const lines = [
      `Bookings: ${summary?.total ?? 0} (online ${summary?.online ?? 0}, offline ${summary?.offline ?? 0})`,
      `Pending confirmation: ${summary?.pendingConfirmation ?? 0}`,
      `Bookings with missing data: ${summary?.withMissingData ?? 0}`,
      ...(Array.isArray(summary?.currencies)
        ? (summary!.currencies as { currency: string; selling: string; margin: string; marginExcluded: number }[]).map(
            (c) => `${c.currency}: selling ${c.selling}, margin ${c.margin}${c.marginExcluded ? ` (${c.marginExcluded} excluded)` : ''}`,
          )
        : []),
    ];
    let attachments: { filename: string; content: Buffer; contentType: string }[] | undefined;

    const pending = await this.prisma.reportDelivery.findMany({
      where: { reportRunId: run.id, status: { in: ['PENDING', 'FAILED'] }, attempts: { lt: env().REPORT_DELIVERY_MAX_ATTEMPTS } },
    });
    const outcome = { sent: 0, failed: 0 };
    for (const d of pending) {
      const claim = await this.prisma.reportDelivery.updateMany({
        where: { id: d.id, status: { in: ['PENDING', 'FAILED'] } },
        data: { status: 'SENDING', attempts: { increment: 1 } },
      });
      if (claim.count === 0) continue;
      try {
        let providerMessageId: string | null = null;
        if (d.channel === 'EMAIL') {
          if (!approved.has(d.recipient)) throw new Error('Recipient is no longer on the approved list');
          attachments ??= await Promise.all(
            files.map(async (f) => ({ filename: f.fileName, content: await this.storage.read(f.storageKey), contentType: CONTENT_TYPES[f.format] })),
          );
          const body = `${subject}\n\n${lines.join('\n')}\n\nGenerated by OPERAFlow. Full detail: ${link}\n`;
          providerMessageId = await this.delivery.sendEmail(d.recipient, subject, body, attachments);
        } else {
          const integ = schedule.channelIntegration;
          if (!integ || integ.mode !== 'LIVE' || !integ.encryptedSecret) throw new Error('Chat integration is disabled or not configured');
          await this.delivery.postChat(integ.kind as 'TEAMS_WEBHOOK' | 'SLACK_WEBHOOK', this.crypto.decrypt(integ.encryptedSecret), subject, lines, link);
        }
        await this.prisma.reportDelivery.update({ where: { id: d.id }, data: { status: 'SENT', sentAt: new Date(), providerMessageId, lastError: null } });
        outcome.sent++;
      } catch (err) {
        const message = err instanceof DeliveryNotConfiguredError ? err.message : `Delivery failed: ${(err as Error).message}`;
        await this.prisma.reportDelivery.update({ where: { id: d.id }, data: { status: 'FAILED', lastError: message.slice(0, 500) } });
        outcome.failed++;
      }
    }

    if (outcome.failed && schedule.createdById) {
      await this.prisma.notification.create({
        data: {
          userId: schedule.createdById,
          type: 'report.delivery_failed',
          severity: 'error',
          title: `${outcome.failed} delivery failure(s) for ${schedule.name}`,
          link: `/reports/runs/${run.id}`,
        },
      });
    }
    await this.audit.log({ actorId, action: 'report.delivered', entityType: 'report_run', entityId: run.id, metadata: { ...outcome, attempted: pending.length } });
    return { ...outcome, attempted: pending.length };
  }

  /** Entry point for the scheduler (BullMQ job). `firedAt` is the scheduled fire time. */
  async runScheduled(scheduleId: string, firedAt: Date) {
    const schedule = await this.prisma.scheduledReport.findUnique({ where: { id: scheduleId } });
    if (!schedule || !schedule.isEnabled) return { skipped: 'schedule disabled or deleted' };
    const filters = reportFiltersSchema.parse(schedule.filters ?? {});
    const period = resolvePeriod(schedule.timezone, filters.period, firedAt);
    const run = await this.generate({
      idempotencyKey: `sched:${schedule.id}:${period.date}`,
      name: schedule.name,
      scheduledReportId: schedule.id,
      period,
      filters,
      formats: schedule.formats,
      isPreview: false,
    });
    const delivery = await this.deliver(run.id);
    await this.audit.log({ action: 'report.scheduled_run', entityType: 'scheduled_report', entityId: schedule.id, metadata: { runId: run.id, reportDate: period.date, ...delivery } });
    return { runId: run.id, reportDate: period.date, ...delivery };
  }

  periodFor(timezone: string, filters: ReportFilters, date?: string) {
    return resolvePeriod(timezone, filters.period, new Date(), date);
  }
}
