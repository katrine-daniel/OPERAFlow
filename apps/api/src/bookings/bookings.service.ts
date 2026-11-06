import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Booking } from '@operaflow/db';
import {
  bookingDedupeKey,
  hasPermission,
  zonedDayRange,
  zonedTimeToUtc,
  type BookingQuery,
  type CreateBookingInput,
  type UpdateBookingInput,
} from '@operaflow/shared';
import { env } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { isUniqueViolation, type Tx } from '../common/prisma-errors';
import type { AuthUser, RequestMeta } from '../common/auth-context';
import { dateOnly, diffBookings, missingDataWhere, serializeBooking, toDateOnly } from './booking-view';

/** Fields owned by the online source system; staff may not overwrite them on ONLINE bookings. */
const SOURCE_OWNED_ONLINE = new Set([
  'externalRef', 'leadGuestName', 'guestEmail', 'guestPhone', 'adults', 'children', 'rooms', 'roomType', 'boardBasis',
  'bookingDate', 'checkIn', 'checkOut', 'currency', 'sellingAmount', 'taxAmount', 'status', 'cancellationStatus', 'hotelId',
]);

export const TRACKED_FIELDS = [
  'externalRef', 'supplierId', 'hotelId', 'leadGuestName', 'guestEmail', 'guestPhone', 'adults', 'children', 'rooms', 'roomType',
  'boardBasis', 'bookingDate', 'checkIn', 'checkOut', 'currency', 'sellingAmount', 'costAmount', 'taxAmount', 'status',
  'paymentStatus', 'confirmationStatus', 'cancellationStatus', 'confirmationNumber', 'assignedToId', 'notes',
];

export const bookingListInclude = {
  source: { select: { id: true, code: true, name: true, channel: true, adapter: true } },
  supplier: { select: { id: true, code: true, name: true } },
  hotel: { select: { id: true, name: true, city: true, country: true } },
  assignedTo: { select: { id: true, name: true } },
} satisfies Prisma.BookingInclude;

