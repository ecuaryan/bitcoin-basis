import { formatBtc, mulDivRoundHalfUp, SATS_PER_BTC } from '@bitcoin-basis/engine';

/** Replace every digit with a bullet, keeping separators: `$319,206` becomes `$•••,•••`. */
export function maskDigits(text: string): string {
  return text.replace(/\d/g, '•');
}

/** Sats as BTC with 8 decimals in two groups of four: `0.0074 2665`. */
export function groupedBtc(sats: number): string {
  const [whole = '0', frac = '00000000'] = formatBtc(sats).split('.');
  return `${whole}.${frac.slice(0, 4)} ${frac.slice(4)}`;
}

/** Whole sats with thousands separators: `336,672,105`. */
export function groupedSats(sats: number): string {
  return sats.toLocaleString('en-US');
}

/** BTC to 4 decimals, rounded half-up on sats, for compact lists: `1.1802`. */
export function shortBtc(sats: number): string {
  const rounded = Math.floor((sats + 5_000) / 10_000); // units of 0.0001 BTC
  const whole = Math.floor(rounded / 10_000);
  return `${whole}.${String(rounded % 10_000).padStart(4, '0')}`;
}

export interface MoneyFormat {
  /** `cents` shows $1,234.56. `dollars` drops the cents, rounding toward zero so gains are never overstated. */
  precision?: 'cents' | 'dollars';
  /** Put a + in front of gains. */
  signed?: boolean;
}

/** Cents as dollars: `$1,234.56`, `-$1,234.56`, `+$180,329`. */
export function formatMoney(cents: number, { precision = 'cents', signed = false }: MoneyFormat = {}): string {
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const body = precision === 'dollars' ? whole.toLocaleString('en-US') : `${whole.toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
  const negative = cents < 0 && (precision === 'cents' || whole > 0);
  const sign = negative ? '-' : signed && cents > 0 ? '+' : '';
  return `${sign}$${body}`;
}

/** Value of `sats` at `priceCents` per BTC, in cents (half-up, no floats). */
export function satsToCents(sats: number, priceCents: number): number {
  return mulDivRoundHalfUp(sats, priceCents, SATS_PER_BTC);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-11-02` as `Nov 2`, or `Oct 30, 2025` if not in `todayDate`'s year. */
export function shortDate(date: string, todayDate: string): string {
  const [y = '', m = '1', d = '1'] = date.split('-');
  const base = `${MONTHS[Number(m) - 1] ?? ''} ${Number(d)}`;
  return y === todayDate.slice(0, 4) ? base : `${base}, ${y}`;
}
