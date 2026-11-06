import { describe, expect, it } from 'vitest';
import { bookingDedupeKey, createBookingSchema, moneySchema, normalizeName, updateBookingSchema } from './bookings';

const base = {
  sourceId: '6f0f8d9e-3a3c-4b8e-9a51-6d0f3c1e2a10',
  leadGuestName: 'Jane Doe',
  checkIn: '2026-12-01',
  checkOut: '2026-12-04',
  currency: 'aed',
};

describe('booking schemas', () => {
  it('normalises currency and keeps blank amounts as null (never 0)', () => {
    const r = createBookingSchema.parse({ ...base, sellingAmount: '', costAmount: '1,250.5' });
    expect(r.currency).toBe('AED');
    expect(r.sellingAmount).toBeNull();
    expect(r.costAmount).toBe('1250.5');
  });

  it('rejects check-out before check-in and impossible dates', () => {
    expect(createBookingSchema.safeParse({ ...base, checkOut: '2026-12-01' }).success).toBe(false);
    expect(createBookingSchema.safeParse({ ...base, checkIn: '2026-02-30' }).success).toBe(false);
  });

  it('rejects negative or over-precise amounts', () => {
    expect(moneySchema.safeParse('-5').success).toBe(false);
    expect(moneySchema.safeParse('1.234').success).toBe(false);
    expect(moneySchema.parse(99.5)).toBe('99.50');
  });

  it('requires a version on update and allows partial changes', () => {
    expect(updateBookingSchema.safeParse({ notes: 'x' }).success).toBe(false);
    const r = updateBookingSchema.parse({ version: 3, notes: 'x' });
    expect(r).toEqual({ version: 3, notes: 'x' });
  });
});

describe('duplicate fingerprint', () => {
  it('treats name order, case, accents, titles and punctuation as equal', () => {
    expect(normalizeName('Mr. Doe, JÁNE')).toBe(normalizeName('jane doe'));
  });
  it('keeps non-Latin names', () => {
    expect(normalizeName('李 雷')).toBe('李 雷');
  });
  it('builds a key only when the hotel is known', () => {
    expect(bookingDedupeKey(null, 'a', '2026-01-01', '2026-01-02')).toBeNull();
    expect(bookingDedupeKey('h1', 'Doe Jane', '2026-01-01', '2026-01-02')).toBe('h1|doe jane|2026-01-01|2026-01-02');
  });
});
