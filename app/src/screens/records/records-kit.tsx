import { useState, type ReactNode } from 'react';
import { Button } from '../../ui/Button.tsx';
import { ShieldIcon } from '../../ui/more-icons.tsx';
import { Sheet } from '../../ui/Sheet.tsx';

/** Local to this device (like the other display choices): the day the kit was last tested, `YYYY-MM-DD`. */
export const KIT_TESTED_KEY = 'bb.kit-tested';

function readTested(): string | null {
  try {
    const v = window.localStorage.getItem(KIT_TESTED_KEY);
    return v !== null && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** Show the reminder again one year after the last test (dates compare as text). */
export function kitTestDue(tested: string | null, today: string): boolean {
  if (tested === null) return true;
  return today >= `${Number(tested.slice(0, 4)) + 1}${tested.slice(4)}`;
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden="true" className="flex size-7 flex-none items-center justify-center rounded-full border border-accent text-sm font-semibold text-accent">
        {n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5 text-[15px] leading-snug">{children}</div>
    </li>
  );
}

/** The "test your emergency kit" reminder and the sheet that walks through the test. */
export function KitCard({ today }: { today: string }) {
  const [tested, setTested] = useState<string | null>(readTested);
  const [open, setOpen] = useState(false);
  const [noCode, setNoCode] = useState(false);
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null);
  const address = window.location.origin;

  function close() {
    setOpen(false);
    setNoCode(false);
    setCopied(null);
  }
  function worked() {
    try {
      window.localStorage.setItem(KIT_TESTED_KEY, today);
    } catch {
      // Storage blocked: the reminder comes back next visit.
    }
    setTested(today);
    close();
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied('yes');
    } catch {
      setCopied('no');
    }
  }

  if (!kitTestDue(tested, today)) return null;
  return (
    <>
      <section aria-label="Needs attention" className="flex items-center gap-3 rounded-[18px] border-[1.5px] border-accent bg-[linear-gradient(180deg,rgb(247_147_26/0.16),rgb(247_147_26/0.04))] px-4 py-3.5">
        <span className="flex size-10 flex-none items-center justify-center rounded-xl bg-accent text-bg">
          <ShieldIcon size={20} />
        </span>
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="text-[15px] font-semibold">Test your emergency kit</span>
          <span className="text-xs leading-[1.4] text-soft">Takes two minutes in a private window.</span>
        </div>
        <Button variant="primary" className="flex-none text-sm" onClick={() => setOpen(true)}>
          Test
        </Button>
      </section>
      <Sheet open={open} onClose={close} title="Test your emergency kit">
        <div className="flex flex-col gap-4 pb-3">
          <ol className="m-0 flex list-none flex-col gap-4 p-0">
            <Step n={1}>
              <span>Open this app&apos;s address in a private window.</span>
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 break-all rounded-lg border border-line bg-bg px-2.5 py-1.5 text-[13px] text-soft">{address}</code>
                <Button className="min-h-11" onClick={() => void copy()}>
                  Copy
                </Button>
              </div>
              <span role="status" className="text-xs text-muted">
                {copied === 'yes' ? 'Address copied.' : copied === 'no' ? 'Could not copy. Type it in instead.' : ''}
              </span>
            </Step>
            <Step n={2}>
              <span>Choose Restore on this device, then type the recovery code from your kit.</span>
            </Step>
            <Step n={3}>
              <span>If your records open, close that window and tap It worked.</span>
            </Step>
          </ol>
          {noCode ? (
            <p className="m-0 rounded-xl border border-line bg-bg p-3 text-sm leading-snug text-soft">
              Make a new recovery code in Records, Security. It prints a new kit, and the old code stops working.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2.5">
            <Button variant="primary" onClick={worked}>
              It worked
            </Button>
            <Button onClick={() => setNoCode(true)} aria-expanded={noCode}>
              I can&apos;t find my code
            </Button>
          </div>
        </div>
      </Sheet>
    </>
  );
}
