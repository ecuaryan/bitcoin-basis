import type { ButtonHTMLAttributes } from 'react';
import { cx } from '../lib/cx.ts';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-bg font-bold hover:bg-amber active:brightness-95',
  secondary: 'bg-surface text-text border border-line font-semibold hover:bg-surface-2',
  ghost: 'bg-transparent text-soft font-semibold hover:bg-surface hover:text-text',
};

/** 44px minimum touch target. Primary is the one orange button on a screen. */
export function buttonClasses(variant: ButtonVariant = 'secondary', extra?: string): string {
  return cx('inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-[15px] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50', VARIANTS[variant], extra);
}

export function Button({ variant = 'secondary', className, type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type={type} className={buttonClasses(variant, className)} {...rest} />;
}
