import { exportEntriesJson, exportOpeningLotsCsv, form8949Csv, TIERS, yearOf, type WalletType } from '@bitcoin-basis/engine';
import { useSubmit } from '../../ui/use-submit.ts';
import { Fragment, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { countOf } from '../../lib/format.ts';
import { TIER_LABEL } from '../../lib/origin.ts';
import { tierShares } from '../../lib/holdings-view.ts';
import { Segmented, type SegmentedOption } from '../../ui/Segmented.tsx';
import { nowInstant } from '../log/model.ts';
import { useLedger } from '../../data/ledger-provider.tsx';
import { Amount, Money } from '../../ui/Amount.tsx';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { downloadText } from '../../ui/download.ts';
import { SelectBox } from '../../ui/Field.tsx';
import { DownloadIcon, UploadIcon } from '../../ui/more-icons.tsx';
import { newIdGenerator } from '../../ui/new-entry.ts';
import { useToast } from '../../ui/Toast.tsx';
import { yearsAvailable } from '../tax/tax-logic.ts';
import { chunk, linkedRows, loanEntries, lotsTemplateCsv, previewImport, previewJson, walletEntries, withoutBadRows, type ImportPreview, type JsonPreview } from './io-logic.ts';
import { AprInput } from '../../ui/formatted-inputs.tsx';

function FilePicker({ label, accept, onText }: { label: string; accept: string; onText(text: string, name: string): void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept={accept}
        aria-label={label}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          void f.text().then((t) => onText(t, f.name));
          e.target.value = '';
        }}
      />
      <Button onClick={() => ref.current?.click()}>
        <UploadIcon size={16} />
        {label}
      </Button>
    </>
  );
}

function NotInDemo({ title, label }: { title: string; label: string }) {
  return (
    <Card as="section" aria-label={label} className="flex flex-col gap-1 !rounded-[18px] !p-4">
      <h2 className="m-0 text-[15px] font-semibold">{title}</h2>
      <p className="m-0 text-[13px] text-muted">Not in the demo.</p>
    </Card>
  );
}

const KIND_OPTIONS: readonly SegmentedOption<WalletType>[] = [
  { value: 'exchange', label: 'Exchange' },
  { value: 'self-custody', label: 'Self-custody', sub: '(your own wallet)' },
];
/** For a new wallet whose rows are written as retirement purchases (no tier, no loan): it may be an IRA or Roth. */
const KIND_OPTIONS_WITH_RETIREMENT: readonly SegmentedOption<WalletType>[] = [...KIND_OPTIONS, { value: 'retirement', label: 'Retirement', sub: '(IRA, Roth)' }];
const BATCH = 200;

/** The template's columns in plain words. The first six are needed on every row. */
const TEMPLATE_COLUMNS: readonly (readonly [string, string])[] = [
  ['wallet', 'Where it is held, like Strike. A new name becomes a new wallet.'],
  ['acquired_utc', 'When you got it, like 2023\u201101\u201120 14:02:11.'],
  ['sats', 'How much, in sats (100,000,000 sats = 1 BTC).'],
  ['cost_usd', 'What you paid, fees included.'],
  ['tier', 'How well the cost is backed up: Documented, Reconstructed, Estimated or Unknown. Leave it empty for a retirement account.'],
  ['origin', 'Where the proof is, like Email receipt.'],
  ['btc, cost_per_btc', 'Optional. Only used to double-check the row.'],
  ['tz', 'Optional time zone, like America/Boise.'],
  ['funded_by', 'Optional. The loan that paid for it, like HELOC.'],
];

