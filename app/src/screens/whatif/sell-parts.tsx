import type { SalePlan, Tier } from '@bitcoin-basis/engine';
import { useId, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../../lib/cx.ts';
import { TIER_LABEL } from '../../lib/origin.ts';
import { countOf } from '../../lib/format.ts';
import { Money } from '../../ui/Amount.tsx';
import { InfoIcon } from '../../ui/more-icons.tsx';
import { rangeLabel, riskPercentFromBp, taxEffectLabel, type Segment } from './sell-logic.ts';

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

function Row({ label, tone, children, big }: { label: string; tone: 'plain' | 'hot'; children: ReactNode; big?: boolean }) {
  return (
    <span className="flex flex-col gap-0.5 text-left">
      <span className={cx('text-[11px] font-normal normal-nums', tone === 'hot' ? 'text-soft' : 'text-muted')}>{label}</span>
      <span className={cx(big ? 'text-xl font-bold' : 'text-sm font-semibold')}>{children}</span>
    </span>
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

/** One column of the side-by-side comparison. Tapping it is the choice. */
export function PlanCard({ title, plan, active, onSelect, carryBest = false, className }: { title: string; plan: SalePlan; active: boolean; onSelect(): void; carryBest?: boolean; className?: string }) {
  const titleId = useId();
  const rows: { label: string; cents: number }[] = [];
  if (plan.stGainCents !== 0) rows.push({ label: `Short-term ${plan.stGainCents < 0 ? 'loss' : 'gain'}`, cents: plan.stGainCents });
  if (plan.ltGainCents !== 0) rows.push({ label: `Long-term ${plan.ltGainCents < 0 ? 'loss' : 'gain'}`, cents: plan.ltGainCents });
  if (rows.length === 0) rows.push({ label: 'Gain', cents: 0 });
  const tone = active ? 'hot' : 'plain';
  const carried = plan.carryforwardOut.st + plan.carryforwardOut.lt;
  const tax = taxEffectLabel(plan.totalTaxCents);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-labelledby={titleId}
      tabIndex={active ? 0 : -1}
      onClick={onSelect}
      className={cx(
        'flex flex-col gap-3 rounded-[18px] p-3.5 text-left text-text',
        active ? 'border-[1.5px] border-accent bg-[linear-gradient(180deg,rgb(247_147_26/0.16),rgb(247_147_26/0.04))]' : 'border border-line bg-surface hover:bg-surface-2',
        className,
      )}
    >
      <span id={titleId} className={cx('text-[13px]', active ? 'font-bold text-amber' : 'font-semibold text-soft')}>
        {title}
      </span>
      <Row label="Lots used" tone={tone}>
        {rangeLabel(plan.coinsFrom, plan.coinsTo)}
        <span className="block text-[11px] font-normal text-muted">{countOf(plan.picks.length, 'lot')}</span>
      </Row>
      {rows.map((r) => (
        <Row key={r.label} label={r.label} tone={tone}>
          <Money cents={r.cents} signed countUp />
        </Row>
      ))}
      <Row label={tax.label} tone={tone} big>
        <Money cents={tax.cents} countUp />
      </Row>
      <Row label="Losses left for next year" tone={tone}>
        <span className={cx(carryBest && 'text-amber')}>
          <Money cents={carried} precision="dollars" countUp />
        </span>
      </Row>
      {plan.estimatedShareBp > 0 && (
        <Row label="On Estimated or Unknown cost" tone={tone}>
          {riskPercentFromBp(plan.estimatedShareBp)}
        </Row>
      )}
    </button>
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
