import { describe, expect, test } from 'vitest';
import { instantMs, isLongTerm, isValidInstant, isValidLocalDate, isValidTimeZone, localDate, oneYearAnniversary, taxYear, yearOf } from '../src/dates.ts';

describe('holding period', () => {
  test('bought 2025-01-15: sold 2026-01-15 is short-term; 2026-01-16 is long-term', () => {
    expect(isLongTerm('2025-01-15', '2026-01-15')).toBe(false);
    expect(isLongTerm('2025-01-15', '2026-01-16')).toBe(true);
  });
  test('bought 2024-02-29: sold 2025-02-28 short-term; 2025-03-01 long-term', () => {
    expect(oneYearAnniversary('2024-02-29')).toBe('2025-02-28');
    expect(isLongTerm('2024-02-29', '2025-02-28')).toBe(false);
    expect(isLongTerm('2024-02-29', '2025-03-01')).toBe(true);
  });
  test('ordinary dates and year ends', () => {
    expect(oneYearAnniversary('2023-12-31')).toBe('2024-12-31');
    expect(isLongTerm('2023-12-31', '2025-01-01')).toBe(true);
    expect(isLongTerm('2023-03-01', '2024-03-01')).toBe(false);
    expect(isLongTerm('2023-03-01', '2024-03-02')).toBe(true);
    expect(isLongTerm('2025-06-01', '2025-05-01')).toBe(false);
  });
});

describe('local dates and tax years', () => {
  test('23:30 on Dec 31 in Boise is Jan 1 in UTC but belongs to the earlier year', () => {
    expect(localDate('2026-01-01T06:30:00Z', 'America/Boise')).toBe('2025-12-31');
    expect(taxYear('2026-01-01T06:30:00Z', 'America/Boise')).toBe(2025);
    expect(taxYear('2026-01-01T07:00:00Z', 'America/Boise')).toBe(2026);
  });
  test('daylight time and other zones', () => {
    expect(localDate('2025-07-01T05:59:59Z', 'America/Boise')).toBe('2025-06-30'); // MDT, UTC−6
    expect(localDate('2025-07-01T06:00:00Z', 'America/Boise')).toBe('2025-07-01');
    expect(localDate('2025-07-01T06:00:00.500Z', 'UTC')).toBe('2025-07-01');
    expect(localDate('2025-12-31T15:00:00Z', 'Asia/Tokyo')).toBe('2026-01-01');
    expect(yearOf('2031-05-06')).toBe(2031);
  });
  test('invalid inputs throw (programmer error); validators say no', () => {
    expect(() => localDate('2025-01-01', 'UTC')).toThrow(RangeError);
    expect(() => localDate('2025-01-01T00:00:00Z', 'Mars/Olympus')).toThrow(RangeError);
    expect(isValidTimeZone('America/Boise')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
  test('instant and date validation', () => {
    expect(isValidInstant('2025-01-01T00:00:00Z')).toBe(true);
    expect(isValidInstant('2025-01-01T00:00:00.123Z')).toBe(true);
    expect(isValidInstant('2025-01-01T00:00:00+00:00')).toBe(false);
    expect(isValidInstant('2025-02-30T00:00:00Z')).toBe(false);
    expect(isValidInstant('2025-13-01T00:00:00Z')).toBe(false);
    expect(isValidInstant('2025-01-01T24:00:00Z')).toBe(false);
    expect(isValidInstant('1969-12-31T23:59:59Z')).toBe(false);
    expect(isValidLocalDate('2024-02-29')).toBe(true);
    expect(isValidLocalDate('2025-02-29')).toBe(false);
    expect(isValidLocalDate('1969-01-01')).toBe(false);
    expect(isValidLocalDate('2025-1-1')).toBe(false);
    expect(instantMs('1970-01-01T00:00:01Z')).toBe(1000);
  });
});
