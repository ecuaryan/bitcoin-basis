// Sessions (signed, revocable cookie) and stateless, single-use WebAuthn challenges.
import { randomBytes, signToken, toB64u, verifyToken } from './crypto.ts';
import { fail } from './http.ts';
import { currentEpoch, ONLY_IF_NEW, revokedKey, type Env } from './store.ts';
import { b64u } from './validate.ts';

const SESSION_MS = 2 * 60 * 60 * 1000;
const CHALLENGE_MS = 5 * 60 * 1000;
export const COOKIE = '__Secure-bb_session';
const ATTRIBUTES = 'HttpOnly; Secure; SameSite=Strict; Path=/api';

export type SessionKind = 'passkey' | 'recovery';

export interface Session {
  /** Session id (16 random bytes); `revoked/<sid>` ends it. */
  readonly sid: string;
  readonly kind: SessionKind;
  /** passkey sessions: the credential that signed in. */
  readonly cid?: string;
  /** recovery sessions: the recovery version the code matched. Dead once a newer version exists. */
  readonly rv?: number;
}

export async function sessionCookie(env: Env, s: Omit<Session, 'sid'>): Promise<string> {
  const payload = { typ: 'session', sid: toB64u(randomBytes(16)), ...s, exp: Date.now() + SESSION_MS };
  const token = await signToken(env.SESSION_SECRET, payload);
  return `${COOKIE}=${token}; ${ATTRIBUTES}; Max-Age=${SESSION_MS / 1000}`;
}

export const clearedCookie = `${COOKIE}=; ${ATTRIBUTES}; Max-Age=0`;

function cookieToken(req: Request): string | undefined {
  const cookie = (req.headers.get('Cookie') ?? '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`));
  return cookie?.slice(COOKIE.length + 1);
}

/** A signed, unexpired session token, without the storage checks (logout uses it to revoke). */
async function signedSession(req: Request, env: Env): Promise<Session | null> {
  const p = await verifyToken(env.SESSION_SECRET, cookieToken(req), 'session');
  if (p === null || typeof p.sid !== 'string' || (p.kind !== 'passkey' && p.kind !== 'recovery')) return null;
  return {
    sid: p.sid,
    kind: p.kind,
    ...(typeof p.cid === 'string' ? { cid: p.cid } : {}),
    ...(typeof p.rv === 'number' ? { rv: p.rv } : {}),
  };
}

/** The live session: signed, unexpired, not revoked, and (recovery) not outdated by a rotation. */
export async function getSession(req: Request, env: Env): Promise<Session | null> {
  const s = await signedSession(req, env);
  if (s === null) return null;
  if ((await env.DATA.head(revokedKey(s.sid))) !== null) return null;
  if (s.kind === 'recovery' && s.rv !== (await currentEpoch(env.DATA))) return null;
  return s;
}

export async function requireSession(req: Request, env: Env, kind?: SessionKind): Promise<Session> {
  const s = (await getSession(req, env)) ?? fail(401);
  if (kind !== undefined && s.kind !== kind) fail(401);
  return s;
}

/** Writes `revoked/<sid>` for a validly signed session (only-if-new; a second logout is a no-op). */
export async function revoke(req: Request, env: Env): Promise<void> {
  const s = await signedSession(req, env);
  if (s !== null) await env.DATA.put(revokedKey(s.sid), '', ONLY_IF_NEW);
}

export type Purpose = 'register' | 'login' | 'stepup';
export type StepUpPurpose = 'register' | 'rotate';

/** A fresh challenge (bytes, for the WebAuthn options) and a signed 5-minute token that carries it. */
export async function newChallenge(env: Env, typ: Purpose, extra: Record<string, string> = {}) {
  const challenge = randomBytes(32);
  const token = await signToken(env.SESSION_SECRET, { typ, ch: toB64u(challenge), exp: Date.now() + CHALLENGE_MS, ...extra });
  return { challenge, token };
}

/** Checks a challenge token's signature, purpose and age. Does not spend it (see `burnChallenge`). */
export async function readChallenge(env: Env, token: unknown, typ: Purpose) {
  const p = (await verifyToken(env.SESSION_SECRET, token, typ)) ?? fail(401);
  return { ch: b64u(p.ch, 32), via: p.via, purpose: p.purpose, sid: p.sid };
}

/**
 * Spends a challenge after its assertion or attestation verified: an only-if-new `used/<challenge>`
 * marker makes it single use (of two racing requests, only one gets past it).
 */
export async function burnChallenge(env: Env, ch: string): Promise<void> {
  if ((await env.DATA.put(`used/${ch}`, '', ONLY_IF_NEW)) === null) fail(401);
}
