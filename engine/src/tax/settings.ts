import type { Settings } from '../types.ts';
import type { StateCode } from './tables/state.ts';
import type { StateChoice } from './tax.ts';

/** The tax module's state choice for the ledger's state setting (flat codes are validated on entry). */
export function stateChoiceFromSettings(settings: Pick<Settings, 'state'>): StateChoice {
  const s = settings.state;
  if (s.kind === 'none') return { customRate: 0 };
  if (s.kind === 'flat') return { code: s.state as StateCode };
  return { customRate: s.rate };
}
