import { describe, expect, test } from 'vitest';
import { fromHex, toHex } from './bytes.ts';
import {
  cleanRecoveryCodeInput,
  generateRecoveryCode,
  parseRecoveryCode,
  readRecoveryFragment,
  RECOVERY_ALPHABET,
  recoveryCodeFromSecret,
  recoveryLink,
  RecoveryCodeError,
  takeRecoveryCodeFromUrl,
} from './recovery-code.ts';

const FIXED = fromHex('000102030405060708090a0b0c0d0e0f');
const FIXED_TEXT = '000G4-0R40M-30E20-9185G-R38E1-YZ4BJ';

describe('recovery code', () => {
  test('frozen encoding of a fixed secret', async () => {
    expect((await recoveryCodeFromSecret(FIXED)).text).toBe(FIXED_TEXT);
  });

  test('format: six groups of five Crockford base32 characters', async () => {
    for (let i = 0; i < 50; i++) {
      const code = await generateRecoveryCode();
      expect(code.text).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){5}$/);
      expect(code.secret.length).toBe(16);
      const back = await parseRecoveryCode(code.text);
      expect(toHex(back.secret)).toBe(toHex(code.secret));
      expect(back.text).toBe(code.text);
    }
  });

  test('alphabet has no I, L, O or U', () => {
    expect(RECOVERY_ALPHABET).toHaveLength(32);
    expect(RECOVERY_ALPHABET).not.toMatch(/[ILOU]/);
  });

  test('forgiving input: case, spaces, dashes, lookalikes, a pasted link', async () => {
    const want = toHex(FIXED);
    const variants = [
      FIXED_TEXT.toLowerCase(),
      FIXED_TEXT.replace(/-/g, ' '),
      FIXED_TEXT.replace(/-/g, ''),
      `  ${FIXED_TEXT.replace(/-/g, ' - ')}  `,
      FIXED_TEXT.replace(/0/g, 'O'),
      FIXED_TEXT.replace(/0/g, 'o').replace(/1/g, 'l'),
      FIXED_TEXT.replace(/1/g, 'I'),
      FIXED_TEXT.replace(/-/g, '–'),
      `https://basis.example/#recover=${FIXED_TEXT}`,
    ];
    for (const v of variants) expect(toHex((await parseRecoveryCode(v)).secret)).toBe(want);
  });

  test('every single-character typo and adjacent swap is caught by the check bits', async () => {
    const chars = FIXED_TEXT.replace(/-/g, '');
    for (let i = 0; i < chars.length; i++) {
      for (const c of RECOVERY_ALPHABET) {
        if (c === chars[i]) continue;
        const typo = chars.slice(0, i) + c + chars.slice(i + 1);
        await expect(parseRecoveryCode(typo)).rejects.toMatchObject({ problem: 'checksum' });
      }
      if (i + 1 < chars.length && chars[i] !== chars[i + 1]) {
        const swap = chars.slice(0, i) + chars[i + 1] + chars[i] + chars.slice(i + 2);
        await expect(parseRecoveryCode(swap)).rejects.toMatchObject({ problem: 'checksum' });
      }
    }
  });

  test('typed problems, before any network call', async () => {
    await expect(parseRecoveryCode('')).rejects.toMatchObject({ problem: 'empty' });
    await expect(parseRecoveryCode(' - ')).rejects.toMatchObject({ problem: 'empty' });
    await expect(parseRecoveryCode(FIXED_TEXT.slice(0, -1))).rejects.toMatchObject({ problem: 'too-short', detail: { length: 29 } });
    await expect(parseRecoveryCode(`${FIXED_TEXT}0`)).rejects.toMatchObject({ problem: 'too-long' });
    await expect(parseRecoveryCode(FIXED_TEXT.replace('G', 'U'))).rejects.toMatchObject({ problem: 'invalid-character', detail: { character: 'U', position: 3 } });
    await expect(parseRecoveryCode('word word word')).rejects.toBeInstanceOf(RecoveryCodeError);
    expect(cleanRecoveryCodeInput('abc').problem).toBe('too-short');
  });

  test('URL fragment: build, read, and remove from history', () => {
    const link = recoveryLink('https://basis.example/', FIXED_TEXT);
    expect(link).toBe(`https://basis.example/#recover=${FIXED_TEXT}`);
    expect(readRecoveryFragment(new URL(link).hash)).toBe(FIXED_TEXT);
    expect(readRecoveryFragment('#other=1')).toBeNull();
    const calls: string[] = [];
    const code = takeRecoveryCodeFromUrl({ hash: `#recover=${FIXED_TEXT}`, pathname: '/', search: '?a=1' }, { state: null, replaceState: (_s, _t, url) => void calls.push(String(url)) });
    expect(code).toBe(FIXED_TEXT);
    expect(calls).toEqual(['/?a=1']);
    expect(takeRecoveryCodeFromUrl({ hash: '', pathname: '/', search: '' }, { state: null, replaceState: () => calls.push('x') })).toBeNull();
    expect(calls).toHaveLength(1);
  });
});
