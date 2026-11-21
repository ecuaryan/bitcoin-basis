import { useId, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useLedger } from '../../data/ledger-provider.tsx';
import { explainError, wasCancelled } from '../../data/explain-error.ts';
import { incomingRecovery, kitHandoff } from '../../data/recovery-handoff.ts';
import { useVault, usePendingKit, useVaultStatus } from '../../data/vault-provider.tsx';
import { cx } from '../../lib/cx.ts';
import { PrinterIcon } from '../../ui/auth-icons.tsx';
import { ChevronLeftIcon } from '../../ui/more-icons.tsx';
import { BigButton, BigLink, CodeGroups, ErrorLine, Frame, LogoMark, NotSeedPhrase, TextButton } from './parts.tsx';
import { RecoveryInput } from './RecoveryInput.tsx';
import { SaveCode } from './SaveCode.tsx';
import { matchesGroup, normalizeSetupCode } from './setup-logic.ts';
import { useTitle } from '../../ui/use-title.ts';

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
  const [mode, setMode] = useState<Mode>(() => (kitHandoff.get()?.reason === 'setup' ? 'code' : incomingRecovery.peek() !== null ? 'restore' : 'home'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useTitle(WELCOME_TITLES[mode]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(wasCancelled(e) ? 'Cancelled. Tap to try again.' : explainError(e));
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
  const finish = () => {
    kitHandoff.clear();
    navigate('/?add=wallet', { replace: true });
  };

  if (mode === 'code' && pending !== null) return <CodeStep code={pending.code} onNext={() => setMode('confirm')} />;
  if (mode === 'confirm' && pending !== null) return <ConfirmStep code={pending.code} onDone={() => setMode('done')} />;
  if (mode === 'done') return <DoneStep onFinish={finish} />;
  if (mode === 'restored') {
    return (
      <RestoredStep
        onAdd={() =>
          void run(async () => {
            await vault.addPasskey();
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
          })
        }
      />
    );
  }

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
          Setup code from your install script
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
          className="min-h-14 w-full rounded-[14px] border border-accent bg-surface px-4 text-center font-display text-[16px] font-semibold tracking-[0.04em] text-text placeholder:font-sans placeholder:text-[15px] placeholder:font-normal placeholder:tracking-normal placeholder:text-muted"
        />
      </div>
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
      <p className="m-0 mt-2.5 text-[15px] leading-normal text-soft">Look at the paper, not the screen, and type group&nbsp;4. That proves you copied it right.</p>
      <form
        className="relative mt-5 flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) onDone();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor={id} className="text-[13px] text-soft">
            Group&nbsp;4 of your recovery code
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

function DoneStep({ onFinish }: { onFinish(): void }) {
  return (
    <Frame glowTop={60}>
      <section className="relative flex flex-1 flex-col items-center justify-center gap-4 text-center lg:flex-none lg:pb-10">
        <LogoMark size={72} />
        <h1 className="m-0 font-display text-[30px] font-semibold leading-[1.1] tracking-[-0.02em]">You&apos;re all set</h1>
        <p className="m-0 max-w-[300px] text-[15px] leading-normal text-soft">Your records are encrypted and synced. Start with the wallet or exchange you use most.</p>
      </section>
      <div className="relative flex flex-col gap-2.5">
        <BigButton onClick={onFinish}>Add my first wallet</BigButton>
        <BigLink to="/kit" variant="secondary">
          <PrinterIcon size={18} />
          Print the emergency kit
        </BigLink>
        <span className="text-center text-xs text-muted">The recovery code is only shown until you leave this page.</span>
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
  const [value, setValue] = useState(() => incomingRecovery.take() ?? '');
  const [valid, setValid] = useState(false);
  return (
    <Frame glowTop={0} className="pt-5">
      <button type="button" onClick={onBack} className="flex min-h-11 w-fit items-center gap-1 bg-transparent pr-3 text-sm font-semibold text-soft hover:text-text">
        <ChevronLeftIcon size={16} />
        Back
      </button>
      <h1 className="m-0 mt-3 font-display text-[30px] font-semibold leading-[1.1] tracking-[-0.02em]">Open your records</h1>
      <p className="m-0 mt-2.5 text-[15px] leading-normal text-soft">Type the recovery code from your emergency kit, or scan the kit&apos;s square code with the camera.</p>
      <form
        className="relative mt-5 flex flex-col gap-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onCode(value);
        }}
      >
        <RecoveryInput value={value} onChange={setValue} onValid={setValid} autoFocus />
        <NotSeedPhrase />
        <ErrorLine>{error}</ErrorLine>
        <BigButton type="submit" disabled={!valid || busy}>
          {busy ? 'Restoring…' : 'Restore my records'}
        </BigButton>
      </form>
      <div className="min-h-6 flex-1 lg:min-h-10 lg:flex-none" />
      <div className="flex flex-col items-center gap-1">
        <span className="text-xs text-muted">Have a passkey that syncs to this device?</span>
        <TextButton onClick={onPasskey} disabled={busy}>
          Use a passkey
        </TextButton>
      </div>
    </Frame>
  );
}
