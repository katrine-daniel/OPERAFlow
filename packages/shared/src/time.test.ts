import { describe, expect, it } from 'vitest';
import { isValidTimeZone, zonedDayRange, zonedTimeToUtc } from './time';

describe('time helpers', () => {
  it('computes the day range in a fixed-offset zone (Dubai, UTC+4)', () => {
    const r = zonedDayRange('Asia/Dubai', new Date('2026-11-06T22:30:00Z')); // 02:30 on 7 Nov in Dubai
    expect(r.isoDate).toBe('2026-11-07');
    expect(r.start.toISOString()).toBe('2026-11-06T20:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-11-07T20:00:00.000Z');
  });

  it('handles DST days (London, 29 Mar 2026 is 23h long)', () => {
    const r = zonedDayRange('Europe/London', new Date('2026-03-29T12:00:00Z'));
    expect(r.start.toISOString()).toBe('2026-03-29T00:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-03-29T23:00:00.000Z');
  });

  it('converts wall-clock time to UTC', () => {
    expect(zonedTimeToUtc(2026, 7, 1, 9, 0, 'America/New_York').toISOString()).toBe('2026-07-01T13:00:00.000Z');
  });

  it('validates time zones', () => {
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
});
