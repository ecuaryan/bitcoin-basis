// Thin wrappers over @simplewebauthn/server with this app's fixed choices.
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { fromB64u, randomBytes, toB64u } from './crypto.ts';
import type { Credential, Env } from './store.ts';
import type { Obj } from './validate.ts';

/** EdDSA, ES256, RS256: what passkey providers use. */
const ALGORITHMS = [-8, -7, -257];

export function registrationOptions(env: Env, challenge: Uint8Array<ArrayBuffer>, excludeIds: string[]) {
  return generateRegistrationOptions({
    rpName: env.RP_NAME,
    rpID: env.RP_ID,
    userName: env.RP_NAME,
    userID: randomBytes(16),
    challenge,
    attestationType: 'none',
    excludeCredentials: excludeIds.map((id) => ({ id })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    extensions: { prf: {} } as Record<string, unknown>,
    supportedAlgorithmIDs: ALGORITHMS,
  });
}

/** Returns the new credential, or null if the attestation doesn't verify. */
export async function verifyRegistration(env: Env, response: Obj, challenge: string) {
  try {
    const { verified, registrationInfo } = await verifyRegistrationResponse({
      response: response as unknown as RegistrationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: env.ORIGIN,
      expectedRPID: env.RP_ID,
      requireUserVerification: true,
      supportedAlgorithmIDs: ALGORITHMS,
    });
    if (!verified) return null;
    const { id, publicKey, transports } = registrationInfo.credential;
    return { id, publicKey: toB64u(publicKey), transports: transports ?? [] };
  } catch {
    return null;
  }
}

export function loginOptions(env: Env, challenge: Uint8Array<ArrayBuffer>) {
  return generateAuthenticationOptions({ rpID: env.RP_ID, challenge, userVerification: 'required' });
}

/** Sign counters are not enforced (synced passkeys report 0), so the stored counter is always 0. */
export async function verifyLogin(env: Env, response: Obj, challenge: string, id: string, cred: Credential): Promise<boolean> {
  const publicKey = fromB64u(cred.publicKey);
  if (!publicKey) return false;
  try {
    const { verified } = await verifyAuthenticationResponse({
      response: response as unknown as AuthenticationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: env.ORIGIN,
      expectedRPID: env.RP_ID,
      credential: { id, publicKey, counter: 0, transports: cred.transports },
      requireUserVerification: true,
    });
    return verified;
  } catch {
    return false;
  }
}
