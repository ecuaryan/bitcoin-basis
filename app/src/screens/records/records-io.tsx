import { exportEntriesJson, exportOpeningLotsCsv, form8949Csv, TIERS, yearOf, type WalletType } from '@bitcoin-basis/engine';
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { TIER_LABEL } from '../../lib/origin.ts';
import { Segmented } from '../../ui/Segmented.tsx';
import { nowInstant } from '../log/model.ts';
import { useLedger } from '../../data/ledger-provider.tsx';
import { Amount, Money } from '../../ui/Amount.tsx';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { downloadText } from '../../ui/download.ts';
import { SelectBox } from '../../ui/Field.tsx';
import { DownloadIcon } from '../../ui/more-icons.tsx';
import { newIdGenerator } from '../../ui/new-entry.ts';
import { useToast } from '../../ui/Toast.tsx';
import { yearsAvailable } from '../tax/tax-logic.ts';
import { chunk, lotsTemplateCsv, previewImport, previewJson, walletEntries, withoutBadRows, type ImportPreview, type JsonPreview } from './io-logic.ts';

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
      <Button onClick={() => ref.current?.click()}>{label}</Button>
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

const KIND_OPTIONS: readonly { value: WalletType; label: string }[] = [
  { value: 'exchange', label: 'Exchange' },
  { value: 'self-custody', label: 'Self-custody' },
];
const BATCH = 200;

