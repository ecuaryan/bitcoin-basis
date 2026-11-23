/**
 * Federal and state tax on a year's capital gains, for estimates (not tax advice).
 *
 * Model: wages are the only other income, the standard deduction is taken, no credits.
 *
 * Netting (Schedule D and the Capital Loss Carryover Worksheet):
 * 1. Carryforward losses join their own character: st − carryforward.st, lt − carryforward.lt.
 * 2. Short and long cross-net. A net gain is included in income; the long-term part of it
 *    (min(net LT, total net)) is taxed at 0/15/20%, stacked on top of ordinary taxable income.
 * 3. A net loss is deducted against wages up to the limit ($3,000; $1,500 MFS), and never more than
 *    taxable income before the deduction (IRC § 1212(b)(2): only the deduction that actually reduced income
 *    counts as used).
 * 4. The rest carries forward keeping character (§ 1212(b)(1)): the used deduction comes out of the
 *    short-term loss first, then long-term; a net gain of one character also absorbs loss of the other.
 *
 * Federal = ordinary tax on (taxable income − preferential gain) + 0/15/20% on the preferential gain,
 * capped at ordinary tax on all taxable income (the worksheet's "smaller of"), + 3.8% NIIT on
 * min(net investment income, MAGI − threshold). State = flat rate × net capital gain included in income
 * (or −the used loss deduction).
 *
 * Exactness: cents × rate (1/10000ths) is an exact integer, so every tax is kept as a BigInt in units of
 * 1/10000 cent and rounded half-up to cents only for reported figures. Federal and state are rounded
 * separately; total = round(exact federal + exact state), so it can differ from federal + state by one cent.
 */

import { divRoundHalfUp, type Cents } from '../money.ts';
import { federalTableFor } from './tables/index.ts';
import { STATE_RATES, type StateCode } from './tables/state.ts';
import { NIIT_RATE } from './tables/statutory.ts';
import { RATE_SCALE, type Bracket, type TaxFilingStatus, type TaxRate } from './types.ts';

/** A state from the table, or a custom flat rate in 1/10000ths (530 = 5.3%). */
export type StateChoice = { readonly code: StateCode } | { readonly customRate: TaxRate; readonly label?: string };

export interface Carryforward {
  /** Short-term loss carried, as a positive amount of cents. */
  readonly st: Cents;
  /** Long-term loss carried, as a positive amount of cents. */
  readonly lt: Cents;
}

export interface TaxInput {
  readonly year: number;
  readonly filingStatus: TaxFilingStatus;
  readonly wages: Cents;
  /** Net short-term gain this year (negative for a loss), before carryforward. */
  readonly st: Cents;
  /** Net long-term gain this year (negative for a loss), before carryforward. */
  readonly lt: Cents;
  /** Losses carried into this year. */
  readonly carryforward: Carryforward;
  readonly state: StateChoice;
}

export interface TaxAssumptions {
  /** Year asked for. */
  readonly year: number;
  /** Year of the federal table used. */
  readonly tableYear: number;
  /** True when `year` had no table: the earliest table is used for years before it, the latest for years after. */
  readonly fellBack: boolean;
  readonly filingStatus: TaxFilingStatus;
  readonly standardDeduction: Cents;
  readonly capitalLossLimit: Cents;
  readonly state: {
    readonly code: StateCode | null;
    readonly name: string;
    readonly rate: TaxRate;
    readonly year: number | null;
    readonly source: string | null;
  };
  readonly notes: readonly string[];
}

export interface Netting {
  /** Short-term after carryforward joined. */
  readonly st: Cents;
  /** Long-term after carryforward joined. */
  readonly lt: Cents;
  readonly net: Cents;
  /** Capital loss that reduced taxable income this year (≥ 0). */
  readonly lossDeduction: Cents;
  /** Net gain included in income, or −lossDeduction. */
  readonly includedInIncome: Cents;
  /** Long-term gain taxed at 0/15/20%. */
  readonly preferential: Cents;
  readonly taxableIncome: Cents;
}

