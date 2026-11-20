/**
 * Runtime validation of entries (imported JSON, synced data, and every entry replay sees).
 * Unknown fields are rejected so typos cannot silently drop data.
 */
import { instantMs, isValidInstant, isValidLocalDate, isValidTimeZone } from './dates.ts';
import { STATE_RATES } from './tax/tables/state.ts';
import { err, ok } from './result.ts';
import { FILING_STATUSES, LOST_CAUSES, TIERS, WALLET_TYPES, type Entry, type EntryKind, type Result } from './types.ts';

type Check = (v: unknown) => boolean;
type Field = readonly [check: Check, required: boolean];
type Schema = Readonly<Record<string, Field>>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const isString: Check = (v) => typeof v === 'string';
const isText: Check = (v) => typeof v === 'string' && v.trim() !== '';
const isPositiveInt: Check = (v) => Number.isSafeInteger(v) && (v as number) > 0;
const isNonNegativeInt: Check = (v) => Number.isSafeInteger(v) && (v as number) >= 0;
const isBoolean: Check = (v) => typeof v === 'boolean';
const isInstant: Check = (v) => typeof v === 'string' && isValidInstant(v);
const isDate: Check = (v) => typeof v === 'string' && isValidLocalDate(v);
const isYear: Check = (v) => Number.isSafeInteger(v) && (v as number) >= 1970 && (v as number) <= 9999;
const isTimeZone: Check = (v) => typeof v === 'string' && isValidTimeZone(v);
const isRateTenThousandths: Check = (v) => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= 10_000;
const isStateCode: Check = (v) => typeof v === 'string' && Object.hasOwn(STATE_RATES, v);
const isPercent: Check = (v) => typeof v === 'number' && v >= 0 && v <= 100;
const oneOf =
  (values: readonly string[]): Check =>
  (v) =>
    typeof v === 'string' && values.includes(v);

const req = (check: Check): Field => [check, true];
const opt = (check: Check): Field => [check, false];

/** First problem with `o` against `schema`, or null. */
function schemaError(o: Record<string, unknown>, schema: Schema): string | null {
  for (const key of Object.keys(o)) if (!Object.hasOwn(schema, key)) return `unknown field "${key}"`;
  for (const [key, [check, required]] of Object.entries(schema)) {
    const v = o[key];
    if (v === undefined) {
      if (required) return `missing "${key}"`;
    } else if (!check(v)) {
      return `invalid "${key}"`;
    }
  }
  return null;
}

const matches =
  (schema: Schema): Check =>
  (v) =>
    isRecord(v) && schemaError(v, schema) === null;

/** A tagged union of objects: the `field` value picks the schema. */
const taggedUnion =
  (field: string, schemas: Readonly<Record<string, Schema>>): Check =>
  (v) =>
    isRecord(v) && typeof v[field] === 'string' && Object.hasOwn(schemas, v[field]) && matches(schemas[v[field]] as Schema)(v);

const isPicks: Check = (v) => Array.isArray(v) && v.length > 0 && v.every(matches({ lotId: req(isText), sats: req(isPositiveInt) }));

const isSource = taggedUnion('type', {
  income: { type: req(isString), description: opt(isString) },
  gift: { type: req(isString), giverCostCents: opt(isNonNegativeInt), giverAcquiredAt: opt(isInstant) },
  inherited: { type: req(isString) },
  'frozen-payout': { type: req(isString), fromWallet: req(isText) },
});

const isStateTax = taggedUnion('kind', {
  none: { kind: req(isString) },
  flat: { kind: req(isString), state: req(isStateCode) },
  custom: { kind: req(isString), rate: req(isRateTenThousandths) },
});

