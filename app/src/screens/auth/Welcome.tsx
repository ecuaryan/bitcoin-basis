import { useEffect, useId, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { useLedger } from '../../data/ledger-provider.tsx';
import { explainError, passkeyRestoreFallback, wasCancelled } from '../../data/explain-error.ts';
import { incomingRecovery, kitHandoff } from '../../data/recovery-handoff.ts';
import { useVault, usePendingKit, useVaultStatus } from '../../data/vault-provider.tsx';
import { cx } from '../../lib/cx.ts';
import { KeyIcon, PrinterIcon } from '../../ui/auth-icons.tsx';
import { PlusIcon } from '../../ui/icons.tsx';
import { ChevronLeftIcon, UploadIcon } from '../../ui/more-icons.tsx';
import { BigButton, BigLink, CodeGroups, ErrorLine, Frame, GroupMap, LogoMark, NotSeedPhrase, TextButton } from './parts.tsx';
import { RecoveryInput } from './RecoveryInput.tsx';
import { SaveCode } from './SaveCode.tsx';
import { matchesGroup, normalizeSetupCode } from './setup-logic.ts';
import { useTitle } from '../../ui/use-title.ts';
import { useToast } from '../../ui/Toast.tsx';

type Mode = 'home' | 'restore' | 'code' | 'confirm' | 'done' | 'restored';
const WELCOME_TITLES: Record<Mode, string | null> = { home: null, restore: 'Open your records', code: 'Save your recovery code', confirm: 'Check your recovery code', done: 'All set', restored: 'Records restored' };

const STEPS = ['Claim this app with your setup code', 'Create a passkey on this device', 'Save your recovery code', 'Check your recovery code'];

function Progress({ step }: { step: number }) {
  return (
    <>
      <div className="flex gap-1.5" role="progressbar" aria-label="Setup progress" aria-valuemin={1} aria-valuemax={4} aria-valuenow={step}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className={cx('h-[5px] flex-1 rounded-[3px]', i <= step ? 'bg-accent' : 'bg-line')} />
        ))}
      </div>
      <span className="mt-2.5 text-xs text-muted">Step {step} of 4</span>
    </>
  );
}