function ImportLots() {
  const { entries, state, append } = useLedger();
  const toast = useToast();
  const navigate = useNavigate();
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [types, setTypes] = useState<Record<string, WalletType>>({});
  const [rates, setRates] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [failed, setFailed] = useState(false);
  // The preview as it was when adding started: each saved batch changes the book, and the preview stays put meanwhile.
  const [held, setHeld] = useState<ImportPreview | null>(null);
  const tz = state.settings.timeZone;
  const retirementNames = useMemo(() => Object.keys(types).filter((n) => types[n] === 'retirement'), [types]);
  // Rows already in the book (an import that stopped part way, tried again or chosen again) are left out.
  const book = useMemo(() => ({ entries, applied: state.applied }), [entries, state.applied]);
  const run = (text: string) => previewImport(text, state.wallets, tz, newIdGenerator(entries), state.closedYears, state.loans, retirementNames, book);
  const fresh = useMemo(() => (file ? run(file.text) : null), [file, state.wallets, state.closedYears, state.loans, retirementNames, book]); // eslint-disable-line react-hooks/exhaustive-deps
  const preview = progress !== null && held !== null ? held : fresh;
  // New wallets written like retirement purchases: ask what they are before showing anything else.
  const undecided = preview?.newWallets.filter((w) => w.retirementLike && types[w.name] === undefined) ?? [];
  const goodOnly = useMemo(() => (preview && preview.problems.length > 0 && preview.goodRows > 0 ? run(withoutBadRows(preview.text, preview.problems)) : null), [preview]); // eslint-disable-line react-hooks/exhaustive-deps
  const read = (text: string, name: string) => {
    setTypes({});
    setRates({});
    setFailed(false);
    setFile({ name, text });
  };
  const adder = useSubmit(async (p: ImportPreview) => {
    const loans = loanEntries(p.newLoans, rates, nowInstant(Date.now()), tz);
    if (loans === null) return;
    // New loans and wallets first, then the lots, then the links from loans to the lots they paid for.
    const batches = [...chunk([...loans, ...walletEntries(p.newWallets, types, nowInstant(Date.now()), tz)], BATCH), ...chunk(p.entries, BATCH), ...chunk(p.retirementBuys, BATCH), ...chunk(p.links, BATCH)];
    const total = batches.reduce((s, b) => s + b.length, 0);
    let done = 0;
    setFailed(false);
    setHeld(preview);
    setProgress({ done, total });
    try {
      for (const b of batches) {
        await append(b);
        done += b.length;
        setProgress({ done, total });
      }
    } catch {
      setFailed(true);
      setProgress(null);
      setHeld(null);
      return;
    }
    const n = p.entries.length;
    const made = [...(p.newWallets.length > 0 ? [countOf(p.newWallets.length, 'wallet')] : []), ...(p.newLoans.length > 0 ? [countOf(p.newLoans.length, 'loan')] : [])];
    const parts = [...(n > 0 || p.retirementBuys.length === 0 ? [countOf(n, 'lot')] : []), ...(p.retirementBuys.length > 0 ? [countOf(p.retirementBuys.length, 'retirement purchase')] : []), ...made];
    const linksOnly = n === 0 && p.retirementBuys.length === 0 && p.links.length > 0;
    toast.show(linksOnly ? 'Added the loan links.' : `Added ${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`}.`, { success: true });
    setFile(null);
    setProgress(null);
    setHeld(null);
    navigate('/');
  });
  const add = adder.run;
  return (
    <Card as="section" aria-label="Import from a spreadsheet" className="flex flex-col gap-3 !rounded-[18px] !p-4">
      <h2 className="m-0 text-[15px] font-semibold">Import from a spreadsheet</h2>
      <p className="m-0 text-[13px] leading-[1.45] text-muted">Fill in the template, one row per purchase, then choose it here. You&apos;ll see a preview before anything is added.</p>
      <div className="flex flex-wrap items-center gap-2.5">
        <Button onClick={() => downloadText('bitcoin-basis-template.csv', lotsTemplateCsv(state.wallets.find((w) => !w.archived)?.name ?? 'My exchange', tz))}>
          <DownloadIcon size={16} /> Download the template
        </Button>
        <FilePicker label="Choose your spreadsheet" accept=".csv,text/csv" onText={read} />
      </div>
      <details className="text-[13px] text-muted">
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-soft">What goes in each column?</summary>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 pb-1 leading-[1.45]">
          {TEMPLATE_COLUMNS.map(([name, what]) => (
            <Fragment key={name}>
              <dt className="font-mono text-xs text-soft">{name}</dt>
              <dd className="m-0">{what}</dd>
            </Fragment>
          ))}
        </dl>
      </details>
      {file && preview && (
        <div role="status" className="flex flex-col gap-3 rounded-2xl border border-line bg-bg p-3 text-sm">
          <span className="text-xs text-muted">{file.name}</span>
          {undecided.length > 0 ? (
            <div className="flex flex-col gap-3">
              <span className="font-semibold">{undecided.length === 1 ? 'One question first' : 'A few questions first'}</span>
              <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-label="Wallets to name">
                {undecided.map((w) => (
                  <li key={w.entryId} className="flex flex-col gap-1.5">
                    <span className="text-[13px] leading-[1.45] text-soft">
                      <strong className="text-text">{w.name}</strong> is new, and its {w.coins === 1 ? 'row has' : `${w.coins} rows have`} no tier. Is it a retirement account?
                    </span>
                    <Segmented<WalletType> label={`What kind of wallet is ${w.name}`} value={'' as WalletType} onChange={(v) => setTypes({ ...types, [w.name]: v })} options={KIND_OPTIONS_WITH_RETIREMENT} className="w-full [&_button]:flex-1 [&_button]:whitespace-nowrap" />
                  </li>
                ))}
              </ul>
              <span className="text-xs text-muted">Retirement purchases are kept apart from tax math. Other wallets need a tier on each row.</span>
            </div>
          ) : preview.problems.length === 0 && nothingToAdd(preview) ? (
            <span className="font-semibold">Everything in this file is already in your records. Nothing was added.</span>
          ) : preview.problems.length === 0 ? (
            <ReadyBlock p={preview} types={types} setTypes={setTypes} rates={rates} setRates={setRates} progress={progress} failed={failed} onAdd={() => void add(preview)} />
          ) : (
            <>
              <span className="font-semibold text-loss">
                {preview.problems.length === 1 ? '1 problem' : `${preview.problems.length} problems`} found. Nothing was added.
              </span>
              <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Problems">
                {preview.problems.map((p, i) => (
                  <li key={i} className="text-[13px] text-soft">
                    <strong className="text-text">Row {p.row}:</strong> {p.message}
                  </li>
                ))}
              </ul>
              {goodOnly && goodOnly.problems.length === 0 && goodOnly.entries.length + goodOnly.retirementBuys.length > 0 ? (
                <ReadyBlock p={goodOnly} types={types} setTypes={setTypes} rates={rates} setRates={setRates} progress={progress} failed={failed} onAdd={() => void add(goodOnly)} goodOnly />
              ) : (
                <span className="text-xs text-muted">Fix the file and choose it again.</span>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
}

/** An import with nothing left to add: every row is already in the book, with its loan links. */
function nothingToAdd(p: ImportPreview): boolean {
  return p.skipped > 0 && p.entries.length + p.retirementBuys.length + p.links.length + p.newWallets.length + p.newLoans.length === 0;
}

function ReadyBlock({ p, types, setTypes, rates, setRates, progress, failed, onAdd, goodOnly = false }: { p: ImportPreview; types: Record<string, WalletType>; setTypes(t: Record<string, WalletType>): void; rates: Record<string, string>; setRates(r: Record<string, string>): void; progress: { done: number; total: number } | null; failed: boolean; onAdd(): void; goodOnly?: boolean }) {
  const n = p.entries.length;
  const r = p.retirementBuys.length;
  const lots = (k: number) => countOf(k, 'lot');
  // Every row was added before but some loan links were not (an import that stopped at the very end).
  const linksOnly = n === 0 && r === 0 && p.links.length > 0;
  const what = linksOnly ? 'the loan links' : [...(n > 0 || r === 0 ? [lots(n)] : []), ...(r > 0 ? [countOf(r, 'retirement purchase')] : [])].join(' and ');
  const shares = tierShares(p.tiers);
  const mix = TIERS.filter((t) => (p.tiers[t] ?? 0) > 0).map((t) => `${TIER_LABEL[t]} ${shares[t]}`);
  const busy = progress !== null;
  const make = p.newWallets.length > 0;
  const ratesReady = loanEntries(p.newLoans, rates, '', '') !== null;
  const linked = linkedRows(p.links);
  return (
    <>
      {p.newLoans.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="font-semibold">{countOf(p.newLoans.length, 'loan')} will be created</span>
          <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="New loans">
            {p.newLoans.map((l) => (
              <li key={l.entryId}>
                <AprInput label={`Interest rate for ${l.name} (${lots(l.coins)})`} value={rates[l.name] ?? ''} onChange={(v) => setRates({ ...rates, [l.name]: v })} />
              </li>
            ))}
          </ul>
          <span className="text-xs text-muted">Add the statement day, limit and payments on the loan&apos;s page afterwards.</span>
        </div>
      )}
      {make && (
        <div className="flex flex-col gap-2">
          <span className="font-semibold">
            {countOf(p.newWallets.length, 'wallet')} will be created
          </span>
          <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="New wallets">
            {p.newWallets.map((w) => (
              <li key={w.entryId} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <span className="min-w-0 break-words">
                  {w.name} <span className="text-muted">· {lots(w.coins)}</span>
                </span>
                <Segmented<WalletType> label={`What kind of wallet is ${w.name}`} value={types[w.name] ?? w.guessedType} onChange={(v) => setTypes({ ...types, [w.name]: v })} options={w.retirementLike ? KIND_OPTIONS_WITH_RETIREMENT : KIND_OPTIONS} className="w-full sm:w-auto [&_button]:flex-1 [&_button]:whitespace-nowrap" />
              </li>
            ))}
          </ul>
          <span className="text-xs text-muted">Receipts for new wallets start as &ldquo;Email receipt&rdquo;. You can change that later.</span>
        </div>
      )}
      {p.matched.map((m) => (
        <span key={m.from} className="text-xs text-muted">
          &ldquo;{m.from}&rdquo; in the file is your wallet {m.to}.
        </span>
      ))}
      <div className="flex flex-col gap-0.5">
        {linksOnly ? null : n > 0 || r === 0 ? (
          <>
            <span className="font-semibold">
              {lots(n)} · <Amount sats={p.sats} showUnit short interactive={false} /> · <Money cents={p.costCents} precision="dollars" /> cost
            </span>
            <span className="text-xs text-muted">{mix.join(' · ')}</span>
          </>
        ) : null}
        {r > 0 ? (
          <span className="font-semibold">
            {countOf(r, 'retirement purchase')} will be added · <Amount sats={p.retirementSats} showUnit short interactive={false} /> · <Money cents={p.retirementCostCents} precision="dollars" /> cost
          </span>
        ) : null}
        {r > 0 ? <span className="text-xs text-muted">Kept apart from tax math.</span> : null}
        {linksOnly ? <span className="font-semibold">{countOf(linked, 'lot')} already added still {linked === 1 ? 'needs its' : 'need their'} loan link</span> : linked > 0 ? <span className="text-xs text-muted">{countOf(linked, 'lot')} paid with a loan</span> : null}
      </div>
      {p.closedYears.length > 0 && (
        <span className="text-xs text-amber">
          Lots from {p.closedYears.join(' and ')} land in {p.closedYears.length === 1 ? 'a year you closed' : 'years you closed'}. That is allowed for imported lots.
        </span>
      )}
      {p.warnings.map((w) => (
        <span key={`${w.row}-${w.message}`} className="text-xs text-amber">
          Row {w.row}: {w.message}
        </span>
      ))}
      {p.skipped > 0 && <span className="text-xs text-muted">{p.skipped === 1 ? '1 row is' : `${p.skipped.toLocaleString('en-US')} rows are`} already in your records and will be skipped.</span>}
      {failed && <span className="text-xs text-loss">Something went wrong. Nothing more was added. Try again; lots already added are skipped.</span>}
      {!ratesReady ? <span className="text-xs text-amber">Enter each new loan&apos;s rate, like 6.5.</span> : null}
      <Button variant="primary" className="self-start" disabled={busy || !ratesReady} onClick={onAdd}>
        {busy ? `Adding ${progress.done.toLocaleString('en-US')} of ${progress.total.toLocaleString('en-US')}…` : make ? `Create ${p.newWallets.length === 1 ? 'wallet' : 'wallets'} and add ${goodOnly ? 'the ' : ''}${what}` : `Add ${goodOnly && !linksOnly ? 'the ' : ''}${what}`}
      </Button>
    </>
  );
}

function ImportJson() {
  const { entries, append } = useLedger();
  const toast = useToast();
  const [name, setName] = useState('');
  const [preview, setPreview] = useState<JsonPreview | null>(null);
  const have = useMemo(() => new Set(entries.map((e) => e.id)), [entries]);
  const addFresh = useSubmit(async () => {
    if (preview === null || preview.fresh.length === 0) return;
    await append(preview.fresh);
    toast.show(`Added ${countOf(preview.fresh.length, 'entry', 'entries')}.`, { success: true });
    setPreview(null);
  });
  return (
    <Card as="section" aria-label="Restore from a backup" className="flex flex-col gap-3 !rounded-[18px] !p-4">
      <h2 className="m-0 text-[15px] font-semibold">Restore from a backup file</h2>
      <p className="m-0 text-[13px] leading-[1.45] text-muted">A backup made here. What you already have is skipped.</p>
      <div className="flex">
        <FilePicker
          label="Choose a backup file"
          accept=".json,application/json"
          onText={(t, n) => {
            setName(n);
            setPreview(previewJson(t, have));
          }}
        />
      </div>
      {preview && (
        <div role="status" className="flex flex-col gap-2 rounded-2xl border border-line bg-bg p-3 text-sm">
          <span className="text-xs text-muted">{name}</span>
          {preview.problems.length > 0 ? (
            <>
              <span className="font-semibold text-loss">This file can't be used. Nothing was added.</span>
              <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Problems">
                {preview.problems.slice(0, 20).map((p, i) => (
                  <li key={i} className="text-[13px] text-soft">
                    {p.index === null ? p.message : `Entry ${p.index + 1}: ${p.message}`}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <span className="font-semibold">
                {preview.fresh.length} new, {preview.entries.length - preview.fresh.length} already here
              </span>
              <Button
                variant="primary"
                className="self-start"
                disabled={preview.fresh.length === 0 || addFresh.busy}
                onClick={() => void addFresh.run()}
              >
                {addFresh.busy ? 'Saving…' : `Add ${preview.fresh.length} new ${preview.fresh.length === 1 ? 'entry' : 'entries'}`}
              </Button>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function Export() {
  const { state, entries, today } = useLedger();
  const years = useMemo(() => yearsAvailable(state, today), [state, today]);
  const [year, setYear] = useState(yearOf(today));
  const [warn, setWarn] = useState<string[]>([]);
  return (
    <Card as="section" aria-label="Download" className="flex flex-col gap-3 !rounded-[18px] !p-4">
      <h2 className="m-0 text-[15px] font-semibold">Download</h2>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button onClick={() => downloadText('bitcoin-basis-entries.json', exportEntriesJson(entries), 'application/json')}>
          <DownloadIcon size={16} /> Backup file (keeps everything)
        </Button>
        <Button
          onClick={() => {
            const out = exportOpeningLotsCsv(state);
            setWarn(out.warnings);
            downloadText('opening-lots.csv', out.csv);
          }}
        >
          <DownloadIcon size={16} /> Spreadsheet of your lots
        </Button>
      </div>
      <div className="flex items-end gap-2">
        {years.length > 1 && (
          <SelectBox label="Tax year" value={String(year)} onChange={(e) => setYear(Number(e.target.value))} className="w-28">
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </SelectBox>
        )}
        {/* The year picker sits right beside it, so the label only names the year when there is no picker. */}
        <Button aria-label={`Form 8949 for ${year}`} className="flex-1 sm:flex-none" onClick={() => downloadText(`form-8949-${year}.csv`, form8949Csv(state, year))}>
          <DownloadIcon size={16} /> {years.length > 1 ? 'Form 8949' : `Form 8949 for ${year}`}
        </Button>
      </div>
      {warn.length > 0 && (
        <ul className="m-0 list-none p-0" aria-label="Download notes">
          {warn.map((w) => (
            <li key={w} className="text-xs text-amber">
              {w}
            </li>
          ))}
        </ul>
      )}
      <p className="m-0 text-xs text-muted">Keep the backup file somewhere safe. Files are made on this device and are not encrypted.</p>
    </Card>
  );
}

export function ImportExportView() {
  const { isDemo } = useLedger();
  return (
    <div className="flex flex-col gap-3">
      <h2 className="m-0 hidden font-display text-2xl font-semibold lg:block">Import and export</h2>
      {isDemo ? (
        <>
          <NotInDemo title="Import from a spreadsheet" label="Import from a spreadsheet" />
          <NotInDemo title="Restore from a backup file" label="Restore from a backup" />
        </>
      ) : (
        <>
          <ImportLots />
          <ImportJson />
        </>
      )}
      <Export />
    </div>
  );
}
