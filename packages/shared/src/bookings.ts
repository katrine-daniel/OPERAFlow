import { z } from 'zod';
import { isValidTimeZone } from './time';

// Mirrors of the Prisma enums (kept here so the web app does not depend on @prisma/client).
export const BOOKING_STATUSES = ['PENDING', 'CONFIRMED', 'ON_REQUEST', 'CANCELLED', 'FAILED'] as const;
export const PAYMENT_STATUSES = ['UNPAID', 'PARTIALLY_PAID', 'PAID', 'REFUNDED', 'NOT_APPLICABLE'] as const;
export const CONFIRMATION_STATUSES = ['PENDING', 'CONFIRMED', 'REJECTED'] as const;
export const CANCELLATION_STATUSES = ['NONE', 'REQUESTED', 'CANCELLED', 'CANCELLED_WITH_FEE'] as const;
export const BOOKING_CHANNELS = ['ONLINE', 'OFFLINE'] as const;
export const SUPPLIER_TYPES = ['HOTEL_DIRECT', 'WHOLESALER', 'BEDBANK', 'DMC', 'OTHER'] as const;
export const ISSUE_TYPES = ['DUPLICATE_SUSPECT', 'AMOUNT_MISMATCH', 'STATUS_MISMATCH', 'MISSING_IN_SOURCE', 'MISSING_REQUIRED_DATA'] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const LABELS: Record<string, string> = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  ON_REQUEST: 'On request',
  CANCELLED: 'Cancelled',
  FAILED: 'Failed',
  UNPAID: 'Unpaid',
  PARTIALLY_PAID: 'Partially paid',
  PAID: 'Paid',
  REFUNDED: 'Refunded',
  NOT_APPLICABLE: 'N/A',
  REJECTED: 'Rejected',
  NONE: 'None',
  REQUESTED: 'Requested',
  CANCELLED_WITH_FEE: 'Cancelled with fee',
  ONLINE: 'Online',
  OFFLINE: 'Offline',
  HOTEL_DIRECT: 'Hotel direct',
  WHOLESALER: 'Wholesaler',
  BEDBANK: 'Bedbank',
  DMC: 'DMC',
  OTHER: 'Other',
  DUPLICATE_SUSPECT: 'Possible duplicate',
  AMOUNT_MISMATCH: 'Amount mismatch',
  STATUS_MISMATCH: 'Status mismatch',
  MISSING_IN_SOURCE: 'Missing in source',
  MISSING_REQUIRED_DATA: 'Missing required data',
};

/** Empty strings from HTML forms become undefined. */
const blankToUndef = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optText = (max: number) => z.preprocess(blankToUndef, z.string().trim().max(max).optional());
const optNullableText = (max: number) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), 'Invalid date');

/** Money as a decimal string with at most 2 decimals. Blank = not provided (stays NULL). */
export const moneySchema = z.preprocess(
  (v) => (typeof v === 'number' ? v.toFixed(2) : typeof v === 'string' ? (v.trim() === '' ? null : v.replace(/,/g, '').trim()) : v),
  z
    .string()
    .regex(/^\d{1,10}(\.\d{1,2})?$/, 'Amount must be a non-negative number with up to 2 decimals')
    .nullable()
    .optional(),
);

export const currencySchema = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{3}$/, 'Use a 3-letter ISO currency code'));

const optUuid = z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional());

const bookingFields = {
  externalRef: optNullableText(100),
  supplierId: optUuid,
  hotelId: optUuid,
  leadGuestName: z.string().trim().min(1, 'Guest name is required').max(200),
  guestEmail: z.preprocess((v) => (v === '' ? null : v), z.string().trim().toLowerCase().email().max(254).nullable().optional()),
  guestPhone: optNullableText(40),
  adults: z.coerce.number().int().min(1).max(50).default(1),
  children: z.coerce.number().int().min(0).max(50).default(0),
  rooms: z.coerce.number().int().min(1).max(100).default(1),
  roomType: optNullableText(120),
  boardBasis: optNullableText(60),
  bookingDate: z.preprocess(blankToUndef, z.coerce.date().optional()),
  checkIn: isoDate,
  checkOut: isoDate,
  currency: currencySchema,
  sellingAmount: moneySchema,
  costAmount: moneySchema,
  taxAmount: moneySchema,
  status: z.enum(BOOKING_STATUSES).default('PENDING'),
  paymentStatus: z.enum(PAYMENT_STATUSES).default('UNPAID'),
  confirmationStatus: z.enum(CONFIRMATION_STATUSES).default('PENDING'),
  cancellationStatus: z.enum(CANCELLATION_STATUSES).default('NONE'),
  confirmationNumber: optNullableText(100),
  assignedToId: optUuid,
  notes: optNullableText(5000),
};

