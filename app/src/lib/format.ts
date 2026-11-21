import { formatBtc, mulDivRoundHalfUp, SATS_PER_BTC } from '@bitcoin-basis/engine';

/** A hidden dollar amount: always this one shape, so its length says nothing about the amount. */
export const MASKED_MONEY = '$•••••';
/** A hidden BTC amount, always this shape. */
export const MASKED_BTC = '•.•••• ••••';
/** A hidden sats amount, always this shape. */
export const MASKED_SATS = '•••••••';

/**
 * A hidden amount in one fixed shape that never shows its size: `$319,206` and `$4.10` both become `$•••••`,
 * `0.0074 2665 BTC` becomes `•.•••• •••• BTC`. A leading + or − and a trailing unit stay (where the words already say up or down).
 */
export function maskDigits(text: string): string {
  const sign = /^[+\u2212-]/.exec(text)?.[0] ?? '';
  const unit = / (BTC|sats)$/.exec(text)?.[0] ?? '';
  const body = text.slice(sign.length, text.length - unit.length);
  const shape = body.startsWith('$') ? MASKED_MONEY : body.includes('.') || unit === ' BTC' ? MASKED_BTC : MASKED_SATS;
  return `${sign}${shape}${unit}`;
}

/** Sats as BTC with 8 decimals in two groups of four: `0.0074 2665`. */
export function groupedBtc(sats: number): string {
  const [whole = '0', frac = '00000000'] = formatBtc(sats).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${grouped}.${frac.slice(0, 4)} ${frac.slice(4)}`;
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

/** Cents as dollars: `$1,234.56`, `−$1,234.56` (a real minus sign), `+$180,329`. */
export function formatMoney(cents: number, { precision = 'cents', signed = false }: MoneyFormat = {}): string {
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const body = precision === 'dollars' ? whole.toLocaleString('en-US') : `${whole.toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
  const negative = cents < 0 && (precision === 'cents' || whole > 0);
  const sign = negative ? '\u2212' : signed && cents > 0 ? '+' : '';
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

/** How long ago a wallet's balance last matched, the same words everywhere: `Confirmed Nov 21`, `Confirmed today`, `Not confirmed yet`. */
export function confirmedLabel(date: string | null, today: string): string {
  return date === null ? 'Not confirmed yet' : date === today ? 'Confirmed today' : `Confirmed ${shortDate(date, today)}`;
}

/** `1 lot`, `2 lots`: a count with its noun, pluralised with an "s" unless `plural` is given. */
export function countOf(n: number, noun: string, plural = `${noun}s`): string {
  return `${n} ${n === 1 ? noun : plural}`;
}

/** `2026-11-02` as `Nov 2, 2026` (always with the year). */
export function longDate(date: string): string {
  const [y = '', m = '1', d = '1'] = date.split('-');
  return `${MONTHS[Number(m) - 1] ?? ''} ${Number(d)}, ${y}`;
}

interface ClockParts {
  y: number;
  mo: number;
  d: number;
  time: string;
}

function clockIn(ms: number, tz: string | undefined): ClockParts {
  let f: Intl.DateTimeFormat;
  try {
    f = new Intl.DateTimeFormat('en-US', { ...(tz === undefined ? {} : { timeZone: tz }), year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  } catch {
    f = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  }
  const v: Record<string, string> = {};
  for (const p of f.formatToParts(new Date(ms))) v[p.type] = p.value;
  return { y: Number(v['year']), mo: Number(v['month']), d: Number(v['day']), time: `${v['hour'] ?? '12'}:${v['minute'] ?? '00'} ${(v['dayPeriod'] ?? 'AM').toUpperCase()}` };
}

/** The clock time of a moment, `9:02 AM`, read on `tz`. */
export function clockTime(at: string | number, tz?: string): string {
  const ms = typeof at === 'number' ? at : Date.parse(at);
  return Number.isNaN(ms) ? '' : clockIn(ms, tz).time;
}

/**
 * The one way to show a moment: `Today, 5:55 PM` for today, `Nov 20, 2025 · 5:55 PM` for any other day.
 * `at` is an ISO instant or epoch milliseconds; `tz` is the clock to read it on (default: this device's).
 */
export function formatWhen(at: string | number, nowMs: number, tz?: string): string {
  const ms = typeof at === 'number' ? at : Date.parse(at);
  if (Number.isNaN(ms)) return '';
  const c = clockIn(ms, tz);
  const n = clockIn(nowMs, tz);
  if (c.y === n.y && c.mo === n.mo && c.d === n.d) return `Today, ${c.time}`;
  return `${MONTHS[c.mo - 1] ?? ''} ${c.d}, ${c.y} \u00b7 ${c.time}`;
}

/** A calendar day as `Today` or `Nov 20, 2026`. */
export function formatDay(date: string, today: string): string {
  return date === today ? 'Today' : longDate(date);
}

// ---- Typed numbers (shared by the formatted inputs) ---------------------------------------

/** Keep digits and one dot, at most `maxDecimals` after it: `$94,812.40 USD` becomes `94812.40`. */
export function cleanDecimal(text: string, maxDecimals: number): string {
  let out = '';
  let dot = false;
  let decimals = 0;
  for (const ch of text) {
    if (ch >= '0' && ch <= '9') {
      if (dot) {
        if (decimals >= maxDecimals) continue;
        decimals += 1;
      }
      out += ch;
    } else if (ch === '.' && !dot && maxDecimals > 0) {
      dot = true;
      out += '.';
    }
  }
  if (out.startsWith('.')) out = `0${out}`;
  return out.replace(/^0+(?=\d)/, '');
}

const withCommas = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** `130000` as `130,000`, `94812.4` as `94,812.40` (what a dollar box shows when you leave it). */
export function prettyDollars(clean: string): string {
  if (clean === '' || clean === '.') return '';
  const [whole = '0', frac] = clean.split('.');
  return `${withCommas(whole === '' ? '0' : whole)}${frac === undefined ? '' : `.${frac.padEnd(2, '0')}`}`;
}

/** `1` as `1.0000 0000`, `1234.5` as `1,234.5000 0000`. */
export function prettyBtc(clean: string): string {
  if (clean === '' || clean === '.') return '';
  const [whole = '0', frac = ''] = clean.split('.');
  const f = frac.padEnd(8, '0');
  return `${withCommas(whole === '' ? '0' : whole)}.${f.slice(0, 4)} ${f.slice(4)}`;
}