/** First run: claim the app with the setup code, or restore on this device, or look around with the demo. */
export function Welcome() {
  const vault = useVault();
  const status = useVaultStatus();
  const { isDemo, loadDemo } = useLedger();
  const pending = usePendingKit();
  const navigate = useNavigate();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>(() => (kitHandoff.get()?.reason === 'setup' ? 'code' : incomingRecovery.peek() !== null ? 'restore' : 'home'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Does the server already hold records? null while we ask (a neutral skeleton shows, never the claim form). If the
  // question fails (no server, offline) the claim form shows: that is the only way forward on an unclaimed instance.
  const [claimed, setClaimed] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    vault.serverStatus().then(
      (r) => live && setClaimed(r.claimed),
      () => live && setClaimed(false),
    );
    return () => {
      live = false;
    };
  }, [vault]);
  useTitle(WELCOME_TITLES[mode]);

  const run = async (fn: () => Promise<void>, explain: (e: unknown) => string = (e) => (wasCancelled(e) ? 'Cancelled. Tap to try again.' : explainError(e))) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(false);
    }
  };

  // Leave when there is nothing to do here: the demo is on, or records are already open on this device.
  if (isDemo) return <Navigate to="/" replace />;
  if (status.state === 'locked' && mode === 'home' && !busy) return <Navigate to="/" replace />;
  if (status.state === 'unlocked' && mode === 'home' && !busy && pending === null) return <Navigate to="/" replace />;

  const back = () => {
    setError(null);
    setMode('home');
  };
  const finish = (to: '/?add=wallet' | '/records?v=io' = '/?add=wallet') => {
    kitHandoff.clear();
    navigate(to, { replace: true });
  };

  if (mode === 'code' && pending !== null) return <CodeStep code={pending.code} onNext={() => setMode('confirm')} />;
  if (mode === 'confirm' && pending !== null) return <ConfirmStep code={pending.code} onDone={() => setMode('done')} />;
  if (mode === 'done') return <DoneStep onFinish={() => finish()} onImport={() => finish('/records?v=io')} />;
  if (mode === 'restored') {
    return (
      <RestoredStep
        onAdd={() =>
          void run(async () => {
            const r = await vault.addPasskey();
            // Shown over Holdings; a pending "make a new recovery code" (kit QR link) opens there now that a passkey is here.
            toast.show(r.adopted ? 'Your passkey from your other device works here too.' : 'Passkey added on this device.', { success: true });
            navigate('/', { replace: true });
          })
        }
        onSkip={() => navigate('/', { replace: true })}
        busy={busy}
        error={error}
      />
    );
  }
  if (mode === 'restore') {
    return (
      <RestoreStep
        busy={busy}
        error={error}
        onBack={back}
        onCode={(code) =>
          void run(async () => {
            const r = await vault.unlockWithRecoveryCode(code);
            // A restored device has no passkey yet: offer to add one right away.
            if (r.via === 'recovery' && !vault.status.passkeyUnlock) setMode('restored');
            else navigate('/', { replace: true });
          })
        }
        onPasskey={() =>
          void run(async () => {
            await vault.unlockWithPasskey();
            navigate('/', { replace: true });
          }, passkeyRestoreFallback)
        }
      />
    );
  }

  if (claimed === null) return <WelcomeSkeleton />;
  if (claimed) return <ClaimedHome onOpen={() => setMode('restore')} onDemo={() => void run(async () => {
    await loadDemo();
    navigate('/', { replace: true });
  })} />;

  return (
    <Frame>
      <section className="relative flex flex-col items-center gap-[18px] pt-[72px] text-center">
        <LogoMark size={80} />
        <h1 className="m-0 font-display text-[32px] font-semibold leading-[1.1] tracking-[-0.02em]">
          Your Bitcoin,
          <br />
          on the record.
        </h1>
        <p className="m-0 max-w-[300px] text-[15px] leading-normal text-soft">Prove what every coin cost. Encrypted on your devices, synced through your own server. Nobody else can read it.</p>
      </section>

      <ol aria-label="Setup steps" className="relative m-0 mt-7 flex list-none flex-col gap-2.5 p-0">
        {STEPS.map((label, i) => (
          <li key={label} className="flex min-h-10 items-center gap-3">
            <span aria-hidden="true" className={cx('flex size-7 flex-none items-center justify-center rounded-full text-[13px] font-bold', i === 0 ? 'bg-accent text-bg' : 'border-[1.5px] border-[#3a3632] text-muted')}>
              {i + 1}
            </span>
            <span className={cx('text-sm', i === 0 ? 'font-semibold text-text' : 'text-muted')}>{label}</span>
          </li>
        ))}
      </ol>

      <div className="min-h-6 flex-1 lg:min-h-10 lg:flex-none" />

      <SetupForm
        busy={busy}
        error={error}
        onClaim={(setupCode) =>
          void run(async () => {
            const r = await vault.create({ setupCode });
            kitHandoff.set(r.recoveryCode, 'setup');
            setMode('code');
          })
        }
      />

      <div className="relative mt-2 flex items-center justify-center gap-1 text-sm">
        <TextButton onClick={() => setMode('restore')}>I already use Bitcoin Basis</TextButton>
        <span aria-hidden="true" className="text-muted">
          ·
        </span>
        <TextButton
          onClick={() =>
            void run(async () => {
              await loadDemo();
              navigate('/', { replace: true });
            })
          }
        >
          Try the demo
        </TextButton>
      </div>
    </Frame>
  );
}

const GUIDE_URL = 'https://github.com/ecuaryan/bitcoin-basis/blob/main/SELF-HOSTING.md';

/** While we ask the server whether it is claimed: the same frame, nothing to type into. */
function WelcomeSkeleton() {
  return (
    <Frame>
      <div role="status" aria-label="Loading" className="relative flex flex-col items-center gap-[18px] pt-[72px]">
        <div className="size-20 animate-pulse rounded-[20px] bg-surface-2" />
        <div className="h-[70px] w-64 animate-pulse rounded-2xl bg-surface-2" />
        <div className="h-14 w-72 animate-pulse rounded-2xl bg-surface" />
      </div>
    </Frame>
  );
}

