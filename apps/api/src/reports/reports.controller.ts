import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { CronExpressionParser } from 'cron-parser';
import { Prisma, type ReportFormat } from '@operaflow/db';
import {
  adhocReportSchema,
  buildCron,
  parseSimpleCron,
  reportFiltersSchema,
  runReportSchema,
  scheduleSchema,
  type ScheduleInput,
} from '@operaflow/shared';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, ReqMeta, RequestMeta, RequirePermissions } from '../common/auth-context';
import { isUniqueViolation } from '../common/prisma-errors';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../bookings/storage.service';
import { ReportsService, type StoredFile } from './reports.service';

// No top-level defaults on update (zod 4 applies .default()/.prefault() inside .partial(), which would wipe
// recipients and reset filters when a client only renames a schedule).
const updateSchema = scheduleSchema
  .extend({ recipients: z.array(z.string().trim().toLowerCase().email()).max(50), filters: reportFiltersSchema })
  .partial();
const runsQuery = z.object({ scheduleId: z.string().uuid().optional() });

export function nextRuns(cron: string, timezone: string, count = 3): string[] {
  try {
    const it = CronExpressionParser.parse(cron, { tz: timezone, currentDate: new Date() });
    return Array.from({ length: count }, () => it.next().toDate().toISOString());
  } catch {
    return [];
  }
}

