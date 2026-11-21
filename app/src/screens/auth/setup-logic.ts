import { cleanRecoveryCodeInput } from '../../vault/index.ts';

/** The nth group (1 to 6) of a canonical `XXXXX-…` recovery code. */
export function groupFour(code: string, n = 4): string {
  return code.split('-')[n - 1] ?? '';
}

/** Whether what was typed is that group (forgiving: case, spaces, dashes, O/0, I/L/1). */
export function matchesGroup(code: string, n: number, typed: string): boolean {
  const want = cleanRecoveryCodeInput(groupFour(code, n)).chars;
  const got = cleanRecoveryCodeInput(typed).chars;
  return want.length === 5 && want === got;
}

export type SetupCodeResult = { ok: true; code: string } | { ok: false; message: string };

/**
 * The install script prints 32 hex characters as 8 groups of 4 (`ABCD-1234-...`). Forgiving input:
 * trim, upper-case, drop spaces and dashes, then put a dash back after every 4 characters.
 */
export function normalizeSetupCode(input: string): SetupCodeResult {
  const chars = input.toUpperCase().replace(/[\s\-_.]/g, '');
  if (chars === '') return { ok: false, message: 'Paste the setup code. It was shown when the app was set up.' };
  if (!/^[0-9A-F]+$/.test(chars)) return { ok: false, message: 'The setup code only has the digits 0 to 9 and the letters A to F. Check for a typo.' };
  if (chars.length !== 32) return { ok: false, message: `The setup code has 32 characters (8 groups of 4). You typed ${chars.length}.` };
  return { ok: true, code: chars.match(/.{4}/g)?.join('-') ?? chars };
}
