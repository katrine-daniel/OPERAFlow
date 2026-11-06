import { Injectable } from '@nestjs/common';
import { Prisma, type BookingSource, type ChangeOrigin } from '@operaflow/db';
import { bookingDedupeKey } from '@operaflow/shared';
import type { Tx } from '../common/prisma-errors';
import { dateOnly, diffBookings, toDateOnly } from './booking-view';
import { nextInternalRef, TRACKED_FIELDS } from './bookings.service';
import { REQUIRED_FOR_CREATE, type ExternalBooking } from './external-booking';

export class IngestError extends Error {
  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(message);
  }
}

export type IngestResult = { action: 'created' | 'updated' | 'unchanged' | 'stale'; bookingId: string; internalRef: string };

/**
 * The single write path for externally-sourced bookings (import, webhook, future API sync).
 * Upserts by (source, externalRef); only provided fields are written; stale events are ignored.
 */
@Injectable()
export class IngestService {
  async upsert(tx: Tx, source: BookingSource, ext: ExternalBooking, origin: ChangeOrigin, actorId: string | null): Promise<IngestResult> {
    const existing = await tx.booking.findUnique({ where: { sourceId_externalRef: { sourceId: source.id, externalRef: ext.externalRef } } });

    if (existing && existing.externalUpdatedAt && ext.externalUpdatedAt && ext.externalUpdatedAt <= existing.externalUpdatedAt) {
      return { action: 'stale', bookingId: existing.id, internalRef: existing.internalRef };
    }

    if (!existing) {
      const missing = REQUIRED_FOR_CREATE.filter((f) => ext[f] === undefined);
      if (missing.length) throw new IngestError(missing[0]!, `New booking is missing required field(s): ${missing.join(', ')}`);
    }

    const supplierId = ext.supplierCode ? await this.resolveSupplier(tx, ext.supplierCode) : undefined;
    const assignedToId = ext.assignedToEmail ? await this.resolveAssignee(tx, ext.assignedToEmail) : undefined;
    const hotelId =
      ext.hotelName && ext.hotelCity && ext.hotelCountry
        ? (
            await tx.hotel.upsert({
              where: { name_city_country: { name: ext.hotelName, city: ext.hotelCity, country: ext.hotelCountry } },
              update: {},
              create: { name: ext.hotelName, city: ext.hotelCity, country: ext.hotelCountry },
            })
          ).id
        : undefined;

    const fields: Record<string, unknown> = {
      leadGuestName: ext.leadGuestName,
      guestEmail: ext.guestEmail,
      guestPhone: ext.guestPhone,
      adults: ext.adults,
      children: ext.children,
      rooms: ext.rooms,
      roomType: ext.roomType,
      boardBasis: ext.boardBasis,
      bookingDate: ext.bookingDate,
      checkIn: ext.checkIn ? toDateOnly(ext.checkIn) : undefined,
      checkOut: ext.checkOut ? toDateOnly(ext.checkOut) : undefined,
      currency: ext.currency,
      sellingAmount: ext.sellingAmount ?? undefined,
      costAmount: ext.costAmount ?? undefined,
      taxAmount: ext.taxAmount ?? undefined,
      status: ext.status,
      paymentStatus: ext.paymentStatus,
      confirmationStatus: ext.confirmationStatus,
      cancellationStatus: ext.cancellationStatus ?? (ext.status === 'CANCELLED' ? 'CANCELLED' : undefined),
      confirmationNumber: ext.confirmationNumber,
      notes: ext.notes,
      supplierId,
      hotelId,
      assignedToId,
      externalUpdatedAt: ext.externalUpdatedAt,
    };
    const provided = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    const changeType = origin === 'IMPORT' ? 'IMPORTED' : 'SYNCED';

    if (!existing) {
      const checkIn = ext.checkIn!;
      const checkOut = ext.checkOut!;
      const booking = await tx.booking.create({
        data: {
          ...(provided as Omit<Prisma.BookingUncheckedCreateInput, 'internalRef' | 'sourceId' | 'channel'>),
          leadGuestName: ext.leadGuestName!,
          checkIn: toDateOnly(checkIn),
          checkOut: toDateOnly(checkOut),
          currency: ext.currency!,
          bookingDate: ext.bookingDate ?? new Date(),
          internalRef: await nextInternalRef(tx),
          externalRef: ext.externalRef,
          sourceId: source.id,
          channel: source.channel,
          dedupeKey: bookingDedupeKey(hotelId ?? null, ext.leadGuestName!, checkIn, checkOut),
          createdById: actorId,
        },
      });
      await tx.bookingChange.create({
        data: { bookingId: booking.id, changedById: actorId, changeType, origin, diff: { source: source.code, externalRef: ext.externalRef } },
      });
      return { action: 'created', bookingId: booking.id, internalRef: booking.internalRef };
    }

    // Merge to validate the resulting stay dates and recompute the duplicate fingerprint.
    const checkIn = ext.checkIn ?? dateOnly(existing.checkIn);
    const checkOut = ext.checkOut ?? dateOnly(existing.checkOut);
    if (checkOut <= checkIn) throw new IngestError('checkOut', 'Resulting check-out would not be after check-in');
    const dedupeKey = bookingDedupeKey(hotelId ?? existing.hotelId, ext.leadGuestName ?? existing.leadGuestName, checkIn, checkOut);

    const candidate: Record<string, unknown> = { ...existing, ...provided };
    for (const k of ['sellingAmount', 'costAmount', 'taxAmount']) {
      if (typeof candidate[k] === 'string') candidate[k] = new Prisma.Decimal(candidate[k] as string);
    }
    const diff = diffBookings(existing, candidate, TRACKED_FIELDS);
    if (Object.keys(diff).length === 0) {
      // Nothing material changed: don't bump the version (would break staff edits in progress).
      if (ext.externalUpdatedAt) await tx.booking.update({ where: { id: existing.id }, data: { externalUpdatedAt: ext.externalUpdatedAt } });
      return { action: 'unchanged', bookingId: existing.id, internalRef: existing.internalRef };
    }
    const after = await tx.booking.update({
      where: { id: existing.id },
      data: { ...(provided as Prisma.BookingUncheckedUpdateInput), dedupeKey, version: { increment: 1 } },
    });
    await tx.bookingChange.create({
      data: {
        bookingId: existing.id,
        changedById: actorId,
        changeType: diff.status && after.status === 'CANCELLED' ? 'CANCELLED' : changeType,
        origin,
        diff: diff as Prisma.InputJsonValue,
      },
    });
    return { action: 'updated', bookingId: existing.id, internalRef: existing.internalRef };
  }

  private async resolveSupplier(tx: Tx, code: string): Promise<string> {
    const s = await tx.supplier.findUnique({ where: { code }, select: { id: true, isActive: true } });
    if (!s || !s.isActive) throw new IngestError('supplierCode', `Unknown or inactive supplier code "${code}"`);
    return s.id;
  }

  private async resolveAssignee(tx: Tx, email: string): Promise<string> {
    const u = await tx.user.findFirst({ where: { email, isActive: true, role: { in: ['ADMIN', 'OPS_MANAGER', 'OPS_STAFF'] } }, select: { id: true } });
    if (!u) throw new IngestError('assignedToEmail', `No active operations user with email ${email}`);
    return u.id;
  }
}