const isSettingsPatch = matches({
  filingStatus: opt(oneOf(FILING_STATUSES)),
  wagesCents: opt(isNonNegativeInt),
  state: opt(isStateTax),
  carryforwardStCents: opt(isNonNegativeInt),
  carryforwardLtCents: opt(isNonNegativeInt),
  givingEnabled: opt(isBoolean),
  givingName: opt(isText),
  givingPercent: opt(isPercent),
  givingMode: opt(oneOf(['before-tax', 'after-tax'])),
  earlierMoneyInCents: opt(isNonNegativeInt),
  timeZone: opt(isTimeZone),
});

const wallet = req(isText);
const sats = req(isPositiveInt);
const cents = req(isNonNegativeInt);
const tier = req(oneOf(TIERS));

const KIND_SCHEMAS: Readonly<Record<EntryKind, Schema>> = {
  wallet: { wallet, name: req(isText), type: req(oneOf(WALLET_TYPES)), defaultProof: req(isString) },
  'wallet-update': { wallet, name: opt(isText), archived: opt(isBoolean) },
  'wallet-freeze': { wallet },
  'wallet-close-out': { wallet, lossDate: opt(isDate), reason: req(isText) },
  'opening-lot': { wallet, acquiredAt: req(isInstant), sats, costCents: cents, tier, origin: req(isString) },
  buy: { wallet, sats, costCents: cents, tier },
  receive: { wallet, sats, valueCents: cents, source: req(isSource), tier: opt(oneOf(TIERS)) },
  move: { from: wallet, to: wallet, sats, feeSats: req(isNonNegativeInt), feeValueCents: cents, picks: req(isPicks) },
  sell: { wallet, sats, proceedsCents: cents, picks: req(isPicks), spent: req(isBoolean), description: opt(isString) },
  give: { wallet, sats, valueCents: cents, to: req(oneOf(['person', 'charity'])), recipient: req(isText), picks: req(isPicks) },
  lost: { wallet, sats, cause: req(oneOf(LOST_CAUSES)), picks: req(isPicks) },
  'balance-confirm': { wallet, sats: req(isNonNegativeInt) },
  'retirement-snapshot': { wallet, sats: req(isNonNegativeInt) },
  settings: { patch: req(isSettingsPatch) },
  'close-year': { year: req(isYear) },
  'unlock-year': { year: req(isYear), reason: req(isText) },
  'giving-paid': { year: req(isYear), cents },
  delete: { replaces: req(isText), reason: req(isText) },
};

const COMMON: Schema = {
  id: req(isText),
  kind: req(isString),
  at: req(isInstant),
  tz: req(isTimeZone),
  note: opt(isString),
  proof: opt(isString),
  replaces: opt(isText),
  reason: opt(isText),
};

/** Rules that span fields. */
function crossFieldError(e: Entry): string | null {
  if (e.replaces !== undefined && e.reason === undefined) return 'an edit or delete needs a reason';
  if (e.replaces === e.id) return 'an entry cannot replace itself';
  if ((e.kind === 'close-year' || e.kind === 'unlock-year') && e.replaces !== undefined) return 'closing or unlocking a year cannot be edited';
  if (e.kind === 'move' && e.from === e.to) return 'a move needs two different wallets';
  if (e.kind === 'move' && e.feeSats === 0 && e.feeValueCents !== 0) return 'fee value without fee sats';
  if (e.kind === 'receive' && e.source.type === 'gift' && e.source.giverAcquiredAt !== undefined && instantMs(e.source.giverAcquiredAt) > instantMs(e.at)) {
    return "the giver's acquisition is after the gift";
  }
  return null;
}

/** Validate an unknown value as an entry. The error is a short human-readable reason. */
export function parseEntry(value: unknown): Result<Entry, string> {
  if (!isRecord(value)) return err('entry must be an object');
  const kind = value['kind'];
  if (typeof kind !== 'string' || !Object.hasOwn(KIND_SCHEMAS, kind)) return err(`unknown kind "${String(kind)}"`);
  const problem = schemaError(value, { ...COMMON, ...KIND_SCHEMAS[kind as EntryKind] }) ?? crossFieldError(value as unknown as Entry);
  return problem === null ? ok(value as unknown as Entry) : err(problem);
}
