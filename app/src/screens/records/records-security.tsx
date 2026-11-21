import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { cx } from '../../lib/cx.ts';
import { appAddress, shortAddress } from '../../data/app-url.ts';
import { explainError, wasCancelled } from '../../data/explain-error.ts';
import { installPrompt, isStandalone } from '../../data/install.ts';
import { useLedger } from '../../data/ledger-provider.tsx';
import { currentPlatform, isIos } from '../../data/platform.ts';
import { kitHandoff } from '../../data/recovery-handoff.ts';
import { describeSync, syncRowText, type SyncTone } from '../../data/sync-view.ts';
import { useVault, useVaultStatus } from '../../data/vault-provider.tsx';
import { ExitDemoButton } from '../../ui/AppShell.tsx';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { SelectBox } from '../../ui/Field.tsx';
import { QrCode } from '../../ui/QrCode.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { useToast } from '../../ui/Toast.tsx';
import { useHelp } from '../../ui/Help.tsx';

const LOCK_CHOICES = [1, 5, 15, 30, 0] as const;

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card as="section" aria-label={title} className="flex flex-col gap-3 !rounded-[18px] !p-4">
      <h2 className="m-0 text-[15px] font-semibold">{title}</h2>
      {children}
    </Card>
  );
}

const P = 'm-0 text-[13px] leading-[1.45] text-soft';

/** "Passkey" stays (the browser uses the word), explained once behind a "?". */
function PasskeyLine() {
  const help = useHelp('What is a passkey?', 'A passkey lets this device open your records with its fingerprint or screen lock. Nothing to type or remember.');
  return (
    <>
      <p className={cx(P, 'flex items-center gap-1')}>
        Passkey on this device ✓{help.button}
      </p>
      {help.panel}
    </>
  );
}

/** Settings, Security and devices: sync, this device, adding another device, the recovery code and forgetting the device. */
export function SecurityView() {
  const { isDemo } = useLedger();
  if (isDemo) {
    return (
      <Card className="flex max-w-[640px] flex-col items-start gap-3">
        <p className={P}>You are looking at the demo, so there is nothing to protect yet. Exit the demo and set up your own records to get a passkey, a recovery code and syncing.</p>
        <ExitDemoButton variant="primary" />
      </Card>
    );
  }
  return <RealSecurity />;
}

/** Settings, App: when the app locks itself, installing it, and a note on hiding amounts. */
export function AppView() {
  const { isDemo } = useLedger();
  return (
    <div className="flex max-w-[640px] flex-col gap-3">
      {!isDemo && <AutoLockGroup />}
      <InstallGroup />
      <Group title="Hide amounts">
        <p className={P}>Amounts show when you open the app. Tap the eye at the top to hide them.</p>
      </Group>
    </div>
  );
}

function AutoLockGroup() {
  const vault = useVault();
  const status = useVaultStatus();
  return (
    <Group title="Auto-lock">
      <SelectBox label="Lock after" value={String(status.autoLockMinutes)} onChange={(e) => vault.setAutoLockMinutes(Number(e.target.value))}>
        {LOCK_CHOICES.map((m) => (
          <option key={m} value={m}>
            {m === 0 ? 'Never' : `${m} ${m === 1 ? 'minute' : 'minutes'} of no activity`}
          </option>
        ))}
      </SelectBox>
    </Group>
  );
}

const SYNC_DOT: Record<SyncTone, string> = { ok: 'bg-accent', busy: 'animate-pulse bg-amber', quiet: 'bg-muted', attention: 'bg-loss' };

