import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@operaflow/db';
import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { env } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser, RequestMeta } from '../common/auth-context';
import { externalBookingSchema, mapHeader, type ExternalBooking } from './external-booking';
import { IngestError, IngestService } from './ingest.service';

export interface RowError {
  row: number;
  field: string;
  message: string;
}

type RawRow = { row: number; values: Record<string, unknown> };

@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ingest: IngestService,
    private readonly audit: AuditService,
  ) {}

  private async readRows(buf: Buffer, fileName: string): Promise<{ rows: RawRow[]; unmapped: string[] }> {
    const isXlsx = buf[0] === 0x50 && buf[1] === 0x4b;
    let headers: string[];
    let body: unknown[][];

    if (isXlsx) {
      if (!/\.xlsx$/i.test(fileName)) throw new BadRequestException('Excel files must be .xlsx');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
      const ws = wb.worksheets[0];
      if (!ws) throw new BadRequestException('The workbook has no sheets');
      const matrix: unknown[][] = [];
      ws.eachRow({ includeEmpty: false }, (r) => {
        const vals = (r.values as unknown[]).slice(1).map((v) => {
          if (v && typeof v === 'object' && 'result' in (v as object)) return (v as { result: unknown }).result; // formula
          if (v && typeof v === 'object' && 'text' in (v as object)) return (v as { text: unknown }).text; // hyperlink / rich text
          return v;
        });
        matrix.push(vals);
      });
      headers = (matrix[0] ?? []).map((h) => String(h ?? '').trim());
      body = matrix.slice(1);
    } else {
      if (buf.subarray(0, 8192).includes(0)) throw new BadRequestException('Upload a CSV (UTF-8) or .xlsx file');
      let records: string[][];
      try {
        records = parseCsv(buf, { bom: true, skip_empty_lines: true, relax_column_count: true, trim: true });
      } catch (err) {
        throw new BadRequestException(`Could not read CSV: ${(err as Error).message}`);
      }
      headers = (records[0] ?? []).map((h) => h.trim());
      body = records.slice(1);
    }

    if (headers.length === 0) throw new BadRequestException('The file is empty');
    const mapped = headers.map(mapHeader);
    if (!mapped.includes('externalRef')) throw new BadRequestException('Missing required column: external_ref');
    if (body.length > env().MAX_IMPORT_ROWS) throw new BadRequestException(`Too many rows (max ${env().MAX_IMPORT_ROWS})`);

    const rows: RawRow[] = body
      .map((cells, i) => {
        const values: Record<string, unknown> = {};
        mapped.forEach((field, c) => {
          if (field) values[field] = cells[c] ?? undefined;
        });
        return { row: i + 2, values };
      })
      .filter((r) => Object.values(r.values).some((v) => v !== undefined && v !== null && String(v).trim() !== ''));
    return { rows, unmapped: headers.filter((_, i) => !mapped[i]) };
  }

  async preview(file: Express.Multer.File, sourceId: string, actor: AuthUser, meta: RequestMeta) {
    const source = await this.prisma.bookingSource.findUnique({ where: { id: sourceId } });
    if (!source || !source.isActive) throw new BadRequestException('Unknown or inactive booking source');
    if (source.adapter !== 'CSV_IMPORT' && source.adapter !== 'MANUAL') {
      throw new BadRequestException(`${source.name} is fed by its integration and does not accept file imports`);
    }
    const fileSha256 = createHash('sha256').update(file.buffer).digest('hex');
    const already = await this.prisma.bookingImport.findFirst({ where: { sourceId, fileSha256, status: 'COMMITTED' } });
    if (already) throw new ConflictException(`This exact file was already imported for ${source.name} on ${already.completedAt?.toISOString().slice(0, 10)}`);

    const { rows, unmapped } = await this.readRows(file.buffer, file.originalname);
    const errors: RowError[] = [];
    const valid: { row: number; data: ExternalBooking }[] = [];
    const seenRefs = new Map<string, number>();

    for (const r of rows) {
      const parsed = externalBookingSchema.safeParse(r.values);
      if (!parsed.success) {
        for (const i of parsed.error.issues) errors.push({ row: r.row, field: String(i.path[0] ?? ''), message: i.message });
        continue;
      }
      const prev = seenRefs.get(parsed.data.externalRef);
      if (prev) {
        errors.push({ row: r.row, field: 'externalRef', message: `Duplicate external_ref in file (also row ${prev})` });
        continue;
      }
      seenRefs.set(parsed.data.externalRef, r.row);
      valid.push({ row: r.row, data: parsed.data });
    }

    // Reference checks in bulk.
    const codes = [...new Set(valid.map((v) => v.data.supplierCode).filter(Boolean))] as string[];
    const emails = [...new Set(valid.map((v) => v.data.assignedToEmail).filter(Boolean))] as string[];
    const [suppliers, users, existing] = await Promise.all([
      this.prisma.supplier.findMany({ where: { code: { in: codes }, isActive: true }, select: { code: true } }),
      this.prisma.user.findMany({ where: { email: { in: emails }, isActive: true, role: { in: ['ADMIN', 'OPS_MANAGER', 'OPS_STAFF'] } }, select: { email: true } }),
      this.prisma.booking.findMany({ where: { sourceId, externalRef: { in: valid.map((v) => v.data.externalRef) } }, select: { externalRef: true } }),
    ]);
    const knownCodes = new Set(suppliers.map((s) => s.code));
    const knownEmails = new Set(users.map((u) => u.email));
    const existingRefs = new Set(existing.map((e) => e.externalRef));

    const ready: { row: number; data: ExternalBooking }[] = [];
    let wouldCreate = 0;
    let wouldUpdate = 0;
    for (const v of valid) {
      const rowErrors: RowError[] = [];
      if (v.data.supplierCode && !knownCodes.has(v.data.supplierCode)) rowErrors.push({ row: v.row, field: 'supplierCode', message: `Unknown supplier code "${v.data.supplierCode}"` });
      if (v.data.assignedToEmail && !knownEmails.has(v.data.assignedToEmail)) rowErrors.push({ row: v.row, field: 'assignedToEmail', message: `No active operations user ${v.data.assignedToEmail}` });
      const isNew = !existingRefs.has(v.data.externalRef);
      if (isNew) {
        for (const f of ['leadGuestName', 'checkIn', 'checkOut', 'currency'] as const) {
          if (v.data[f] === undefined) rowErrors.push({ row: v.row, field: f, message: 'Required for a new booking' });
        }
      }
      if (rowErrors.length) {
        errors.push(...rowErrors);
        continue;
      }
      if (isNew) wouldCreate++;
      else wouldUpdate++;
      ready.push(v);
    }

    const errorRowCount = new Set(errors.map((e) => e.row)).size;
    const imp = await this.prisma.bookingImport.create({
      data: {
        sourceId,
        fileName: file.originalname.slice(0, 200),
        fileSha256,
        status: ready.length ? 'READY' : 'FAILED',
        totalRows: rows.length,
        errorRows: errorRowCount,
        errors: errors.slice(0, 1000) as unknown as Prisma.InputJsonValue,
        rows: ready as unknown as Prisma.InputJsonValue,
        uploadedById: actor.id,
      },
    });
    await this.audit.log({
      actorId: actor.id,
      action: 'booking_import.previewed',
      entityType: 'booking_import',
      entityId: imp.id,
      metadata: { source: source.code, totalRows: rows.length, errorRows: errorRowCount },
      meta,
    });
    return {
      id: imp.id,
      status: imp.status,
      source: { id: source.id, name: source.name },
      totalRows: rows.length,
      readyRows: ready.length,
      errorRows: errorRowCount,
      wouldCreate,
      wouldUpdate,
      unmappedColumns: unmapped,
      errors: errors.slice(0, 1000),
    };
  }

  async commit(id: string, skipInvalid: boolean, actor: AuthUser, meta: RequestMeta) {
    const imp = await this.prisma.bookingImport.findUnique({ where: { id }, include: { source: true } });
    if (!imp) throw new NotFoundException();
    if (imp.status !== 'READY') throw new ConflictException(`Import is ${imp.status.toLowerCase()} and cannot be committed`);
    if (imp.errorRows > 0 && !skipInvalid) {
      throw new BadRequestException(`${imp.errorRows} row(s) have errors. Fix the file, or confirm to import only the valid rows.`);
    }
    const rows = (imp.rows ?? []) as unknown as { row: number; data: ExternalBooking }[];

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // Claim the import atomically: a concurrent second commit finds nothing to claim.
          const claimed = await tx.bookingImport.updateMany({ where: { id, status: 'READY' }, data: { status: 'COMMITTED' } });
          if (claimed.count === 0) throw new ConflictException('Import was already committed');

          const counts = { created: 0, updated: 0, unchanged: 0, stale: 0 };
          for (const r of rows) {
            // JSON round-trip turned dates into strings; re-validate to restore types.
            const data = externalBookingSchema.parse(r.data);
            try {
              const res = await this.ingest.upsert(tx, imp.source, data, 'IMPORT', actor.id);
              counts[res.action]++;
            } catch (err) {
              if (err instanceof IngestError) throw new BadRequestException(`Row ${r.row}: ${err.message}. Nothing was imported.`);
              throw err;
            }
          }
          await tx.bookingImport.update({
            where: { id },
            data: {
              createdRows: counts.created,
              updatedRows: counts.updated,
              skippedRows: counts.unchanged + counts.stale + imp.errorRows,
              rows: Prisma.DbNull,
              completedAt: new Date(),
            },
          });
          await this.audit.log(
            { actorId: actor.id, action: 'booking_import.committed', entityType: 'booking_import', entityId: id, metadata: { source: imp.source.code, ...counts, skippedInvalid: imp.errorRows }, meta },
            tx,
          );
          return { id, status: 'COMMITTED', ...counts, skippedInvalid: imp.errorRows };
        },
        { timeout: 120_000, maxWait: 10_000 },
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Another import created some of these bookings at the same time. Re-upload the file to preview again.');
      }
      throw err;
    }
  }

  list() {
    return this.prisma.bookingImport.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true, fileName: true, status: true, totalRows: true, createdRows: true, updatedRows: true, skippedRows: true, errorRows: true,
        createdAt: true, completedAt: true, source: { select: { name: true } }, uploadedBy: { select: { name: true } },
      },
    });
  }

  async get(id: string) {
    const imp = await this.prisma.bookingImport.findUnique({
      where: { id },
      select: {
        id: true, fileName: true, status: true, totalRows: true, createdRows: true, updatedRows: true, skippedRows: true, errorRows: true,
        errors: true, createdAt: true, completedAt: true, source: { select: { id: true, name: true } },
      },
    });
    if (!imp) throw new NotFoundException();
    return imp;
  }
}
