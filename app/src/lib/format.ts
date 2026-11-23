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

/**
 * Which way a compact figure rounds: `half-up` (the nearest), `up` (never less than it is: a shortfall) or `down` (never
 * more than it is: something left over).
 */
export type Rounding = 'half-up' | 'up' | 'down';

/**
 * BTC to 4 decimals, rounded half-up on sats (or `up` / `down`), for compact lists: `1.1802`. An amount too small to show
 * in 4 decimals keeps all 8 (`0.0000 4999`), so a few sats are never shown as zero. Sats are never negative here.
 */
export function shortBtc(sats: number, round: Rounding = 'half-up'): string {
  const rounded = Math.floor((sats + (round === 'up' ? 9_999 : round === 'down' ? 0 : 5_000)) / 10_000); // units of 0.0001 BTC
  if (rounded === 0 && sats !== 0) return groupedBtc(sats);
  const whole = Math.floor(rounded / 10_000);
  return `${whole}.${String(rounded % 10_000).padStart(4, '0')}`;
}

export interface MoneyFormat {
  /**
   * `cents` shows $1,234.56. `dollars` drops the cents, rounding toward zero so gains are never overstated; an amount
   * under $1 (not $0) keeps its cents (`$0.40`), so it is never shown as $0.
   */
  precision?: 'cents' | 'dollars';
  /** Put a + in front of gains. */
  signed?: boolean;
}

/**
 * Parts shown in whole dollars under a total shown in whole dollars, so the parts add up to the total exactly (largest
 * remainder). Each part starts at its whole dollars toward zero, as `formatMoney` shows it; the dollar or two they fall
 * short of the total's (toward zero) go to the parts closest to their next dollar, in the total's direction. Returns cents
 * (whole dollars) to show with `precision: 'dollars'`. A part under $1 (not $0) keeps its cents, as `formatMoney` shows
 * it. Null parts stay null and are left out.
 */
export function wholeDollarParts(parts: readonly (number | null)[], total: number): (number | null)[] {
  const whole = (c: number): number => Math.trunc(c / 100) * 100;
  const out = parts.map((p) => (p === null ? null : Math.abs(p) < 100 ? p : whole(p)));
  const shown = out.reduce<number>((t, p) => t + (p ?? 0), 0);
  let left = Math.round((whole(total) - shown) / 100);
  const step = Math.sign(left);
  // Closest to the next dollar in the total's direction first; earlier first on a tie. Parts under $1 keep their cents.
  const order = parts
    .map((p, i) => ({ i, rem: p === null || Math.abs(p) < 100 ? -1 : (step > 0 ? p - whole(p) : whole(p) - p) }))
    .filter((x) => x.rem > 0)
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const { i } of order) {
    if (left === 0) break;
    out[i] = (out[i] as number) + step * 100;
    left -= step;
  }
  return out;
}

/** Cents as dollars: `$1,234.56`, `−$1,234.56` (a real minus sign), `+$180,329`. */
export function formatMoney(cents: number, { precision = 'cents', signed = false }: MoneyFormat = {}): string {
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const dollars = precision === 'dollars' && (whole > 0 || abs === 0);
  const body = dollars ? whole.toLocaleString('en-US') : `${whole.toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
  const negative = cents < 0;
  const sign = negative ? '\u2212' : signed && cents > 0 ? '+' : '';
  return `${sign}$${body}`;
}

/**
 * Whole-percent shares of a total that add up to 100% (largest remainder: each share rounded down, the leftover points
 * to the largest remainders, earlier first on a tie), with two rules so a share is never misleading: only a part that is
 * all of the total shows `100%` (a part that is not gets 99% and the point goes to the next), and a part that is not zero
 * never shows `0%` (`under 1%` instead). Parts are whole sats; integer math (BigInt), no floats.
 */
export function sharePercents(parts: readonly number[]): string[] {
  const total = parts.reduce((t, p) => t + BigInt(p), 0n);
  if (total <= 0n) return parts.map(() => '0%');
  const pts = parts.map((p) => Number((BigInt(p) * 100n) / total));
  const rem = parts.map((p) => (BigInt(p) * 100n) % total);
  const order = parts.map((_, i) => i).sort((a, b) => ((rem[a] as bigint) === (rem[b] as bigint) ? a - b : (rem[a] as bigint) > (rem[b] as bigint) ? -1 : 1));
  let left = 100 - pts.reduce((t, p) => t + p, 0);
  for (const i of order) {
    if (left <= 0) break;
    pts[i] = (pts[i] as number) + 1;
    left -= 1;
  }
  parts.forEach((p, i) => {
    if (pts[i] !== 100 || BigInt(p) === total) return;
    pts[i] = 99;
    const next = order.find((j) => j !== i && (parts[j] as number) > 0) as number;
    pts[next] = (pts[next] as number) + 1;
  });
  return parts.map((p, i) => (p === 0 ? '0%' : pts[i] === 0 ? 'under 1%' : `${pts[i]}%`));
}

/** Value of `sats` at `priceCents` per BTC, in cents (half-up, no floats). */
export function satsToCents(sats: number, priceCents: number): number {
  return mulDivRoundHalfUp(sats, priceCents, SATS_PER_BTC);
}

/** `satsToCents` rounded `up` or `down` to the cent (whole sats and cents, BigInt): a shortfall never shown smaller, a leftover never bigger. */
export function satsToCentsRounded(sats: number, priceCents: number, round: Rounding): number {
  if (round === 'half-up') return satsToCents(sats, priceCents);
  const n = BigInt(sats) * BigInt(priceCents);
  const d = BigInt(SATS_PER_BTC);
  return Number(round === 'up' ? (n + d - 1n) / d : n / d);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * `2026-11-02` as `Nov 2, 2026`: always with the year, so no date ever makes you wonder which year it is.
 */
export function shortDate(date: string): string {
  const [y = '', m = '1', d = '1'] = date.split('-');
  return `${MONTHS[Number(m) - 1] ?? ''} ${Number(d)}, ${y}`;
}

/** How long ago a wallet's balance last matched, the same words everywhere: `Confirmed Nov 21`, `Confirmed today`, `Not confirmed yet`. */
export function confirmedLabel(date: string | null, today: string): string {
  return date === null ? 'Not confirmed yet' : date === today ? 'Confirmed today' : `Confirmed ${shortDate(date)}`;
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

/** When a price is from, short: `3:12 PM` today, `Nov 19, 3:12 PM` this year, `Nov 19, 2025, 3:12 PM` before. */
export function shortWhen(at: number, nowMs: number, tz?: string): string {
  const c = clockIn(at, tz);
  const n = clockIn(nowMs, tz);
  if (c.y === n.y && c.mo === n.mo && c.d === n.d) return c.time;
  const day = `${MONTHS[c.mo - 1] ?? ''} ${c.d}`;
  return c.y === n.y ? `${day}, ${c.time}` : `${day}, ${c.y}, ${c.time}`;
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

/**
 * How long coins have been held, in whole units toward zero: `Bought today`, `Held 12 days`, `Held 8 months`, `Held 2 yr
 * 3 mo`. Days until two whole months have passed, so the count never drops (`Held 60 days`, then `Held 2 months`).
 */
export function heldLabel(days: number): string {
  if (days < 1) return 'Bought today';
  const months = Math.floor((days * 12) / 365);
  if (months < 2) return `Held ${countOf(days, 'day')}`;
  if (months < 12) return `Held ${countOf(months, 'month')}`;
  const years = Math.floor(months / 12);
  return months % 12 === 0 ? `Held ${countOf(years, 'year')}` : `Held ${years} yr ${months % 12} mo`;
}