export interface TaxResult {
  readonly federal: Cents;
  /** Each part rounded on its own; they can differ from `federal` by a cent. */
  readonly federalParts: { readonly ordinary: Cents; readonly longTerm: Cents; readonly niit: Cents };
  readonly state: Cents;
  /** round(exact federal + exact state). */
  readonly total: Cents;
  readonly carryforwardOut: Carryforward;
  readonly netting: Netting;
  readonly assumptions: TaxAssumptions;
}

export interface TaxEffect {
  readonly federal: Cents;
  readonly state: Cents;
  readonly total: Cents;
  /** Carryforward into next year (from the input with the capital items). */
  readonly carryforwardOut: Carryforward;
  readonly assumptions: TaxAssumptions;
}

export interface IncrementalTax extends TaxEffect {
  /** Carryforward into next year without the sale. */
  readonly baseCarryforwardOut: Carryforward;
}

export interface MarginalRates {
  readonly st: number;
  readonly lt: number;
}

const SCALE = BigInt(RATE_SCALE);
const ZERO = 0n;

const max = (a: bigint, b: bigint): bigint => (a > b ? a : b);
const min = (a: bigint, b: bigint): bigint => (a < b ? a : b);
const overlap = (lo: bigint, hi: bigint, bandLo: bigint, bandHi: bigint): bigint => max(ZERO, min(hi, bandHi) - max(lo, bandLo));

function safeInt(name: string, v: number, nonNegative = false): bigint {
  if (!Number.isSafeInteger(v)) throw new RangeError(`${name} must be a safe integer, got ${v}`);
  if (nonNegative && v < 0) throw new RangeError(`${name} must not be negative, got ${v}`);
  return BigInt(v);
}

function toCents(name: string, scaled: bigint): Cents {
  const out = Number(divRoundHalfUp(scaled, SCALE));
  if (!Number.isSafeInteger(out)) throw new RangeError(`${name} is too large`);
  return out;
}

function toNumber(name: string, v: bigint): Cents {
  const out = Number(v);
  if (!Number.isSafeInteger(out)) throw new RangeError(`${name} is too large`);
  return out;
}

/** Ordinary tax on `income` cents, scaled by RATE_SCALE. */
function ordinaryTax(brackets: readonly Bracket[], income: bigint): bigint {
  let tax = ZERO;
  let lo = ZERO;
  for (const b of brackets) {
    const hi = b.upTo === null ? income : BigInt(b.upTo);
    tax += overlap(lo, income, lo, hi) * BigInt(b.rate);
    lo = hi;
  }
  return tax;
}

function resolveState(choice: StateChoice): TaxAssumptions['state'] {
  if ('code' in choice) {
    const s = STATE_RATES[choice.code];
    if (s === undefined) throw new RangeError(`unknown state ${String(choice.code)}`);
    return { code: choice.code, name: s.name, rate: s.rate, year: s.year, source: s.source };
  }
  const rate = choice.customRate;
  if (!Number.isSafeInteger(rate) || rate < 0 || rate > RATE_SCALE) throw new RangeError(`custom state rate must be 0..${RATE_SCALE}, got ${rate}`);
  return { code: null, name: choice.label ?? 'Custom rate', rate, year: null, source: null };
}

interface Core {
  readonly ordinary: bigint;
  readonly longTerm: bigint;
  readonly niit: bigint;
  readonly federal: bigint;
  readonly state: bigint;
  readonly carryST: bigint;
  readonly carryLT: bigint;
  readonly netting: { st: bigint; lt: bigint; net: bigint; lossDeduction: bigint; included: bigint; preferential: bigint; taxable: bigint };
  readonly assumptions: TaxAssumptions;
}

