import { Link } from 'react-router';
import { Brand } from '../ui/AppShell.tsx';
import { buttonClasses } from '../ui/Button.tsx';
import { useTitle } from '../ui/use-title.ts';

/** An address the app does not know: say so plainly and offer the way home. */
export function NotFound() {
  useTitle('Not found');
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 px-5 py-10">
      <Brand />
      <h1 className="m-0 font-display text-3xl font-semibold tracking-tight">Page not found</h1>
      <p className="m-0 text-[15px] leading-relaxed text-muted">That address is not part of the app.</p>
      <Link to="/" className={buttonClasses('primary', 'w-full no-underline hover:text-bg sm:w-fit')}>
        Back to Holdings
      </Link>
    </main>
  );
}
