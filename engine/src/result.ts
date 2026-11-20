import type { Result } from './types.ts';

/** A successful result. */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** A failed result. */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