@Controller('reports')
export class ReportsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  private async assertRecipientsApproved(recipients: string[]) {
    if (!recipients.length) return;
    const approved = await this.prisma.approvedRecipient.findMany({ where: { email: { in: recipients } }, select: { email: true } });
    const missing = recipients.filter((r) => !approved.some((a) => a.email === r));
    if (missing.length) throw new BadRequestException(`Not on the approved recipient list: ${missing.join(', ')}. An administrator must approve them first.`);
  }

  private async assertChannel(id: string | null | undefined) {
    if (!id) return;
    const integ = await this.prisma.integration.findUnique({ where: { id } });
    if (!integ || !['TEAMS_WEBHOOK', 'SLACK_WEBHOOK'].includes(integ.kind)) throw new BadRequestException('Unknown chat channel');
  }

  // ── Schedules ──

  @Get('schedules')
  @RequirePermissions('reports:read')
  async list() {
    const schedules = await this.prisma.scheduledReport.findMany({
      orderBy: { name: 'asc' },
      include: {
        channelIntegration: { select: { id: true, name: true, kind: true, mode: true, status: true } },
        createdBy: { select: { name: true } },
        runs: { where: { isPreview: false }, orderBy: { createdAt: 'desc' }, take: 1, include: { deliveries: { select: { status: true } } } },
      },
    });
    return schedules.map((s) => ({ ...s, simple: parseSimpleCron(s.cron), nextRuns: s.isEnabled ? nextRuns(s.cron, s.timezone) : [] }));
  }

  @Post('schedules')
  @RequirePermissions('reports:manage')
  async create(@Body(new ZodPipe(scheduleSchema)) body: ScheduleInput, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    await this.assertRecipientsApproved(body.recipients);
    await this.assertChannel(body.channelIntegrationId);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const s = await tx.scheduledReport.create({
          data: {
            name: body.name,
            cron: buildCron(body.timeOfDay, body.daysOfWeek),
            timezone: body.timezone,
            formats: body.formats,
            recipients: body.recipients,
            channelIntegrationId: body.channelIntegrationId ?? null,
            filters: body.filters as Prisma.InputJsonValue,
            isEnabled: false, // enabled only after a preview
            createdById: user.id,
          },
        });
        await this.audit.log({ actorId: user.id, action: 'report_schedule.created', entityType: 'scheduled_report', entityId: s.id, metadata: { name: s.name, cron: s.cron }, meta }, tx);
        return s;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new BadRequestException('A schedule with this name already exists');
      throw err;
    }
  }

  @Patch('schedules/:id')
  @RequirePermissions('reports:manage')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    const before = await this.prisma.scheduledReport.findUnique({ where: { id } });
    if (!before) throw new NotFoundException();
    if (body.recipients) await this.assertRecipientsApproved(body.recipients);
    await this.assertChannel(body.channelIntegrationId);
    const simple = parseSimpleCron(before.cron);
    const data: Prisma.ScheduledReportUncheckedUpdateInput = {
      ...(body.name && { name: body.name }),
      ...(body.timezone && { timezone: body.timezone }),
      ...(body.formats && { formats: body.formats }),
      ...(body.recipients && { recipients: body.recipients }),
      ...(body.channelIntegrationId !== undefined && { channelIntegrationId: body.channelIntegrationId }),
      ...(body.filters && { filters: body.filters as Prisma.InputJsonValue }),
    };
    if (body.timeOfDay || body.daysOfWeek) {
      data.cron = buildCron(body.timeOfDay ?? simple?.timeOfDay ?? '08:00', body.daysOfWeek ?? simple?.daysOfWeek ?? [1, 2, 3, 4, 5]);
    }
    // Content changes require a fresh preview before automation resumes.
    const contentChanged = Boolean(body.filters || body.formats || body.timezone);
    if (contentChanged) Object.assign(data, { isEnabled: false, lastPreviewedAt: null });
    const s = await this.prisma.scheduledReport.update({ where: { id }, data });
    await this.audit.log({ actorId: user.id, action: 'report_schedule.updated', entityType: 'scheduled_report', entityId: id, metadata: { fields: Object.keys(body), disabledForPreview: contentChanged && before.isEnabled }, meta });
    return s;
  }

  @Post('schedules/:id/preview')
  @HttpCode(200)
  @RequirePermissions('reports:manage')
  async preview(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(runReportSchema)) body: z.infer<typeof runReportSchema>, @CurrentUser() user: AuthUser) {
    const s = await this.prisma.scheduledReport.findUnique({ where: { id } });
    if (!s) throw new NotFoundException();
    const filters = reportFiltersSchema.parse(s.filters ?? {});
    const period = this.reports.periodFor(s.timezone, filters, body.date);
    const run = await this.reports.generate({
      idempotencyKey: `preview:${randomUUID()}`,
      name: `${s.name} (preview)`,
      scheduledReportId: s.id,
      period,
      filters,
      formats: s.formats,
      isPreview: true,
      triggeredById: user.id,
    });
    await this.prisma.scheduledReport.update({ where: { id }, data: { lastPreviewedAt: new Date() } });
    await this.audit.log({ actorId: user.id, action: 'report_schedule.previewed', entityType: 'scheduled_report', entityId: id, metadata: { runId: run.id } });
    return run;
  }

  @Post('schedules/:id/enable')
  @HttpCode(200)
  @RequirePermissions('reports:manage')
  async enable(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    const s = await this.prisma.scheduledReport.findUnique({ where: { id } });
    if (!s) throw new NotFoundException();
    if (!s.lastPreviewedAt) throw new BadRequestException('Generate and review a preview before enabling this schedule');
    if (!s.recipients.length && !s.channelIntegrationId) throw new BadRequestException('Add at least one approved recipient or a chat channel first');
    await this.assertRecipientsApproved(s.recipients);
    const updated = await this.prisma.scheduledReport.update({ where: { id }, data: { isEnabled: true } });
    await this.audit.log({ actorId: user.id, action: 'report_schedule.enabled', entityType: 'scheduled_report', entityId: id, meta });
    return { ...updated, nextRuns: nextRuns(updated.cron, updated.timezone) };
  }

  @Post('schedules/:id/disable')
  @HttpCode(200)
  @RequirePermissions('reports:manage')
  async disable(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    const s = await this.prisma.scheduledReport.update({ where: { id }, data: { isEnabled: false } }).catch(() => null);
    if (!s) throw new NotFoundException();
    await this.audit.log({ actorId: user.id, action: 'report_schedule.disabled', entityType: 'scheduled_report', entityId: id, meta });
    return s;
  }

  /** Manual run of a schedule (e.g. to re-send a specific day). Previews must be used for checking content. */
  @Post('schedules/:id/run')
  @HttpCode(200)
  @RequirePermissions('reports:manage')
  async run(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(runReportSchema)) body: z.infer<typeof runReportSchema>, @CurrentUser() user: AuthUser) {
    const s = await this.prisma.scheduledReport.findUnique({ where: { id } });
    if (!s) throw new NotFoundException();
    if (body.deliver && !s.lastPreviewedAt) throw new BadRequestException('Preview the report before delivering it');
    const filters = reportFiltersSchema.parse(s.filters ?? {});
    const period = this.reports.periodFor(s.timezone, filters, body.date);
    const run = await this.reports.generate({
      idempotencyKey: `manual:${randomUUID()}`,
      name: s.name,
      scheduledReportId: s.id,
      period,
      filters,
      formats: s.formats,
      isPreview: false,
      triggeredById: user.id,
    });
    const delivery = body.deliver ? await this.reports.deliver(run.id, user.id) : null;
    return { run, delivery };
  }

  /** One-off report for any day; downloadable, never emailed. */
  @Post('adhoc')
  @HttpCode(200)
  @RequirePermissions('reports:read')
  async adhoc(@Body(new ZodPipe(adhocReportSchema)) body: z.infer<typeof adhocReportSchema>, @CurrentUser() user: AuthUser) {
    const period = this.reports.periodFor(body.timezone, body.filters, body.date);
    return this.reports.generate({
      idempotencyKey: `adhoc:${randomUUID()}`,
      name: 'Operations report',
      period,
      filters: body.filters,
      formats: body.formats,
      isPreview: true,
      triggeredById: user.id,
    });
  }

  // ── Runs ──

  @Get('runs')
  @RequirePermissions('reports:read')
  runs(@Query(new ZodPipe(runsQuery)) q: z.infer<typeof runsQuery>) {
    return this.prisma.reportRun.findMany({
      where: q.scheduleId ? { scheduledReportId: q.scheduleId } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        scheduledReport: { select: { id: true, name: true } },
        triggeredBy: { select: { name: true } },
        deliveries: { orderBy: { createdAt: 'asc' } },
      },
    });
  }

  @Get('runs/:id')
  @RequirePermissions('reports:read')
  async getRun(@Param('id', ParseUUIDPipe) id: string) {
    const run = await this.prisma.reportRun.findUnique({
      where: { id },
      include: {
        scheduledReport: { select: { id: true, name: true, recipients: true, channelIntegration: { select: { name: true, kind: true } } } },
        triggeredBy: { select: { name: true } },
        deliveries: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!run) throw new NotFoundException();
    return run;
  }

  @Post('runs/:id/deliver')
  @HttpCode(200)
  @RequirePermissions('reports:manage')
  deliver(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.reports.deliver(id, user.id);
  }

  @Get('runs/:id/files/:format')
  @RequirePermissions('reports:read')
  async download(@Param('id', ParseUUIDPipe) id: string, @Param('format') format: string, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta, @Res() res: Response) {
    const run = await this.prisma.reportRun.findUnique({ where: { id } });
    const file = ((run?.files as unknown as StoredFile[]) ?? []).find((f) => f.format === format.toUpperCase());
    if (!run || !file) throw new NotFoundException();
    await this.audit.log({ actorId: user.id, action: 'report.downloaded', entityType: 'report_run', entityId: id, metadata: { format: file.format }, meta });
    res.setHeader('Content-Type', this.reports.contentType(file.format as ReportFormat));
    res.setHeader('Content-Length', String(file.sizeBytes));
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    this.storage.stream(file.storageKey).on('error', () => res.destroy()).pipe(res);
  }
}
