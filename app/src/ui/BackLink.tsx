import type { MouseEvent, ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';

/**
 * The in-app back button. When the app itself brought you here, it goes back in history, exactly like the browser's
 * or phone's back gesture: to the page you came from, at the place you left it (see `scroll-behavior.ts`). Opened
 * directly (a link from outside, a new tab), there is nothing in the app to go back to, so it links to `fallback`.
 */
export function BackLink({ fallback, fallbackLabel, className, children }: { fallback: string; fallbackLabel: string; className?: string; children: ReactNode }) {
  const { key } = useLocation();
  const navigate = useNavigate();
  // The first page this tab opened has the key "default": nothing in the app before it.
  const inApp = key !== 'default';
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!inApp || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    void navigate(-1);
  };
  return (
    <Link to={fallback} aria-label={inApp ? 'Back' : fallbackLabel} onClick={onClick} className={className}>
      {children}
    </Link>
  );
}
