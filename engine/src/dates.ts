/** Local dates, tax years and holding periods. All dates are `YYYY-MM-DD` strings in the entry's time zone. */
import type { IsoInstant, LocalDate } from './types.ts';

export const DEFAULT_TIME_ZONE = 'America/Boise';

const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (f === undefined) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    formatters.set(tz, f);
  }
  return f;
}

/** True if `tz` is an IANA time zone this runtime knows. */
export function isValidTimeZone(tz: string): boolean {
  if (tz === '') return false;
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** True for a real UTC instant from 1970 on, in the form `YYYY-MM-DDTHH:MM:SS(.sss)Z`. */
export function isValidInstant(s: string): boolean {
  const ms = Date.parse(s);
  if (!INSTANT_RE.test(s) || s < '1970' || Number.isNaN(ms)) return false;
  return new Date(ms).toISOString().slice(0, 19) === s.slice(0, 19);
}

/** True for a real calendar date `YYYY-MM-DD` from 1970 on. */
export function isValidLocalDate(s: string): boolean {
  return DATE_RE.test(s) && s >= '1970' && isValidInstant(`${s}T00:00:00Z`);
}

/** Milliseconds since the epoch for a valid instant (for ordering). */
export function instantMs(at: IsoInstant): number {
  return Date.parse(at);
}

/**
 * The local calendar date of a UTC instant in an IANA time zone.
 * Throws RangeError for an invalid instant or zone (validate user input first).
 */
export function localDate(at: IsoInstant, tz: string): LocalDate {
  if (!isValidInstant(at)) throw new RangeError(`invalid instant: ${at}`);
  const v: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const p of formatter(tz).formatToParts(new Date(Date.parse(at)))) v[p.type] = p.value;
  return `${v.year}-${v.month}-${v.day}`;
}

/** Calendar year of a local date. */
export function yearOf(date: LocalDate): number {
  return Number(date.slice(0, 4));
}

/** Tax year of an instant: the year of its local date in `tz`. */
export function taxYear(at: IsoInstant, tz: string): number {
  return yearOf(localDate(at, tz));
}

/** One year after `acquired`. The anniversary of Feb 29 is Feb 28. */
export function oneYearAnniversary(acquired: LocalDate): LocalDate {
  const year = String(yearOf(acquired) + 1);
  const monthDay = acquired.slice(5);
  return `${year}-${monthDay === '02-29' ? '02-28' : monthDay}`;
}

/** Long-term if the disposal's local date is after the one-year anniversary of the acquisition's local date. */
export function isLongTerm(acquiredLocalDate: LocalDate, disposedLocalDate: LocalDate): boolean {
  return disposedLocalDate > oneYearAnniversary(acquiredLocalDate);
}
