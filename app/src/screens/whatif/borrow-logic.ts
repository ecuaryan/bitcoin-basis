import type { BorrowPlan } from '@bitcoin-basis/engine';

/** `11.5` or `70` to 1/10000ths (1150, 7000). Up to two decimals, 0 to 100. Null if malformed. No floats. */
export function parsePercentBp(text: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{0,2}))?$/.exec(text.trim().replace(/%$/, ''));
  if (m === null) return null;
  const bp = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return bp > 10_000 ? null : bp;
}

/** 1/10000ths back to the text a person types: 1150 becomes `11.5`, 7000 becomes `70`. */
export function bpToInput(bp: number): string {
  const whole = Math.floor(bp / 100);
  const frac = bp % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}`;
}

/** Share of the price that can be lost before a trigger, as whole percent, rounded down (never overstates the room). */
export function roomPercent(bp: number): number {
  return Math.max(0, Math.floor(bp / 100));
}

export interface PriceScale {
  /** Left-to-right positions in percent for the markers. */
  liquidation: number;
  marginCall: number;
  today: number;
}

/** Positions of the three prices on one bar. The bar runs from $0 to a little above the highest of them. */
export function priceScale(plan: Pick<BorrowPlan, 'liquidationPriceCents' | 'marginCallPriceCents'>, todayCents: number): PriceScale {
  const top = Math.max(todayCents, plan.marginCallPriceCents, plan.liquidationPriceCents);
  const max = top + Math.floor(top / 18);
  const pos = (v: number): number => Math.min(100, Math.max(0, Math.round((v * 10_000) / max) / 100));
  return { liquidation: pos(plan.liquidationPriceCents), marginCall: pos(plan.marginCallPriceCents), today: pos(todayCents) };
}

export interface SavedScenario {
  id: string;
  wallet: string;
  loan: string;
  pledge: string;
  rate: string;
  marginCall: string;
  liquidation: string;
}

const KEY = 'bb.borrow.scenarios';

export function loadScenarios(storage: Pick<Storage, 'getItem'> = window.localStorage): SavedScenario[] {
  try {
    const raw: unknown = JSON.parse(storage.getItem(KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter((s): s is SavedScenario => typeof s === 'object' && s !== null && ['id', 'wallet', 'loan', 'pledge', 'rate', 'marginCall', 'liquidation'].every((k) => typeof (s as Record<string, unknown>)[k] === 'string'));
  } catch {
    return [];
  }
}

export function saveScenarios(list: readonly SavedScenario[], storage: Pick<Storage, 'setItem'> = window.localStorage): void {
  try {
    storage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage blocked: scenarios last until the page closes.
  }
}