const datesOrdered = (v: { checkIn?: string; checkOut?: string }) => !v.checkIn || !v.checkOut || v.checkOut > v.checkIn;

export const createBookingSchema = z
  .object({
    sourceId: z.string().uuid('Choose a booking source'),
    ...bookingFields,
    /** Set after the user has reviewed a duplicate warning. */
    confirmDuplicate: z.boolean().optional(),
  })
  .refine(datesOrdered, { message: 'Check-out must be after check-in', path: ['checkOut'] });
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const updateBookingSchema = z
  .object({
    ...Object.fromEntries(
      Object.entries(bookingFields).map(([k, s]) => [k, (s as z.ZodTypeAny).optional()]),
    ) as { [K in keyof typeof bookingFields]: z.ZodOptional<(typeof bookingFields)[K]> },
    version: z.coerce.number().int().min(1),
  })
  .refine(datesOrdered, { message: 'Check-out must be after check-in', path: ['checkOut'] });
export type UpdateBookingInput = z.infer<typeof updateBookingSchema>;

export const cancelBookingSchema = z.object({
  version: z.coerce.number().int().min(1),
  withFee: z.boolean().default(false),
  reason: z.string().trim().min(3, 'Give a short reason').max(1000),
});

export const confirmBookingSchema = z.object({
  version: z.coerce.number().int().min(1),
  confirmationNumber: z.string().trim().min(1).max(100),
});

export const bookingQuerySchema = z.object({
  q: optText(100),
  channel: z.preprocess(blankToUndef, z.enum(BOOKING_CHANNELS).optional()),
  sourceId: z.preprocess(blankToUndef, z.string().uuid().optional()),
  supplierId: z.preprocess(blankToUndef, z.string().uuid().optional()),
  assignedToId: z.preprocess(blankToUndef, z.string().uuid().optional()),
  status: z.preprocess(blankToUndef, z.enum(BOOKING_STATUSES).optional()),
  confirmationStatus: z.preprocess(blankToUndef, z.enum(CONFIRMATION_STATUSES).optional()),
  dateField: z.preprocess(blankToUndef, z.enum(['bookingDate', 'checkIn']).default('bookingDate')),
  from: z.preprocess(blankToUndef, isoDate.optional()),
  to: z.preprocess(blankToUndef, isoDate.optional()),
  missingData: z.preprocess((v) => v === 'true' || v === true, z.boolean()).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type BookingQuery = z.infer<typeof bookingQuerySchema>;

// ── Directory ──
export const hotelSchema = z.object({
  name: z.string().trim().min(1).max(200),
  city: z.string().trim().min(1).max(120),
  country: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{2}$/, 'Use a 2-letter ISO country code')),
  address: optNullableText(500),
  starRating: z.preprocess((v) => (v === '' || v === null ? null : v), z.coerce.number().int().min(1).max(7).nullable().optional()),
});

export const supplierSchema = z.object({
  code: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9_-]{2,32}$/, 'Code: 2–32 letters, digits, - or _')),
  name: z.string().trim().min(1).max(200),
  type: z.enum(SUPPLIER_TYPES),
  phone: optNullableText(40),
  timezone: z
    .string()
    .trim()
    .default('UTC')
    .refine(isValidTimeZone, 'Unknown IANA timezone'),
  notes: optNullableText(2000),
  isActive: z.boolean().optional(),
});

export const supplierContactSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  name: optNullableText(120),
  isPrimary: z.boolean().default(false),
});

export const resolveIssueSchema = z.object({
  status: z.enum(['RESOLVED', 'DISMISSED']),
  note: z.string().trim().min(3).max(1000),
});

// ── Duplicate detection ──

/** Lowercase, strip accents and punctuation, sort tokens: "Doe, Jane" == "jane doe" == "Jáne Doe". */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t && !['mr', 'mrs', 'ms', 'miss', 'dr'].includes(t))
    .sort()
    .join(' ');
}

/**
 * Fingerprint for cross-source duplicate detection: same hotel, same lead guest, same stay dates.
 * `hotelKey` is the hotel id when known, otherwise a normalised "name|city|country".
 */
export function bookingDedupeKey(hotelKey: string | null, leadGuestName: string, checkIn: string, checkOut: string): string | null {
  if (!hotelKey) return null;
  return [hotelKey, normalizeName(leadGuestName), checkIn, checkOut].join('|');
}
