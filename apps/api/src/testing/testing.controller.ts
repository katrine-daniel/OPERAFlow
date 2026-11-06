import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CronExpressionParser } from 'cron-parser';
import { Prisma } from '@operaflow/db';
import { isValidTimeZone } from '@operaflow/shared';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, ReqMeta, RequestMeta, RequirePermissions } from '../common/auth-context';
import { isUniqueViolation } from '../common/prisma-errors';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../bookings/storage.service';
import { nextRuns } from '../reports/reports.controller';
import { scenarioConfigSchema } from './steps';
import { TestingService } from './testing.service';

const MUTATING = ['BOOKING_CREATE', 'BOOKING_CONFIRMATION', 'BOOKING_MODIFY', 'BOOKING_CANCEL'];
const JOURNEYS = ['HOTEL_SEARCH', 'ROOM_AVAILABILITY', 'RATE_SELECTION', 'GUEST_VALIDATION', 'BOOKING_CREATE', 'BOOKING_CONFIRMATION', 'BOOKING_MODIFY', 'BOOKING_CANCEL', 'CANCELLATION_POLICY', 'NEGATIVE_INPUTS'] as const;

const envSchema = z.object({
  name: z.string().trim().min(2).max(120),
  baseUrl: z.string().trim().max(500),
  kind: z.enum(['SANDBOX', 'STAGING', 'PRODUCTION_READONLY']),
  allowBookingMutations: z.boolean().default(false),
  config: z.unknown().optional(),
  isActive: z.boolean().optional(),
  /** Write-only. Omit to keep, null to clear. */
  secrets: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/), z.string().max(500)).nullable().optional(),
});
const cron = z.preprocess((v) => (v === '' ? null : v), z.string().max(100).nullable().optional()).refine((c) => {
  if (!c) return true;
  try {
    CronExpressionParser.parse(c);
    return c.trim().split(/\s+/).length === 5;
  } catch {
    return false;
  }
}, 'Use a 5-field cron expression, e.g. "0 6 * * *"');
const scenarioUpdate = z.object({
  name: z.string().trim().min(3).max(160).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  isCritical: z.boolean().optional(),
  viewports: z.array(z.enum(['desktop', 'mobile'])).min(1).optional(),
  config: scenarioConfigSchema.optional(),
  cron,
  timezone: z.string().refine(isValidTimeZone, 'Unknown IANA timezone').optional(),
  environmentId: z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional()),
  isActive: z.boolean().optional(),
});
const scenarioCreate = z.object({
  key: z.string().regex(/^[a-z0-9][a-z0-9.-]{2,60}$/, 'lowercase letters, digits, dots and dashes'),
  name: z.string().trim().min(3).max(160),
  journey: z.enum(JOURNEYS),
  isCritical: z.boolean().default(false),
});
const runSchema = z.object({ environmentId: z.string().uuid(), viewports: z.array(z.enum(['desktop', 'mobile'])).optional() });
const runsQuery = z.object({ scenarioId: z.string().uuid().optional(), status: z.string().max(20).optional() });

