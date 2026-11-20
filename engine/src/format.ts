/** Text formatting and parsing of money with string math only (no floats). */
import { SATS_PER_BTC, type Cents, type Sats } from './money.ts';

/** Cents as plain dollars, e.g. `-1234.56`. */
export function formatCents(cents: Cents): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Sats as BTC with 8 decimals, e.g. `0.50000000`. */
export function formatBtc(sats: Sats): string {
  const sign = sats < 0 ? '-' : '';
  const abs = Math.abs(sats);
  return `${sign}${Math.floor(abs / SATS_PER_BTC)}.${String(abs % SATS_PER_BTC).padStart(8, '0')}`;
}

/** Split a non-negative decimal string into whole and fraction digits, or null if malformed. */
function decimalParts(text: string): { whole: string; frac: string } | null {
  if (!/^\d+(\.\d*)?$/.test(text)) return null;
  const dot = text.indexOf('.');
  return dot < 0 ? { whole: text, frac: '' } : { whole: text.slice(0, dot), frac: text.slice(dot + 1) };
}

function safe(n: bigint): number | null {
  const out = Number(n);
  return Number.isSafeInteger(out) ? out : null;
}

/**
 * Parse a non-negative dollar amount (`14000`, `14,000.00`, `$9000.5`) to cents.
 * More than two decimals round half-up. Returns null if malformed or too large.
 */
export function parseDollars(text: string): Cents | null {
  const parts = decimalParts(text.trim().replace(/^\$/, '').replaceAll(',', ''));
  if (parts === null) return null;
  const cents = BigInt(parts.whole) * 100n + BigInt(`${parts.frac}00`.slice(0, 2)) + (parts.frac.charAt(2) >= '5' ? 1n : 0n);
  return safe(cents);
}

/** Parse a non-negative BTC amount with at most 8 decimals to sats. Returns null if malformed. */
export function parseBtc(text: string): Sats | null {
  const parts = decimalParts(text.trim());
  if (parts === null || parts.frac.length > 8) return null;
  return safe(BigInt(parts.whole) * BigInt(SATS_PER_BTC) + BigInt(parts.frac.padEnd(8, '0')));
}
