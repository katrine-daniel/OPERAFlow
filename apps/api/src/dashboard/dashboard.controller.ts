import { Controller, Get } from '@nestjs/common';
import { hasPermission, zonedDayRange } from '@operaflow/shared';
import { env } from '../config/env';
import { AuthUser, CurrentUser, RequirePermissions } from '../common/auth-context';
import { PrismaService } from '../prisma/prisma.service';
import { missingDataWhere } from '../bookings/booking-view';

/** Every number here is a live database count — no placeholders. Sections the user cannot access are null. */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('summary')
  @RequirePermissions('dashboard:read')
  async summary(@CurrentUser() user: AuthUser) {
    const tz = env().DEFAULT_TIMEZONE;
    const today = zonedDayRange(tz);
    const can = (p: Parameters<typeof hasPermission>[1]) => hasPermission(user.role, p);
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 86_400_000);

    const bookings = can('bookings:read')
      ? await (async () => {
          const todayWhere = { bookingDate: { gte: today.start, lt: today.end } };
          const [total, online, offline, pendingConfirmations, missingInfo] = await Promise.all([
            this.prisma.booking.count({ where: todayWhere }),
            this.prisma.booking.count({ where: { ...todayWhere, channel: 'ONLINE' } }),
            this.prisma.booking.count({ where: { ...todayWhere, channel: 'OFFLINE' } }),
            this.prisma.booking.count({ where: { confirmationStatus: 'PENDING', status: { notIn: ['CANCELLED', 'FAILED'] } } }),
            this.prisma.booking.count({ where: missingDataWhere }),
          ]);
          return { today: total, online, offline, pendingConfirmations, missingInfo };
        })()
      : null;

    const followUps = can('followups:read')
      ? {
          due: await this.prisma.emailConversation.count({
            where: {
              OR: [
                { status: { in: ['FOLLOWUP_DUE', 'AWAITING_APPROVAL'] } },
                { status: 'TRACKING', nextFollowUpAt: { lte: now } },
              ],
            },
          }),
          needsReview: await this.prisma.emailConversation.count({ where: { status: 'NEEDS_REVIEW' } }),
        }
      : null;

    const tests = can('tests:read')
      ? {
          failedLast24h: await this.prisma.testRun.count({
            where: { status: { in: ['FAILED', 'ERROR'] }, queuedAt: { gte: dayAgo } },
          }),
          criticalFailedLast24h: await this.prisma.testRun.count({
            where: { status: { in: ['FAILED', 'ERROR'] }, queuedAt: { gte: dayAgo }, scenario: { isCritical: true } },
          }),
          environmentsConfigured: await this.prisma.testEnvironment.count({ where: { isActive: true } }),
        }
      : null;

    const reports = can('reports:read')
      ? {
          scheduledEnabled: await this.prisma.scheduledReport.count({ where: { isEnabled: true } }),
          failedDeliveries: await this.prisma.reportDelivery.count({ where: { status: 'FAILED' } }),
        }
      : null;

    const automation = {
      integrations: await this.prisma.integration.groupBy({ by: ['kind', 'mode', 'status'], _count: true }),
      failedJobsLast24h: await this.prisma.jobExecution.count({ where: { status: 'FAILED', createdAt: { gte: dayAgo } } }),
    };

    const recentActivity = can('audit:read')
      ? await this.prisma.auditLog.findMany({
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { id: true, action: true, entityType: true, entityId: true, createdAt: true, actor: { select: { name: true } } },
        })
      : null;

    const unreadNotifications = await this.prisma.notification.count({ where: { userId: user.id, readAt: null } });

    return { timezone: tz, date: today.isoDate, bookings, followUps, tests, reports, automation, recentActivity, unreadNotifications };
  }
}
