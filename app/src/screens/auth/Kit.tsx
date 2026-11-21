import { useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { appAddress, shortAddress } from '../../data/app-url.ts';
import { useLedger } from '../../data/ledger-provider.tsx';
import { kitHandoff } from '../../data/recovery-handoff.ts';
import { usePendingKit } from '../../data/vault-provider.tsx';
import { recoveryLink } from '../../vault/index.ts';
import { PrinterIcon } from '../../ui/auth-icons.tsx';
import { ChevronLeftIcon } from '../../ui/more-icons.tsx';
import { QrCode } from '../../ui/QrCode.tsx';
import { cx } from '../../lib/cx.ts';
import { KIT_STEPS, kitWalletRows, longDate, oneYearLater } from './kit-logic.ts';
import { SaveCode } from './SaveCode.tsx';
import { useTitle } from '../../ui/use-title.ts';

/**
 * The printed emergency kit. Always light, letter paper. The recovery code is on it only right after
 * setup or rotation (it is never stored); later the kit prints without a code and says how to get a new one.
 */
export function Kit() {
  const { state, today } = useLedger();
  const pending = usePendingKit();
  const nameId = useId();
  const [name, setName] = useState('');
  const [leaving, setLeaving] = useState(false);
  useTitle('Emergency kit');
  const navigate = useNavigate();
  const address = appAddress();
  const code = pending?.code ?? null;
  const wallets = kitWalletRows(state.wallets);
  const slots = code?.split('-') ?? Array.from({ length: 6 }, () => '');
  const link = code === null ? address : recoveryLink(address, code);

  return (
    <main className="kit-print min-h-dvh bg-bg print:bg-white">
      <div className="mx-auto flex max-w-[816px] flex-col gap-3 px-5 pb-4 pt-5 text-text print:hidden">
        <div className="flex items-center justify-between gap-3">
          {pending?.reason === 'rotate' ? (
            <button type="button" onClick={() => setLeaving(true)} className="flex min-h-11 items-center gap-1 bg-transparent text-sm font-semibold text-soft hover:text-text">
              <ChevronLeftIcon size={16} />
              Back
            </button>
          ) : (
            <Link to={pending?.reason === 'setup' ? '/welcome' : '/records?v=security'} className="flex min-h-11 items-center gap-1 text-sm font-semibold text-soft no-underline hover:text-text">
              <ChevronLeftIcon size={16} />
              Back
            </Link>
          )}
          <button
            type="button"
            onClick={() => window.print()}
            className="press flex min-h-11 items-center gap-2 rounded-xl bg-accent px-4 text-[15px] font-bold text-bg hover:bg-amber"
          >
            <PrinterIcon size={18} />
            Print
          </button>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={nameId} className="text-xs text-muted">
            Your name, printed at the top (not saved anywhere)
          </label>
          <input
            id={nameId}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            className="min-h-12 w-full rounded-[14px] border border-line bg-bg px-3 text-base font-semibold text-text placeholder:font-normal placeholder:text-muted"
            placeholder="First and last name"
          />
        </div>
        {leaving && (
          <div role="alertdialog" aria-label="Leave without saving" className="flex flex-col gap-2 rounded-xl border border-accent bg-surface px-3.5 py-3 text-[13px] leading-[1.45] text-soft">
            <span>Leave without saving the new code? Your old kit no longer works.</span>
            <div className="flex gap-2">
              <button type="button" autoFocus onClick={() => setLeaving(false)} className="press min-h-11 rounded-xl bg-accent px-4 text-sm font-bold text-bg hover:bg-amber">
                Stay
              </button>
              <button type="button" onClick={() => navigate('/records?v=security')} className="press min-h-11 rounded-xl border border-line bg-surface-2 px-4 text-sm font-semibold text-text hover:bg-line">
                Leave
              </button>
            </div>
          </div>
        )}
        {code === null ? (
          <p role="note" className="m-0 rounded-xl border border-line bg-surface px-3.5 py-3 text-[13px] leading-[1.45] text-soft">
            The recovery code is only shown once, right after setup or when you make a new one, so this kit has no code on it. To print a kit with a code, make a new one in{' '}
            <Link to="/records?v=security" className="inline-flex min-h-11 items-center underline">
              Records → Security
            </Link>. The old code stops working when you do.
          </p>
        ) : (
          <div className="flex flex-col gap-2 rounded-xl border border-accent bg-surface px-3.5 py-3 text-[13px] leading-[1.45] text-soft">
            <span>
              {pending?.reason === 'setup'
                ? 'Print this page or save it as a PDF, then tap Back to finish setup.'
                : 'This page has your recovery code. Print it now and keep it somewhere safe. When you leave this screen, the code is gone for good.'}
            </span>
            {pending?.reason !== 'setup' && (
            <button
              type="button"
              onClick={() => kitHandoff.clear()}
              className="min-h-11 w-fit rounded-xl border border-line bg-surface-2 px-4 text-sm font-semibold text-text hover:bg-line"
            >
              I saved it. Remove the code from this screen
            </button>
            )}
            <SaveCode code={code} className="mt-1" />
          </div>
        )}
      </div>

      <article
        aria-label="Emergency kit"
        className="mx-auto flex w-full max-w-[816px] flex-col gap-[18px] bg-white px-5 py-8 text-[#161514] sm:px-12 lg:px-[72px] lg:py-12 print:min-h-[11in] print:w-[8.5in] print:max-w-none print:gap-3 print:px-[72px] print:py-7"
      >
        <header className="flex items-start justify-between gap-4 border-b-[3px] border-accent pb-4">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-xs font-bold tracking-[0.12em] text-[#9a4f00]">EMERGENCY KIT · KEEP WITH YOUR ESTATE PAPERS</span>
            <h1 className="m-0 font-display text-[28px] font-bold leading-[1.15] tracking-[-0.02em] text-balance sm:text-[34px] print:text-[30px]">
              Opening the Bitcoin records of {name.trim() === '' ? <span className="inline-block min-w-[200px] border-b border-[#161514]">&nbsp;</span> : name.trim()}
            </h1>
          </div>
          <img src="/icons/logo-mark.webp" width={52} height={52} alt="" className="block flex-none" />
        </header>

        <section className="flex flex-col gap-1 rounded-xl border-2 border-[#161514] px-[18px] py-3.5">
          <span className="text-base font-bold">This app holds records, not Bitcoin.</span>
          <span className="text-sm leading-normal">
            This opens the records. It does not open the Bitcoin. The app shows what was bought, when, and what it cost. Getting to the Bitcoin itself depends on how it&apos;s held (exchange accounts, hardware wallets, multisig). Follow the separate inheritance plan for that. No keys or passwords are ever printed here.
          </span>
        </section>

        <section aria-label="Steps" className="flex flex-col gap-2.5">
          <h2 className="m-0 text-lg font-bold">Steps</h2>
          <ol className="m-0 flex list-none flex-col gap-2.5 p-0 print:gap-1.5">
            {KIT_STEPS.map((text, i) => (
              <li key={i} className="flex items-start gap-3.5">
                <span aria-hidden="true" className="flex size-[26px] flex-none items-center justify-center rounded-full bg-accent text-[13px] font-bold text-[#161514]">
                  {i + 1}
                </span>
                <span className="pt-[3px] text-sm leading-normal">{text}</span>
              </li>
            ))}
          </ol>
        </section>

        <section aria-label="Recovery code" className="flex flex-col gap-6 sm:flex-row sm:items-stretch">
          <div className="flex flex-1 flex-col gap-2.5">
            <h2 className="m-0 text-lg font-bold">Recovery code</h2>
            <span className="text-[13px] font-semibold leading-[1.45]">This is NOT a Bitcoin seed phrase. It can&apos;t move Bitcoin. It only opens the records.</span>
            <ol aria-label="Recovery code groups" className="m-0 grid list-none grid-cols-3 gap-2 p-0">
              {slots.map((g, i) => (
                <li key={i} className={cx('flex h-10 items-center justify-center rounded-lg border-[1.5px] border-[#161514] font-display text-[17px] font-semibold tracking-[0.08em]', g === '' ? 'text-[#595550]' : 'text-[#161514]')}>
                  {g === '' ? <span className="sr-only">Not printed</span> : g}
                </li>
              ))}
            </ol>
            <span className="text-xs text-[#595550]">
              {code === null ? 'No code on this copy. Make a new one in the app (Records → Security) and print again.' : 'Anyone holding this page can read the records. Keep it in the safe.'}
            </span>
          </div>
          <div className="flex w-[150px] flex-none flex-col items-center gap-1.5 self-center sm:self-auto">
            <QrCode text={link} size={150} label={code === null ? 'QR code that opens the app address' : 'QR code that opens the app and fills in the recovery code'} className="rounded-[10px] border border-[#d9d5cf]" />
            <span className="text-center text-xs text-[#595550]">{code === null ? 'Opens the app' : "Scan with the phone's camera"}</span>
          </div>
        </section>

        <section aria-label="Where the Bitcoin is held" className="flex flex-col gap-2">
          <h2 className="m-0 text-lg font-bold">Where the Bitcoin is held</h2>
          <span className="text-xs text-[#595550]">Filled in from the app&apos;s wallets when printed. Names and types only.</span>
          <ul className="m-0 list-none overflow-hidden rounded-[10px] border-[1.5px] border-[#161514] p-0">
            {wallets.length === 0 ? (
              <li className="flex min-h-9 items-center px-3.5 text-[13px] text-[#595550]">No wallets are recorded yet.</li>
            ) : (
              wallets.map((w, i) => (
                <li key={i} className={cx('flex min-h-9 items-center justify-between gap-3 px-3.5', i < wallets.length - 1 && 'border-b border-[#d9d5cf]')}>
                  <span className="text-sm font-semibold">{w.name}</span>
                  <span className="text-[13px] normal-nums text-[#595550]">{w.type}</span>
                </li>
              ))
            )}
          </ul>
        </section>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-bold tracking-[0.06em] text-[#595550]">APP ADDRESS</span>
            <span className="break-all text-[15px] font-semibold">{shortAddress(address)}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-bold tracking-[0.06em] text-[#595550]">PRINTED · TEST IT AGAIN BY</span>
            <span className="text-[15px] font-semibold">
              {longDate(today)} · {longDate(oneYearLater(today))}
            </span>
          </div>
          <p className="m-0 text-[13px] leading-normal sm:col-span-2">
            <strong>Test it once a year.</strong> Open a private window (Incognito in Chrome), follow the steps above, and check the records open. Then write the date here: ______________
          </p>
        </section>

        <section className="flex flex-col gap-1 rounded-xl bg-[#fff4e5] px-[18px] py-3.5">
          <span className="text-sm font-bold">For the tax preparer</span>
          <span className="text-[13px] leading-normal normal-nums">
            Inherited Bitcoin generally gets a new cost basis: its value on the date of death. In community-property states this can apply to a surviving spouse&apos;s half too. The records show everything bought, given and sold before then.
          </span>
        </section>
      </article>
    </main>
  );
}
