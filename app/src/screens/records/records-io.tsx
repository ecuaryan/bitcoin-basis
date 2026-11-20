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
import { previewJson, previewLots, withoutBadRows, type JsonPreview, type LotsPreview } from './io-logic.ts';

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
    <Card as="section" aria-label="Import opening lots" className="flex flex-col gap-3 !rounded-[18px] !p-4">
      <h3 className="m-0 text-[15px] font-semibold">Import opening lots (CSV)</h3>
      <p className="m-0 text-[13px] leading-[1.45] text-muted">
        One row per lot, with the columns wallet, acquired_utc, btc, sats, cost_usd, cost_per_btc, tier and origin. Wallet names must match a wallet you already have. You see a preview first; nothing is added until you say so.
      </p>
      <FilePicker label="Choose a lots CSV" accept=".csv,text/csv" onText={read} />
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
                Add {preview.entries.length} {preview.entries.length === 1 ? 'lot' : 'lots'}
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
    <Card as="section" aria-label="Import entries" className="flex flex-col gap-3 !rounded-[18px] !p-4">
      <h3 className="m-0 text-[15px] font-semibold">Import entries (JSON)</h3>
      <p className="m-0 text-[13px] leading-[1.45] text-muted">A backup made here. Entries you already have are skipped; the rest are added as they are.</p>
      <FilePicker
        label="Choose an entries file"
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
              <span className="font-semibold text-loss">This file cannot be imported. Nothing was added.</span>
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
    <Card as="section" aria-label="Export" className="flex flex-col gap-3 !rounded-[18px] !p-4">
      <h3 className="m-0 text-[15px] font-semibold">Export</h3>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => {
            const out = exportOpeningLotsCsv(state);
            setWarn(out.warnings);
            downloadText('opening-lots.csv', out.csv);
          }}
        >
          <DownloadIcon size={16} /> Opening lots (CSV)
        </Button>
        <Button onClick={() => downloadText('bitcoin-basis-entries.json', exportEntriesJson(entries), 'application/json')}>
          <DownloadIcon size={16} /> All entries (JSON)
        </Button>
      </div>
      <div className="flex items-end gap-2">
        <SelectBox label="Tax year for Form 8949" value={String(year)} onChange={(e) => setYear(Number(e.target.value))} className="w-36">
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </SelectBox>
        <Button onClick={() => downloadText(`form-8949-${year}.csv`, form8949Csv(state, year))}>
          <DownloadIcon size={16} /> 8949 (CSV)
        </Button>
      </div>
      {warn.length > 0 && (
        <ul className="m-0 list-none p-0" aria-label="Export notes">
          {warn.map((w) => (
            <li key={w} className="text-xs text-amber">
              {w}
            </li>
          ))}
        </ul>
      )}
      <p className="m-0 text-xs text-muted">The entries file keeps everything, including edit history. It is the one to keep as a backup. Files are made on this device and are not encrypted.</p>
    </Card>
  );
}

export function ImportExportView() {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="m-0 font-display text-2xl font-semibold">Import and export</h2>
      <ImportLots />
      <ImportJson />
      <Export />
    </div>
  );
}
