import { BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { approvedRecipientSchema } from '@operaflow/shared';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, ReqMeta, RequestMeta, RequirePermissions } from '../common/auth-context';
import { isUniqueViolation } from '../common/prisma-errors';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

/** Report emails (which contain guest data) may only go to addresses an administrator has approved. */
@Controller('reports/recipients')
export class RecipientsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('reports:read')
  list() {
    return this.prisma.approvedRecipient.findMany({ orderBy: { email: 'asc' }, include: { approvedBy: { select: { name: true } } } });
  }

  @Post()
  @RequirePermissions('reports:approve-recipients')
  async add(@Body(new ZodPipe(approvedRecipientSchema)) body: z.infer<typeof approvedRecipientSchema>, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const r = await tx.approvedRecipient.create({ data: { email: body.email, label: body.label, approvedById: user.id } });
        await this.audit.log({ actorId: user.id, action: 'report_recipient.approved', entityType: 'approved_recipient', entityId: r.id, metadata: { email: r.email }, meta }, tx);
        return r;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('Already approved');
      throw err;
    }
  }

  @Delete(':id')
  @RequirePermissions('reports:approve-recipients')
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    const r = await this.prisma.approvedRecipient.findUnique({ where: { id } });
    if (!r) throw new NotFoundException();
    const usedBy = await this.prisma.scheduledReport.findMany({ where: { recipients: { has: r.email } }, select: { name: true } });
    if (usedBy.length) throw new BadRequestException(`Remove ${r.email} from these schedules first: ${usedBy.map((s) => s.name).join(', ')}`);
    await this.prisma.$transaction(async (tx) => {
      await tx.approvedRecipient.delete({ where: { id } });
      await this.audit.log({ actorId: user.id, action: 'report_recipient.revoked', entityType: 'approved_recipient', entityId: id, metadata: { email: r.email }, meta }, tx);
    });
    return { ok: true };
  }
}
