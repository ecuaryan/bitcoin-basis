// Sessions (signed cookie) and stateless, single-use WebAuthn challenges.
import { randomBytes, signToken, toB64u, verifyToken } from './crypto.ts';
import { fail } from './http.ts';
import { ONLY_IF_NEW, type Env } from './store.ts';
import { b64u } from './validate.ts';

const SESSION_MS = 12 * 60 * 60 * 1000;
const CHALLENGE_MS = 5 * 60 * 1000;
const COOKIE = 'bb_session';
const ATTRIBUTES = 'HttpOnly; Secure; SameSite=Strict; Path=/api';

export async function sessionCookie(env: Env, kind: 'passkey' | 'recovery'): Promise<string> {
  const token = await signToken(env.SESSION_SECRET, { typ: 'session', kind, exp: Date.now() + SESSION_MS });
  return `${COOKIE}=${token}; ${ATTRIBUTES}; Max-Age=${SESSION_MS / 1000}`;
}

export const clearedCookie = `${COOKIE}=; ${ATTRIBUTES}; Max-Age=0`;

export async function hasSession(req: Request, env: Env): Promise<boolean> {
  const cookie = (req.headers.get('Cookie') ?? '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`));
  return (await verifyToken(env.SESSION_SECRET, cookie?.slice(COOKIE.length + 1), 'session')) !== null;
}

type Purpose = 'register' | 'login';

/** A fresh challenge (bytes, for the WebAuthn options) and a signed 5-minute token that carries it. */
export async function newChallenge(env: Env, typ: Purpose, via?: 'setup' | 'session') {
  const challenge = randomBytes(32);
  const token = await signToken(env.SESSION_SECRET, { typ, ch: toB64u(challenge), exp: Date.now() + CHALLENGE_MS, ...(via ? { via } : {}) });
  return { challenge, token };
}

/** Verifies a challenge token and burns it: an only-if-new `used/<challenge>` marker makes it single use. */
export async function useChallenge(env: Env, token: unknown, typ: Purpose) {
  const payload = (await verifyToken(env.SESSION_SECRET, token, typ)) ?? fail(401);
  const ch = b64u(payload.ch, 32);
  if ((await env.DATA.put(`used/${ch}`, '', ONLY_IF_NEW)) === null) fail(401);
  return { ch, via: payload.via };
}
