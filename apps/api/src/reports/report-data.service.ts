import { Injectable } from '@nestjs/common';
import { Prisma } from '@operaflow/db';
import { LABELS, zonedDayRange, zonedTimeToUtc, type ReportFilters } from '@operaflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { dateOnly, missingFields } from '../bookings/booking-view';

export interface ReportPeriod {
  /** Organisation-local calendar day the report covers. */
  date: string;
  start: Date;
  end: Date;
  timezone: string;
}

export interface ReportRow {
  internalRef: string;
  externalRef: string | null;
  bookingDate: string;
  guestName: string;
  hotel: string | null;
  destination: string | null;
  checkIn: string;
  checkOut: string;
  source: string;
  channel: string;
  supplier: string | null;
  status: string;
  sellingAmount: string | null;
  costAmount: string | null;
  currency: string;
  margin: string | null;
  paymentStatus: string;
  confirmationStatus: string;
  confirmationNumber: string | null;
  cancellationStatus: string;
  assignedTo: string | null;
  missing: string[];
}

export interface CurrencyTotals {
  currency: string;
  bookings: number;
  selling: string;
  sellingMissing: number;
  cost: string;
  costMissing: number;
  margin: string;
  /** Bookings excluded from margin because price or cost is missing. */
  marginExcluded: number;
}

export interface ReportWarning {
  internalRef: string | null;
  message: string;
}

export interface ReportDataset {
  period: ReportPeriod;
  filters: ReportFilters;
  generatedAt: string;
  rows: ReportRow[];
  summary: {
    total: number;
    online: number;
    offline: number;
    byStatus: Record<string, number>;
    pendingConfirmation: number;
    cancelled: number;
    withMissingData: number;
    currencies: CurrencyTotals[];
    openReconciliationIssues: Record<string, number>;
  };
  warnings: ReportWarning[];
}

const FIELD_NAMES: Record<string, string> = {
  sellingAmount: 'selling price', costAmount: 'supplier cost', supplier: 'supplier', hotel: 'hotel', assignedTo: 'owner',
  confirmationNumber: 'confirmation number',
};

/** Calendar day in `tz` for a report: the given date, or the period relative to `at`. */
export function resolvePeriod(tz: string, period: ReportFilters['period'], at: Date, date?: string): ReportPeriod {
  let day: string;
  if (date) day = date;
  else {
    const today = zonedDayRange(tz, at);
    day = period === 'CURRENT_DAY' ? today.isoDate : zonedDayRange(tz, new Date(today.start.getTime() - 1)).isoDate;
  }
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const range = zonedDayRange(tz, zonedTimeToUtc(y, m, d, 12, 0, tz));
  return { date: day, start: range.start, end: range.end, timezone: tz };
}

const money = (d: Prisma.Decimal | null) => (d === null ? null : d.toFixed(2));

/**
 * Builds the daily operations dataset straight from the booking registry. Nothing is invented:
 * missing values stay null, are listed as warnings, and are excluded (and counted) in totals.
 */
@Injectable()
export class ReportDataService {
  constructor(private readonly prisma: PrismaService) {}