@Controller('testing')
export class TestingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly testing: TestingService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  @Get('environments')
  @RequirePermissions('tests:read')
  async environments() {
    const items = await this.prisma.testEnvironment.findMany({ orderBy: { name: 'asc' } });
    return items.map(({ encryptedSecret, ...e }) => ({ ...e, hasSecrets: Boolean(encryptedSecret), secretKeys: encryptedSecret ? '(hidden)' : null }));
  }

  @Post('environments')
  @RequirePermissions('tests:manage')
  async createEnv(@Body(new ZodPipe(envSchema)) body: z.infer<typeof envSchema>, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    try {
      return await this.testing.saveEnvironment(body, user, meta);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('An environment with this name exists');
      throw err;
    }
  }

  @Patch('environments/:id')
  @RequirePermissions('tests:manage')
  async updateEnv(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(envSchema)) body: z.infer<typeof envSchema>, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    if (!(await this.prisma.testEnvironment.count({ where: { id } }))) throw new NotFoundException();
    return this.testing.saveEnvironment({ ...body, id }, user, meta);
  }

  @Get('scenarios')
  @RequirePermissions('tests:read')
  async scenarios() {
    const items = await this.prisma.testScenario.findMany({
      orderBy: [{ isCritical: 'desc' }, { key: 'asc' }],
      include: {
        environment: { select: { id: true, name: true } },
        runs: { orderBy: { queuedAt: 'desc' }, take: 6, select: { id: true, status: true, viewport: true, queuedAt: true, durationMs: true, failureClass: true, environment: { select: { name: true } } } },
      },
    });
    return items.map((s) => ({ ...s, configured: scenarioConfigSchema.safeParse(s.config).success, nextRuns: s.cron && s.environmentId && s.isActive ? nextRuns(s.cron, s.timezone) : [] }));
  }

  @Post('scenarios')
  @RequirePermissions('tests:manage')
  async createScenario(@Body(new ZodPipe(scenarioCreate)) body: z.infer<typeof scenarioCreate>, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    try {
      const s = await this.prisma.testScenario.create({ data: { ...body, mutatesBookings: MUTATING.includes(body.journey), viewports: ['desktop', 'mobile'] } });
      await this.audit.log({ actorId: user.id, action: 'test_scenario.created', entityType: 'test_scenario', entityId: s.id, metadata: { key: s.key }, meta });
      return s;
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('A scenario with this key exists');
      throw err;
    }
  }

  @Patch('scenarios/:id')
  @RequirePermissions('tests:manage')
  async updateScenario(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(scenarioUpdate)) body: z.infer<typeof scenarioUpdate>, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    const before = await this.prisma.testScenario.findUnique({ where: { id } });
    if (!before) throw new NotFoundException();
    const cronAfter = body.cron !== undefined ? body.cron : before.cron;
    const envAfter = body.environmentId !== undefined ? body.environmentId : before.environmentId;
    if (cronAfter && !envAfter) throw new BadRequestException('Choose the environment that scheduled runs should use');
    const s = await this.prisma.testScenario.update({ where: { id }, data: { ...body, config: body.config as Prisma.InputJsonValue | undefined } });
    await this.audit.log({ actorId: user.id, action: 'test_scenario.updated', entityType: 'test_scenario', entityId: id, metadata: { fields: Object.keys(body) }, meta });
    return s;
  }

  @Post('scenarios/:id/run')
  @RequirePermissions('tests:run')
  async run(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(runSchema)) body: z.infer<typeof runSchema>, @CurrentUser() user: AuthUser) {
    const runs = await this.testing.requestRuns(id, body.environmentId, body.viewports, 'MANUAL', user.id);
    return { mode: this.testing.mode(), runs: runs.map((r) => ({ id: r.id, viewport: r.viewport, status: r.status })) };
  }

  @Get('runs')
  @RequirePermissions('tests:read')
  runs(@Query(new ZodPipe(runsQuery)) q: z.infer<typeof runsQuery>) {
    return this.prisma.testRun.findMany({
      where: { ...(q.scenarioId && { scenarioId: q.scenarioId }), ...(q.status && { status: q.status as never }) },
      orderBy: { queuedAt: 'desc' },
      take: 100,
      include: { scenario: { select: { id: true, name: true, isCritical: true, journey: true } }, environment: { select: { name: true, kind: true } }, triggeredBy: { select: { name: true } } },
    });
  }

  @Get('runs/:id')
  @RequirePermissions('tests:read')
  async getRun(@Param('id', ParseUUIDPipe) id: string) {
    const r = await this.prisma.testRun.findUnique({
      where: { id },
      include: {
        scenario: true,
        environment: { select: { id: true, name: true, kind: true, baseUrl: true } },
        triggeredBy: { select: { name: true } },
        artifacts: { orderBy: { createdAt: 'asc' }, select: { id: true, kind: true, sizeBytes: true, createdAt: true } },
      },
    });
    if (!r) throw new NotFoundException();
    return r;
  }

  @Get('runs/:id/artifacts/:artifactId')
  @RequirePermissions('tests:read')
  async artifact(@Param('id', ParseUUIDPipe) id: string, @Param('artifactId', ParseUUIDPipe) artifactId: string, @Res() res: Response) {
    const a = await this.prisma.testArtifact.findFirst({ where: { id: artifactId, runId: id } });
    if (!a) throw new NotFoundException();
    const isTrace = a.kind === 'TRACE';
    res.setHeader('Content-Type', isTrace ? 'application/zip' : 'image/png');
    res.setHeader('Content-Length', String(a.sizeBytes));
    res.setHeader('Content-Disposition', `${isTrace ? 'attachment' : 'inline'}; filename="${a.kind.toLowerCase()}-${a.id.slice(0, 8)}.${isTrace ? 'zip' : 'png'}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox");
    this.storage.stream(a.storageKey).on('error', () => res.destroy()).pipe(res);
  }
}
