import { describe, expect, test } from 'vitest';
import { csvField, parseCsv, toCsv } from '../src/csv.ts';
import { formatBtc, formatCents, parseBtc, parseDollars } from '../src/format.ts';

describe('money text', () => {
  test('formatCents and formatBtc', () => {
    expect(formatCents(0)).toBe('0.00');
    expect(formatCents(5)).toBe('0.05');
    expect(formatCents(1_400_000)).toBe('14000.00');
    expect(formatCents(-65_000)).toBe('-650.00');
    expect(formatBtc(50_000_000)).toBe('0.50000000');
    expect(formatBtc(29_998_000)).toBe('0.29998000');
    expect(formatBtc(123_456_789_012)).toBe('1234.56789012');
    expect(formatBtc(-1)).toBe('-0.00000001');
  });
  test('parseDollars uses string math and rounds half-up past cents', () => {
    expect(parseDollars('14000')).toBe(1_400_000);
    expect(parseDollars('14,000.00')).toBe(1_400_000);
    expect(parseDollars(' $9000.5 ')).toBe(900_050);
    expect(parseDollars('0.1')).toBe(10);
    expect(parseDollars('0.29')).toBe(29); // 0.29 * 100 in floats is 28.999999999999996
    expect(parseDollars('1.005')).toBe(101);
    expect(parseDollars('1.0049999')).toBe(100);
    expect(parseDollars('7.')).toBe(700);
    expect(parseDollars('')).toBeNull();
    expect(parseDollars('-5')).toBeNull();
    expect(parseDollars('1e3')).toBeNull();
    expect(parseDollars('.5')).toBeNull();
    expect(parseDollars('99999999999999999999')).toBeNull();
  });
  test('parseBtc', () => {
    expect(parseBtc('0.5')).toBe(50_000_000);
    expect(parseBtc('0.00000001')).toBe(1);
    expect(parseBtc('21')).toBe(2_100_000_000);
    expect(parseBtc('0.000000001')).toBeNull();
    expect(parseBtc('abc')).toBeNull();
    expect(parseBtc('999999999999')).toBeNull();
  });
});

describe('csv', () => {
  test('quoted fields, doubled quotes, commas and newlines inside quotes, CRLF, BOM, blank lines', () => {
    const text = '﻿a,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\n\r\n,,\nlast,"",z';
    expect(parseCsv(text)).toEqual({
      ok: true,
      value: [
        ['a', 'b', 'c'],
        ['x, y', 'say "hi"', 'line1\nline2'],
        ['', '', ''],
        ['last', '', 'z'],
      ],
    });
  });
  test('trailing newline and lone CR line endings', () => {
    expect(parseCsv('a,b\rc,d\n')).toEqual({ ok: true, value: [['a', 'b'], ['c', 'd']] });
    expect(parseCsv('')).toEqual({ ok: true, value: [] });
    expect(parseCsv('a,')).toEqual({ ok: true, value: [['a', '']] });
  });
  test('quotes inside an unquoted field are literal', () => {
    expect(parseCsv('ab"c,d')).toEqual({ ok: true, value: [['ab"c', 'd']] });
  });
  test('malformed quoting is an error, not an exception', () => {
    expect(parseCsv('"abc')).toEqual({ ok: false, error: 'a quoted field is not closed' });
    expect(parseCsv('"abc"x,y').ok).toBe(false);
  });
  test('writing quotes only when needed and round-trips', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    const rows = [['h1', 'h2'], ['a,b', 'line\nbreak'], ['"q"', '']];
    expect(parseCsv(toCsv(rows))).toEqual({ ok: true, value: rows });
  });
});
