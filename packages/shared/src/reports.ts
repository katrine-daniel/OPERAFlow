import { z } from 'zod';
import { BOOKING_CHANNELS, isoDate } from './bookings';
import { isValidTimeZone } from './time';

export const REPORT_FORMATS = ['XLSX', 'PDF'] as const;
export const REPORT_PERIODS = ['PREVIOUS_DAY', 'CURRENT_DAY'] as const;

export const reportFiltersSchema = z.object({
  /** Which day the report covers relative to when it runs. */
  period: z.enum(REPORT_PERIODS).default('PREVIOUS_DAY'),
  /** bookingDate = bookings made that day; checkIn = arrivals that day. */
  dateField: z.enum(['bookingDate', 'checkIn']).default('bookingDate'),
  channel: z.enum(BOOKING_CHANNELS).optional(),
  sourceIds: z.array(z.string().uuid()).max(50).optional(),
  supplierIds: z.array(z.string().uuid()).max(200).optional(),
  includeCancelled: z.boolean().default(true),
});
export type ReportFilters = z.infer<typeof reportFiltersSchema>;

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h)');

export const scheduleSchema = z.object({
  name: z.string().trim().min(3).max(120),
  timeOfDay,
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  daysOfWeek: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  timezone: z.string().refine(isValidTimeZone, 'Unknown IANA timezone'),
  formats: z.array(z.enum(REPORT_FORMATS)).min(1),
  recipients: z.array(z.string().trim().toLowerCase().email()).max(50).default([]),
  channelIntegrationId: z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional()),
  filters: reportFiltersSchema.default({}),
});
export type ScheduleInput = z.infer<typeof scheduleSchema>;

export const runReportSchema = z.object({
  /** Report day (organisation-local). Omit to use the schedule's period relative to now. */
  date: isoDate.optional(),
  deliver: z.boolean().default(false),
});

export const adhocReportSchema = z.object({
  date: isoDate,
  timezone: z.string().refine(isValidTimeZone, 'Unknown IANA timezone'),
  formats: z.array(z.enum(REPORT_FORMATS)).min(1).default(['XLSX']),
  filters: reportFiltersSchema.default({}),
});

export const approvedRecipientSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  label: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().max(120).optional()),
});

/** Builds a 5-field cron expression from a time of day and ISO weekdays (cron uses 0 = Sunday). */
export function buildCron(timeOfDay: string, daysOfWeek: number[]): string {
  const [hh, mm] = timeOfDay.split(':').map(Number);
  const days = [...new Set(daysOfWeek.map((d) => d % 7))].sort((a, b) => a - b);
  return `${mm} ${hh} * * ${days.length === 7 ? '*' : days.join(',')}`;
}

/** Inverse of buildCron for schedules created by it. Returns null for other expressions. */
export function parseSimpleCron(cron: string): { timeOfDay: string; daysOfWeek: number[] } | null {
  const m = /^(\d{1,2}) (\d{1,2}) \* \* (\*|[0-6](?:,[0-6])*)$/.exec(cron.trim());
  if (!m) return null;
  const days = m[3] === '*' ? [1, 2, 3, 4, 5, 6, 7] : m[3]!.split(',').map((d) => (Number(d) === 0 ? 7 : Number(d))).sort((a, b) => a - b);
  return { timeOfDay: `${m[2]!.padStart(2, '0')}:${m[1]!.padStart(2, '0')}`, daysOfWeek: days };
}

/** Spreadsheet formula-injection guard: cells starting with = + - @ (or tab/CR) are prefixed with an apostrophe. */
export function safeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}
