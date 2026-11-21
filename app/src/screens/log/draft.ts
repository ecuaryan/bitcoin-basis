import type { Entry, Lot, LotPick } from '@bitcoin-basis/engine';
import type { ReactNode } from 'react';

/** `retirement-buy` has no tab: a retirement wallet's page opens it (and its edits). */
export type LogKind = 'buy' | 'receive' | 'move' | 'sell' | 'give' | 'retirement-buy';

/** Where a Log sheet opens and what it starts with. */
export interface LogPreset {
  kind?: LogKind;
  wallet?: string;
  /** Start with this amount (for example the part of a balance that is not logged yet). */
  sats?: number;
  /** Edit this entry (a new entry replaces it, with a reason). */
  edit?: string;
  /** Remove this entry (a new entry replaces it, with a reason). */
  remove?: string;
  /** Received: start on a payout from this frozen wallet. */
  payoutFrom?: string;
  /** Sold: start from these coins and amount (after a prepare-a-sale move). */
  sell?: { wallet: string; sats: number; lotIds: string[] };
  /** Moved: start with these coins (prepare a sale), then continue to the sale. */
  move?: { from: string; sats: number; lotIds: string[]; thenSell: boolean };
  /** Received from a wallet's own "log a payout" shortcut, or any other start. */
  source?: 'income' | 'frozen-payout' | 'gift' | 'inherited';
}

export type AfterSave = { next: { kind: LogKind; preset: LogPreset } } | { giftNote: string } | null;

export interface DraftRow {
  label: string;
  value: ReactNode;
}

/** Everything the review screen needs to show and save one action. */
export interface Draft {
  title: string;
  saveLabel: string;
  rows: DraftRow[];
  coins?: { picks: readonly LotPick[]; lots: readonly Lot[]; onDate: string };
  /** The entries to save. `reason` is filled when an edit or removal needs one. */
  build(reason: string): Entry[];
  /** Id of the entry this replaces (edits and removals). */
  replacing?: string;
  /** Removal: no tax effect is shown, only what would break. */
  removing?: boolean;
  /** Label of the button that leaves the review (default `Back`). */
  backLabel?: string;
  afterSave?(saved: Entry[]): AfterSave;
  /** Extra content under the effect (for example the gift note preview). */
  extra?: ReactNode;
  /** Past tense for the toast: "Purchase saved." */
  savedMessage: string;
  /** Save straight from the form (no review step) when nothing blocks it. Used for a purchase and a move. */
  direct?: boolean;
}

export interface FormProps {
  /** The entry being edited, if any (already the newest version). */
  initial: Entry | null;
  preset: LogPreset;
  onReview(draft: Draft): void;
  onSwitch(kind: LogKind, preset?: LogPreset): void;
}
