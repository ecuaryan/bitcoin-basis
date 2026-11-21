/**
 * Saving the recovery code into the person's password manager.
 *
 * Chromium (including Android Chrome) has the Credential Management API: `navigator.credentials.store`
 * hands the code to Google Password Manager. Safari and Firefox don't, so we fall back to the standard
 * "new password" form (username + new-password fields) and submit it to the same page; their own
 * "Save password?" prompt then appears. Neither path sends anything over the network.
 */
export const CODE_LABEL = 'Bitcoin Basis recovery code';

export type SaveResult = 'credential' | 'form' | 'failed';

interface PasswordCredentialCtor {
  new (data: { id: string; name: string; password: string }): Credential;
}

export async function saveToPasswordManager(code: string, form: HTMLFormElement | null): Promise<SaveResult> {
  const Ctor = (globalThis as { PasswordCredential?: PasswordCredentialCtor }).PasswordCredential;
  if (Ctor !== undefined && typeof navigator !== 'undefined' && typeof navigator.credentials?.store === 'function') {
    try {
      // Some browsers keep the promise open while their prompt is showing; don't make the person wait on it.
      const stored = navigator.credentials.store(new Ctor({ id: CODE_LABEL, name: CODE_LABEL, password: code }));
      await Promise.race([stored, new Promise<void>((resolve) => setTimeout(resolve, 1000))]);
      return 'credential';
    } catch {
      return 'failed';
    }
  }
  if (form === null) return 'failed';
  try {
    form.requestSubmit();
    return 'form';
  } catch {
    return 'failed';
  }
}

/** True where the browser can hand back a saved code on request (Chromium's Credential Management API). */
export function canFillFromPasswordManager(): boolean {
  return (globalThis as { PasswordCredential?: unknown }).PasswordCredential !== undefined && typeof navigator !== 'undefined' && typeof navigator.credentials?.get === 'function';
}

/**
 * Ask the browser's password manager for the saved recovery code: it shows its own chooser and only
 * offers what was saved for this site. Returns the code, or `null` when nothing was picked or it isn't
 * the recovery code. Nothing goes over the network.
 */
export async function fillFromPasswordManager(): Promise<string | null> {
  if (!canFillFromPasswordManager()) return null;
  try {
    const c = (await navigator.credentials.get({ password: true, mediation: 'required' } as CredentialRequestOptions)) as { id?: string; password?: string } | null;
    if (c === null || typeof c.password !== 'string' || c.password === '') return null;
    return c.id === undefined || c.id === CODE_LABEL ? c.password : null;
  } catch {
    return null;
  }
}