function compute(input: TaxInput): Core {
  if (!Number.isSafeInteger(input.year)) throw new RangeError(`year must be an integer, got ${input.year}`);
  const wages = safeInt('wages', input.wages, true);
  const cfST = safeInt('carryforward.st', input.carryforward.st, true);
  const cfLT = safeInt('carryforward.lt', input.carryforward.lt, true);
  const st = safeInt('st', input.st) - cfST;
  const lt = safeInt('lt', input.lt) - cfLT;

  const { table, fellBack } = federalTableFor(input.year);
  const status = input.filingStatus;
  const deduction = BigInt(table.standardDeduction[status]);
  const limit = BigInt(table.capitalLossLimit[status]);
  const state = resolveState(input.state);

  const net = st + lt;
  // Taxable income before any capital loss deduction, unfloored (the worksheet's "adjusted taxable income").
  const beforeLoss = wages - deduction;
  const lossDeduction = net < ZERO ? min(min(-net, limit), max(ZERO, beforeLoss)) : ZERO;
  const included = net < ZERO ? -lossDeduction : net;
  const taxable = max(ZERO, beforeLoss + included);
  const preferential = net > ZERO && lt > ZERO ? min(min(lt, net), taxable) : ZERO;

  // § 1212(b): the used deduction offsets short-term loss first; a gain of one character absorbs the other's loss.
  const stLoss = max(ZERO, -st);
  const ltLoss = max(ZERO, -lt);
  const carryST = max(ZERO, stLoss - lossDeduction - max(ZERO, lt));
  const carryLT = max(ZERO, ltLoss - max(ZERO, st) - max(ZERO, lossDeduction - stLoss));

  const brackets = table.ordinary[status];
  const ordinaryIncome = taxable - preferential;
  const ordinaryPart = ordinaryTax(brackets, ordinaryIncome);
  const bands = table.longTerm[status];
  const top = ordinaryIncome + preferential;
  const zeroTop = BigInt(bands.zeroTop);
  const fifteenTop = BigInt(bands.fifteenTop);
  const at15 = overlap(ordinaryIncome, top, zeroTop, fifteenTop);
  const at20 = overlap(ordinaryIncome, top, fifteenTop, top);
  const withRates = ordinaryPart + at15 * 1500n + at20 * 2000n;
  const income = min(withRates, ordinaryTax(brackets, taxable));

  const magi = wages + included;
  const nii = max(ZERO, included);
  const niit = min(nii, max(ZERO, magi - BigInt(table.niitThreshold[status]))) * BigInt(NIIT_RATE);

  const notes: string[] = [];
  if (fellBack) notes.push(`No ${input.year} federal table; used the ${table.year < input.year ? 'latest' : 'earliest'} one (${table.year}).`);
  if (state.year !== null && state.year !== input.year) notes.push(`State rate is the ${state.year} rate.`);

  return {
    ordinary: ordinaryPart,
    longTerm: income - ordinaryPart,
    niit,
    federal: income + niit,
    state: included * BigInt(state.rate),
    carryST,
    carryLT,
    netting: { st, lt, net, lossDeduction, included, preferential, taxable },
    assumptions: {
      year: input.year,
      tableYear: table.year,
      fellBack,
      filingStatus: status,
      standardDeduction: table.standardDeduction[status],
      capitalLossLimit: table.capitalLossLimit[status],
      state,
      notes,
    },
  };
}

const carryOut = (c: Core): Carryforward => ({ st: toNumber('carryforward.st', c.carryST), lt: toNumber('carryforward.lt', c.carryLT) });

const wagesOnly = (input: TaxInput): TaxInput => ({ ...input, st: 0, lt: 0, carryforward: { st: 0, lt: 0 } });

