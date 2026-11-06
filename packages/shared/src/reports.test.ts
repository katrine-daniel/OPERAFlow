import { describe, expect, it } from 'vitest';
import { buildCron, parseSimpleCron, safeCell, scheduleSchema } from './reports';

describe('report schedule helpers', () => {
  it('builds cron from time and ISO weekdays (Sunday = 7 → 0)', () => {
    expect(buildCron('08:30', [1, 2, 3, 4, 5])).toBe('30 8 * * 1,2,3,4,5');
    expect(buildCron('07:05', [7, 6])).toBe('5 7 * * 0,6');
    expect(buildCron('00:00', [1, 2, 3, 4, 5, 6, 7])).toBe('0 0 * * *');
  });
  it('round-trips simple cron expressions', () => {
    expect(parseSimpleCron('5 7 * * 0,6')).toEqual({ timeOfDay: '07:05', daysOfWeek: [6, 7] });
    expect(parseSimpleCron('0 0 * * *')).toEqual({ timeOfDay: '00:00', daysOfWeek: [1, 2, 3, 4, 5, 6, 7] });
    expect(parseSimpleCron('*/5 * * * *')).toBeNull();
  });
  it('validates schedule input', () => {
    const ok = scheduleSchema.safeParse({ name: 'Daily ops', timeOfDay: '08:00', daysOfWeek: [1], timezone: 'Asia/Dubai', formats: ['XLSX'], recipients: ['Ops@Example.com'] });
    expect(ok.success && ok.data.recipients).toEqual(['ops@example.com']);
    expect(ok.success && ok.data.filters).toEqual({ period: 'PREVIOUS_DAY', dateField: 'bookingDate', includeCancelled: true });
    expect(scheduleSchema.safeParse({ name: 'x', timeOfDay: '25:00', daysOfWeek: [], timezone: 'Nowhere', formats: [] }).success).toBe(false);
  });
  it('neutralises spreadsheet formulas', () => {
    expect(safeCell('=HYPERLINK("http://evil")')).toBe('\'=HYPERLINK("http://evil")');
    expect(safeCell('-5+3')).toBe("'-5+3");
    expect(safeCell('Jane')).toBe('Jane');
  });
});