/** The server already holds records: there is nothing to claim, only to open. */
function ClaimedHome({ onOpen, onDemo }: { onOpen(): void; onDemo(): void }) {
  return (
    <Frame>
      <section className="relative flex flex-col items-center gap-[18px] pt-[72px] text-center">
        <LogoMark size={80} />
        <h1 className="m-0 font-display text-[32px] font-semibold leading-[1.1] tracking-[-0.02em]">These records are already set up.</h1>
        <p className="m-0 max-w-[300px] text-[15px] leading-normal text-soft">Open them with your recovery code or a passkey.</p>
      </section>
      <div className="min-h-10 flex-1 lg:flex-none" />
      <div className="relative flex flex-col gap-3">
        <BigButton onClick={onOpen}>I already use Bitcoin Basis</BigButton>
      </div>
      <div className="relative mt-2 flex flex-col items-center gap-0.5 text-center text-xs text-muted">
        <span>
          Set up a new instance?{' '}
          <a href={GUIDE_URL} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-6 items-center font-semibold">
            See the self-hosting guide.
          </a>
        </span>
        <TextButton onClick={onDemo}>Try the demo</TextButton>
      </div>
    </Frame>
  );
}

function SetupForm({ busy, error, onClaim }: { busy: boolean; error: string | null; onClaim(code: string): void }) {
  const id = useId();
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <form
      aria-label="Claim this app"
      className="relative flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const r = normalizeSetupCode(code);
        setProblem(r.ok ? null : r.message);
        if (r.ok) onClaim(r.code);
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-[13px] text-soft">
          Setup code
        </label>
        <input
          id={id}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="ABCD-1234-…"
          aria-invalid={error !== null || problem !== null}
          aria-describedby={`${id}-hint`}
          className="min-h-14 w-full rounded-[14px] border border-accent bg-surface px-4 text-center font-display text-[16px] font-semibold tracking-[0.04em] text-text placeholder:font-sans placeholder:text-[15px] placeholder:font-normal placeholder:tracking-normal placeholder:text-muted"
        />
      </div>
      <span id={`${id}-hint`} className="-mt-1 text-xs text-muted">
        Shown when the app was set up (the setup step printed it)
      </span>
      <ErrorLine>{problem ?? error}</ErrorLine>
      <BigButton type="submit" disabled={busy || code.trim() === ''}>
        {busy ? 'Waiting for your passkey…' : 'Claim and create my passkey'}
      </BigButton>
      <span className="text-center text-xs text-muted">The code works once, so a stranger who finds your URL can&apos;t claim it.</span>
    </form>
  );
}

/** Step 3: the recovery code, shown once. */
function CodeStep({ code, onNext }: { code: string; onNext(): void }) {
  return (
    <Frame glowTop={0} className="pt-5">
      <Progress step={3} />
      <h1 className="m-0 mt-[18px] font-display text-[30px] font-semibold leading-[1.1] tracking-[-0.02em]">Save your recovery code</h1>
      <p className="m-0 mt-2.5 text-[15px] leading-normal text-soft">If every device is lost, this code opens your records. Your passkey works day to day.</p>
      <section aria-label="Recovery code" className="relative mt-5 flex flex-col gap-3.5 rounded-[20px] border-[1.5px] border-accent bg-surface p-[18px] shadow-[0_0_60px_rgb(247_147_26/0.12)]">
        <CodeGroups code={code} />
        <NotSeedPhrase className="border-t border-line pt-3" />
      </section>
      <SaveCode code={code} className="mt-4" />
      <div className="min-h-6 flex-1 lg:min-h-10 lg:flex-none" />
      <div className="flex flex-col gap-2.5">
        <BigLink to="/kit">
          <PrinterIcon size={20} />
          Print the emergency kit
        </BigLink>
        <BigButton variant="secondary" onClick={onNext}>
          I&apos;ve saved it
        </BigButton>
        <span className="text-center text-xs text-muted">Next, you&apos;ll type group&nbsp;4 to make sure it&apos;s right.</span>
      </div>
    </Frame>
  );
}

