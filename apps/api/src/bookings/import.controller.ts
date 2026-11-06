import { BadRequestException, Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { env } from '../config/env';
import { AuthUser, CurrentUser, ReqMeta, RequestMeta, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { TEMPLATE_HEADERS } from './external-booking';
import { ImportService } from './import.service';

const previewBody = z.object({ sourceId: z.string().uuid('Choose a booking source') });
const commitBody = z.object({ skipInvalid: z.boolean().default(false) });

@Controller('booking-imports')
export class ImportController {
  constructor(private readonly imports: ImportService) {}

  @Get()
  @RequirePermissions('bookings:import')
  list() {
    return this.imports.list();
  }

  @Get('template.csv')
  @RequirePermissions('bookings:import')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="operaflow-booking-import-template.csv"')
  template() {
    const example = [
      'TBO-883421', '2026-11-05', 'Jane Doe', 'jane@example.com', '+971500000000', 'Example Marina Hotel', 'Dubai', 'AE',
      '', '2026-12-01', '2026-12-04', '2', '0', '1', 'Deluxe King', 'BB', 'AED', '2450.00', '1980.00', '120.00',
      'CONFIRMED', 'PAID', 'CONFIRMED', 'HTL-55102', '', 'Example row — delete before importing',
    ];
    return `${TEMPLATE_HEADERS.join(',')}\r\n${example.map((v) => (/[,"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',')}\r\n`;
  }

  @Get(':id')
  @RequirePermissions('bookings:import')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.imports.get(id);
  }

  @Post()
  @RequirePermissions('bookings:import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: env().MAX_UPLOAD_MB * 1024 * 1024, files: 1 } }))
  preview(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodPipe(previewBody)) body: z.infer<typeof previewBody>,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    if (!file || file.size === 0) throw new BadRequestException('Attach a CSV or .xlsx file in the "file" field');
    return this.imports.preview(file, body.sourceId, user, meta);
  }

  @Post(':id/commit')
  @RequirePermissions('bookings:import')
  commit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(commitBody)) body: z.infer<typeof commitBody>,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.imports.commit(id, body.skipInvalid, user, meta);
  }
}