  async build(period: ReportPeriod, filters: ReportFilters): Promise<ReportDataset> {
    const where: Prisma.BookingWhereInput = {
      ...(filters.dateField === 'checkIn'
        ? { checkIn: new Date(`${period.date}T00:00:00.000Z`) }
        : { bookingDate: { gte: period.start, lt: period.end } }),
      ...(filters.channel && { channel: filters.channel }),
      ...(filters.sourceIds?.length && { sourceId: { in: filters.sourceIds } }),
      ...(filters.supplierIds?.length && { supplierId: { in: filters.supplierIds } }),
      ...(!filters.includeCancelled && { status: { not: 'CANCELLED' } }),
    };
    const bookings = await this.prisma.booking.findMany({
      where,
      orderBy: [{ bookingDate: 'asc' }, { internalRef: 'asc' }],
      include: {
        source: { select: { name: true } },
        supplier: { select: { name: true } },
        hotel: { select: { name: true, city: true, country: true } },
        assignedTo: { select: { name: true } },
      },
    });

    const rows: ReportRow[] = bookings.map((b) => ({
      internalRef: b.internalRef,
      externalRef: b.externalRef,
      bookingDate: b.bookingDate.toISOString(),
      guestName: b.leadGuestName,
      hotel: b.hotel?.name ?? null,
      destination: b.hotel ? `${b.hotel.city}, ${b.hotel.country}` : null,
      checkIn: dateOnly(b.checkIn),
      checkOut: dateOnly(b.checkOut),
      source: b.source.name,
      channel: b.channel,
      supplier: b.supplier?.name ?? null,
      status: b.status,
      sellingAmount: money(b.sellingAmount),
      costAmount: money(b.costAmount),
      currency: b.currency,
      margin: b.sellingAmount !== null && b.costAmount !== null ? b.sellingAmount.minus(b.costAmount).toFixed(2) : null,
      paymentStatus: b.paymentStatus,
      confirmationStatus: b.confirmationStatus,
      confirmationNumber: b.confirmationNumber,
      cancellationStatus: b.cancellationStatus,
      assignedTo: b.assignedTo?.name ?? null,
      missing: missingFields(b),
    }));

    // Per-currency totals: never sum across currencies.
    const byCurrency = new Map<string, { n: number; sell: Prisma.Decimal; sellMiss: number; cost: Prisma.Decimal; costMiss: number; margin: Prisma.Decimal; marginEx: number }>();
    for (const b of bookings) {
      if (b.status === 'CANCELLED' || b.status === 'FAILED') continue;
      const t = byCurrency.get(b.currency) ?? { n: 0, sell: new Prisma.Decimal(0), sellMiss: 0, cost: new Prisma.Decimal(0), costMiss: 0, margin: new Prisma.Decimal(0), marginEx: 0 };
      t.n++;
      if (b.sellingAmount === null) t.sellMiss++;
      else t.sell = t.sell.plus(b.sellingAmount);
      if (b.costAmount === null) t.costMiss++;
      else t.cost = t.cost.plus(b.costAmount);
      if (b.sellingAmount !== null && b.costAmount !== null) t.margin = t.margin.plus(b.sellingAmount.minus(b.costAmount));
      else t.marginEx++;
      byCurrency.set(b.currency, t);
    }

    const byStatus: Record<string, number> = {};
    for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

    const warnings: ReportWarning[] = rows
      .filter((r) => r.missing.length)
      .map((r) => ({ internalRef: r.internalRef, message: `Missing ${r.missing.map((f) => FIELD_NAMES[f] ?? f).join(', ')}` }));
    for (const [cur, t] of byCurrency) {
      if (t.marginEx) warnings.push({ internalRef: null, message: `${cur}: ${t.marginEx} booking(s) excluded from margin total because price or cost is missing` });
    }
    if (byCurrency.size > 1) warnings.push({ internalRef: null, message: `Bookings are in ${byCurrency.size} currencies; totals are shown per currency and not converted` });

    const issues = await this.prisma.reconciliationIssue.groupBy({ by: ['type'], where: { status: 'OPEN' }, _count: true });

    return {
      period,
      filters,
      generatedAt: new Date().toISOString(),
      rows,
      summary: {
        total: rows.length,
        online: rows.filter((r) => r.channel === 'ONLINE').length,
        offline: rows.filter((r) => r.channel === 'OFFLINE').length,
        byStatus,
        pendingConfirmation: rows.filter((r) => r.confirmationStatus === 'PENDING' && r.status !== 'CANCELLED' && r.status !== 'FAILED').length,
        cancelled: byStatus.CANCELLED ?? 0,
        withMissingData: rows.filter((r) => r.missing.length).length,
        currencies: [...byCurrency.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([currency, t]) => ({
            currency,
            bookings: t.n,
            selling: t.sell.toFixed(2),
            sellingMissing: t.sellMiss,
            cost: t.cost.toFixed(2),
            costMissing: t.costMiss,
            margin: t.margin.toFixed(2),
            marginExcluded: t.marginEx,
          })),
        openReconciliationIssues: Object.fromEntries(issues.map((i) => [LABELS[i.type] ?? i.type, i._count])),
      },
      warnings,
    };
  }
}