/** Step 4: prove the code was copied correctly (type group 4), or tick the box after looking once more. */
function ConfirmStep({ code, onDone }: { code: string; onDone(): void }) {
  const id = useId();
  const [typed, setTyped] = useState('');
  const [skipping, setSkipping] = useState(false);
  const [shown, setShown] = useState(false);
  const ok = matchesGroup(code, 4, typed);
  const wrong = typed.trim() !== '' && !matchesGroup(code, 4, typed) && typed.replace(/[\s-]/g, '').length >= 5;
  return (
    <Frame glowTop={0} className="pt-5">
      <Progress step={4} />
      <h1 className="m-0 mt-[18px] font-display text-[30px] font-semibold leading-[1.1] tracking-[-0.02em]">Check your recovery code</h1>
      <p className="m-0 mt-2.5 text-[15px] leading-normal text-soft">Look at where you saved it (your password manager or the printed kit), not this screen, and type group&nbsp;4: the fourth block of five characters, counting from the start.</p>
      <div className="mt-4">
        <GroupMap n={4} />
      </div>
      <form
        className="relative mt-5 flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) onDone();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor={id} className="text-[13px] text-soft">
            Group 4 of your recovery code
          </label>
          <input
            id={id}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={12}
            aria-invalid={wrong}
            aria-describedby={`${id}-s`}
            className={cx(
              'min-h-14 w-full rounded-[14px] border bg-surface px-4 text-center font-display text-[22px] font-semibold uppercase tracking-[0.12em] text-text',
              wrong ? 'border-loss' : matchesGroup(code, 4, typed) ? 'border-accent' : 'border-line',
            )}
          />
          <p id={`${id}-s`} role="status" aria-live="polite" className={cx('m-0 min-h-5 text-xs', wrong ? 'text-loss' : 'text-amber')}>
            {matchesGroup(code, 4, typed) ? 'That matches.' : wrong ? 'That is not group 4. Compare with the paper.' : ''}
          </p>
        </div>

        {shown ? (
          <section aria-label="Recovery code again" className="flex flex-col gap-3 rounded-[20px] border border-line bg-surface p-4">
            <CodeGroups code={code} />
            <NotSeedPhrase className="border-t border-line pt-3" />
          </section>
        ) : null}
        <TextButton onClick={() => setShown((s) => !s)} aria-expanded={shown}>
          {shown ? 'Hide the code' : 'Show the code again'}
        </TextButton>

        <BigButton type="submit" disabled={!ok}>
          Continue
        </BigButton>
        {skipping ? (
          <div role="group" aria-label="Skip the check" className="flex flex-col gap-2 rounded-[14px] border border-line bg-surface p-3.5">
            <p className="m-0 text-[13px] leading-[1.45] text-soft">If the code is copied wrong, it won&apos;t open your records.</p>
            <div className="flex gap-2">
              <BigButton variant="secondary" className="min-h-11 flex-1 rounded-xl" onClick={() => setSkipping(false)}>
                Check it
              </BigButton>
              <BigButton variant="secondary" className="min-h-11 flex-1 rounded-xl" onClick={onDone}>
                Skip anyway
              </BigButton>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setSkipping(true)} className="min-h-11 bg-transparent text-xs text-muted underline-offset-2 hover:text-soft hover:underline">
            Skip this check
          </button>
        )}
      </form>
    </Frame>
  );
}

function DoneStep({ onFinish, onImport }: { onFinish(): void; onImport(): void }) {
  return (
    <Frame glowTop={60}>
      <section className="relative flex flex-1 flex-col items-center justify-center gap-4 text-center lg:flex-none lg:pb-10">
        <LogoMark size={72} />
        <h1 className="m-0 font-display text-[30px] font-semibold leading-[1.1] tracking-[-0.02em]">You&apos;re all set</h1>
        <p className="m-0 max-w-[300px] text-[15px] leading-normal text-soft">Your records are encrypted and synced. Start with the wallet or exchange you use most, or bring in a spreadsheet of your history.</p>
      </section>
      <div className="relative flex flex-col gap-2.5">
        <BigButton onClick={onFinish}>
          <PlusIcon size={20} />
          Add my first wallet
        </BigButton>
        <BigButton variant="secondary" onClick={onImport}>
          <UploadIcon size={20} />
          Import a spreadsheet or backup
        </BigButton>
        <div className="flex flex-col items-center">
          <Link to="/kit" className="flex min-h-11 items-center gap-1.5 px-2 text-sm font-semibold text-amber no-underline underline-offset-2 hover:underline">
            <PrinterIcon size={16} />
            Print the emergency kit
          </Link>
          <span className="text-center text-xs text-muted">The recovery code is only shown until you leave this page.</span>
        </div>
      </div>
    </Frame>
  );
}

