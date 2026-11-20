import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';
import { cx } from '../../lib/cx.ts';
import { InfoIcon } from '../../ui/more-icons.tsx';

/** Full-screen frame for first run and unlock: dark page, soft orange glow, no tabs. */
export function Frame({ children, glowTop = 60, className }: { children: ReactNode; glowTop?: number; className?: string }) {
  return (
    <div className="relative min-h-dvh overflow-x-clip bg-bg text-text">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 h-[420px] w-[520px] -translate-x-1/2 bg-[radial-gradient(closest-side,rgb(247_147_26/0.22),rgb(247_147_26/0))]"
        style={{ top: glowTop }}
      />
      <main className={cx('relative mx-auto flex min-h-dvh w-full max-w-[440px] flex-col px-6 pb-8', className)}>{children}</main>
    </div>
  );
}

export function LogoMark({ size = 80 }: { size?: number }) {
  return <img src="/icons/logo-mark.webp" width={size} height={size} alt="" className="block flex-none drop-shadow-[0_18px_40px_rgb(247_147_26/0.45)]" />;
}

const BIG = 'flex w-full items-center justify-center gap-2.5 rounded-[18px] px-4 transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const PRIMARY = 'min-h-[58px] text-[17px] font-bold bg-accent text-bg no-underline shadow-[0_10px_30px_rgb(247_147_26/0.35)] hover:bg-amber hover:text-bg';
const SECOND = 'min-h-[52px] rounded-2xl border border-line bg-surface text-[15px] font-semibold text-text no-underline hover:bg-surface-2 hover:text-text';

export function BigButton({ variant = 'primary', className, type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' }) {
  return <button type={type} className={cx(BIG, variant === 'primary' ? PRIMARY : SECOND, className)} {...rest} />;
}

export function BigLink({ variant = 'primary', className, ...rest }: LinkProps & { variant?: 'primary' | 'secondary' }) {
  return <Link className={cx(BIG, variant === 'primary' ? PRIMARY : SECOND, className)} {...rest} />;
}

/** A quiet text-style button (44px tall) for secondary choices. */
export function TextButton({ className, type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={cx('flex min-h-11 items-center justify-center bg-transparent px-2 text-sm font-semibold text-amber underline-offset-2 hover:underline', className)} {...rest} />;
}

/** Said wherever a recovery code appears. */
export function NotSeedPhrase({ className, tone = 'dark' }: { className?: string; tone?: 'dark' | 'light' }) {
  return (
    <div className={cx('flex items-start gap-2.5', className)}>
      <InfoIcon size={18} strokeWidth={2.2} className={cx('mt-px flex-none', tone === 'dark' ? 'text-amber' : 'text-[#9a4f00]')} />
      <span className={cx('text-[13px] leading-[1.45]', tone === 'dark' ? 'text-soft' : 'text-[#161514]')}>
        <strong className={tone === 'dark' ? 'text-text' : undefined}>This is NOT a Bitcoin seed phrase.</strong> It can&apos;t move Bitcoin. It only opens these records.
      </span>
    </div>
  );
}

export function ErrorLine({ children }: { children: ReactNode }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <p role="alert" className="m-0 rounded-xl border border-loss/40 bg-loss/10 px-3.5 py-2.5 text-[13px] leading-[1.45] text-loss">
      {children}
    </p>
  );
}

/** The recovery code in its six groups of five, numbered. */
export function CodeGroups({ code }: { code: string }) {
  const groups = code.split('-');
  return (
    <ol aria-label="Recovery code, six groups of five" className="m-0 grid list-none grid-cols-2 gap-2.5 p-0">
      {groups.map((g, i) => (
        <li key={i} className="flex min-h-[50px] items-center gap-2.5 rounded-xl bg-bg px-3">
          <span aria-hidden="true" className="w-2.5 text-[11px] text-muted">
            {i + 1}
          </span>
          <span className="sr-only">Group {i + 1}: </span>
          <span className="font-display text-[21px] font-semibold tracking-[0.1em]">{g}</span>
        </li>
      ))}
    </ol>
  );
}
