import { describe, expect, it } from 'vitest';
import { resolvePeriod } from './report-data.service';

describe('resolvePeriod', () => {
  it('previous day in Dubai for an 08:00 local run', () => {
    const p = resolvePeriod('Asia/Dubai', 'PREVIOUS_DAY', new Date('2026-11-07T04:00:00Z'));
    expect(p).toMatchObject({ date: '2026-11-06' });
    expect(p.start.toISOString()).toBe('2026-11-05T20:00:00.000Z');
    expect(p.end.toISOString()).toBe('2026-11-06T20:00:00.000Z');
  });

  it('uses the local date, not the UTC date, near midnight', () => {
    // 23:30 UTC on 6 Nov is already 7 Nov in India (UTC+5:30)
    expect(resolvePeriod('Asia/Kolkata', 'CURRENT_DAY', new Date('2026-11-06T23:30:00Z')).date).toBe('2026-11-07');
  });

  it('handles a 23-hour DST day', () => {
    const p = resolvePeriod('Europe/London', 'PREVIOUS_DAY', new Date('2026-03-30T08:00:00Z'));
    expect(p.date).toBe('2026-03-29');
    expect(p.end.getTime() - p.start.getTime()).toBe(23 * 3600_000);
  });

  it('honours an explicit date', () => {
    expect(resolvePeriod('UTC', 'PREVIOUS_DAY', new Date(), '2026-01-15').start.toISOString()).toBe('2026-01-15T00:00:00.000Z');
  });
});