function RestoredStep({ onAdd, onSkip, busy, error }: { onAdd(): void; onSkip(): void; busy: boolean; error: string | null }) {
  return (
    <Frame glowTop={60}>
      <section className="relative flex flex-1 flex-col items-center justify-center gap-4 text-center lg:flex-none lg:pb-10">
        <LogoMark size={72} />
        <h1 className="m-0 font-display text-[30px] font-semibold leading-[1.1] tracking-[-0.02em]">Records restored</h1>
        <p className="m-0 max-w-[320px] text-[15px] leading-normal text-soft">Add a passkey on this device so you won&apos;t need the recovery code next time. It takes one tap.</p>
      </section>
      <div className="relative flex flex-col gap-2.5">
        <ErrorLine>{error}</ErrorLine>
        <BigButton onClick={onAdd} disabled={busy}>
          <KeyIcon size={20} />
          {busy ? 'Waiting for your passkey…' : 'Add a passkey on this device'}
        </BigButton>
        <TextButton onClick={onSkip}>Not now</TextButton>
      </div>
    </Frame>
  );
}

function RestoreStep({
  busy,
  error,
  onBack,
  onCode,
  onPasskey,
}: {
  busy: boolean;
  error: string | null;
  onBack(): void;
  onCode(code: string): void;
  onPasskey(): void;
}) {
  // Opened from the kit's QR code: the code is already filled in, so restoring with it comes first.
  const [fromLink] = useState(() => incomingRecovery.peek() !== null);
  const [value, setValue] = useState(() => incomingRecovery.take() ?? '');
  const [valid, setValid] = useState(false);
  const [tried, setTried] = useState<'passkey' | 'code' | null>(null);
  const passkey = (
    <BigButton
      variant={fromLink ? 'secondary' : 'primary'}
      disabled={busy}
      onClick={() => {
        setTried('passkey');
        onPasskey();
      }}
    >
      {busy && tried === 'passkey' ? 'Waiting for your passkey…' : 'Use my passkey'}
    </BigButton>
  );
  const hint = <p className="m-0 text-center text-xs leading-[1.45] text-muted">Passkeys saved in Google Password Manager, iCloud Keychain or a password manager like 1Password usually work on your other devices too.</p>;
  const form = (
    <form
      aria-label="Restore with the recovery code"
      className="relative flex flex-col gap-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        setTried('code');
        onCode(value);
      }}
    >
      {/* After a passkey that found nothing, the field takes focus: it is the way on. */}
      <RecoveryInput key={tried === 'passkey' && error !== null ? 'fallback' : 'first'} value={value} onChange={setValue} onValid={setValid} autoFocus={fromLink || (tried === 'passkey' && error !== null)} />
      <NotSeedPhrase />
      <ErrorLine>{error}</ErrorLine>
      <BigButton type="submit" variant={fromLink ? 'primary' : 'secondary'} disabled={!valid || busy}>
        {busy && tried === 'code' ? 'Restoring…' : 'Restore my records'}
      </BigButton>
    </form>
  );
  return (
    <Frame glowTop={0} className="pt-5">
      <button type="button" onClick={onBack} className="flex min-h-11 w-fit items-center gap-1 bg-transparent pr-3 text-sm font-semibold text-soft hover:text-text">
        <ChevronLeftIcon size={16} />
        Back
      </button>
      <h1 className="m-0 mt-3 font-display text-[30px] font-semibold leading-[1.1] tracking-[-0.02em]">Open your records</h1>
      {fromLink ? (
        <>
          <p className="m-0 mt-2.5 text-[15px] leading-normal text-soft">Your recovery code is filled in from your emergency kit.</p>
          <div className="mt-5">{form}</div>
          <div className="min-h-6 flex-1 lg:min-h-10 lg:flex-none" />
          <div className="flex flex-col gap-2">
            {passkey}
            {hint}
          </div>
        </>
      ) : (
        <>
          <p className="m-0 mt-2.5 text-[15px] leading-normal text-soft">Use the passkey from your other device, or the recovery code from your emergency kit.</p>
          <div className="mt-5 flex flex-col gap-2">
            {passkey}
            {hint}
          </div>
          <div role="separator" aria-hidden="true" className="my-5 flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-line" />
            or use your recovery code
            <span className="h-px flex-1 bg-line" />
          </div>
          {form}
        </>
      )}
    </Frame>
  );
}
