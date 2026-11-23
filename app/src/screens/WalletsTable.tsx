import { cx } from '../lib/cx.ts';
import { countOf } from '../lib/format.ts';
import { type HoldingsView, type WalletCard } from '../lib/holdings-view.ts';
import { Amount } from '../ui/Amount.tsx';
import { Card } from '../ui/Card.tsx';
import { ChevronRightIcon } from '../ui/icons.tsx';
import { PlainMoney } from '../ui/plain-money.tsx';
import { Link } from 'react-router';
import { Percent, tone } from './purchase-table.tsx';
import { AddWalletButton } from './wallet/AddWallet.tsx';

/**
 * One grid, each row a subgrid, so every column lines up. Narrow: Wallet · Bitcoin · Gain or loss, two lines each
 * (name over type, BTC over worth, gain over percent), the balance check on a third line across the row. Wide: the
 * balance check gets its own column and a chevron closes the row.
 */
const TABLE =
  'grid grid-cols-[minmax(0,1fr)_max-content_max-content] gap-x-3 tabular-nums @min-[38rem]:grid-cols-[minmax(0,1fr)_max-content_max-content_minmax(max-content,0.9fr)_1rem] @min-[38rem]:gap-x-6';
const ROW = 'col-span-full grid grid-cols-subgrid';
const WIDE_ONLY = 'hidden @min-[38rem]:block';
/** Cell places: row 1 is the main line, row 2 the line under it. */
const C = {
  name: 'col-start-1 row-start-1 text-sm font-semibold [overflow-wrap:anywhere]',
  type: 'col-start-1 row-start-2 text-xs text-muted',
  btc: 'col-start-2 row-start-1 text-right text-sm font-semibold',
  worth: 'col-start-2 row-start-2 text-right text-xs text-muted',
  gain: 'col-start-3 row-start-1 text-right text-[13px] font-semibold',
  pct: 'col-start-3 row-start-2 text-right text-xs',
  status: 'col-span-3 col-start-1 row-start-3 pt-0.5 text-xs @min-[38rem]:col-span-1 @min-[38rem]:col-start-4 @min-[38rem]:row-start-1 @min-[38rem]:pt-0.5',
  chevron: 'hidden @min-[38rem]:col-start-5 @min-[38rem]:row-span-2 @min-[38rem]:row-start-1 @min-[38rem]:block @min-[38rem]:self-center',
};

/** A frozen wallet (a platform that stopped withdrawals) is listed but never counted. */
const FROZEN_LABEL = 'Frozen, not counted';

function status(w: WalletCard): { text: string; amber: boolean } {
  if (w.frozen) return { text: FROZEN_LABEL, amber: false };
  if (w.needsAttention) return { text: 'Needs a check', amber: true };
  return { text: w.confirmedLabel, amber: false };
}

/** Whole dollars with a sign and the gain or loss color; `even` for $0. */
function GainCell({ cents }: { cents: number }) {
  return (
    <span className={cx(C.gain, tone(cents))}>
      <span className="sr-only">, {cents >= 0 ? 'up ' : 'down '}</span>
      {cents === 0 ? 'even' : <PlainMoney cents={cents} precision="dollars" signed />}
    </span>
  );
}

function WalletLine({ w }: { w: WalletCard }) {
  const s = status(w);
  const shown = w.shown;
  return (
    <li className={cx(ROW, 'border-b border-line-soft')}>
      <Link to={`/wallet/${w.id}`} className={cx(ROW, 'group -mx-2 gap-y-0.5 rounded-xl px-2 py-3 text-text no-underline hover:bg-surface-2 hover:text-text active:bg-surface-2')}>
        <span className={C.name}>{w.name}</span>
        <span className={C.type}>{w.typeLabel}</span>
        <span className={cx(C.btc, w.frozen && 'text-muted')}>
          <span className="sr-only">, </span>
          <Amount sats={w.sats} interactive={false} alwaysBtc />
          <span className="sr-only"> BTC</span>
        </span>
        <span className={C.worth}>
          {shown === null ? (
            '—'
          ) : (
            <>
              <span className="sr-only">, worth </span>
              <PlainMoney cents={shown.valueCents} precision="dollars" />
            </>
          )}
        </span>
        {w.frozen ? <span className={cx(C.gain, 'font-normal text-muted')}>Not counted</span> : shown === null ? <span className={cx(C.gain, 'text-muted')}>—</span> : <GainCell cents={shown.gainCents} />}
        {w.worth !== null && shown !== null ? <Percent worth={w.worth} className={C.pct} /> : null}
        <span className={cx(C.status, s.amber ? 'text-amber' : 'text-muted')}>
          <span className="sr-only">, </span>
          {s.text}
        </span>
        <ChevronRightIcon size={16} className={cx(C.chevron, 'text-muted transition-transform group-hover:translate-x-0.5')} />
      </Link>
    </li>
  );
}

/** Holdings: every wallet in one aligned table, the counted ones with a total that matches the unrealized gain, then frozen ones. */
export function WalletsCard({ view }: { view: HoldingsView }) {
  const total = view.walletsTotal;
  return (
    <Card as="section" aria-label="Wallets" className="@container flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <h2 className="m-0 text-[15px] font-semibold">Wallets</h2>
        <AddWalletButton compact />
      </div>
      <div className={TABLE}>
        <div aria-hidden="true" className={cx(ROW, 'border-b border-line pb-2 pt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted')}>
          <span>Wallet</span>
          <span className="text-right">Bitcoin</span>
          <span className="text-right">Gain or loss</span>
          <span className={WIDE_ONLY}>Balance check</span>
        </div>
        <ul aria-label="Wallets, biggest first" className={cx(ROW, 'm-0 list-none p-0')}>
          {view.wallets.map((w) => (
            <WalletLine key={w.id} w={w} />
          ))}
        </ul>
        {view.wallets.length > 1 ? (
          <div role="group" aria-label="All counted wallets" className={cx(ROW, 'gap-y-0.5 py-3')}>
            <span className={C.name}>Total</span>
            <span className={C.type}>{countOf(view.wallets.length, 'wallet')}</span>
            <span className={C.btc}>
              <span className="sr-only">, </span>
              <Amount sats={total.worth.sats} interactive={false} alwaysBtc />
              <span className="sr-only"> BTC</span>
            </span>
            <span className={C.worth}>
              {total.shownValueCents === null ? (
                '—'
              ) : (
                <>
                  <span className="sr-only">, worth </span>
                  <PlainMoney cents={total.shownValueCents} precision="dollars" />
                </>
              )}
            </span>
            {total.shownGainCents === null ? <span className={cx(C.gain, 'text-muted')}>—</span> : <GainCell cents={total.shownGainCents} />}
            {total.shownGainCents === null ? null : <Percent worth={total.worth} className={C.pct} />}
          </div>
        ) : null}
        {view.frozen.length > 0 ? (
          <ul aria-label="Frozen wallets, not counted" className={cx(ROW, 'm-0 list-none border-t border-line p-0')}>
            {view.frozen.map((w) => (
              <WalletLine key={w.id} w={w} />
            ))}
          </ul>
        ) : null}
      </div>
    </Card>
  );
}