function ImportLots() {
  const { entries, state, append } = useLedger();
  const toast = useToast();
  const navigate = useNavigate();
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [types, setTypes] = useState<Record<string, WalletType>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const tz = state.settings.timeZone;
  const run = (text: string) => previewImport(text, state.wallets, tz, newIdGenerator(entries), state.closedYears);
  const preview = useMemo(() => (file ? run(file.text) : null), [file, state.wallets, state.closedYears]); // eslint-disable-line react-hooks/exhaustive-deps
  const goodOnly = useMemo(() => (preview && preview.problems.length > 0 && preview.goodRows > 0 ? run(withoutBadRows(preview.text, preview.problems)) : null), [preview]); // eslint-disable-line react-hooks/exhaustive-deps
  const read = (text: string, name: string) => {
    setTypes({});
    setFailed(false);
    setFile({ name, text });
  };
  async function add(p: ImportPreview) {
    const batches = [...chunk(walletEntries(p.newWallets, types, nowInstant(Date.now()), tz), BATCH), ...chunk(p.entries, BATCH)];
    const total = batches.reduce((s, b) => s + b.length, 0);
    let done = 0;
    setFailed(false);
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
      return;
    }
    const n = p.entries.length;
    toast.show(`Added ${n} ${n === 1 ? 'coin' : 'coins'}${p.newWallets.length > 0 ? ` and ${p.newWallets.length} ${p.newWallets.length === 1 ? 'wallet' : 'wallets'}` : ''}.`);
    setFile(null);
    setProgress(null);
    navigate('/');
  }
  return (
    <Card as="section" aria-label="Bring in your coins" className="flex flex-col gap-3 !rounded-[18px] !p-4">
      <h2 className="m-0 text-[15px] font-semibold">Bring in your coins from a spreadsheet</h2>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <FilePicker label="Choose a spreadsheet (CSV)" accept=".csv,text/csv" onText={read} />
        <button
          type="button"
          className="flex min-h-11 items-center gap-1.5 bg-transparent text-sm font-semibold text-amber underline-offset-2 hover:underline"
          onClick={() => downloadText('bitcoin-basis-template.csv', lotsTemplateCsv(state.wallets.find((w) => !w.archived)?.name ?? 'My exchange', tz))}
        >
          <DownloadIcon size={16} /> Download a blank template
        </button>
      </div>
      <p className="m-0 text-[13px] leading-[1.45] text-muted">One row per purchase. A wallet name that is new gets created for you. You&apos;ll see a preview before anything is added.</p>
      <details className="text-[13px] text-muted">
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-soft">What columns?</summary>
        <p className="m-0 pb-1 leading-[1.5]">
          wallet (a name you have, or a new one), acquired_utc (like 2023-01-20 14:02:11), btc, sats, cost_usd, cost_per_btc, tier (Documented, Reconstructed, Estimated or Unknown) and origin. A tz column (like America/Boise) is optional. Sats is the number that counts; btc and cost_per_btc are only checked.
        </p>
      </details>
      {file && preview && (
        <div role="status" className="flex flex-col gap-3 rounded-2xl border border-line bg-bg p-3 text-sm">
          <span className="text-xs text-muted">{file.name}</span>
          {preview.problems.length === 0 ? (
            <ReadyBlock p={preview} types={types} setTypes={setTypes} progress={progress} failed={failed} onAdd={() => void add(preview)} />
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
              {goodOnly && goodOnly.problems.length === 0 && goodOnly.entries.length > 0 ? (
                <ReadyBlock p={goodOnly} types={types} setTypes={setTypes} progress={progress} failed={failed} onAdd={() => void add(goodOnly)} goodOnly />
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

function ReadyBlock({ p, types, setTypes, progress, failed, onAdd, goodOnly = false }: { p: ImportPreview; types: Record<string, WalletType>; setTypes(t: Record<string, WalletType>): void; progress: { done: number; total: number } | null; failed: boolean; onAdd(): void; goodOnly?: boolean }) {
  const n = p.entries.length;
  const coins = (k: number) => `${k.toLocaleString('en-US')} ${k === 1 ? 'coin' : 'coins'}`;
  const mix = TIERS.filter((t) => (p.tiers[t] ?? 0) > 0).map((t) => `${TIER_LABEL[t]} ${Math.max(1, Math.round(((p.tiers[t] ?? 0) * 100) / p.sats))}%`);
  const busy = progress !== null;
  const make = p.newWallets.length > 0;
  return (
    <>
      {make && (
        <div className="flex flex-col gap-2">
          <span className="font-semibold">
            {p.newWallets.length} {p.newWallets.length === 1 ? 'wallet' : 'wallets'} will be created
          </span>
          <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="New wallets">
            {p.newWallets.map((w) => (
              <li key={w.entryId} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <span className="min-w-0 break-words">
                  {w.name} <span className="text-muted">· {coins(w.coins)}</span>
                </span>
                <Segmented<WalletType> label={`What kind of wallet is ${w.name}`} value={types[w.name] ?? w.guessedType} onChange={(v) => setTypes({ ...types, [w.name]: v })} options={KIND_OPTIONS} className="w-full sm:w-auto [&_button]:flex-1 [&_button]:whitespace-nowrap" />
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
        <span className="font-semibold">
          {coins(n)} · <Amount sats={p.sats} showUnit short interactive={false} /> · <Money cents={p.costCents} precision="dollars" /> cost
        </span>
        <span className="text-xs text-muted">{mix.join(' · ')}</span>
      </div>
      {p.closedYears.length > 0 && (
        <span className="text-xs text-amber">
          Coins from {p.closedYears.join(' and ')} land in {p.closedYears.length === 1 ? 'a year you closed' : 'years you closed'}. That is allowed for imported coins.
        </span>
      )}
      {p.warnings.map((w) => (
        <span key={`${w.row}-${w.message}`} className="text-xs text-amber">
          Row {w.row}: {w.message}
        </span>
      ))}
      {failed && <span className="text-xs text-loss">Something went wrong. Nothing more was added. Try again; coins already added are skipped.</span>}
      <Button variant="primary" className="self-start" disabled={busy} onClick={onAdd}>
        {busy ? `Adding ${progress.done.toLocaleString('en-US')} of ${progress.total.toLocaleString('en-US')}…` : make ? `Create ${p.newWallets.length === 1 ? 'wallet' : 'wallets'} and add ${goodOnly ? 'the ' : ''}${coins(n)}` : `Add ${goodOnly ? 'the ' : ''}${coins(n)}`}
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
  return (
    <Card as="section" aria-label="Restore from a backup" className="flex flex-col gap-3 !rounded-[18px] !p-4">
      <h2 className="m-0 text-[15px] font-semibold">Restore from a backup file</h2>
      <p className="m-0 text-[13px] leading-[1.45] text-muted">A backup made here. What you already have is skipped.</p>
      <FilePicker
        label="Choose a backup file"
        accept=".json,application/json"
        onText={(t, n) => {
          setName(n);
          setPreview(previewJson(t, have));
        }}
      />
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
                disabled={preview.fresh.length === 0}
                onClick={() => {
                  void append(preview.fresh).then(() => {
                    toast.show(`Added ${preview.fresh.length} entries.`);
                    setPreview(null);
                  });
                }}
              >
                Add {preview.fresh.length} new {preview.fresh.length === 1 ? 'entry' : 'entries'}
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
      <div className="flex flex-wrap gap-2">
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
          <DownloadIcon size={16} /> Spreadsheet of your coins
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
        <Button aria-label={`Form 8949 for ${year}`} onClick={() => downloadText(`form-8949-${year}.csv`, form8949Csv(state, year))}>
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
          <NotInDemo title="Bring in your coins from a spreadsheet" label="Bring in your coins" />
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
