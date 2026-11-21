/**
 * The phone's back gesture (and the browser's Back button) closes the top sheet instead of leaving the page.
 * Each open sheet adds one history entry for the same address; going back pops it and closes that sheet.
 * Closing a sheet any other way removes its entry again, so Back never lands on a dead step.
 */

interface Open {
  id: number;
  close(): void;
}

const stack: Open[] = [];
let seq = 0;
/** Our own history.back() calls still on their way; their popstate is not a person pressing Back. */
let expectPop = 0;
let installed = false;

function current(): number {
  const s: unknown = window.history.state;
  return typeof s === 'object' && s !== null && typeof (s as { bbSheet?: unknown }).bbSheet === 'number' ? (s as { bbSheet: number }).bbSheet : 0;
}

function push(id: number): void {
  const s: unknown = window.history.state;
  window.history.pushState({ ...(typeof s === 'object' && s !== null ? s : {}), bbSheet: id }, '');
}

function onPop(): void {
  const cur = current();
  if (expectPop > 0) {
    expectPop -= 1;
    // A sheet that opened while that step back was on its way lost its entry: give it a new one.
    const top = stack[stack.length - 1];
    if (top && cur !== top.id) push(top.id);
    return;
  }
  // Back onto the entry of a sheet that is already gone (it closed by moving to another screen): skip it.
  if (cur > 0 && !stack.some((x) => x.id === cur)) {
    expectPop += 1;
    window.history.back();
    return;
  }
  for (let i = stack.length - 1; i >= 0; i--) {
    const s = stack[i] as Open;
    if (s.id <= cur) break;
    stack.splice(i, 1);
    s.close();
  }
}

/** Call when a sheet opens; call the returned function when it closes or unmounts. */
export function trackSheet(close: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.history?.pushState !== 'function') return () => {};
  if (!installed) {
    window.addEventListener('popstate', onPop);
    installed = true;
  }
  seq += 1;
  const id = seq;
  push(id);
  stack.push({ id, close });
  return () => {
    const i = stack.findIndex((s) => s.id === id);
    if (i === -1) return; // Closed by Back: its entry is already gone.
    stack.splice(i, 1);
    // Decide a moment later: a sheet often closes together with a move to another screen (which pushes or
    // replaces the entry), and then there is nothing to take back.
    window.setTimeout(() => {
      if (current() !== id) return;
      expectPop += 1;
      window.history.back();
    }, 0);
  };
}
