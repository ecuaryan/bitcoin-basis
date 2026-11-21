import { oneYearAnniversary, termFor, type Lot, type LotPick } from '@bitcoin-basis/engine';
import { useId } from 'react';
import { cx } from '../../lib/cx.ts';
import { shortDate } from '../../lib/format.ts';
import { TIER_LABEL } from '../../lib/origin.ts';
import { Amount, Money } from '../../ui/Amount.tsx';
import { Segmented } from '../../ui/Segmented.tsx';
import { TIER_BG } from '../holdings-parts.tsx';
import { longDate, nextDay, type PickMode } from './model.ts';

/** Which coins a sale, move or gift will use. Oldest first by default; or tick the ones you want. */
export function CoinPicker({
  lots,
  needed,
  mode,
  onMode,
  chosen,
  onChosen,
  picks,
  onDate,
  today,
  walletName,
}: {
  /** The wallet's coins at that time, oldest first. */
  lots: readonly Lot[];
  needed: number | null;
  mode: PickMode;
  onMode(m: PickMode): void;
  chosen: ReadonlySet<string>;
  onChosen(next: Set<string>): void;
  /** What would be used right now (null when it does not add up). */
  picks: readonly LotPick[] | null;
  /** Local date of the entry, to say short- or long-term. */
  onDate: string;
  today: string;
  /** For the empty message: "No coins in Strike on Nov 20, 2026." */
  walletName?: string;
}) {
  const id = useId();
  const used = new Map((picks ?? []).map((p) => [p.lotId, p.sats]));
  const have = lots.reduce((s, l) => s + l.sats, 0);
  const chosenSats = lots.filter((l) => chosen.has(l.id)).reduce((s, l) => s + l.sats, 0);
  const shown = mode === 'oldest' ? lots.filter((l) => used.has(l.id)) : lots;

  function switchMode(m: PickMode) {
    if (m === 'hand' && chosen.size === 0) onChosen(new Set(used.keys()));
    onMode(m);
  }
  function toggle(lotId: string) {
    const next = new Set(chosen);
    if (next.has(lotId)) next.delete(lotId);
    else next.add(lotId);
    onChosen(next);
  }

  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2.5 border-0 p-0">
      <legend className="mb-1 p-0 text-xs text-muted">Which coins</legend>
      <Segmented<PickMode>
        label="How to choose coins"
        value={mode}
        onChange={switchMode}
        options={[
          { value: 'oldest', label: 'Oldest first' },
          { value: 'hand', label: 'Choose coins' },
        ]}
      />
      {needed === null ? (
        <p className="m-0 text-xs text-muted">Enter an amount to see which coins it would use.</p>
      ) : mode === 'oldest' ? (
        picks === null ? (
          <p role="status" className="m-0 text-[13px] text-loss">
            The wallet holds <Amount sats={have} interactive={false} /> at that time. That is not enough.
          </p>
        ) : (
          <p className="m-0 text-xs text-muted">
            Uses {picks.length} {picks.length === 1 ? 'coin' : 'coins'}, oldest first. Saved with the entry.
          </p>
        )
      ) : (
        <p role="status" className={cx('m-0 text-[13px]', picks === null ? 'text-amber' : 'text-muted')}>
          {picks === null ? (
            <>
              Ticked <Amount sats={chosenSats} interactive={false} /> of <Amount sats={needed} interactive={false} /> needed. Tick more coins.
            </>
          ) : (
            <>
              Ticked coins cover it. The newest ticked coin is used only as far as needed.
            </>
          )}
        </p>
      )}
      {lots.length === 0 ? (
        <p className="m-0 rounded-xl border border-line bg-bg px-3 py-2.5 text-[13px] text-muted">
          No coins in {walletName ?? 'this wallet'} on {longDate(onDate)}.
        </p>
      ) : shown.length === 0 ? null : (
        <ul aria-label="Coins in this wallet" className={cx('m-0 flex list-none flex-col rounded-2xl border border-line bg-bg p-0', mode === 'hand' && 'max-h-72 overflow-y-auto')}>
          {shown.map((lot) => {
            const take = used.get(lot.id);
            const long = termFor(lot, onDate) === 'long';
            const term = long ? 'Long-term' : `Long-term on ${shortDate(nextDay(oneYearAnniversary(lot.acquiredDate)), today)}`;
            const rowId = `${id}-${lot.id}`;
            const body = (
              <>
                <span className={cx('h-11 w-1.5 flex-none rounded-full', TIER_BG[lot.tier])} aria-hidden="true" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-semibold">
                    <Amount sats={lot.sats} interactive={false} short />
                    {take !== undefined && take !== lot.sats ? (
                      <span className="font-normal text-muted">
                        {' '}
                        · uses <Amount sats={take} interactive={false} short />
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted">
                    {shortDate(lot.acquiredDate, today)} · {TIER_LABEL[lot.tier]}
                  </span>
                  <span className={cx('text-xs normal-nums', long ? 'text-muted' : 'font-semibold text-amber')}>{term}</span>
                </span>
                <span className="flex-none text-[13px] font-semibold">
                  <Money cents={lot.costCents} />
                </span>
              </>
            );
            return (
              <li key={lot.id} className="border-b border-line last:border-b-0">
                {mode === 'hand' ? (
                  <label htmlFor={rowId} className="flex min-h-16 cursor-pointer items-center gap-3 px-3 py-2">
                    <input id={rowId} type="checkbox" checked={chosen.has(lot.id)} onChange={() => toggle(lot.id)} className="size-5 flex-none accent-[var(--color-accent)]" />
                    {body}
                  </label>
                ) : (
                  <div className="flex min-h-16 items-center gap-3 px-3 py-2">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}
