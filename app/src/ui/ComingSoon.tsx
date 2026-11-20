import { Link } from 'react-router';
import { buttonClasses } from './Button.tsx';
import { Card } from './Card.tsx';

/** Placeholder for screens that arrive in a later step. */
export function ComingSoon({ title, body, bare = false, backTo = '/' }: { title: string; body: string; bare?: boolean; backTo?: string | null }) {
  const inner = (
    <div className="flex flex-col items-start gap-3 py-2">
      <span className="rounded-full bg-accent/12 px-3 py-1 text-xs font-semibold text-amber">Coming soon</span>
      <p className="font-display text-xl font-semibold tracking-tight">{title}</p>
      <p className="max-w-prose text-[15px] leading-relaxed text-muted">{body}</p>
      {backTo !== null && !bare && (
        <Link to={backTo} className={buttonClasses('secondary', 'no-underline text-text')}>
          Back to Holdings
        </Link>
      )}
    </div>
  );
  return bare ? inner : <Card>{inner}</Card>;
}
