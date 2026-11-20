/**
 * Passkeys with the WebAuthn PRF extension, using `navigator.credentials` directly.
 *
 * The PRF is always evaluated on one constant input, `PRF_INPUT` = SHA-256("bitcoin-basis/prf/v1"),
 * for every credential, so any prompt (including a discoverable one on a fresh device) returns
 * the PRF output in one go. Each credential's random `prfSalt` is used only as the HKDF salt.
 * The PRF output (a per-credential secret the authenticator computes) is the input to the passkey KEK. It never leaves the device: the JSON we send to the server carries
 * only `prf.enabled`, never `prf.results`.
 *
 * PRF support is detected in layers: `PublicKeyCredential.getClientCapabilities()['extension:prf']`
 * when the browser has it (a `false` there skips the prompt entirely); otherwise from what `create`
 * and `get` actually return. If `create` returns no PRF result but did not say `enabled: false`, we
 * try one follow-up `get` with a local challenge (several platforms only evaluate PRF on `get`).
 * With no PRF, a passkey can still sign in, but the vault on that device unlocks with the recovery
 * code.
 */
import { fromHex, randomBytes, toBase64Url, fromBase64Url, toBytes, type Bytes } from './bytes.ts';

/** `SHA-256("bitcoin-basis/prf/v1")`: the PRF `eval.first` input for every credential. Frozen. */
export const PRF_INPUT_HEX = 'a47c720225990a579313aa61a5339189f172aa3305c50e82600db23fc835ee16'; // gitleaks:allow (public constant)

/** A fresh copy of the constant PRF input. */
export function prfInput(): Bytes {
  return fromHex(PRF_INPUT_HEX);
}

/** The slice of `navigator.credentials` we use (a fake in tests). */
export interface CredentialsLike {
  create(options: CredentialCreationOptions): Promise<Credential | null>;
  get(options: CredentialRequestOptions): Promise<Credential | null>;
}

export type PrfSupport = 'supported' | 'unsupported' | 'unknown';

export type PasskeyErrorCode = 'unsupported' | 'cancelled' | 'no-credential' | 'prf-unavailable' | 'failed';

export class PasskeyError extends Error {
  override readonly name = 'PasskeyError';
  constructor(readonly code: PasskeyErrorCode, message?: string, options?: { cause?: unknown }) {
    super(message ?? `passkey: ${code}`, options);
  }
}

// --- JSON shapes (as @simplewebauthn/server and its browser package define them) ------------------

export type Base64URLString = string;

export interface PublicKeyCredentialDescriptorJSON {
  id: Base64URLString;
  type: 'public-key';
  transports?: string[];
}

export interface PublicKeyCredentialCreationOptionsJSON {
  rp: { id?: string; name: string };
  user: { id: Base64URLString; name: string; displayName: string };
  challenge: Base64URLString;
  pubKeyCredParams: { alg: number; type: 'public-key' }[];
  timeout?: number;
  excludeCredentials?: PublicKeyCredentialDescriptorJSON[];
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  hints?: string[];
  attestation?: AttestationConveyancePreference;
  extensions?: Record<string, unknown>;
}

export interface PublicKeyCredentialRequestOptionsJSON {
  challenge: Base64URLString;
  timeout?: number;
  rpId?: string;
  allowCredentials?: PublicKeyCredentialDescriptorJSON[];
  userVerification?: UserVerificationRequirement;
  hints?: string[];
  extensions?: Record<string, unknown>;
}

/** Client extension results we are willing to send: never PRF outputs. */
export interface SafeExtensionResults {
  prf?: { enabled?: boolean };
  credProps?: { rk?: boolean };
}

export interface RegistrationResponseJSON {
  id: Base64URLString;
  rawId: Base64URLString;
  response: {
    clientDataJSON: Base64URLString;
    attestationObject: Base64URLString;
    authenticatorData?: Base64URLString;
    transports?: string[];
    publicKeyAlgorithm?: number;
    publicKey?: Base64URLString;
  };
  authenticatorAttachment?: 'platform' | 'cross-platform';
  clientExtensionResults: SafeExtensionResults;
  type: 'public-key';
}

