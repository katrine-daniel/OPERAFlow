/** Timezone helpers using only Intl (no external dependency). */

function partsInZone(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year!, m: +p.month!, d: +p.day!, h: +p.hour!, min: +p.minute!, s: +p.second! };
}

/** Offset of `timeZone` from UTC at `date`, in milliseconds (positive east of UTC). */
export function zoneOffsetMs(date: Date, timeZone: string): number {
  const p = partsInZone(date, timeZone);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Converts a wall-clock time in `timeZone` to a UTC Date. */
export function zonedTimeToUtc(y: number, m: number, d: number, h: number, min: number, timeZone: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, min);
  let utc = guess - zoneOffsetMs(new Date(guess), timeZone);
  // Second pass corrects for DST transitions between guess and result.
  utc = guess - zoneOffsetMs(new Date(utc), timeZone);
  return new Date(utc);
}

/** The [start, end) UTC instants of the calendar day containing `date` in `timeZone`. */
export function zonedDayRange(timeZone: string, date: Date = new Date()): { start: Date; end: Date; isoDate: string } {
  const p = partsInZone(date, timeZone);
  const start = zonedTimeToUtc(p.y, p.m, p.d, 0, 0, timeZone);
  const next = new Date(Date.UTC(p.y, p.m - 1, p.d + 1));
  const end = zonedTimeToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, timeZone);
  const isoDate = `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
  return { start, end, isoDate };
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
