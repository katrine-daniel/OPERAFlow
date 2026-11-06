import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { env } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, ReqMeta, RequestMeta, RequirePermissions } from '../common/auth-context';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { ZodPipe } from '../common/zod.pipe';
import { DeliveryService, validateChatWebhookUrl } from '../reports/delivery.service';
import { MailClientFactory } from '../followups/mail-client.factory';
import { oauthConfigured } from '../followups/oauth';

const chatSchema = z.object({
  kind: z.enum(['TEAMS_WEBHOOK', 'SLACK_WEBHOOK']),
  name: z.string().trim().min(2).max(120),
  url: z.string().trim().max(2000),
});

/** Integration registry. Secrets are write-only: they are encrypted on input and never returned. */
@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly delivery: DeliveryService,
    private readonly audit: AuditService,
    private readonly mail: MailClientFactory,
  ) {}

  @Get()
  @RequirePermissions('integrations:read')
  async list() {
    const items = await this.prisma.integration.findMany({
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
      select: {
        id: true, kind: true, name: true, mode: true, status: true, mailboxAddress: true, lastSyncAt: true, lastError: true,
        createdAt: true, updatedAt: true, config: true, owner: { select: { name: true } }, encryptedSecret: true,
        _count: { select: { bookingSources: true, conversations: true, reports: true } },
      },
    });
    return items.map(({ encryptedSecret, ...i }) => ({ ...i, hasSecret: Boolean(encryptedSecret) }));
  }

  @Get('status')
  @RequirePermissions('dashboard:read')
  async status() {
    const heartbeat = await this.prisma.systemSetting.findUnique({ where: { key: 'worker.heartbeat' } });
    const hb = heartbeat?.value as { at?: string; queues?: string[] } | undefined;
    const ageMs = hb?.at ? Date.now() - new Date(hb.at).getTime() : null;
    return {
      redisConfigured: Boolean(env().REDIS_URL),
      worker: { lastHeartbeat: hb?.at ?? null, healthy: ageMs !== null && ageMs < 3 * 60_000, queues: hb?.queues ?? [] },
      email: this.delivery.emailStatus(),
      oauth: { google: oauthConfigured('google'), microsoft: oauthConfigured('microsoft') },
    };
  }

  @Post('chat-webhooks')
  @RequirePermissions('integrations:manage')
  async addChat(@Body(new ZodPipe(chatSchema)) body: z.infer<typeof chatSchema>, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    let url: string;
    try {
      url = validateChatWebhookUrl(body.kind, body.url);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    return this.prisma.$transaction(async (tx) => {
      const i = await tx.integration.create({
        data: { kind: body.kind, name: body.name, mode: 'LIVE', status: 'NOT_CONFIGURED', encryptedSecret: this.crypto.encrypt(url), config: { host: new URL(url).hostname }, ownerUserId: user.id },
        select: { id: true, kind: true, name: true, mode: true, status: true },
      });
      await this.audit.log({ actorId: user.id, action: 'integration.created', entityType: 'integration', entityId: i.id, metadata: { kind: i.kind, name: i.name }, meta }, tx);
      return i;
    });
  }

  /** Sends a real test message; status becomes CONNECTED only if the remote accepted it. */
  @Post(':id/test')
  @HttpCode(200)
  @RequirePermissions('integrations:manage')
  async test(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    const i = await this.prisma.integration.findUnique({ where: { id } });
    if (!i) throw new NotFoundException();
    if (i.kind === 'GMAIL' || i.kind === 'MICROSOFT_GRAPH') {
      try {
        await this.mail.forIntegration(i).listRecentSent(1);
        await this.prisma.integration.update({ where: { id }, data: { status: 'CONNECTED', lastSyncAt: new Date(), lastError: null } });
        return { ok: true };
      } catch (err) {
        await this.prisma.integration.update({ where: { id }, data: { status: 'ERROR', lastError: (err as Error).message.slice(0, 500) } });
        throw new BadRequestException(`Mailbox test failed: ${(err as Error).message}`);
      }
    }
    if (i.kind !== 'TEAMS_WEBHOOK' && i.kind !== 'SLACK_WEBHOOK') throw new BadRequestException('This integration has no live test');
    if (!i.encryptedSecret) throw new BadRequestException('No webhook URL stored');
    try {
      await this.delivery.postChat(i.kind, this.crypto.decrypt(i.encryptedSecret), 'OPERAFlow test message', [`Sent by ${user.name}. Daily reports will be posted here.`], env().APP_BASE_URL);
      await this.prisma.integration.update({ where: { id }, data: { status: 'CONNECTED', lastSyncAt: new Date(), lastError: null } });
      return { ok: true };
    } catch (err) {
      await this.prisma.integration.update({ where: { id }, data: { status: 'ERROR', lastError: (err as Error).message.slice(0, 500) } });
      throw new BadRequestException(`Test failed: ${(err as Error).message}`);
    }
  }

  @Post(':id/disable')
  @HttpCode(200)
  @RequirePermissions('integrations:manage')
  async disable(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    const i = await this.prisma.integration.update({ where: { id }, data: { mode: 'DISABLED' }, select: { id: true, kind: true, mode: true } }).catch(() => null);
    if (!i) throw new NotFoundException();
    await this.audit.log({ actorId: user.id, action: 'integration.disabled', entityType: 'integration', entityId: id, metadata: { kind: i.kind }, meta });
    return i;
  }
}
