import { BadRequestException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, ReqMeta, RequestMeta, RequirePermissions } from '../common/auth-context';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../prisma/prisma.service';

/** How each adapter actually works today — shown verbatim in the UI so nothing looks more automated than it is. */
const ADAPTER_NOTES: Record<string, string> = {
  API: 'Polling sync requires the booking website vendor API specification and credentials. Not configured; no data is pulled.',
  WEBHOOK: 'Receives signed booking events at the webhook endpoint once a signing secret is issued and shared with the sender.',
  CSV_IMPORT: 'Bookings arrive through validated CSV/Excel imports of an approved export.',
  MANUAL: 'Bookings are entered by staff through the offline booking form or CSV/Excel import. No live API.',
};

@Controller('booking-sources')
export class SourcesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('bookings:read')
  async list() {
    const sources = await this.prisma.bookingSource.findMany({
      orderBy: [{ channel: 'asc' }, { name: 'asc' }],
      include: {
        integration: { select: { id: true, mode: true, status: true, lastSyncAt: true, lastError: true } },
        _count: { select: { bookings: true } },
      },
    });
    return sources.map((s) => ({
      ...s,
      adapterNote: ADAPTER_NOTES[s.adapter],
      webhookPath: s.adapter === 'WEBHOOK' ? `/api/webhooks/bookings/${s.code}` : null,
      acceptsManualEntry: s.adapter === 'MANUAL',
      acceptsImport: s.adapter === 'MANUAL' || s.adapter === 'CSV_IMPORT',
    }));
  }

  /**
   * Issues (or rotates) the HMAC signing secret for a webhook source. The secret is returned exactly once;
   * only its encrypted form is stored. Rotating invalidates the previous secret immediately.
   */
  @Post(':id/webhook-secret')
  @RequirePermissions('integrations:manage')
  async rotateWebhookSecret(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser, @ReqMeta() meta: RequestMeta) {
    const source = await this.prisma.bookingSource.findUnique({ where: { id } });
    if (!source) throw new NotFoundException();
    if (source.adapter !== 'WEBHOOK') throw new BadRequestException('Only webhook sources use a signing secret');

    const secret = `whsec_${CryptoService.randomToken(32)}`;
    const encryptedSecret = this.crypto.encrypt(secret);

    await this.prisma.$transaction(async (tx) => {
      const integration = source.integrationId
        ? await tx.integration.update({ where: { id: source.integrationId }, data: { encryptedSecret, mode: 'LIVE', lastError: null } })
        : await tx.integration.create({
            data: {
              kind: 'BOOKING_WEBHOOK',
              name: `${source.name}`,
              mode: 'LIVE',
              status: 'NOT_CONFIGURED', // becomes CONNECTED after the first verified delivery
              encryptedSecret,
              config: { sourceCode: source.code },
              ownerUserId: actor.id,
            },
          });
      if (!source.integrationId) await tx.bookingSource.update({ where: { id }, data: { integrationId: integration.id } });
      await this.audit.log(
        { actorId: actor.id, action: 'integration.webhook_secret_rotated', entityType: 'integration', entityId: integration.id, metadata: { source: source.code }, meta },
        tx,
      );
    });

    return {
      secret,
      endpointPath: `/api/webhooks/bookings/${source.code}`,
      signature: {
        headers: ['X-OperaFlow-Timestamp: <unix seconds>', 'X-OperaFlow-Signature: sha256=<hex>'],
        algorithm: 'HMAC-SHA256 over "<timestamp>.<raw request body>" using the secret',
      },
      note: 'Store this secret in the sender now. It cannot be shown again.',
    };
  }
}
