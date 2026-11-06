import { Controller, Get, Query } from '@nestjs/common';
import { auditQuerySchema } from '@operaflow/shared';
import type { z } from 'zod';
import { RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('audit:read')
  async list(@Query(new ZodPipe(auditQuerySchema)) q: z.infer<typeof auditQuerySchema>) {
    const where = {
      ...(q.entityType && { entityType: q.entityType }),
      ...(q.entityId && { entityId: q.entityId }),
      ...(q.actorId && { actorId: q.actorId }),
      ...(q.action && { action: { startsWith: q.action } }),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { actor: { select: { id: true, name: true, email: true } } },
      }),
    ]);
    return { total, page: q.page, pageSize: q.pageSize, items };
  }
}