function RealSecurity() {
  const vault = useVault();
  const status = useVaultStatus();
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const [rotateOpen, setRotateOpen] = useState(() => params.get('rotate') === '1');
  const [forgetOpen, setForgetOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    // The one-time prompt after a QR-link restore arrives with ?rotate=1: the sheet is open, so drop it from the address.
    if (params.get('rotate') !== '1') return;
    const next = new URLSearchParams(params);
    next.delete('rotate');
    setParams(next, { replace: true });
  }, [params, setParams]);
  const sync = describeSync(status.sync, now);
  const s = status.sync;
  const row = syncRowText(s, now);
  const unsynced = s.pending > 0 || s.phase === 'syncing';

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(wasCancelled(e) ? 'Cancelled. Tap to try again.' : explainError(e));
    } finally {
      setBusy(null);
    }
  };

  const forget = () =>
    run('forget', async () => {
      await vault.forgetDevice();
      kitHandoff.clear();
      setForgetOpen(false);
      navigate('/welcome', { replace: true });
    });

  return (
    <div className="flex max-w-[640px] flex-col gap-3">
      {error !== null && (
        <p role="alert" className="m-0 rounded-xl border border-loss/40 bg-loss/10 px-3.5 py-2.5 text-[13px] leading-[1.45] text-loss">
          {error}
        </p>
      )}

      <Group title="Sync between devices">
        <p className={cx(P, 'flex items-center gap-2')} role="status">
          <span aria-hidden="true" className={cx('size-2 flex-none rounded-full', SYNC_DOT[row.tone])} />
          {row.text}
        </p>
        {s.conflicts > 0 && (
          <p className={P}>
            {s.conflicts} {s.conflicts === 1 ? 'entry was' : 'entries were'} saved twice with different content on two devices. The first one is shown. Check your entries to be sure.
          </p>
        )}
        {s.missingOnServer > 0 && (
          <p className={P}>
            {s.missingOnServer} {s.missingOnServer === 1 ? 'record on this device is' : 'records on this device are'} no longer on your server. Your copy here is complete. Check your server and its backups.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2.5">
          {sync.canConnect && (
            <Button
              variant="primary"
              disabled={busy !== null}
              onClick={() =>
                void run('connect', async () => {
                  const r = await vault.connect();
                  toast.show(r.ok ? 'Connected and synced.' : 'Connected, but the sync did not finish.', { success: r.ok });
                })
              }
            >
              {busy === 'connect' ? 'Waiting for your passkey…' : 'Sign in to sync'}
            </Button>
          )}
          {!sync.canConnect && (
            <button
              type="button"
              disabled={busy !== null || s.phase === 'syncing' || s.phase === 'off'}
              onClick={() =>
                void run('sync', async () => {
                  const r = await vault.sync();
                  toast.show(r.ok ? 'Synced.' : 'Could not sync right now.', { success: r.ok });
                })
              }
              className="flex min-h-11 items-center bg-transparent px-1 text-sm font-semibold text-amber underline-offset-2 hover:underline disabled:opacity-50"
            >
              Check now
            </button>
          )}
        </div>
      </Group>

      <Group title="This device">
        {status.passkeyUnlock ? (
          <PasskeyLine />
        ) : (
          <>
            <p className={P}>No passkey on this device yet.</p>
            <div>
              <Button
                disabled={busy !== null}
                onClick={() =>
                  void run('passkey', async () => {
                    await vault.addPasskey();
                    toast.show('Passkey added on this device.', { success: true });
                  })
                }
              >
                {busy === 'passkey' ? 'Waiting for your passkey…' : 'Add a passkey on this device'}
              </Button>
            </div>
          </>
        )}
      </Group>

      <AddDeviceGroup />

      <Group title="Recovery code">
        <p className={P}>Opens your records if every device is lost. It is not a Bitcoin seed phrase.</p>
        <div className="flex flex-wrap gap-2.5">
          <Button onClick={() => setRotateOpen(true)}>Make a new recovery code</Button>
        </div>
        <Disclosure label="More">
          <p className={P}>Make a new one if the kit is lost or someone else saw it. The old kit stops working.</p>
        </Disclosure>
      </Group>

      <Group title="Forget this device">
        <p className={P}>Removes this device&apos;s copy. Your server keeps the encrypted one.</p>
        <div>
          <Button onClick={() => setForgetOpen(true)}>Forget this device</Button>
        </div>
      </Group>

      <Sheet open={rotateOpen} onClose={() => setRotateOpen(false)} title="Make a new recovery code?">
        <div className="flex flex-col gap-3 p-1">
          <p className={P}>Your current kit stops working the moment this finishes. You&apos;ll see the new code once, and print a new kit right away.</p>
          <div className="flex flex-wrap gap-2.5">
            <Button
              variant="primary"
              disabled={busy !== null}
              onClick={() =>
                void run('rotate', async () => {
                  const r = await vault.rotateRecoveryCode();
                  kitHandoff.set(r.recoveryCode, 'rotate');
                  setRotateOpen(false);
                  navigate('/kit');
                })
              }
            >
              {busy === 'rotate' ? 'Working…' : 'Make a new code'}
            </Button>
            <Button onClick={() => setRotateOpen(false)}>Cancel</Button>
          </div>
        </div>
      </Sheet>

      <Sheet open={forgetOpen} onClose={() => setForgetOpen(false)} title="Forget this device?">
        <div className="flex flex-col gap-3 p-1">
          <p className={P}>This removes everything stored on this device. You&apos;ll need your recovery code or a passkey to open your records again.</p>
          <p className={cx(P, unsynced && 'text-amber')} role="status">
            {unsynced ? 'Not synced yet. Wait for it before you forget this device. ' : ''}
            {sync.detail}
          </p>
          {unsynced && <p className="m-0 text-[13px] font-semibold leading-[1.45] text-loss">Changes not yet synced from this device will be lost.</p>}
          <div className="flex flex-wrap gap-2.5">
            <Button variant="primary" disabled={busy !== null || unsynced} onClick={() => void forget()}>
              Forget this device
            </Button>
            <Button onClick={() => setForgetOpen(false)}>Cancel</Button>
            {unsynced && (
              <Button variant="ghost" disabled={busy !== null} onClick={() => void forget()}>
                Forget anyway
              </Button>
            )}
          </div>
        </div>
      </Sheet>
    </div>
  );
}

function AddDeviceGroup() {
  const address = appAddress();
  return (
    <Group title="Add another device">
      <p className={P}>Open this address on the new device and choose “Open my records”. Then type your recovery code.</p>
      <Disclosure label="Show the address and square code">
        <div className="flex items-center gap-4">
          <QrCode text={address} size={132} label={`QR code for ${shortAddress(address)}`} className="flex-none rounded-xl" />
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-xs text-muted">App address</span>
            <span className="break-all text-[15px] font-semibold">{shortAddress(address)}</span>
            <span className="text-xs text-muted">Point the new device&apos;s camera at the square.</span>
          </div>
        </div>
      </Disclosure>
    </Group>
  );
}

/** A quiet "more" disclosure with a 44px tap target. */
function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="text-[13px]">
      <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-amber">{label}</summary>
      <div className="pb-1 pt-1">{children}</div>
    </details>
  );
}

function InstallGroup() {
  const canPrompt = useSyncExternalStore(installPrompt.subscribe, installPrompt.available);
  const [result, setResult] = useState<string | null>(null);
  const platform = currentPlatform();
  if (isStandalone()) return null;
  if (!canPrompt && !isIos(platform)) return null;
  return (
    <Group title="Install the app">
      {isIos(platform) ? (
        <p className={P}>Tap the Share button, then Add to Home Screen. It then opens like any other app.</p>
      ) : (
        <>
          <p className={P}>Put Bitcoin Basis on your home screen or dock so it opens like an app, and works offline.</p>
          <div>
            <Button
              variant="primary"
              onClick={() =>
                void installPrompt.run().then((r) => setResult(r === 'accepted' ? 'Installed.' : null))
              }
            >
              Install app
            </Button>
          </div>
          {result !== null && <p className={P}>{result}</p>}
        </>
      )}
    </Group>
  );
}
