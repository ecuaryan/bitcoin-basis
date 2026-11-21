import { exportEntriesJson, exportOpeningLotsCsv, form8949Csv, yearOf } from '@bitcoin-basis/engine';
import { useMemo, useRef, useState } from 'react';
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
import { lotsTemplateCsv, previewJson, previewLots, withoutBadRows, type JsonPreview, type LotsPreview } from './io-logic.ts';

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

function ImportLots() {
  const { entries, state, append } = useLedger();
  const toast = useToast();
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = useState<LotsPreview | null>(null);
  const read = (text: string, name: string) => {
    setFile({ name, text });
    setPreview(previewLots(text, state.wallets, state.settings.timeZone, newIdGenerator(entries)));
  };
  async function add(p: LotsPreview) {
    await append(p.entries);
    toast.show(`Added ${p.entries.length} ${p.entries.length === 1 ? 'lot' : 'lots'}.`);
    setFile(null);
    setPreview(null);
  }
  const goodOnly = file && preview && preview.problems.length > 0 && preview.goodRows > 0 ? previewLots(withoutBadRows(file.text, preview.problems), state.wallets, state.settings.timeZone, newIdGenerator(entries)) : null;
  const sats = preview?.entries.reduce((s, e) => s + e.sats, 0) ?? 0;
  const cost = preview?.entries.reduce((s, e) => s + e.costCents, 0) ?? 0;
  return (
    <Card as="section" aria-label="Bring in your coins" className="flex flex-col gap-3 !rounded-[18px] !p-4">
      <h2 className="m-0 text-[15px] font-semibold">Bring in your coins from a spreadsheet</h2>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <FilePicker label="Choose a spreadsheet (CSV)" accept=".csv,text/csv" onText={read} />
        <button
          type="button"
          className="flex min-h-11 items-center gap-1.5 bg-transparent text-sm font-semibold text-amber underline-offset-2 hover:underline"
          onClick={() => downloadText('bitcoin-basis-template.csv', lotsTemplateCsv(state.wallets.find((w) => !w.archived)?.name ?? 'My exchange', state.settings.timeZone))}
        >
          <DownloadIcon size={16} /> Download a blank template
        </button>
      </div>
      <p className="m-0 text-[13px] leading-[1.45] text-muted">One row per purchase. Wallet names must match yours. You&apos;ll see a preview before anything is added.</p>
      <details className="text-[13px] text-muted">
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-soft">What columns?</summary>
        <p className="m-0 pb-1 leading-[1.5]">
          wallet, acquired_utc (like 2023-01-20 14:02:11), btc, sats, cost_usd, cost_per_btc, tier (Documented, Reconstructed, Estimated or Unknown) and origin. A tz column (like America/Boise) is optional. Sats is the number that counts; btc and cost_per_btc are only checked.
        </p>
      </details>
      {file && preview && (
        <div role="status" className="flex flex-col gap-2 rounded-2xl border border-line bg-bg p-3 text-sm">
          <span className="text-xs text-muted">{file.name}</span>
          {preview.problems.length === 0 ? (
            <>
              <span className="font-semibold">
                {preview.entries.length} {preview.entries.length === 1 ? 'lot' : 'lots'} ready: <Amount sats={sats} showUnit interactive={false} />, cost <Money cents={cost} />
              </span>
              {preview.warnings.map((w) => (
                <span key={`${w.row}-${w.message}`} className="text-xs text-amber">
                  Row {w.row}: {w.message}
                </span>
              ))}
              <Button variant="primary" className="self-start" onClick={() => void add(preview)}>
                Add {preview.entries.length} {preview.entries.length === 1 ? 'purchase' : 'purchases'}
              </Button>
            </>
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
                <Button variant="primary" className="self-start" onClick={() => void add(goodOnly)}>
                  Add the {goodOnly.entries.length} good {goodOnly.entries.length === 1 ? 'row' : 'rows'} only
                </Button>
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
  return (
    <div className="flex flex-col gap-3">
      <h2 className="m-0 hidden font-display text-2xl font-semibold lg:block">Import and export</h2>
      <ImportLots />
      <ImportJson />
      <Export />
    </div>
  );
}
