import { useEffect, useMemo, useRef, useState } from 'react';
import { explainError, wasCancelled } from '../../data/explain-error.ts';
import { PasskeyError } from '../../vault/passkey.ts';
import { VaultError } from '../../vault/errors.ts';
import { incomingRecovery } from '../../data/recovery-handoff.ts';
import { currentPlatform, type Platform } from '../../data/platform.ts';
import { useVault, useVaultStatus } from '../../data/vault-provider.tsx';
import { useLedger } from '../../data/ledger-provider.tsx';
import type { LockReason, UnlockOptions, UnlockStep } from '../../vault/index.ts';
import { FaceIdIcon, FingerprintIcon, KeyIcon } from '../../ui/auth-icons.tsx';
import { ShieldIcon } from '../../ui/more-icons.tsx';
import { BigButton, ErrorLine, Frame, Glow, LogoMark, NotSeedPhrase, TextButton } from './parts.tsx';
import { RecoveryInput } from './RecoveryInput.tsx';
import { useTitle } from '../../ui/use-title.ts';

/** A gentle line about why the app locked itself (nothing when the person pressed Lock). */
export function lockReasonText(reason: LockReason | null, minutes: number): string | null {
  if (reason === 'idle') return `Locked after ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} of no activity.`;
  if (reason === 'hidden') return 'Locked while the app was in the background.';
  if (reason === 'other-window') return 'Locked from another window.';
  return null;
}

function UnlockIcon({ platform }: { platform: Platform }) {
  if (platform === 'ios') return <FaceIdIcon size={22} />;
  if (platform === 'android' || platform === 'macos') return <FingerprintIcon size={22} />;
  return <KeyIcon size={22} />;
}

/** The line under the Unlock button: what the person will be asked to do. Never names Face ID on Android. */
export function unlockCaption(platform: Platform): string {
  switch (platform) {
    case 'android':
      return 'Fingerprint or screen lock';
    case 'ios':
      return 'Face ID or passcode';
    case 'macos':
      return 'Touch ID or password';
    default:
      return 'Passkey on this device';
  }
}

let autoPromptUsed = false;
/** Test hook: forget that the passkey prompt was already tried in this page session. */
export function resetAutoPrompt(): void {
  autoPromptUsed = false;
}

/** After this long on one step, offer "Taking too long? Try again". */
export const SLOW_AFTER_MS = 20_000;

/**
 * Once per page load, on a fresh start (nobody pressed Lock, no idle or background lock), the
 * passkey prompt opens by itself so unlocking is one touch, but only while the page is visible and
 * focused: a prompt asked for from a page that isn't (a home-screen app still launching, a tab in
 * the background) may never show, and must not hold the button up. If the browser refuses it
 * (Safari, Android without a tap) the Unlock button is the way in, with no error.
 */
export function shouldAutoPrompt(o: { passkeyOk: boolean; lockReason: LockReason | null; used: boolean; showingPasskey: boolean; visible: boolean; focused: boolean }): boolean {
  return o.passkeyOk && o.lockReason === null && !o.used && o.showingPasskey && o.visible && o.focused;
}

function pageActive(): { visible: boolean; focused: boolean } {
  if (typeof document === 'undefined') return { visible: false, focused: false };
  return { visible: document.visibilityState === 'visible', focused: typeof document.hasFocus === 'function' && document.hasFocus() };
}

/** What the Unlock button says while an unlock runs. Never names Face ID on Android. */
export function stepText(step: UnlockStep, platform: Platform): string {
  switch (step) {
    case 'connecting':
      return 'Connecting…';
    case 'passkey':
      if (platform === 'android') return 'Waiting for your fingerprint…';
      if (platform === 'ios') return 'Waiting for Face ID…';
      if (platform === 'macos') return 'Waiting for Touch ID…';
      return 'Waiting for your passkey…';
    case 'signing-in':
      return 'Signing in…';
    case 'opening':
      return 'Opening your records…';
  }
}

/** Abandoned on purpose (a newer attempt, or Try again): nothing to show. */
function wasAbandoned(e: unknown): boolean {
  return (e instanceof VaultError && e.code === 'aborted') || (e instanceof PasskeyError && e.code === 'aborted');
}

/** An automatic prompt that didn't happen is not an error: the button is right there. */
function quietAutoFailure(e: unknown): boolean {
  return wasCancelled(e) || wasAbandoned(e) || (e instanceof PasskeyError && e.code === 'unsupported') || (e instanceof VaultError && (e.code === 'passkeys-unsupported' || e.code === 'passkey-timeout'));
}

