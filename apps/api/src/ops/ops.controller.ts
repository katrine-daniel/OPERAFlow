import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { hasPermission } from '@operaflow/shared';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, ReqMeta, RequestMeta, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { RETENTION_DEFAULTS, RETENTION_MINIMUMS, RetentionService, type RetentionKey } from './retention.service';

const retentionSchema = z
  .object(Object.fromEntries(Object.keys(RETENTION_DEFAULTS).map((k) => [k, z.number().int().min(RETENTION_MINIMUMS[k as RetentionKey]).max(3650).optional()])))
  .refine((v) => Object.keys(v).length > 0, 'No changes supplied');
const searchQuery = z.object({ q: z.string().trim().min(2).max(100) });

@Controller()
export class OpsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly retention: RetentionService,
    private readonly audit: AuditService,
  ) {}

  // ── Notifications (own only) ──

  @Get('notifications')
  async notifications(@CurrentUser() user: AuthUser) {
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 30 }),
      this.prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    ]);
    return { unread, items };
  }

  @Post('notifications/:id/read')
  @HttpCode(200)
  async read(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    const r = await this.prisma.notification.updateMany({ where: { id, userId: user.id, readAt: null }, data: { readAt: new Date() } });
    if (r.count === 0 && !(await this.prisma.notification.count({ where: { id, userId: user.id } }))) throw new NotFoundException();
    return { ok: true };
  }

  @Post('notifications/read-all')
  @HttpCode(200)
  async readAll(@CurrentUser() user: AuthUser) {
    const r = await this.prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { updated: r.count };
  }

  // ── Global search (permission-scoped) ──

  @Get('search')
  @RequirePermissions('dashboard:read')
  async search(@Query(new ZodPipe(searchQuery)) { q }: z.infer<typeof searchQuery>, @CurrentUser() user: AuthUser) {
    const can = (p: Parameters<typeof hasPermission>[1]) => hasPermission(user.role, p);
    const ci = { contains: q, mode: 'insensitive' as const };
    const [bookings, suppliers, conversations, scenarios] = await Promise.all([
      can('bookings:read')
        ? this.prisma.booking.findMany({
            where: { OR: [{ internalRef: ci }, { externalRef: ci }, { confirmationNumber: ci }, { leadGuestName: ci }, { hotel: { name: ci } }] },
            select: { id: true, internalRef: true, externalRef: true, leadGuestName: true, status: true, checkIn: true, hotel: { select: { name: true } } },
            orderBy: { bookingDate: 'desc' },
            take: 10,
          })
        : [],
      can('suppliers:read') ? this.prisma.supplier.findMany({ where: { OR: [{ name: ci }, { code: ci }, { contacts: { some: { email: ci } } }] }, select: { id: true, name: true, code: true }, take: 5 }) : [],
      can('followups:read') ? this.prisma.emailConversation.findMany({ where: { OR: [{ subject: ci }, { supplier: { name: ci } }] }, select: { id: true, subject: true, status: true }, take: 5 }) : [],
      can('tests:read') ? this.prisma.testScenario.findMany({ where: { OR: [{ name: ci }, { key: ci }] }, select: { id: true, name: true }, take: 5 }) : [],
    ]);
    return {
      bookings: bookings.map((b) => ({ ...b, checkIn: b.checkIn.toISOString().slice(0, 10), leadGuestName: can('bookings:view-pii') ? b.leadGuestName : null })),
      suppliers,
      conversations,
      scenarios,
    };
  }

  // ── Retention settings (admin) ──

  @Get('settings/retention')
  @RequirePermissions('settings:manage')
  async getRetention() {
    const lastRun = await this.prisma.auditLog.findFirst({ where: { action: 'retention.run' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, metadata: true } });
    return { values: await this.retention.settings(), minimums: RETENTION_MINIMUMS, lastRun };
  }

  @Patch('settings/retention')
  @RequirePermissions('settings:manage')
  async setRetention(@Body(new ZodPipe(retentionSchema)) body: Record<string, number | undefined>, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    const before = await this.retention.settings();
    for (const [key, value] of Object.entries(body)) {
      if (value === undefined) continue;
      if (!(key in RETENTION_DEFAULTS)) throw new BadRequestException(`Unknown setting ${key}`);
      await this.prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
    }
    await this.audit.log({ actorId: user.id, action: 'settings.retention_updated', entityType: 'system', metadata: { before, changes: body }, meta });
    return this.retention.settings();
  }

  @Post('settings/retention/run')
  @HttpCode(200)
  @RequirePermissions('settings:manage')
  runRetention() {
    return this.retention.run();
  }
}
