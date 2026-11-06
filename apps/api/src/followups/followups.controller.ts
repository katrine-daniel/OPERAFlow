import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Prisma } from '@operaflow/db';
import { z } from 'zod';
import { AuthUser, CurrentUser, ReqMeta, RequestMeta, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { FollowupsService } from './followups.service';

const trackSchema = z.object({
  integrationId: z.string().uuid(),
  threadId: z.string().min(1).max(300),
  messageId: z.string().min(1).max(300),
  supplierId: z.string().uuid('Choose a supplier'),
  ruleId: z.string().uuid('Choose a rule'),
});
const listQuery = z.object({
  status: z.enum(['TRACKING', 'REPLIED', 'FOLLOWUP_DUE', 'AWAITING_APPROVAL', 'PAUSED', 'CANCELLED', 'EXHAUSTED', 'NEEDS_REVIEW']).optional(),
  mine: z.enum(['true', 'false']).optional(),
});
const reasonSchema = z.object({ reason: z.string().trim().max(500).optional() });
const overrideSchema = z.object({ at: z.coerce.date() });

@Controller('followups')
export class FollowupsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly followups: FollowupsService,
  ) {}

  @Get('mailboxes')
  @RequirePermissions('followups:read')
  mailboxes() {
    return this.prisma.integration.findMany({
      where: { kind: { in: ['GMAIL', 'MICROSOFT_GRAPH'] }, mode: 'LIVE' },
      select: { id: true, kind: true, name: true, mailboxAddress: true, status: true, lastError: true },
    });
  }

  @Get('mailboxes/:id/sent')
  @RequirePermissions('followups:manage')
  sent(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.followups.listSent(id, user);
  }

  @Get('conversations')
  @RequirePermissions('followups:read')
  async list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>, @CurrentUser() user: AuthUser) {
    const where: Prisma.EmailConversationWhereInput = {
      ...(q.status && { status: q.status }),
      ...(q.mine === 'true' && { ownerId: user.id }),
    };
    const [items, counts] = await Promise.all([
      this.prisma.emailConversation.findMany({
        where,
        orderBy: [{ nextFollowUpAt: { sort: 'asc', nulls: 'last' } }, { updatedAt: 'desc' }],
        take: 300,
        include: {
          supplier: { select: { id: true, name: true } },
          owner: { select: { id: true, name: true } },
          rule: { select: { name: true, maxFollowUps: true, sendMode: true } },
          integration: { select: { mailboxAddress: true, kind: true } },
          executions: { where: { status: 'AWAITING_APPROVAL' }, select: { id: true } },
        },
      }),
      this.prisma.emailConversation.groupBy({ by: ['status'], _count: true }),
    ]);
    return { items, counts };
  }

  @Get('conversations/:id')
  @RequirePermissions('followups:read')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const c = await this.prisma.emailConversation.findUnique({
      where: { id },
      include: {
        supplier: { select: { id: true, name: true, contacts: { select: { email: true } } } },
        owner: { select: { id: true, name: true } },
        rule: { include: { template: { select: { name: true } } } },
        integration: { select: { mailboxAddress: true, kind: true, status: true } },
        messages: { orderBy: { receivedAt: 'asc' } },
        executions: { orderBy: { sequence: 'asc' }, include: { approvedBy: { select: { name: true } } } },
      },
    });
    if (!c) throw new NotFoundException();
    return c;
  }

  @Post('conversations')
  @RequirePermissions('followups:manage')
  track(@Body(new ZodPipe(trackSchema)) body: z.infer<typeof trackSchema>, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.followups.track(body, user, meta);
  }

  @Post('conversations/:id/check')
  @HttpCode(200)
  @RequirePermissions('followups:manage')
  async check(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    const c = await this.prisma.emailConversation.findUnique({ where: { id } });
    if (!c) throw new NotFoundException();
    this.followups.assertCanAct(c, user);
    return { result: await this.followups.process(id) };
  }

  @Post('conversations/:id/pause')
  @HttpCode(200)
  @RequirePermissions('followups:manage')
  pause(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(reasonSchema)) body: z.infer<typeof reasonSchema>, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.followups.setState(id, 'pause', user, meta, body.reason);
  }

  @Post('conversations/:id/resume')
  @HttpCode(200)
  @RequirePermissions('followups:manage')
  resume(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.followups.setState(id, 'resume', user, meta);
  }

  @Post('conversations/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('followups:manage')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(reasonSchema)) body: z.infer<typeof reasonSchema>, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.followups.setState(id, 'cancel', user, meta, body.reason);
  }

  @Post('conversations/:id/mark-replied')
  @HttpCode(200)
  @RequirePermissions('followups:manage')
  markReplied(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(reasonSchema)) body: z.infer<typeof reasonSchema>, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.followups.setState(id, 'mark-replied', user, meta, body.reason);
  }

  @Post('conversations/:id/reschedule')
  @HttpCode(200)
  @RequirePermissions('followups:manage')
  reschedule(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(overrideSchema)) body: z.infer<typeof overrideSchema>, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.followups.override(id, body.at, user, meta);
  }

  @Post('executions/:id/approve')
  @HttpCode(200)
  @RequirePermissions('followups:manage')
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.followups.approve(id, user, meta);
  }

  @Post('executions/:id/skip')
  @HttpCode(200)
  @RequirePermissions('followups:manage')
  skip(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.followups.skip(id, user, meta);
  }

  /** Check every tracked thread now (the worker does this automatically every FOLLOWUP_POLL_MINUTES). */
  @Post('check-all')
  @HttpCode(200)
  @RequirePermissions('followups:manage', 'suppliers:manage')
  checkAll() {
    return this.followups.tick();
  }
}