/** Shown in place of the app while the vault is locked. */
export function Unlock({ platform }: { platform?: Platform } = {}) {
  const vault = useVault();
  const status = useVaultStatus();
  const { loadDemo } = useLedger();
  const detected = useMemo(() => platform ?? currentPlatform(), [platform]);
  const passkeyOk = status.passkeyUnlock;
  const [useCode, setUseCode] = useState(() => !passkeyOk || incomingRecovery.peek() !== null);
  const [value, setValue] = useState(() => incomingRecovery.take() ?? '');
  const [valid, setValid] = useState(false);
  /** The step of the unlock in progress, `null` when idle. */
  const [step, setStep] = useState<UnlockStep | null>(null);
  /** The step that has been showing for `SLOW_AFTER_MS` (then "Taking too long?" appears). */
  const [slowStep, setSlowStep] = useState<UnlockStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef<AbortController | null>(null);
  const reason = lockReasonText(status.lockReason, status.autoLockMinutes);
  useTitle('Unlock');

  const run = async (first: UnlockStep, fn: (o: UnlockOptions) => Promise<unknown>, auto = false) => {
    attempt.current?.abort(); // a tap while a prompt is pending (perhaps one the phone never showed) starts over
    const ctrl = new AbortController();
    attempt.current = ctrl;
    const current = () => attempt.current === ctrl && !ctrl.signal.aborted;
    setError(null);
    setStep(first);
    try {
      await fn({ signal: ctrl.signal, onStep: (s) => current() && setStep(s) });
    } catch (e) {
      if (!current() || wasAbandoned(e)) return;
      if (auto && quietAutoFailure(e)) return;
      setError(wasCancelled(e) ? 'Cancelled. Tap to try again.' : explainError(e));
    } finally {
      if (attempt.current === ctrl) {
        attempt.current = null;
        setStep(null);
      }
    }
  };

  const tryAgain = () => {
    attempt.current?.abort();
    attempt.current = null;
    vault.cancelUnlock();
    setStep(null);
    setError(null);
  };

  const unlockWithPasskey = (auto = false) => run('connecting', (o) => vault.unlockWithPasskey(o), auto);

  useEffect(() => {
    if (step === null) return;
    const t = setTimeout(() => setSlowStep(step), SLOW_AFTER_MS);
    return () => clearTimeout(t);
  }, [step]);
  const slow = step !== null && slowStep === step;

  useEffect(() => {
    const ok = () => shouldAutoPrompt({ passkeyOk, lockReason: status.lockReason, used: autoPromptUsed, showingPasskey: !useCode, ...pageActive() });
    if (!ok()) return;
    // A tick later, so a remount (React's development double effects) doesn't spend the one try.
    const t = setTimeout(() => {
      if (!ok()) return;
      autoPromptUsed = true; // set before asking: never a second automatic prompt (cancel, refusal or a remount)
      void unlockWithPasskey(true);
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on arrival
  }, []);

  // Before the prompt has answered, the button stays live: tapping it starts over with a fresh tap.
  const canRestart = step === null || step === 'connecting' || step === 'passkey';
  const slowLine = slow && (
    <TextButton onClick={tryAgain} className="self-center">
      Taking too long? Try again
    </TextButton>
  );

  return (
    <Frame glowTop={null} className="items-center pb-9">
      <div className="relative flex flex-1 flex-col items-center justify-center gap-[22px] pt-10 lg:flex-none lg:pb-10 lg:pt-0">
        <div className="relative">
          {/* The glow follows the logo, which is centered vertically at every screen height. */}
          <Glow className="top-1/2 -translate-y-1/2" />
          <LogoMark size={96} />
        </div>
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
              if (valid && step === null) void run('signing-in', (o) => vault.unlockWithRecoveryCode(value, o));
            }}
          >
            {!passkeyOk && <p className="m-0 text-center text-[13px] leading-[1.45] text-muted">This device has no passkey for these records yet, so unlock with your recovery code. You can add a passkey afterwards.</p>}
            <RecoveryInput value={value} onChange={setValue} onValid={setValid} autoFocus />
            <NotSeedPhrase />
            <ErrorLine>{error}</ErrorLine>
            <BigButton type="submit" disabled={!valid || step !== null}>
              {step !== null ? stepText(step, detected) : 'Unlock'}
            </BigButton>
            {slowLine}
            {passkeyOk && (
              <TextButton
                onClick={() => {
                  tryAgain();
                  setUseCode(false);
                }}
              >
                Use my passkey instead
              </TextButton>
            )}
          </form>
        ) : (
          <>
            <ErrorLine>{error}</ErrorLine>
            <BigButton onClick={() => void unlockWithPasskey()} disabled={!canRestart} aria-live="polite">
              <UnlockIcon platform={detected} />
              {step !== null ? stepText(step, detected) : 'Unlock'}
            </BigButton>
            {slowLine || <p className="m-0 text-center text-xs text-muted">{unlockCaption(detected)}</p>}
            <TextButton
              onClick={() => {
                tryAgain();
                setUseCode(true);
              }}
            >
              Use my recovery code instead
            </TextButton>
          </>
        )}
        <TextButton
          onClick={() => {
            tryAgain();
            void loadDemo();
          }}
        >
          Show the demo
        </TextButton>
        <div className="flex items-center justify-center gap-2 text-xs normal-nums text-muted">
          <ShieldIcon size={14} />
          Self-hosted · end-to-end encrypted · no tracking
        </div>
      </div>
    </Frame>
  );
}