export async function nextInternalRef(tx: Tx | PrismaService): Promise<string> {
  const [row] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('booking_ref_seq') AS n`;
  return `OF-${new Date().getUTCFullYear()}-${String(row!.n).padStart(6, '0')}`;
}

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(q: BookingQuery, user: AuthUser) {
    const tz = env().DEFAULT_TIMEZONE;
    const and: Prisma.BookingWhereInput[] = [];
    if (q.q) {
      and.push({
        OR: [
          { internalRef: { contains: q.q, mode: 'insensitive' } },
          { externalRef: { contains: q.q, mode: 'insensitive' } },
          { confirmationNumber: { contains: q.q, mode: 'insensitive' } },
          { leadGuestName: { contains: q.q, mode: 'insensitive' } },
          { hotel: { name: { contains: q.q, mode: 'insensitive' } } },
        ],
      });
    }
    if (q.from || q.to) {
      if (q.dateField === 'checkIn') {
        and.push({ checkIn: { ...(q.from && { gte: toDateOnly(q.from) }), ...(q.to && { lte: toDateOnly(q.to) }) } });
      } else {
        // bookingDate is an instant; interpret the day boundaries in the organisation timezone.
        const from = q.from ? zonedDayRange(tz, zonedTimeToUtc(+q.from.slice(0, 4), +q.from.slice(5, 7), +q.from.slice(8, 10), 12, 0, tz)).start : undefined;
        const to = q.to ? zonedDayRange(tz, zonedTimeToUtc(+q.to.slice(0, 4), +q.to.slice(5, 7), +q.to.slice(8, 10), 12, 0, tz)).end : undefined;
        and.push({ bookingDate: { ...(from && { gte: from }), ...(to && { lt: to }) } });
      }
    }
    if (q.missingData) and.push(missingDataWhere);
    const where: Prisma.BookingWhereInput = {
      AND: and,
      ...(q.channel && { channel: q.channel }),
      ...(q.sourceId && { sourceId: q.sourceId }),
      ...(q.supplierId && { supplierId: q.supplierId }),
      ...(q.assignedToId && { assignedToId: q.assignedToId }),
      ...(q.status && { status: q.status }),
      ...(q.confirmationStatus && { confirmationStatus: q.confirmationStatus }),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.booking.count({ where }),
      this.prisma.booking.findMany({
        where,
        include: bookingListInclude,
        orderBy: [{ bookingDate: 'desc' }, { internalRef: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    const pii = hasPermission(user.role, 'bookings:view-pii');
    return { total, page: q.page, pageSize: q.pageSize, items: rows.map((b) => serializeBooking(b, pii)) };
  }

  async get(id: string, user: AuthUser) {
    const b = await this.prisma.booking.findUnique({
      where: { id },
      include: {
        ...bookingListInclude,
        createdBy: { select: { id: true, name: true } },
        changes: { orderBy: { createdAt: 'desc' }, take: 200, include: { changedBy: { select: { name: true } } } },
        documents: { orderBy: { createdAt: 'desc' }, include: { uploadedBy: { select: { name: true } } } },
        reconciliationIssues: { where: { status: 'OPEN' } },
        matchedIssues: { where: { status: 'OPEN' } },
      },
    });
    if (!b) throw new NotFoundException();
    return serializeBooking(b, hasPermission(user.role, 'bookings:view-pii'));
  }

  private async assertReferences(tx: Tx, input: { supplierId?: string | null; hotelId?: string | null; assignedToId?: string | null }) {
    if (input.supplierId && !(await tx.supplier.count({ where: { id: input.supplierId, isActive: true } })))
      throw new BadRequestException('Supplier not found or inactive');
    if (input.hotelId && !(await tx.hotel.count({ where: { id: input.hotelId } }))) throw new BadRequestException('Hotel not found');
    if (
      input.assignedToId &&
      !(await tx.user.count({ where: { id: input.assignedToId, isActive: true, role: { in: ['ADMIN', 'OPS_MANAGER', 'OPS_STAFF'] } } }))
    )
      throw new BadRequestException('Assignee not found or cannot own bookings');
  }

  async findDuplicates(dedupeKey: string | null, excludeId?: string) {
    if (!dedupeKey) return [];
    return this.prisma.booking.findMany({
      where: { dedupeKey, status: { notIn: ['CANCELLED', 'FAILED'] }, ...(excludeId && { id: { not: excludeId } }) },
      select: { id: true, internalRef: true, externalRef: true, channel: true, status: true, source: { select: { name: true } } },
      take: 10,
    });
  }

  async create(input: CreateBookingInput, actor: AuthUser, meta: RequestMeta) {
    const source = await this.prisma.bookingSource.findUnique({ where: { id: input.sourceId } });
    if (!source || !source.isActive) throw new BadRequestException('Unknown or inactive booking source');
    if (source.adapter !== 'MANUAL') {
      throw new BadRequestException(`${source.name} bookings arrive through its integration or file import and cannot be entered by hand`);
    }

    const dedupeKey = bookingDedupeKey(input.hotelId ?? null, input.leadGuestName, input.checkIn, input.checkOut);
    const duplicates = await this.findDuplicates(dedupeKey);
    if (duplicates.length && !input.confirmDuplicate) {
      throw new ConflictException({
        code: 'DUPLICATE_SUSPECTED',
        message: 'A booking for the same guest, hotel and dates already exists. Review it, then confirm to save anyway.',
        duplicates,
      });
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.assertReferences(tx, input);
        const { confirmDuplicate: _c, sourceId, ...fields } = input;
        const booking = await tx.booking.create({
          data: {
            ...fields,
            internalRef: await nextInternalRef(tx),
            sourceId,
            channel: source.channel,
            bookingDate: fields.bookingDate ?? new Date(),
            checkIn: toDateOnly(fields.checkIn),
            checkOut: toDateOnly(fields.checkOut),
            dedupeKey,
            createdById: actor.id,
          },
        });
        await tx.bookingChange.create({
          data: {
            bookingId: booking.id,
            changedById: actor.id,
            changeType: 'CREATED',
            origin: 'UI',
            diff: { source: source.code, ...(duplicates.length && { duplicateAcknowledged: duplicates.map((d) => d.internalRef) }) },
          },
        });
        await this.audit.log(
          {
            actorId: actor.id,
            action: 'booking.created',
            entityType: 'booking',
            entityId: booking.id,
            metadata: { internalRef: booking.internalRef, source: source.code, duplicateAcknowledged: duplicates.length > 0 },
            meta,
          },
          tx,
        );
        return booking;
      });
    } catch (err) {
      if (isUniqueViolation(err, 'external_ref')) throw new ConflictException('This supplier reference already exists for the selected source');
      throw err;
    }
  }

  async update(id: string, input: UpdateBookingInput, actor: AuthUser, meta: RequestMeta) {
    const before = await this.prisma.booking.findUnique({ where: { id } });
    if (!before) throw new NotFoundException();
    const { version, ...changes } = input;
    const keys = (Object.keys(changes) as (keyof typeof changes)[]).filter((k) => changes[k] !== undefined);

    if (before.version !== version) throw new ConflictException('This booking was changed by someone else. Reload and try again.');
    if (changes.status === 'CANCELLED' && before.status !== 'CANCELLED') throw new BadRequestException('Use the cancel action to cancel a booking');
    if (before.status === 'CANCELLED') {
      const allowed = new Set(['notes', 'paymentStatus', 'cancellationStatus', 'assignedToId', 'costAmount', 'supplierId']);
      const blocked = keys.filter((k) => !allowed.has(k));
      if (blocked.length) throw new BadRequestException(`Cancelled bookings only allow changes to: ${[...allowed].join(', ')}`);
    }
    if (before.channel === 'ONLINE') {
      const blocked = keys.filter((k) => SOURCE_OWNED_ONLINE.has(k));
      if (blocked.length) throw new BadRequestException(`These fields are maintained by the online source: ${blocked.join(', ')}`);
    }

    const checkIn = changes.checkIn ?? dateOnly(before.checkIn);
    const checkOut = changes.checkOut ?? dateOnly(before.checkOut);
    if (checkOut <= checkIn) throw new BadRequestException('Check-out must be after check-in');

    const data: Prisma.BookingUncheckedUpdateManyInput = {};
    for (const k of keys) (data as Record<string, unknown>)[k] = changes[k];
    if (changes.checkIn) data.checkIn = toDateOnly(changes.checkIn);
    if (changes.checkOut) data.checkOut = toDateOnly(changes.checkOut);
    if (keys.some((k) => ['hotelId', 'leadGuestName', 'checkIn', 'checkOut'].includes(k))) {
      data.dedupeKey = bookingDedupeKey(
        changes.hotelId !== undefined ? changes.hotelId : before.hotelId,
        changes.leadGuestName ?? before.leadGuestName,
        checkIn,
        checkOut,
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.assertReferences(tx, changes);
        const res = await tx.booking.updateMany({ where: { id, version }, data: { ...data, version: { increment: 1 } } });
        if (res.count === 0) throw new ConflictException('This booking was changed by someone else. Reload and try again.');
        const after = await tx.booking.findUniqueOrThrow({ where: { id } });
        const diff = diffBookings(before, after, TRACKED_FIELDS);
        if (Object.keys(diff).length) {
          const statusOnly = Object.keys(diff).every((k) => k.endsWith('tatus'));
          await tx.bookingChange.create({
            data: { bookingId: id, changedById: actor.id, changeType: statusOnly ? 'STATUS_CHANGED' : 'UPDATED', origin: 'UI', diff: diff as Prisma.InputJsonValue },
          });
          await this.audit.log(
            { actorId: actor.id, action: 'booking.updated', entityType: 'booking', entityId: id, metadata: { fields: Object.keys(diff) }, meta },
            tx,
          );
        }
        return after;
      });
    } catch (err) {
      if (isUniqueViolation(err, 'external_ref')) throw new ConflictException('This supplier reference already exists for the selected source');
      throw err;
    }
  }

  private async transition(
    id: string,
    version: number,
    actor: AuthUser,
    meta: RequestMeta,
    build: (b: Booking) => { data: Prisma.BookingUpdateManyMutationInput; changeType: 'CANCELLED' | 'STATUS_CHANGED'; extra?: Record<string, unknown>; action: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.booking.findUnique({ where: { id } });
      if (!before) throw new NotFoundException();
      const { data, changeType, extra, action } = build(before);
      const res = await tx.booking.updateMany({ where: { id, version }, data: { ...data, version: { increment: 1 } } });
      if (res.count === 0) throw new ConflictException('This booking was changed by someone else. Reload and try again.');
      const after = await tx.booking.findUniqueOrThrow({ where: { id } });
      const diff = { ...diffBookings(before, after, TRACKED_FIELDS), ...extra };
      await tx.bookingChange.create({ data: { bookingId: id, changedById: actor.id, changeType, origin: 'UI', diff: diff as Prisma.InputJsonValue } });
      await this.audit.log({ actorId: actor.id, action, entityType: 'booking', entityId: id, metadata: extra, meta }, tx);
      return after;
    });
  }

  cancel(id: string, input: { version: number; withFee: boolean; reason: string }, actor: AuthUser, meta: RequestMeta) {
    return this.transition(id, input.version, actor, meta, (b) => {
      if (b.status === 'CANCELLED') throw new BadRequestException('Booking is already cancelled');
      if (b.channel === 'ONLINE') throw new BadRequestException('Online bookings are cancelled at the source; the cancellation syncs automatically');
      return {
        data: { status: 'CANCELLED', cancellationStatus: input.withFee ? 'CANCELLED_WITH_FEE' : 'CANCELLED' },
        changeType: 'CANCELLED',
        extra: { reason: input.reason },
        action: 'booking.cancelled',
      };
    });
  }

  confirm(id: string, input: { version: number; confirmationNumber: string }, actor: AuthUser, meta: RequestMeta) {
    return this.transition(id, input.version, actor, meta, (b) => {
      if (b.status === 'CANCELLED' || b.status === 'FAILED') throw new BadRequestException('Cancelled or failed bookings cannot be confirmed');
      return {
        data: {
          confirmationStatus: 'CONFIRMED',
          confirmationNumber: input.confirmationNumber,
          ...((b.status === 'PENDING' || b.status === 'ON_REQUEST') && { status: 'CONFIRMED' as const }),
        },
        changeType: 'STATUS_CHANGED',
        action: 'booking.confirmed',
      };
    });
  }
}
