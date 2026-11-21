import type { Lot, SellEntry } from '@bitcoin-basis/engine';
import type { ReactNode } from 'react';
import { Amount, Money } from '../../ui/Amount.tsx';
import type { Draft } from './draft.ts';
import { whenLabel } from './model.ts';

/**
 * The one review a sale ends on, shared by the Log sheet and What if: same title, same rows, same buttons.
 * `Review` adds the coins used and the tax effect underneath.
 */
export function saleDraft({ entry, walletName, lots, onDate, nowMs, extra }: { nowMs: number; entry: SellEntry; walletName: string; lots: readonly Lot[]; onDate: string; extra?: ReactNode }): Draft {
  const spent = entry.spent === true;
  return {
    title: spent ? 'Log your spending' : 'Log your sale',
    saveLabel: spent ? 'Save spending' : 'Save sale',
    savedMessage: spent ? 'Spending saved.' : 'Sale saved.',
    rows: [
      { label: spent ? 'Spent' : 'Sold', value: <Amount sats={entry.sats} interactive={false} showUnit /> },
      { label: spent ? 'Worth' : 'Dollars received', value: <Money cents={entry.proceedsCents} /> },
      ...(spent && entry.description !== undefined ? [{ label: 'What it bought', value: entry.description }] : []),
      { label: 'From', value: walletName },
      { label: 'When', value: whenLabel(entry.at, entry.tz, nowMs) },
    ],
    coins: { picks: entry.picks, lots, onDate },
    build: () => [entry],
    ...(extra === undefined ? {} : { extra }),
  };
}