export interface AuthenticationResponseJSON {
  id: Base64URLString;
  rawId: Base64URLString;
  response: {
    clientDataJSON: Base64URLString;
    authenticatorData: Base64URLString;
    signature: Base64URLString;
    userHandle?: Base64URLString;
  };
  authenticatorAttachment?: 'platform' | 'cross-platform';
  clientExtensionResults: SafeExtensionResults;
  type: 'public-key';
}

// --- Detection -----------------------------------------------------------------------------------

/** What the browser says about PRF before any prompt. `unknown` when it can't tell. */
export async function detectPrfSupport(pkc: unknown = (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential): Promise<PrfSupport> {
  const getCaps = (pkc as { getClientCapabilities?: () => Promise<Record<string, boolean | undefined>> } | undefined)?.getClientCapabilities;
  if (typeof getCaps !== 'function') return 'unknown';
  try {
    const caps = await getCaps.call(pkc);
    const prf = caps['extension:prf'];
    return prf === true ? 'supported' : prf === false ? 'unsupported' : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** `navigator.credentials` when WebAuthn exists, else `null`. */
export function browserCredentials(): CredentialsLike | null {
  const nav = (globalThis as { navigator?: { credentials?: CredentialsLike } }).navigator;
  const hasPkc = typeof (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential !== 'undefined';
  return hasPkc && nav?.credentials ? nav.credentials : null;
}

// --- Options conversion --------------------------------------------------------------------------

export function creationOptionsFromJSON(json: PublicKeyCredentialCreationOptionsJSON): PublicKeyCredentialCreationOptions {
  const out: PublicKeyCredentialCreationOptions = {
    rp: json.rp,
    user: { id: fromBase64Url(json.user.id), name: json.user.name, displayName: json.user.displayName },
    challenge: fromBase64Url(json.challenge),
    pubKeyCredParams: json.pubKeyCredParams,
    excludeCredentials: (json.excludeCredentials ?? []).map(descriptorFromJSON),
    // Resident key preferred, user verification required, whatever the server sent.
    authenticatorSelection: { ...json.authenticatorSelection, residentKey: json.authenticatorSelection?.residentKey ?? 'preferred', userVerification: 'required' },
  };
  if (json.timeout !== undefined) out.timeout = json.timeout;
  if (json.attestation !== undefined) out.attestation = json.attestation;
  if (json.extensions !== undefined) out.extensions = json.extensions as AuthenticationExtensionsClientInputs;
  return out;
}

export function requestOptionsFromJSON(json: PublicKeyCredentialRequestOptionsJSON): PublicKeyCredentialRequestOptions {
  const out: PublicKeyCredentialRequestOptions = {
    challenge: fromBase64Url(json.challenge),
    allowCredentials: (json.allowCredentials ?? []).map(descriptorFromJSON),
    userVerification: 'required',
  };
  if (json.timeout !== undefined) out.timeout = json.timeout;
  if (json.rpId !== undefined) out.rpId = json.rpId;
  if (json.extensions !== undefined) out.extensions = json.extensions as AuthenticationExtensionsClientInputs;
  return out;
}

function descriptorFromJSON(d: PublicKeyCredentialDescriptorJSON): PublicKeyCredentialDescriptor {
  const out: PublicKeyCredentialDescriptor = { id: fromBase64Url(d.id), type: 'public-key' };
  if (d.transports !== undefined) out.transports = d.transports as AuthenticatorTransport[];
  return out;
}

// --- Ceremonies ----------------------------------------------------------------------------------

export interface CreatedPasskey {
  readonly credentialId: string;
  readonly response: RegistrationResponseJSON;
  /** The PRF output for `PRF_INPUT`, or `null` when this authenticator/browser has no PRF. */
  readonly prfOutput: Bytes | null;
}

/**
 * Create a passkey, asking for PRF with `eval.first = PRF_INPUT`. If the create result lacks PRF
 * results (and didn't say PRF is disabled), runs one follow-up `get` to evaluate it.
 */
export async function createPasskey(creds: CredentialsLike, optionsJSON: PublicKeyCredentialCreationOptionsJSON): Promise<CreatedPasskey> {
  const publicKey = creationOptionsFromJSON(optionsJSON);
  publicKey.extensions = { ...publicKey.extensions, credProps: true, prf: { eval: { first: prfInput() } } } as AuthenticationExtensionsClientInputs;
  const cred = asPublicKeyCredential(await call(() => creds.create({ publicKey })));
  const ext = cred.getClientExtensionResults() as { prf?: { enabled?: boolean; results?: { first?: BufferSource } } };
  const credentialId = toBase64Url(toBytes(cred.rawId));
  const response = registrationToJSON(cred);
  let prfOutput = prfResult(ext);
  if (prfOutput === null && ext.prf?.enabled !== false) {
    const rpId = optionsJSON.rp.id;
    try {
      prfOutput = (await evaluatePrf(creds, [credentialId], rpId)).prfOutput;
    } catch (e) {
      if (e instanceof PasskeyError && e.code === 'cancelled') throw e;
      prfOutput = null;
    }
  }
  return { credentialId, response, prfOutput };
}

export interface Assertion {
  readonly credentialId: string;
  readonly response: AuthenticationResponseJSON;
  /** PRF output for `PRF_INPUT`, when the authenticator returned one. */
  readonly prfOutput: Bytes | null;
}

/**
 * One `get` prompt, always requesting PRF on `PRF_INPUT`. With `knownIds`, the prompt is restricted
 * to those credentials; with none, it is discoverable (a fresh device with a synced passkey).
 */
export async function getAssertion(creds: CredentialsLike, optionsJSON: PublicKeyCredentialRequestOptionsJSON, knownIds: readonly Base64URLString[]): Promise<Assertion> {
  const publicKey = requestOptionsFromJSON(optionsJSON);
  if (knownIds.length > 0) publicKey.allowCredentials = knownIds.map((id) => ({ id: fromBase64Url(id), type: 'public-key' }));
  publicKey.extensions = { ...publicKey.extensions, prf: { eval: { first: prfInput() } } } as AuthenticationExtensionsClientInputs;
  const cred = asPublicKeyCredential(await call(() => creds.get({ publicKey })));
  const credentialId = toBase64Url(toBytes(cred.rawId));
  if (knownIds.length > 0 && !knownIds.includes(credentialId)) throw new PasskeyError('no-credential', 'the authenticator answered with an unknown passkey');
  const ext = cred.getClientExtensionResults() as { prf?: { results?: { first?: BufferSource } } };
  return { credentialId, response: authenticationToJSON(cred), prfOutput: prfResult(ext) };
}

/** A `get` with a local random challenge, only to evaluate PRF (offline unlock, or after `create`). */
export async function evaluatePrf(creds: CredentialsLike, knownIds: readonly Base64URLString[], rpId?: string): Promise<{ credentialId: string; prfOutput: Bytes }> {
  if (knownIds.length === 0) throw new PasskeyError('no-credential', 'no passkey with PRF is set up on this device');
  const options: PublicKeyCredentialRequestOptionsJSON = { challenge: toBase64Url(randomBytes(32)), userVerification: 'required', timeout: 120_000 };
  if (rpId !== undefined) options.rpId = rpId;
  const a = await getAssertion(creds, options, knownIds);
  if (a.prfOutput === null) throw new PasskeyError('prf-unavailable', 'this passkey or browser does not support the PRF extension');
  return { credentialId: a.credentialId, prfOutput: a.prfOutput };
}

// --- Encoding ------------------------------------------------------------------------------------

type AttestationLike = AuthenticatorAttestationResponse & {
  getTransports?: () => string[];
  getPublicKey?: () => ArrayBuffer | null;
  getPublicKeyAlgorithm?: () => number;
  getAuthenticatorData?: () => ArrayBuffer;
};

/** Encode a `create` result as `RegistrationResponseJSON` (PRF outputs stripped). */
export function registrationToJSON(cred: PublicKeyCredential): RegistrationResponseJSON {
  const r = cred.response as AttestationLike;
  const id = toBase64Url(toBytes(cred.rawId));
  const response: RegistrationResponseJSON['response'] = {
    clientDataJSON: toBase64Url(toBytes(r.clientDataJSON)),
    attestationObject: toBase64Url(toBytes(r.attestationObject)),
  };
  if (typeof r.getTransports === 'function') response.transports = r.getTransports();
  if (typeof r.getPublicKeyAlgorithm === 'function') response.publicKeyAlgorithm = r.getPublicKeyAlgorithm();
  if (typeof r.getPublicKey === 'function') {
    const pk = r.getPublicKey();
    if (pk !== null) response.publicKey = toBase64Url(toBytes(pk));
  }
  if (typeof r.getAuthenticatorData === 'function') response.authenticatorData = toBase64Url(toBytes(r.getAuthenticatorData()));
  const out: RegistrationResponseJSON = { id, rawId: id, response, clientExtensionResults: safeExtensions(cred), type: 'public-key' };
  const att = attachment(cred);
  if (att !== undefined) out.authenticatorAttachment = att;
  return out;
}

/** Encode a `get` result as `AuthenticationResponseJSON` (PRF outputs stripped). */
export function authenticationToJSON(cred: PublicKeyCredential): AuthenticationResponseJSON {
  const r = cred.response as AuthenticatorAssertionResponse;
  const id = toBase64Url(toBytes(cred.rawId));
  const response: AuthenticationResponseJSON['response'] = {
    clientDataJSON: toBase64Url(toBytes(r.clientDataJSON)),
    authenticatorData: toBase64Url(toBytes(r.authenticatorData)),
    signature: toBase64Url(toBytes(r.signature)),
  };
  if (r.userHandle !== null && r.userHandle !== undefined) response.userHandle = toBase64Url(toBytes(r.userHandle));
  const out: AuthenticationResponseJSON = { id, rawId: id, response, clientExtensionResults: safeExtensions(cred), type: 'public-key' };
  const att = attachment(cred);
  if (att !== undefined) out.authenticatorAttachment = att;
  return out;
}

function safeExtensions(cred: PublicKeyCredential): SafeExtensionResults {
  const ext = cred.getClientExtensionResults() as { prf?: { enabled?: unknown }; credProps?: { rk?: unknown } };
  const out: SafeExtensionResults = {};
  if (ext.prf !== undefined) out.prf = typeof ext.prf.enabled === 'boolean' ? { enabled: ext.prf.enabled } : {};
  if (ext.credProps !== undefined && typeof ext.credProps.rk === 'boolean') out.credProps = { rk: ext.credProps.rk };
  return out;
}

function attachment(cred: PublicKeyCredential): 'platform' | 'cross-platform' | undefined {
  const a = (cred as { authenticatorAttachment?: string | null }).authenticatorAttachment;
  return a === 'platform' || a === 'cross-platform' ? a : undefined;
}

function prfResult(ext: { prf?: { results?: { first?: BufferSource } } }): Bytes | null {
  const first = ext.prf?.results?.first;
  if (first === undefined) return null;
  const bytes = toBytes(first);
  return bytes.length >= 32 ? bytes : null;
}

function asPublicKeyCredential(c: Credential | null): PublicKeyCredential {
  if (c === null || c.type !== 'public-key') throw new PasskeyError('failed', 'no passkey was returned');
  return c as PublicKeyCredential;
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    if (name === 'NotAllowedError' || name === 'AbortError') throw new PasskeyError('cancelled', 'the passkey prompt was cancelled or timed out', { cause: e });
    if (name === 'NotSupportedError' || name === 'SecurityError') throw new PasskeyError('unsupported', 'passkeys are not available here', { cause: e });
    if (name === 'InvalidStateError') throw new PasskeyError('failed', 'this passkey is already registered', { cause: e });
    throw new PasskeyError('failed', 'the passkey request failed', { cause: e });
  }
}
