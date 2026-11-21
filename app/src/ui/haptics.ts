import { prefersReducedMotion } from './motion.ts';

/**
 * A light tap (10 ms) on phones that can vibrate (Android Chrome), for a confirmed action such as a save.
 * Only after the person has touched the page, never under reduced motion, and silently nothing elsewhere.
 */
export function confirmHaptic(): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  if (navigator.userActivation !== undefined && !navigator.userActivation.hasBeenActive) return;
  if (prefersReducedMotion()) return;
  try {
    navigator.vibrate(10);
  } catch {
    // Some browsers throw instead of ignoring; a missing buzz is fine.
  }
}
