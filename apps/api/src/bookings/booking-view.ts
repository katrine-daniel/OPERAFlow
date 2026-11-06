import { Prisma, type Booking } from '@operaflow/db';
import { maskEmail, maskName, maskPhone } from '@operaflow/shared';

const ACTIVE_STATUSES = { notIn: ['CANCELLED', 'FAILED'] } as Prisma.EnumBookingStatusFilter;

/** Active bookings lacking data operations needs. Shared by registry filter, dashboard and reconciliation. */
export const missingDataWhere: Prisma.BookingWhereInput = {
  status: ACTIVE_STATUSES,
  OR: [
    { sellingAmount: null },
    { costAmount: null },
    { supplierId: null },
    { hotelId: null },
    { assignedToId: null },
    { confirmationStatus: 'CONFIRMED', confirmationNumber: null },
  ],
};

export function missingFields(b: Booking): string[] {
  if (b.status === 'CANCELLED' || b.status === 'FAILED') return [];
  const out: string[] = [];
  if (b.sellingAmount === null) out.push('sellingAmount');
  if (b.costAmount === null) out.push('costAmount');
  if (!b.supplierId) out.push('supplier');
  if (!b.hotelId) out.push('hotel');
  if (!b.assignedToId) out.push('assignedTo');
  if (b.confirmationStatus === 'CONFIRMED' && !b.confirmationNumber) out.push('confirmationNumber');
  return out;
}

export const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
export const toDateOnly = (s: string) => new Date(`${s}T00:00:00.000Z`);
const money = (d: Prisma.Decimal | null) => (d === null ? null : d.toFixed(2));

/** Margin is computed, never stored, and is null whenever an input is missing. */
export function margin(b: Pick<Booking, 'sellingAmount' | 'costAmount'>): string | null {
  if (b.sellingAmount === null || b.costAmount === null) return null;
  return b.sellingAmount.minus(b.costAmount).toFixed(2);
}

export function serializeBooking<T extends Booking>(b: T, canViewPii: boolean) {
  return {
    ...b,
    leadGuestName: canViewPii ? b.leadGuestName : maskName(b.leadGuestName),
    guestEmail: canViewPii ? b.guestEmail : maskEmail(b.guestEmail),
    guestPhone: canViewPii ? b.guestPhone : maskPhone(b.guestPhone),
    checkIn: dateOnly(b.checkIn),
    checkOut: dateOnly(b.checkOut),
    nights: Math.round((b.checkOut.getTime() - b.checkIn.getTime()) / 86_400_000),
    sellingAmount: money(b.sellingAmount),
    costAmount: money(b.costAmount),
    taxAmount: money(b.taxAmount),
    margin: margin(b),
    missing: missingFields(b),
  };
}

export const PII_FIELDS = new Set(['leadGuestName', 'guestEmail', 'guestPhone']);

function comparable(v: unknown): unknown {
  if (v instanceof Prisma.Decimal) return v.toFixed(2);
  if (v instanceof Date) return v.toISOString();
  return v ?? null;
}

/** Field-level diff. Personal data is recorded as changed, never with its values. */
export function diffBookings(before: Record<string, unknown>, after: Record<string, unknown>, fields: string[]) {
  const diff: Record<string, unknown> = {};
  for (const f of fields) {
    const a = comparable(before[f]);
    const b = comparable(after[f]);
    if (a !== b) diff[f] = PII_FIELDS.has(f) ? { changed: true } : { from: a, to: b };
  }
  return diff;
}
