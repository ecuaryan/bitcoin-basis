import type { DisposalPick, SalePlan, Tier } from '@bitcoin-basis/engine';
import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../../lib/cx.ts';
import { TIER_LABEL } from '../../lib/origin.ts';
import { countOf, maskDigits, shortDate } from '../../lib/format.ts';
import { Amount, Money } from '../../ui/Amount.tsx';
import { CheckIcon, ChevronDownIcon, InfoIcon } from '../../ui/more-icons.tsx';
import { PlainMoney } from '../../ui/plain-money.tsx';
import { usePrefs } from '../../ui/prefs.tsx';
import { tone } from '../purchase-table.tsx';
import { carriedOut, lotsUsed, rangeLabel, riskPercentFromBp, taxShown, termLabel, type Segment } from './sell-logic.ts';

export const TIER_DOT: Record<Tier, string> = { documented: 'bg-accent', reconstructed: 'bg-cream', estimated: 'bg-tier-estimated', unknown: 'bg-tier-unknown' };

export function TierChip({ tier }: { tier: Tier }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-soft">
      <span aria-hidden="true" className={cx('size-2 rounded-full', TIER_DOT[tier])} />
      {TIER_LABEL[tier]}
    </span>
  );
}

/** Text with money slots, so hidden amounts stay hidden in a sentence. */
export function Sentence({ parts }: { parts: readonly Segment[] }) {
  return (
    <>
      {parts.map((p, i) => {
        if (typeof p === 'string') return <span key={i}>{p}</span>;
        if ('cents' in p) return <Money key={i} cents={p.cents} precision="dollars" {...(p.bold ? { className: 'font-semibold text-text' } : {})} />;
        return (
          <strong key={i} className="font-semibold text-text">
            {p.bold}
          </strong>
        );
      })}
    </>
  );
}

/** The choices of lots to use: side-by-side cards, one picked. A radio group (arrow keys move, Tab leaves). */
export function PlanChoice({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (dir === 0) return;
    const radios = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')];
    const at = radios.findIndex((r) => r === document.activeElement);
    if (at < 0) return;
    e.preventDefault();
    const next = radios[(at + dir + radios.length) % radios.length];
    next?.click();
    next?.focus();
  }
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className={className}>
      {children}
    </div>
  );
}

const DETAIL_LABEL = 'text-[11px] text-muted lg:text-xs';
const DETAIL_VALUE = 'text-sm font-semibold lg:text-[15px]';

/** A label over a figure: one row of a plan card. */
function Detail({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <span className={cx('flex flex-col gap-0.5 lg:gap-[3px]', className)}>
      <span className={DETAIL_LABEL}>{label}</span>
      {children}
    </span>
  );
}

/**
 * One plan, as a card in the side-by-side comparison; tapping it is the choice. Every card has the same rows in the same
 * order (8 rows, a subgrid of `PlanChoice`'s grid), so figures line up across cards: the tax as the hero
 * with its federal and state parts, what you keep after tax with its math, short-term, long-term, losses left for next
 * year, the share on Estimated or Unknown cost, and the lots used. Empty figures ($0.00, 0%) are muted.
 */
