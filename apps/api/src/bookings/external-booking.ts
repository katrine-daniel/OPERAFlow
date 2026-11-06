import { z } from 'zod';
import {
  BOOKING_STATUSES,
  CANCELLATION_STATUSES,
  CONFIRMATION_STATUSES,
  PAYMENT_STATUSES,
  currencySchema,
  isoDate,
  moneySchema,
} from '@operaflow/shared';

const blank = (v: unknown) => (v === '' || v === null ? undefined : v);
const text = (max: number) => z.preprocess(blank, z.string().trim().max(max).optional());
/** Accepts "Cancelled", "canceled", "on request" etc. */
const looseEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() ? v.trim().toUpperCase().replace(/[\s-]+/g, '_').replace(/^CANCELED$/, 'CANCELLED') : undefined),
    z.enum(values).optional(),
  );
const toIsoDate = (v: unknown) => {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === 'string') {
    const s = v.trim();
    const dmy = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(s); // DD/MM/YYYY (day-first, as used in the region)
    if (dmy) return `${dmy[3]}-${dmy[2]!.padStart(2, '0')}-${dmy[1]!.padStart(2, '0')}`;
    return s.slice(0, 10);
  }
  return v;
};
const count = (min: number) => z.preprocess(blank, z.coerce.number().int().min(min).max(100).optional());

/**
 * Canonical shape for bookings that arrive from outside (CSV/Excel import, webhook).
 * `undefined` means "not provided" — ingestion never overwrites existing data with a missing value.
 */
export const externalBookingSchema = z
  .object({
    externalRef: z.string().trim().min(1, 'external_ref is required').max(100),
    bookingDate: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.date().optional()),
    leadGuestName: text(200),
    guestEmail: z.preprocess(blank, z.string().trim().toLowerCase().email().max(254).optional()),
    guestPhone: text(40),
    hotelName: text(200),
    hotelCity: text(120),
    hotelCountry: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() ? v.trim().toUpperCase() : undefined),
      z.string().regex(/^[A-Z]{2}$/, 'hotel_country must be a 2-letter ISO code').optional(),
    ),
    supplierCode: z.preprocess((v) => (typeof v === 'string' && v.trim() ? v.trim().toUpperCase() : undefined), z.string().max(32).optional()),
    checkIn: z.preprocess((v) => (blank(v) === undefined ? undefined : toIsoDate(v)), isoDate.optional()),
    checkOut: z.preprocess((v) => (blank(v) === undefined ? undefined : toIsoDate(v)), isoDate.optional()),
    adults: count(1),
    children: count(0),
    rooms: count(1),
    roomType: text(120),
    boardBasis: text(60),
    currency: z.preprocess(blank, currencySchema.optional()),
    sellingAmount: z.preprocess(blank, moneySchema),
    costAmount: z.preprocess(blank, moneySchema),
    taxAmount: z.preprocess(blank, moneySchema),
    status: looseEnum(BOOKING_STATUSES),
    paymentStatus: looseEnum(PAYMENT_STATUSES),
    confirmationStatus: looseEnum(CONFIRMATION_STATUSES),
    cancellationStatus: looseEnum(CANCELLATION_STATUSES),
    confirmationNumber: text(100),
    assignedToEmail: z.preprocess(blank, z.string().trim().toLowerCase().email().optional()),
    notes: text(5000),
    externalUpdatedAt: z.preprocess(blank, z.coerce.date().optional()),
  })
  .superRefine((v, ctx) => {
    if (v.checkIn && v.checkOut && v.checkOut <= v.checkIn) {
      ctx.addIssue({ code: 'custom', path: ['checkOut'], message: 'check_out must be after check_in' });
    }
    const hotelParts = [v.hotelName, v.hotelCity, v.hotelCountry].filter(Boolean).length;
    if (hotelParts > 0 && hotelParts < 3) {
      ctx.addIssue({ code: 'custom', path: ['hotelName'], message: 'hotel_name, hotel_city and hotel_country must be given together' });
    }
  });
export type ExternalBooking = z.infer<typeof externalBookingSchema>;

/** Fields required to create a booking that does not exist yet. */
export const REQUIRED_FOR_CREATE: (keyof ExternalBooking)[] = ['leadGuestName', 'checkIn', 'checkOut', 'currency'];

/** Spreadsheet header → canonical field. Matching ignores case, spaces, dashes and underscores. */
const HEADER_ALIASES: Record<string, keyof ExternalBooking> = {
  externalref: 'externalRef', bookingref: 'externalRef', supplierref: 'externalRef', reference: 'externalRef', bookingreference: 'externalRef',
  bookingdate: 'bookingDate', createdat: 'bookingDate',
  guestname: 'leadGuestName', leadguest: 'leadGuestName', leadguestname: 'leadGuestName', guest: 'leadGuestName',
  guestemail: 'guestEmail', email: 'guestEmail',
  guestphone: 'guestPhone', phone: 'guestPhone',
  hotelname: 'hotelName', hotel: 'hotelName',
  hotelcity: 'hotelCity', city: 'hotelCity', destination: 'hotelCity',
  hotelcountry: 'hotelCountry', country: 'hotelCountry',
  suppliercode: 'supplierCode', supplier: 'supplierCode',
  checkin: 'checkIn', arrival: 'checkIn',
  checkout: 'checkOut', departure: 'checkOut',
  adults: 'adults', children: 'children', rooms: 'rooms',
  roomtype: 'roomType', boardbasis: 'boardBasis', board: 'boardBasis', mealplan: 'boardBasis',
  currency: 'currency',
  sellingamount: 'sellingAmount', sellingprice: 'sellingAmount', sell: 'sellingAmount', saleamount: 'sellingAmount',
  costamount: 'costAmount', cost: 'costAmount', supplierCost: 'costAmount', suppliercost: 'costAmount', netamount: 'costAmount',
  taxamount: 'taxAmount', tax: 'taxAmount', taxes: 'taxAmount',
  status: 'status', bookingstatus: 'status',
  paymentstatus: 'paymentStatus',
  confirmationstatus: 'confirmationStatus',
  cancellationstatus: 'cancellationStatus',
  confirmationnumber: 'confirmationNumber', confirmationno: 'confirmationNumber', hotelconfirmation: 'confirmationNumber',
  assignedtoemail: 'assignedToEmail', assignedto: 'assignedToEmail', owner: 'assignedToEmail',
  notes: 'notes', remarks: 'notes',
  updatedat: 'externalUpdatedAt', lastmodified: 'externalUpdatedAt',
};

export function mapHeader(header: string): keyof ExternalBooking | undefined {
  return HEADER_ALIASES[header.toLowerCase().replace(/[\s_\-.]/g, '')];
}

export const TEMPLATE_HEADERS = [
  'external_ref', 'booking_date', 'guest_name', 'guest_email', 'guest_phone', 'hotel_name', 'hotel_city', 'hotel_country',
  'supplier_code', 'check_in', 'check_out', 'adults', 'children', 'rooms', 'room_type', 'board_basis', 'currency',
  'selling_amount', 'cost_amount', 'tax_amount', 'status', 'payment_status', 'confirmation_status', 'confirmation_number',
  'assigned_to_email', 'notes',
];
