import { cleanRecoveryCodeInput, formatRecoveryCode, parseRecoveryCode } from '../../vault/index.ts';

export type RecoveryInputState = 'empty' | 'typing' | 'bad' | 'checking' | 'ok' | 'typo';

export interface RecoveryInputView {
  readonly state: RecoveryInputState;
  /** One short line under the field. */
  readonly message: string;
  /** The code as typed, regrouped `XXXXX-XXXXX-…` for easy comparing with the paper. */
  readonly grouped: string;
  readonly count: number;
}

export const CODE_LENGTH = 30;

/** Instant feedback while typing. The check bits can only be verified once all 30 characters are in (`checkCompleteCode`). */
export function describeRecoveryInput(input: string): RecoveryInputView {
  const { chars, problem, detail } = cleanRecoveryCodeInput(input);
  const grouped = formatRecoveryCode(chars);
  const count = chars.length;
  switch (problem) {
    case 'empty':
      return { state: 'empty', message: '', grouped, count };
    case 'invalid-character':
      return { state: 'bad', message: `"${detail.character ?? '?'}" is not used in recovery codes. Check character ${(detail.position ?? 0) + 1}.`, grouped, count };
    case 'too-short':
      return { state: 'typing', message: `${count} of ${CODE_LENGTH} characters`, grouped, count };
    case 'too-long':
      return { state: 'bad', message: `That is ${count} characters. A recovery code has ${CODE_LENGTH}.`, grouped, count };
    default:
      return { state: 'checking', message: 'Checking the code...', grouped, count };
  }
}

/** Verifies the check bits of a complete code (no network). */
export async function checkCompleteCode(input: string): Promise<RecoveryInputView> {
  const base = describeRecoveryInput(input);
  if (base.state !== 'checking') return base;
  try {
    await parseRecoveryCode(input);
    return { ...base, state: 'ok', message: 'This code looks right.' };
  } catch {
    return { ...base, state: 'typo', message: 'There is a typo. Compare each group of five with the paper.' };
  }
}