export function PlanCard({ title, plan, active, onSelect, pill = null, carryBest = false, className }: { title: string; plan: SalePlan; active: boolean; onSelect(): void; pill?: string | null; carryBest?: boolean; className?: string }) {
  const titleId = useId();
  const pillId = useId();
  const { masked } = usePrefs();
  const tax = taxShown(plan);
  const carried = carriedOut(plan);
  const risk = riskPercentFromBp(plan.estimatedShareBp);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-labelledby={titleId}
      aria-describedby={pill === null ? undefined : pillId}
      tabIndex={active ? 0 : -1}
      onClick={onSelect}
      className={cx(
        'relative row-span-8 grid grid-rows-subgrid content-start gap-y-3 rounded-[18px] text-left text-text lg:gap-y-3.5',
        active ? 'border-[1.5px] border-accent bg-[linear-gradient(180deg,rgb(247_147_26/0.16),rgb(247_147_26/0.04))] p-[13px]' : 'border border-line bg-surface p-[13.5px] hover:bg-surface-2',
        className,
      )}
    >
      {pill !== null && (
        <span id={pillId} className="absolute -top-2.5 left-3 inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-line bg-bg py-0.5 pl-1.5 pr-2 text-[11px] font-semibold text-soft lg:-top-[11px] lg:left-3.5 lg:text-xs">
          <CheckIcon size={12} className="text-gain" />
          {pill}
        </span>
      )}
      <span className="flex items-center gap-2 pt-0.5">
        <span aria-hidden="true" className={cx('flex size-4 flex-none items-center justify-center rounded-full border-[1.5px]', active ? 'border-accent' : 'border-muted')}>
          {active && <span className="size-2 rounded-full bg-accent" />}
        </span>
        <span id={titleId} className={cx('text-[13px] lg:text-sm', active ? 'font-bold text-amber' : 'font-semibold text-soft')}>
          {title}
        </span>
      </span>
      <span className="flex flex-col gap-[3px] lg:gap-1">
        <span className="text-xs text-soft">{tax.label}</span>
        <span className={cx('font-display text-[25px] font-semibold leading-[1.1] tracking-[-0.02em] lg:text-[30px]', tax.saves ? 'text-gain' : 'text-text')}>
          <PlainMoney cents={tax.cents} />
        </span>
        <span className="text-[11px] leading-[1.4] text-muted lg:text-xs">
          Federal <PlainMoney cents={tax.federal} /> {tax.state < 0 ? '−' : '+'} state <PlainMoney cents={Math.abs(tax.state)} />
        </span>
      </span>
      <span className="flex flex-col gap-[3px] lg:gap-1">
        <span className="text-xs text-soft">You keep after tax</span>
        <span className="text-[17px] font-semibold lg:text-[19px]">
          <PlainMoney cents={plan.afterTaxCents} />
        </span>
        <span className="text-[11px] leading-[1.4] text-muted lg:text-xs">
          <PlainMoney cents={plan.proceedsCents} /> sale {tax.saves ? '+' : '−'} <PlainMoney cents={tax.cents} /> {tax.saves ? 'tax saved' : 'tax'}
        </span>
      </span>
      <Detail label={termLabel('Short-term', plan.stGainCents)} className="border-t border-line pt-3 lg:pt-3.5">
        <span className={cx(DETAIL_VALUE, tone(plan.stGainCents))}>
          <PlainMoney cents={plan.stGainCents} signed />
        </span>
      </Detail>
      <Detail label={termLabel('Long-term', plan.ltGainCents)}>
        <span className={cx(DETAIL_VALUE, tone(plan.ltGainCents))}>
          <PlainMoney cents={plan.ltGainCents} signed />
        </span>
      </Detail>
      <Detail label="Losses left for next year">
        <span className={cx(DETAIL_VALUE, carried === 0 ? 'text-muted' : carryBest ? 'text-amber' : 'text-text')}>
          <PlainMoney cents={carried} />
        </span>
      </Detail>
      <Detail label="On Estimated or Unknown cost">
        <span className={cx(DETAIL_VALUE, plan.estimatedShareBp === 0 ? 'text-muted' : 'text-text')}>{masked ? maskDigits(risk) : risk}</span>
      </Detail>
      <Detail label="Lots used">
        <span className="text-[13px] font-semibold lg:text-sm">{rangeLabel(plan.coinsFrom, plan.coinsTo)}</span>
        <span className={DETAIL_LABEL}>{countOf(plan.picks.length, 'lot')}</span>
      </Detail>
    </button>
  );
}

/** The lots table starts open when the plan uses this many lots or fewer. */
export const LOTS_OPEN_UP_TO = 8;

const LOT_TERM: Record<DisposalPick['term'], string> = { short: 'Short-term', long: 'Long-term' };

