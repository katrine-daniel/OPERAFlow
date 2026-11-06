import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { isValidTimeZone } from '@operaflow/shared';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, ReqMeta, RequestMeta, RequirePermissions } from '../common/auth-context';
import { isUniqueViolation } from '../common/prisma-errors';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { templateProblems, TEMPLATE_VARIABLES } from './logic';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
const ruleSchema = z
  .object({
    name: z.string().trim().min(3).max(120),
    delayHours: z.coerce.number().int().min(1).max(720),
    maxFollowUps: z.coerce.number().int().min(0).max(10),
    businessHoursOnly: z.boolean(),
    businessStart: hhmm,
    businessEnd: hhmm,
    businessDays: z.array(z.number().int().min(1).max(7)).min(1),
    timezone: z.string().refine(isValidTimeZone, 'Unknown IANA timezone'),
    templateId: z.string().uuid(),
    isActive: z.boolean().default(true),
  })
  .refine((r) => r.businessStart < r.businessEnd, { message: 'Business hours must end after they start', path: ['businessEnd'] });
const ruleUpdate = z
  .object({
    name: z.string().trim().min(3).max(120),
    delayHours: z.coerce.number().int().min(1).max(720),
    maxFollowUps: z.coerce.number().int().min(0).max(10),
    businessHoursOnly: z.boolean(),
    businessStart: hhmm,
    businessEnd: hhmm,
    businessDays: z.array(z.number().int().min(1).max(7)).min(1),
    timezone: z.string().refine(isValidTimeZone, 'Unknown IANA timezone'),
    templateId: z.string().uuid(),
    isActive: z.boolean(),
  })
  .partial();
const templateSchema = z
  .object({
    name: z.string().trim().min(3).max(120),
    subjectTemplate: z.string().trim().min(1).max(300),
    bodyTemplate: z.string().trim().min(10).max(5000),
    isActive: z.boolean().default(true),
  })
  .superRefine((t, ctx) => {
    for (const p of [...templateProblems(t.subjectTemplate), ...templateProblems(t.bodyTemplate)]) ctx.addIssue({ code: 'custom', message: p, path: ['bodyTemplate'] });
  });

@Controller('followups')
export class RulesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('rules')
  @RequirePermissions('followups:read')
  rules() {
    return this.prisma.followUpRule.findMany({
      orderBy: { delayHours: 'asc' },
      include: { template: { select: { id: true, name: true } }, autoSendApprovedBy: { select: { name: true } }, _count: { select: { conversations: true } } },
    });
  }

  @Post('rules')
  @RequirePermissions('suppliers:manage', 'followups:manage')
  async createRule(@Body(new ZodPipe(ruleSchema)) body: z.infer<typeof ruleSchema>, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    try {
      const r = await this.prisma.followUpRule.create({ data: { ...body, sendMode: 'DRAFT_REVIEW' } });
      await this.audit.log({ actorId: user.id, action: 'followup_rule.created', entityType: 'follow_up_rule', entityId: r.id, metadata: { name: r.name }, meta });
      return r;
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('A rule with this name exists');
      throw err;
    }
  }

  @Patch('rules/:id')
  @RequirePermissions('suppliers:manage', 'followups:manage')
  async updateRule(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ruleUpdate)) body: z.infer<typeof ruleUpdate>, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    const before = await this.prisma.followUpRule.findUnique({ where: { id } });
    if (!before) throw new NotFoundException();
    const start = body.businessStart ?? before.businessStart;
    const end = body.businessEnd ?? before.businessEnd;
    if (start >= end) throw new BadRequestException('Business hours must end after they start');
    // Changing an auto-send rule's behaviour revokes the approval: an administrator must re-approve what will run unattended.
    const revoke = before.sendMode === 'AUTO_SEND';
    const r = await this.prisma.followUpRule.update({
      where: { id },
      data: { ...body, ...(revoke && { sendMode: 'DRAFT_REVIEW', autoSendApprovedById: null, autoSendApprovedAt: null }) },
    });
    await this.audit.log({ actorId: user.id, action: 'followup_rule.updated', entityType: 'follow_up_rule', entityId: id, metadata: { fields: Object.keys(body), autoSendRevoked: revoke }, meta });
    return r;
  }

  /** Unattended sending requires an explicit administrator decision, recorded with who and when. */
  @Post('rules/:id/approve-autosend')
  @HttpCode(200)
  @RequirePermissions('followups:approve-autosend')
  async approveAutosend(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    const r = await this.prisma.followUpRule.update({ where: { id }, data: { sendMode: 'AUTO_SEND', autoSendApprovedById: user.id, autoSendApprovedAt: new Date() } }).catch(() => null);
    if (!r) throw new NotFoundException();
    await this.audit.log({ actorId: user.id, action: 'followup_rule.autosend_approved', entityType: 'follow_up_rule', entityId: id, metadata: { name: r.name }, meta });
    return r;
  }

  @Post('rules/:id/revoke-autosend')
  @HttpCode(200)
  @RequirePermissions('followups:manage')
  async revokeAutosend(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    const r = await this.prisma.followUpRule.update({ where: { id }, data: { sendMode: 'DRAFT_REVIEW', autoSendApprovedById: null, autoSendApprovedAt: null } }).catch(() => null);
    if (!r) throw new NotFoundException();
    await this.audit.log({ actorId: user.id, action: 'followup_rule.autosend_revoked', entityType: 'follow_up_rule', entityId: id, meta });
    return r;
  }

  @Get('templates')
  @RequirePermissions('followups:read')
  async templates() {
    return { variables: TEMPLATE_VARIABLES, items: await this.prisma.followUpTemplate.findMany({ orderBy: { name: 'asc' } }) };
  }

  @Post('templates')
  @RequirePermissions('suppliers:manage', 'followups:manage')
  async createTemplate(@Body(new ZodPipe(templateSchema)) body: z.infer<typeof templateSchema>, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    try {
      const t = await this.prisma.followUpTemplate.create({ data: body });
      await this.audit.log({ actorId: user.id, action: 'followup_template.created', entityType: 'follow_up_template', entityId: t.id, meta });
      return t;
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('A template with this name exists');
      throw err;
    }
  }

  @Patch('templates/:id')
  @RequirePermissions('suppliers:manage', 'followups:manage')
  async updateTemplate(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(templateSchema)) body: z.infer<typeof templateSchema>, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    const t = await this.prisma.followUpTemplate.update({ where: { id }, data: body }).catch(() => null);
    if (!t) throw new NotFoundException();
    // Auto-send rules using this template need re-approval of the new wording.
    const revoked = await this.prisma.followUpRule.updateMany({ where: { templateId: id, sendMode: 'AUTO_SEND' }, data: { sendMode: 'DRAFT_REVIEW', autoSendApprovedById: null, autoSendApprovedAt: null } });
    await this.audit.log({ actorId: user.id, action: 'followup_template.updated', entityType: 'follow_up_template', entityId: id, metadata: { autoSendRulesRevoked: revoked.count }, meta });
    return t;
  }
}
