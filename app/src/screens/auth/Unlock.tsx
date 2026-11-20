import { useMemo, useState } from 'react';
import { explainError, wasCancelled } from '../../data/explain-error.ts';
import { incomingRecovery } from '../../data/recovery-handoff.ts';
import { currentPlatform, unlockButtonLabel, type Platform } from '../../data/platform.ts';
import { useVault, useVaultStatus } from '../../data/vault-provider.tsx';
import type { LockReason } from '../../vault/index.ts';
import { FaceIdIcon, FingerprintIcon, KeyIcon } from '../../ui/auth-icons.tsx';
import { ShieldIcon } from '../../ui/more-icons.tsx';
import { BigButton, ErrorLine, Frame, LogoMark, NotSeedPhrase, TextButton } from './parts.tsx';
import { RecoveryInput } from './RecoveryInput.tsx';

/** A gentle line about why the app locked itself (nothing when the person pressed Lock). */
export function lockReasonText(reason: LockReason | null, minutes: number): string | null {
  if (reason === 'idle') return `Locked after ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} of no activity.`;
  if (reason === 'hidden') return 'Locked while the app was in the background.';
  return null;
}

function UnlockIcon({ platform }: { platform: Platform }) {
  if (platform === 'ios') return <FaceIdIcon size={22} />;
  if (platform === 'android' || platform === 'macos') return <FingerprintIcon size={22} />;
  return <KeyIcon size={22} />;
}

/** Shown in place of the app while the vault is locked. */
export function Unlock({ platform }: { platform?: Platform } = {}) {
  const vault = useVault();
  const status = useVaultStatus();
  const detected = useMemo(() => platform ?? currentPlatform(), [platform]);
  const passkeyOk = status.passkeyUnlock;
  const [useCode, setUseCode] = useState(() => !passkeyOk || incomingRecovery.peek() !== null);
  const [value, setValue] = useState(() => incomingRecovery.take() ?? '');
  const [valid, setValid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reason = lockReasonText(status.lockReason, status.autoLockMinutes);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      if (!wasCancelled(e)) setError(explainError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Frame glowTop={140} className="items-center pb-9">
      <div className="relative flex flex-1 flex-col items-center justify-center gap-[22px] pt-10">
        <LogoMark size={96} />
        <h1 className="m-0 font-display text-[30px] font-semibold tracking-[-0.02em]">Bitcoin Basis</h1>
        <p className="m-0 max-w-[280px] text-center text-[15px] leading-normal text-soft">Your records are encrypted on this device. Only you can open them.</p>
        {reason !== null && <p className="m-0 text-center text-[13px] text-muted">{reason}</p>}
      </div>

      <div className="relative flex w-full flex-col gap-3.5">
        {useCode ? (
          <form
            className="flex flex-col gap-3.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (valid) void run(() => vault.unlockWithRecoveryCode(value));
            }}
          >
            {!passkeyOk && <p className="m-0 text-center text-[13px] leading-[1.45] text-muted">This device has no passkey for these records yet, so unlock with your recovery code. You can add a passkey afterwards.</p>}
            <RecoveryInput value={value} onChange={setValue} onValid={setValid} autoFocus />
            <NotSeedPhrase />
            <ErrorLine>{error}</ErrorLine>
            <BigButton type="submit" disabled={!valid || busy}>
              {busy ? 'Unlocking...' : 'Unlock'}
            </BigButton>
            {passkeyOk && (
              <TextButton
                onClick={() => {
                  setUseCode(false);
                  setError(null);
                }}
              >
                Use my passkey instead
              </TextButton>
            )}
          </form>
        ) : (
          <>
            <ErrorLine>{error}</ErrorLine>
            <BigButton onClick={() => void run(() => vault.unlockWithPasskey())} disabled={busy}>
              <UnlockIcon platform={detected} />
              {busy ? 'Waiting for you...' : unlockButtonLabel(detected)}
            </BigButton>
            <TextButton
              onClick={() => {
                setUseCode(true);
                setError(null);
              }}
            >
              Use recovery code
            </TextButton>
          </>
        )}
        <div className="flex items-center justify-center gap-2 text-xs text-muted">
          <ShieldIcon size={14} />
          Self-hosted · end-to-end encrypted · no tracking
        </div>
      </div>
    </Frame>
  );
}