// One grid for the table, every row a subgrid, so columns line up. The section is a container: under 40rem it is
// Bought (term under it) · Bitcoin (cost under it) · Gain or loss ("sold $X" under it); from 40rem one line per lot:
// Bought · Term · Bitcoin · Cost · Sold for · Gain or loss.
const LOTS_GRID = 'grid grid-cols-[minmax(0,1fr)_max-content_max-content] gap-x-3 @min-[40rem]:grid-cols-[max-content_minmax(0,1fr)_repeat(4,max-content)] @min-[40rem]:gap-x-5';
const LOTS_ROW = 'col-span-full grid grid-cols-subgrid gap-y-0.5 @min-[40rem]:items-baseline';
const L = {
  date: 'col-start-1 row-start-1',
  term: 'col-start-1 row-start-2 @min-[40rem]:col-start-2 @min-[40rem]:row-start-1',
  btc: 'col-start-2 row-start-1 text-right @min-[40rem]:col-start-3',
  cost: 'col-start-2 row-start-2 text-right @min-[40rem]:col-start-4 @min-[40rem]:row-start-1',
  sold: 'col-start-3 row-start-2 text-right @min-[40rem]:col-start-5 @min-[40rem]:row-start-1',
  gain: 'col-start-3 row-start-1 text-right @min-[40rem]:col-start-6',
};
const MAIN_CELL = 'text-[13px] @min-[40rem]:text-sm';
const SUB_CELL = 'text-[11px] text-muted @min-[40rem]:text-sm @min-[40rem]:text-soft';
const NARROW = '@min-[40rem]:hidden';
const WIDE = 'hidden @min-[40rem]:inline';

/**
 * "Lots used in Lowest tax": the selected plan's lots as an aligned table, in the order the plan uses them, with a
 * Total row. Each lot's sold-for is the sale's proceeds split by sats and its gain is the engine's (for a dual-basis gift,
 * the cost shown is the basis the rule used), so the rows add up to the Total, and the Total's gain is the card's
 * short-term + long-term. Column headings are visual only; each cell carries screen-reader words.
 */
