import {
  BadRequestException,
  ConflictException,
  Controller,
  Headers,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { createHmac } from 'node:crypto';
import { Prisma } from '@operaflow/db';
import { z } from 'zod';
import { env } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { Public, requestMeta, SkipOriginCheck } from '../common/auth-context';
import { CryptoService } from '../common/crypto.service';
import { isUniqueViolation } from '../common/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import { externalBookingSchema } from './external-booking';
import { IngestError, IngestService } from './ingest.service';

/** Envelope of a booking event. `booking` uses the canonical external booking fields (camelCase). */
const eventSchema = z.object({
  eventId: z.string().min(1).max(200),
  eventType: z.enum(['booking.created', 'booking.updated', 'booking.cancelled']),
  occurredAt: z.coerce.date(),
  booking: z.record(z.string(), z.unknown()),
});

@Controller('webhooks/bookings')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly ingest: IngestService,
    private readonly audit: AuditService,
  ) {}

  @Public()
  @SkipOriginCheck()
  @Post(':sourceCode')
  @HttpCode(200)
  async receive(
    @Param('sourceCode') sourceCode: string,
    @Headers('x-operaflow-timestamp') timestamp: string | undefined,
    @Headers('x-operaflow-signature') signature: string | undefined,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const meta = requestMeta(req);
    const source = await this.prisma.bookingSource.findUnique({ where: { code: sourceCode }, include: { integration: true } });
    if (!source || source.adapter !== 'WEBHOOK' || !source.isActive || !source.integration?.encryptedSecret || source.integration.mode !== 'LIVE') {
      throw new NotFoundException();
    }

    // 1. Authenticate: HMAC over "<timestamp>.<raw body>", with replay window.
    const raw = req.rawBody;
    const ts = Number(timestamp);
    const reject = async (reason: string) => {
      await this.audit.logSafe({ action: 'webhook.rejected', entityType: 'integration', entityId: source.integration!.id, metadata: { source: sourceCode, reason }, meta });
      throw new UnauthorizedException('Invalid signature');
    };
    if (!raw || !signature?.startsWith('sha256=') || !Number.isInteger(ts)) return reject('missing_headers');
    if (Math.abs(Date.now() / 1000 - ts) > env().WEBHOOK_TOLERANCE_SECONDS) return reject('timestamp_out_of_window');
    const secret = this.crypto.decrypt(source.integration.encryptedSecret);
    const expected = createHmac('sha256', secret).update(`${ts}.`).update(raw).digest('hex');
    if (!CryptoService.safeEqual(signature.slice(7), expected)) return reject('bad_signature');

    // 2. Validate envelope and booking payload.
    const event = eventSchema.safeParse(req.body);
    if (!event.success) throw new BadRequestException({ message: 'Invalid event envelope', issues: event.error.issues });
    const parsed = externalBookingSchema.safeParse({
      ...event.data.booking,
      externalUpdatedAt: event.data.booking.updatedAt ?? event.data.occurredAt,
      ...(event.data.eventType === 'booking.cancelled' && { status: 'CANCELLED' }),
    });
    if (!parsed.success) {
      throw new UnprocessableEntityException({
        message: 'Invalid booking payload',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }

    // 3. Idempotency: one JobExecution per (source, eventId). Failed events may be redelivered.
    const idempotencyKey = `webhook:${source.code}:${event.data.eventId}`;
    let job;
    try {
      job = await this.prisma.jobExecution.create({
        data: { queue: 'webhooks', jobName: event.data.eventType, idempotencyKey, status: 'RUNNING', attempts: 1, startedAt: new Date(), payload: { source: source.code, eventId: event.data.eventId, externalRef: parsed.data.externalRef } },
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const prior = await this.prisma.jobExecution.findUniqueOrThrow({ where: { idempotencyKey } });
      if (prior.status === 'SUCCEEDED') return { status: 'duplicate', result: prior.result };
      if (prior.status === 'RUNNING' && prior.startedAt && Date.now() - prior.startedAt.getTime() < 60_000) {
        throw new ConflictException('Event is being processed');
      }
      job = await this.prisma.jobExecution.update({
        where: { id: prior.id },
        data: { status: 'RUNNING', attempts: { increment: 1 }, startedAt: new Date(), error: null },
      });
    }

    // 4. Apply.
    try {
      const result = await this.prisma.$transaction((tx) => this.ingest.upsert(tx, source, parsed.data, 'WEBHOOK', null));
      await this.prisma.$transaction([
        this.prisma.jobExecution.update({
          where: { id: job.id },
          data: { status: 'SUCCEEDED', finishedAt: new Date(), result: result as unknown as Prisma.InputJsonValue },
        }),
        this.prisma.integration.update({
          where: { id: source.integration.id },
          data: { status: 'CONNECTED', lastSyncAt: new Date(), lastError: null },
        }),
      ]);
      return { status: 'processed', result };
    } catch (err) {
      const message = err instanceof IngestError ? err.message : 'Internal error while applying event';
      if (!(err instanceof IngestError)) this.logger.error(`webhook ${idempotencyKey} failed`, err as Error);
      await this.prisma.$transaction([
        this.prisma.jobExecution.update({ where: { id: job.id }, data: { status: 'FAILED', finishedAt: new Date(), error: message } }),
        this.prisma.integration.update({ where: { id: source.integration.id }, data: { lastError: message.slice(0, 500) } }),
      ]);
      if (err instanceof IngestError) throw new UnprocessableEntityException({ message, field: err.field });
      throw err;
    }
  }
}
