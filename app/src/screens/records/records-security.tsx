import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { appAddress, shortAddress } from '../../data/app-url.ts';
import { explainError, wasCancelled } from '../../data/explain-error.ts';
import { installPrompt, isStandalone } from '../../data/install.ts';
import { useLedger } from '../../data/ledger-provider.tsx';
import { currentPlatform, isIos } from '../../data/platform.ts';
import { kitHandoff } from '../../data/recovery-handoff.ts';
import { describeSync } from '../../data/sync-view.ts';
import { useVault, useVaultStatus } from '../../data/vault-provider.tsx';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { SelectBox } from '../../ui/Field.tsx';
import { QrCode } from '../../ui/QrCode.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { useToast } from '../../ui/Toast.tsx';

const LOCK_CHOICES = [1, 5, 15, 30, 0] as const;

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card as="section" aria-label={title} className="flex flex-col gap-3 !rounded-[18px] !p-4">
      <h3 className="m-0 text-[15px] font-semibold">{title}</h3>
      {children}
    </Card>
  );
}

const P = 'm-0 text-[13px] leading-[1.45] text-soft';

/** Records → Security: sync, this device, adding another device, the recovery code and locking. */
export function SecurityView() {
  const { isDemo, clearAll } = useLedger();
  if (isDemo) {
    return (
      <div className="flex flex-col gap-3">
        <h2 className="m-0 font-display text-2xl font-semibold">Security</h2>
        <Card className="flex flex-col items-start gap-3">
          <p className={P}>You are looking at the demo, so there is nothing to protect yet. Exit the demo and set up your own records to get a passkey, a recovery code and syncing.</p>
          <Button variant="primary" onClick={() => void clearAll()}>
            Exit demo
          </Button>
        </Card>
        <InstallGroup />
      </div>
    );
  }
  return <RealSecurity />;
}

function RealSecurity() {
  const vault = useVault();
  const status = useVaultStatus();
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [forgetOpen, setForgetOpen] = useState(false);
  const [now] = useState(() => Date.now());
  const sync = describeSync(status.sync, now);
  const s = status.sync;

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    setError(null);
    try {
      await fn();
    } catch (e) {
      if (!wasCancelled(e)) setError(explainError(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <h2 className="m-0 font-display text-2xl font-semibold">Security</h2>
      {error !== null && (
        <p role="alert" className="m-0 rounded-xl border border-loss/40 bg-loss/10 px-3.5 py-2.5 text-[13px] leading-[1.45] text-loss">
          {error}
        </p>
      )}

      <Group title="Syncing">
        <p className={P} role="status">
          {sync.detail}
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
        <div className="flex flex-wrap gap-2.5">
          {sync.canConnect && (
            <Button
              variant="primary"
              disabled={busy !== null}
              onClick={() =>
                void run('connect', async () => {
                  const r = await vault.connect();
                  toast.show(r.ok ? 'Connected and synced.' : 'Connected, but the sync did not finish.');
                })
              }
            >
              {busy === 'connect' ? 'Waiting for your passkey...' : 'Connect'}
            </Button>
          )}
          <Button
            disabled={busy !== null || s.phase === 'signed-out'}
            onClick={() =>
              void run('sync', async () => {
                const r = await vault.sync();
                toast.show(r.ok ? 'Synced.' : 'Could not sync right now.');
              })
            }
          >
            Sync now
          </Button>
        </div>
      </Group>

      <Group title="This device">
        <p className={P}>{status.passkeyUnlock ? 'This device unlocks with a passkey.' : 'This device has no passkey yet. It unlocks with the recovery code.'}</p>
        <div>
          <Button
            disabled={busy !== null}
            onClick={() =>
              void run('passkey', async () => {
                await vault.addPasskey();
                toast.show('Passkey added on this device.');
              })
            }
          >
            {busy === 'passkey' ? 'Waiting for your passkey...' : 'Add a passkey on this device'}
          </Button>
        </div>
        <SelectBox
          label="Lock after"
          value={String(status.autoLockMinutes)}
          onChange={(e) => vault.setAutoLockMinutes(Number(e.target.value))}
        >
          {LOCK_CHOICES.map((m) => (
            <option key={m} value={m}>
              {m === 0 ? 'Never' : `${m} ${m === 1 ? 'minute' : 'minutes'} of no activity`}
            </option>
          ))}
        </SelectBox>
      </Group>

      <AddDeviceGroup />

      <Group title="Recovery code">
        <p className={P}>
          The recovery code on your printed kit opens your records if every device is lost. This is NOT a Bitcoin seed phrase. Make a new one if the kit is lost or someone else saw it. The old kit stops working.
        </p>
        <div>
          <Button onClick={() => setRotateOpen(true)}>Make a new recovery code</Button>
        </div>
      </Group>

      <InstallGroup />

      <Group title="Forget this device">
        <p className={P}>Removes the records and keys stored on this device. Your server keeps its encrypted copy, and you can restore here again with the recovery code.</p>
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
              {busy === 'rotate' ? 'Working...' : 'Make a new code'}
            </Button>
            <Button onClick={() => setRotateOpen(false)}>Cancel</Button>
          </div>
        </div>
      </Sheet>

      <Sheet open={forgetOpen} onClose={() => setForgetOpen(false)} title="Forget this device?">
        <div className="flex flex-col gap-3 p-1">
          <p className={P}>This removes everything stored on this device. Anything not yet synced is lost, so check that Syncing says Synced first. You&apos;ll need your recovery code or a passkey to open your records again.</p>
          <div className="flex flex-wrap gap-2.5">
            <Button
              variant="primary"
              disabled={busy !== null}
              onClick={() =>
                void run('forget', async () => {
                  await vault.forgetDevice();
                  kitHandoff.clear();
                  setForgetOpen(false);
                  navigate('/welcome', { replace: true });
                })
              }
            >
              Forget this device
            </Button>
            <Button onClick={() => setForgetOpen(false)}>Cancel</Button>
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
      <p className={P}>On the new device, open this address, choose Restore on this device, and type your recovery code (or scan the square code on your kit). Then add a passkey there when it asks.</p>
      <div className="flex items-center gap-4">
        <QrCode text={address} size={132} label={`QR code for ${shortAddress(address)}`} className="flex-none rounded-xl" />
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-xs text-muted">App address</span>
          <span className="break-all text-[15px] font-semibold">{shortAddress(address)}</span>
          <span className="text-xs text-muted">Point the new device&apos;s camera at the square.</span>
        </div>
      </div>
    </Group>
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
        <p className={P}>In Safari, tap the Share button, then Add to Home Screen. It then opens like any other app.</p>
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
