import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { createHash } from 'node:crypto';
import {
  bookingQuerySchema,
  cancelBookingSchema,
  confirmBookingSchema,
  createBookingSchema,
  updateBookingSchema,
  type BookingQuery,
  type CreateBookingInput,
  type UpdateBookingInput,
} from '@operaflow/shared';
import type { z } from 'zod';
import { env } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, ReqMeta, RequestMeta, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { BookingsService } from './bookings.service';
import { safeFileName, sniffDocumentType, StorageService } from './storage.service';

const uploadLimit = () => ({ limits: { fileSize: env().MAX_UPLOAD_MB * 1024 * 1024, files: 1 } });

@Controller('bookings')
export class BookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('bookings:read')
  list(@Query(new ZodPipe(bookingQuerySchema)) q: BookingQuery, @CurrentUser() user: AuthUser) {
    return this.bookings.list(q, user);
  }

  @Get(':id')
  @RequirePermissions('bookings:read')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.bookings.get(id, user);
  }

  @Post()
  @RequirePermissions('bookings:write')
  create(@Body(new ZodPipe(createBookingSchema)) body: CreateBookingInput, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.bookings.create(body, user, meta);
  }

  @Patch(':id')
  @RequirePermissions('bookings:write')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateBookingSchema)) body: UpdateBookingInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.bookings.update(id, body, user, meta);
  }

  @Post(':id/cancel')
  @RequirePermissions('bookings:write')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(cancelBookingSchema)) body: z.infer<typeof cancelBookingSchema>,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.bookings.cancel(id, body, user, meta);
  }

  @Post(':id/confirm')
  @RequirePermissions('bookings:write')
  confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(confirmBookingSchema)) body: z.infer<typeof confirmBookingSchema>,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.bookings.confirm(id, body, user, meta);
  }

  // ── Supporting documents ──

  @Post(':id/documents')
  @RequirePermissions('bookings:write')
  @UseInterceptors(FileInterceptor('file', uploadLimit()))
  async upload(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    if (!file || file.size === 0) throw new BadRequestException('Attach a file in the "file" field');
    if (!(await this.prisma.booking.count({ where: { id } }))) throw new NotFoundException();
    const fileName = safeFileName(file.originalname);
    const mimeType = sniffDocumentType(file.buffer, fileName);
    if (!mimeType) throw new UnsupportedMediaTypeException('Allowed: PDF, PNG, JPEG, WEBP, XLSX, DOCX, CSV, TXT, EML');

    const storageKey = await this.storage.save('bookings', file.buffer);
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    return this.prisma.$transaction(async (tx) => {
      const doc = await tx.bookingDocument.create({
        data: { bookingId: id, fileName, mimeType, sizeBytes: file.size, storageKey, sha256, uploadedById: user.id },
        select: { id: true, fileName: true, mimeType: true, sizeBytes: true, sha256: true, createdAt: true },
      });
      await tx.bookingChange.create({
        data: { bookingId: id, changedById: user.id, changeType: 'DOCUMENT_ADDED', origin: 'UI', diff: { document: fileName, sizeBytes: file.size } },
      });
      await this.audit.log(
        { actorId: user.id, action: 'booking.document_added', entityType: 'booking', entityId: id, metadata: { documentId: doc.id, mimeType }, meta },
        tx,
      );
      return doc;
    });
  }

  @Get(':id/documents/:docId')
  @RequirePermissions('bookings:read')
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
    @Res() res: Response,
  ) {
    const doc = await this.prisma.bookingDocument.findFirst({ where: { id: docId, bookingId: id } });
    if (!doc) throw new NotFoundException();
    await this.audit.log({ actorId: user.id, action: 'booking.document_downloaded', entityType: 'booking', entityId: id, metadata: { documentId: doc.id }, meta });
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Length', String(doc.sizeBytes));
    res.setHeader('Content-Disposition', `attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    this.storage.stream(doc.storageKey).on('error', () => res.destroy()).pipe(res);
  }
}
