import { describe, expect, it } from 'vitest';
import { kitWalletRows, longDate } from './kit-logic.ts';
import { checkCompleteCode, describeRecoveryInput } from './recovery-input-logic.ts';
import { matchesGroup, normalizeSetupCode } from './setup-logic.ts';
import { recoveryCodeFromSecret } from '../../vault/recovery-code.ts';

describe('describeRecoveryInput (live feedback)', () => {
  it('empty, typing, bad character, too long, complete', () => {
    expect(describeRecoveryInput('').state).toBe('empty');
    expect(describeRecoveryInput('7f3qx 9wm').state).toBe('typing');
    expect(describeRecoveryInput('7f3qx 9wm').message).toBe('8 of 30 characters');
    const bad = describeRecoveryInput('7F3U');
    expect(bad.state).toBe('bad');
    expect(bad.message).toContain('"U"');
    expect(bad.message).toContain('character 4');
    expect(describeRecoveryInput('0'.repeat(31)).state).toBe('bad');
    expect(describeRecoveryInput('0'.repeat(30)).state).toBe('checking');
  });
  it('is forgiving: O reads as 0, I and L as 1, spaces and dashes are ignored', () => {
    expect(describeRecoveryInput('OOOOO-IIIII-LLLLL').count).toBe(15);
    expect(describeRecoveryInput('OOOOO-IIIII-LLLLL').state).toBe('typing');
  });
  it('checks the check bits once all 30 characters are in', async () => {
    const code = await recoveryCodeFromSecret(new Uint8Array(16).fill(7));
    expect((await checkCompleteCode(code.text.toLowerCase())).state).toBe('ok');
    const flat = code.text.replaceAll('-', '');
    const typo = flat.slice(0, 29) + (flat.endsWith('2') ? '3' : '2');
    expect((await checkCompleteCode(typo)).state).toBe('typo');
  });
});

describe('normalizeSetupCode', () => {
  it('accepts the script format however it is typed', () => {
    const want = 'ABCD-1234-ABCD-1234-ABCD-1234-ABCD-1234';
    expect(normalizeSetupCode(want)).toEqual({ ok: true, code: want });
    expect(normalizeSetupCode('  abcd1234abcd1234abcd1234abcd1234 ')).toEqual({ ok: true, code: want });
    expect(normalizeSetupCode('abcd 1234 abcd 1234 abcd 1234 abcd 1234')).toEqual({ ok: true, code: want });
  });
  it('explains what is wrong', () => {
    expect(normalizeSetupCode('')).toMatchObject({ ok: false });
    expect(normalizeSetupCode('ABCD-123')).toMatchObject({ ok: false, message: expect.stringContaining('32 characters') });
    expect(normalizeSetupCode('ZZZZ'.repeat(8))).toMatchObject({ ok: false, message: expect.stringContaining('A to F') });
  });
});

describe('confirm: type group 4', () => {
  const code = 'AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF';
  it('matches loosely', () => {
    expect(matchesGroup(code, 4, 'ddddd')).toBe(true);
    expect(matchesGroup(code, 4, ' d-d dd d ')).toBe(true);
    expect(matchesGroup(code, 4, 'CCCCC')).toBe(false);
    expect(matchesGroup(code, 4, '')).toBe(false);
  });
});

describe('kit', () => {
  it('lists names and types only, without archived wallets', () => {
    const rows = kitWalletRows([
      { id: 'a', name: 'Strike', type: 'exchange', defaultProof: 'x', archived: false, frozen: false, closeOutEntryId: null, recoveredCents: 0 },
      { id: 'b', name: 'Old', type: 'retirement', defaultProof: 'x', archived: true, frozen: false, closeOutEntryId: null, recoveredCents: 0 },
      { id: 'c', name: 'Cold', type: 'self-custody', defaultProof: 'x', archived: false, frozen: false, closeOutEntryId: null, recoveredCents: 0 },
    ]);
    expect(rows).toEqual([
      { name: 'Strike', type: 'Exchange' },
      { name: 'Cold', type: 'Self-custody' },
    ]);
  });
  it('dates', () => {
    expect(longDate('2026-11-20')).toBe('Nov 20, 2026');
  });
});
