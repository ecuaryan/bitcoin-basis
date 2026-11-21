import { prefersReducedMotion } from '../../ui/motion.ts';

/**
 * After a submit with errors: bring the first problem into the middle of the view and put the cursor there, so it is
 * never left hidden below the fold or behind the pinned Save button. Runs after React has drawn the errors.
 */
export function focusFirstError(form: HTMLFormElement): void {
  window.setTimeout(() => {
    if (!form.isConnected) return;
    const bad = form.querySelector<HTMLElement>('[aria-invalid="true"], [role="alert"]');
    if (bad === null) return;
    const details = bad.closest('details');
    if (details !== null && !details.open) details.open = true;
    const field = bad.matches('input, select, textarea') ? bad : (bad.parentElement?.querySelector<HTMLElement>('input, select, textarea') ?? bad);
    field.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    if (field.matches('input, select, textarea')) field.focus({ preventScroll: true });
  }, 0);
}
