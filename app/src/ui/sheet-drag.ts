/** Fraction of the sheet's height it must be dragged down to close on release. */
export const CLOSE_FRACTION = 0.25;
/** A flick faster than this (pixels per millisecond) closes it, as long as it moved a little. */
export const FLICK_VELOCITY = 0.5;
const FLICK_MIN_DISTANCE = 16;
/** Any upward motion faster than this (px/ms) at release keeps the sheet open. */
export const UPWARD_KEEP_VELOCITY = 0.05;
const RUBBER_MAX = 20;

/** Should letting go here close the sheet? `dy` is how far down it was dragged, `velocity` is px/ms (down is positive). */
export function shouldCloseOnRelease(dy: number, height: number, velocity: number): boolean {
  if (height <= 0) return false;
  // Moving back up when letting go means "keep it open", however far it was pulled (platform convention).
  if (velocity < -UPWARD_KEEP_VELOCITY) return false;
  if (dy > height * CLOSE_FRACTION) return true;
  return velocity > FLICK_VELOCITY && dy > FLICK_MIN_DISTANCE;
}

/** Where the sheet sits for a finger `dy` pixels from where the drag began: follows it down, resists going up. */
export function dragOffset(dy: number): number {
  return dy >= 0 ? dy : -Math.min(RUBBER_MAX, Math.sqrt(-dy) * 2);
}

/** Backdrop opacity (1 = full) for a sheet pulled down `offset` of `height`. */
export function backdropOpacity(offset: number, height: number): number {
  if (height <= 0) return 1;
  return 1 - Math.min(1, Math.max(0, offset / height));
}

/** Down-speed in px/ms from recent samples (time, y), looking at the last ~100 ms. */
export function releaseVelocity(samples: ReadonlyArray<{ t: number; y: number }>): number {
  const last = samples[samples.length - 1];
  if (!last) return 0;
  const first = samples.find((s) => last.t - s.t <= 100) ?? last;
  const dt = last.t - first.t;
  return dt > 0 ? (last.y - first.y) / dt : 0;
}