/** Federal (ordinary + long-term + NIIT) and state tax for a year, with carryforward out by character. */
export function taxForYear(input: TaxInput): TaxResult {
  const c = compute(input);
  const n = c.netting;
  return {
    federal: toCents('federal', c.federal),
    federalParts: { ordinary: toCents('ordinary', c.ordinary), longTerm: toCents('longTerm', c.longTerm), niit: toCents('niit', c.niit) },
    state: toCents('state', c.state),
    total: toCents('total', c.federal + c.state),
    carryforwardOut: carryOut(c),
    netting: {
      st: toNumber('st', n.st),
      lt: toNumber('lt', n.lt),
      net: toNumber('net', n.net),
      lossDeduction: toNumber('lossDeduction', n.lossDeduction),
      includedInIncome: toNumber('includedInIncome', n.included),
      preferential: toNumber('preferential', n.preferential),
      taxableIncome: toNumber('taxableIncome', n.taxable),
    },
    assumptions: c.assumptions,
  };
}

interface ExactDelta { readonly federal: bigint; readonly state: bigint }

function effectExact(input: TaxInput): { delta: ExactDelta; core: Core } {
  const core = compute(input);
  const none = compute(wagesOnly(input));
  return { delta: { federal: core.federal - none.federal, state: core.state - none.state }, core };
}

/** a / b rounded toward minus infinity (b > 0). */
const floorDiv = (a: bigint, b: bigint): bigint => (a % b < ZERO ? a / b - 1n : a / b);

/**
 * Federal and state cents that add up exactly to the total (the exact sum, half-up), so "federal $X + state $Y"
 * always matches the total shown. Each part is its exact value rounded down or up: both start rounded down, and
 * the 0, 1 or 2 cents left go to the part with the larger remainder (largest remainder; federal on a tie).
 * Rounding each part on its own could miss the total by a cent.
 */
export function addingParts(federal: bigint, state: bigint): { federal: Cents; state: Cents; total: Cents } {
  const total = toCents('total', federal + state);
  const f = floorDiv(federal, SCALE);
  const s = floorDiv(state, SCALE);
  const left = BigInt(total) - f - s;
  const federalUp = left === 2n || (left === 1n && federal - f * SCALE >= state - s * SCALE);
  const stateUp = left === 2n || (left === 1n && !federalUp);
  return { federal: toNumber('federal', federalUp ? f + 1n : f), state: toNumber('state', stateUp ? s + 1n : s), total };
}

function report(d: ExactDelta): { federal: Cents; state: Cents; total: Cents } {
  return addingParts(d.federal, d.state);
}

/** Capital tax effect = tax with the capital items (gains, losses, carryforward) − tax with none (wages only). */
export function capitalTaxEffect(input: TaxInput): TaxEffect {
  const { delta, core } = effectExact(input);
  return { ...report(delta), carryforwardOut: carryOut(core), assumptions: core.assumptions };
}

/** Tax a sale adds ("Tax this adds"): capital tax effect with the sale − capital tax effect without it. */
export function incrementalTax(base: TaxInput, withSale: TaxInput): IncrementalTax {
  const b = effectExact(base);
  const w = effectExact(withSale);
  return {
    ...report({ federal: w.delta.federal - b.delta.federal, state: w.delta.state - b.delta.state }),
    carryforwardOut: carryOut(w.core),
    baseCarryforwardOut: carryOut(b.core),
    assumptions: w.core.assumptions,
  };
}

const STEP = 100; // one dollar, in cents

function ratesAt(input: TaxInput): MarginalRates {
  const base = compute(input);
  const total = (c: Core): bigint => c.federal + c.state;
  const rate = (bumped: TaxInput): number => Number(total(compute(bumped)) - total(base)) / (STEP * RATE_SCALE);
  return { st: rate({ ...input, st: input.st + STEP }), lt: rate({ ...input, lt: input.lt + STEP }) };
}

/**
 * Combined federal + state rate on the next dollar of short- and long-term gain, as plain numbers
 * (0.273 = 27.3%), for ranking lots. If the year's losses would absorb that dollar at both rates (both 0),
 * the rates at the wages-only position are returned instead, so lots still rank by what a gain would cost.
 */
export function marginalRates(input: TaxInput): MarginalRates {
  const here = ratesAt(input);
  return here.st === 0 && here.lt === 0 ? ratesAt(wagesOnly(input)) : here;
}
