import { useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router';
import { useLedger } from '../data/ledger-provider.tsx';
import { recoveryLinkNotice } from '../data/recovery-handoff.ts';
import { useVaultStatusOptional } from '../data/vault-provider.tsx';
import { Button } from './Button.tsx';
import { Sheet } from './Sheet.tsx';

/**
 * Shown once after unlocking when the page was opened from the emergency kit's QR code: the link holds the
 * recovery code and the browser may keep it in history, so offer a new code (which makes the old one useless).
 */
export function LinkHistoryPrompt() {
  const pending = useSyncExternalStore(recoveryLinkNotice.subscribe, recoveryLinkNotice.pending);
  const status = useVaultStatusOptional();
  const { isDemo } = useLedger();
  const navigate = useNavigate();
  const open = pending && !isDemo && status?.state === 'unlocked';
  return (
    <Sheet open={open} onClose={recoveryLinkNotice.dismiss} title="Make a new recovery code?">
      <div className="flex flex-col gap-3 p-1">
        <p className="m-0 text-[13px] leading-[1.45] text-soft">You opened this from your kit&apos;s QR code. Browsers can keep that link in history. Make a new recovery code?</p>
        <div className="flex flex-wrap gap-2.5">
          <Button
            variant="primary"
            onClick={() => {
              recoveryLinkNotice.dismiss();
              navigate('/settings?rotate=1#security');
            }}
          >
            Make a new code
          </Button>
          <Button onClick={recoveryLinkNotice.dismiss}>Not now</Button>
        </div>
      </div>
    </Sheet>
  );
}
