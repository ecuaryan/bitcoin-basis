import { describe, expect, it } from 'vitest';
import { taxTableNotice } from './tax-table-notice.ts';

describe('taxTableNotice', () => {
  it('is silent for a year with its own table', () => {
    expect(taxTableNotice(2025)).toBeNull();
    expect(taxTableNotice(2026)).toBeNull();
    expect(taxTableNotice(2027)).toBeNull();
  });
  it('names the table used when the year is after the last one', () => {
    expect(taxTableNotice(2028)).toBe("Using 2027 tax rates; 2028 rates aren't in the app yet.");
  });
  it('names the table used when the year is before the first one', () => {
    expect(taxTableNotice(2023)).toBe("Using 2025 tax rates; 2023 rates aren't in the app yet.");
  });
});