export function LotsUsedTable({ planName, plan }: { planName: string; plan: SalePlan }) {
  // Open to start when the list is short; a long one starts folded (its count and dates still show).
  const [open, setOpen] = useState(plan.pieces.length <= LOTS_OPEN_UP_TO);
  const id = useId();
  const used = lotsUsed(plan);
  const count = countOf(used.rows.length, 'lot');
  return (
    <section aria-label="Lots used" className="flex flex-col rounded-[18px] border border-line bg-surface px-3.5 py-1 @container lg:px-5">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} className="flex min-h-[52px] items-center gap-2.5 bg-transparent p-0 text-left text-text">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 @min-[40rem]:flex-row @min-[40rem]:items-baseline @min-[40rem]:gap-1.5">
          <span className="text-sm font-semibold @min-[40rem]:text-[15px]">Lots used in {planName}</span>
          <span className="text-xs text-muted @min-[40rem]:text-[13px]">
            <span className={WIDE}>· </span>
            {count} · {rangeLabel(plan.coinsFrom, plan.coinsTo)}
          </span>
        </span>
        <ChevronDownIcon size={16} className={cx('flex-none text-muted', open && 'rotate-180')} />
      </button>
      <div id={id} hidden={!open} className={cx(LOTS_GRID, 'pb-2.5 tabular-nums @min-[40rem]:pb-3')}>
        <div aria-hidden="true" className={cx(LOTS_ROW, 'border-t border-line pb-1.5 pt-2 text-[11px] text-muted @min-[40rem]:text-xs')}>
          <span className={L.date}>Bought</span>
          <span className={cx(L.term, WIDE)}>Term</span>
          <span className={L.btc}>
            Bitcoin<span className={NARROW}> · cost</span>
          </span>
          <span className={cx(L.cost, WIDE, 'text-right')}>Cost</span>
          <span className={cx(L.sold, WIDE, 'text-right')}>Sold for</span>
          <span className={L.gain}>Gain or loss</span>
        </div>
        <ul aria-label={`Lots used in ${planName}`} className="col-span-full m-0 grid list-none grid-cols-subgrid p-0">
          {used.rows.map((p, i) => (
            <li key={`${p.lotId}-${i}`} className={cx(LOTS_ROW, 'border-t border-line-soft py-2.5')}>
              <span className={cx(L.date, MAIN_CELL, 'font-semibold')}>
                <span className="sr-only">Bought </span>
                {shortDate(p.acquiredDate)}
              </span>
              <span className={cx(L.term, SUB_CELL)}>
                <span className="sr-only">, </span>
                {LOT_TERM[p.term]}
                {p.tier !== 'documented' && (
                  <span className="text-muted">
                    {' · '}
                    <span aria-hidden="true" className={cx('mr-1 inline-block size-[7px] rounded-full', TIER_DOT[p.tier])} />
                    {TIER_LABEL[p.tier]}
                  </span>
                )}
              </span>
              <span className={cx(L.btc, MAIN_CELL, 'font-semibold @min-[40rem]:font-normal')}>
                <span className="sr-only">, </span>
                <Amount sats={p.sats} interactive={false} alwaysBtc />
                <span className="sr-only"> BTC</span>
              </span>
              <span className={cx(L.cost, SUB_CELL)}>
                <span className="sr-only">, cost </span>
                <PlainMoney cents={p.costCents} />
              </span>
              <span className={cx(L.sold, SUB_CELL)}>
                <span className="sr-only">, sold for </span>
                <span aria-hidden="true" className={NARROW}>
                  sold{' '}
                </span>
                <PlainMoney cents={p.proceedsCents} />
              </span>
              <span className={cx(L.gain, MAIN_CELL, 'font-semibold', tone(p.gainCents))}>
                <span className="sr-only">{p.gainCents < 0 ? ', loss ' : ', gain '}</span>
                <PlainMoney cents={p.gainCents} signed />
              </span>
            </li>
          ))}
        </ul>
        <div role="group" aria-label="Total of the lots used" className={cx(LOTS_ROW, 'border-t-[1.5px] border-line pb-0.5 pt-2.5 font-bold @min-[40rem]:pb-1')}>
          <span className={cx(L.date, MAIN_CELL)}>Total</span>
          <span className={cx(L.term, SUB_CELL, 'font-normal')}>
            <span className="sr-only">, </span>
            {count}
          </span>
          <span className={cx(L.btc, MAIN_CELL)}>
            <span className="sr-only">, </span>
            <Amount sats={used.total.sats} interactive={false} alwaysBtc />
            <span className="sr-only"> BTC</span>
          </span>
          <span className={cx(L.cost, SUB_CELL, 'font-normal @min-[40rem]:font-bold @min-[40rem]:text-text')}>
            <span className="sr-only">, cost </span>
            <PlainMoney cents={used.total.costCents} />
          </span>
          <span className={cx(L.sold, SUB_CELL, 'font-normal @min-[40rem]:font-bold @min-[40rem]:text-text')}>
            <span className="sr-only">, sold for </span>
            <span aria-hidden="true" className={NARROW}>
              sold{' '}
            </span>
            <PlainMoney cents={used.total.proceedsCents} />
          </span>
          <span className={cx(L.gain, MAIN_CELL, tone(used.total.gainCents))}>
            <span className="sr-only">{used.total.gainCents < 0 ? ', loss ' : ', gain '}</span>
            <PlainMoney cents={used.total.gainCents} signed />
          </span>
        </div>
      </div>
    </section>
  );
}

/** A calm note card: an icon and a sentence or two. */
export function Note({ children, tone = 'plain', className }: { children: ReactNode; tone?: 'plain' | 'warn'; className?: string }) {
  return (
    <div className={cx('flex items-start gap-3 text-[13px] leading-[1.45] text-soft', className)}>
      <InfoIcon size={18} className={cx('mt-px flex-none', tone === 'warn' ? 'text-accent' : 'text-muted')} />
      <p className="m-0">{children}</p>
    </div>
  );
}
