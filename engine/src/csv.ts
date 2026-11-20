/** Minimal RFC 4180 CSV reading and writing (quoted fields, doubled quotes, CRLF or LF). */
import { err, ok } from './result.ts';
import type { Result } from './types.ts';

/** Parse CSV text into rows of fields. Blank lines are skipped; a leading BOM is ignored. */
export function parseCsv(text: string): Result<string[][], string> {
  const s = text.startsWith('﻿') ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const endRow = (): void => {
    row.push(field);
    if (row.length > 1 || field !== '') rows.push(row);
    row = [];
    field = '';
  };
  while (i < s.length) {
    const c = s.charAt(i);
    if (quoted) {
      if (c !== '"') {
        field += c;
        i += 1;
      } else if (s.charAt(i + 1) === '"') {
        field += '"';
        i += 2;
      } else {
        quoted = false;
        i += 1;
        if (!['', ',', '\r', '\n'].includes(s.charAt(i))) return err(`unexpected character after a closing quote at position ${i}`);
      }
    } else if (c === '"' && field === '') {
      quoted = true;
      i += 1;
    } else if (c === ',') {
      row.push(field);
      field = '';
      i += 1;
    } else if (c === '\r' || c === '\n') {
      endRow();
      i += c === '\r' && s.charAt(i + 1) === '\n' ? 2 : 1;
    } else {
      field += c;
      i += 1;
    }
  }
  if (quoted) return err('a quoted field is not closed');
  if (field !== '' || row.length > 0) endRow();
  return ok(rows);
}

/** Quote a field if it contains a comma, quote or line break. */
export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** Rows to CSV text with LF line endings and a trailing newline. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((r) => r.map(csvField).join(',')).join('\n') + '\n';
}

const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Make a text cell safe to open in a spreadsheet: a cell starting with = + - @ tab or CR gets a leading
 * single quote, so it is shown as text instead of run as a formula (OWASP CSV injection guidance).
 * Use on text columns only; numeric columns are never changed.
 */
export function neutralizeFormula(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

/** Undo `neutralizeFormula` when reading a cell back. */
export function restoreFormula(text: string): string {
  return text.startsWith("'") && FORMULA_START.test(text.slice(1)) ? text.slice(1) : text;
}
