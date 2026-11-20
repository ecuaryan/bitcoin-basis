// A software WebAuthn authenticator for tests: a P-256 key, 'none' attestation
// and assertions built by hand, byte for byte as a browser would send them.
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

export const b64u = (b: Uint8Array): string => Buffer.from(b).toString('base64url');
const sha256 = (b: Uint8Array | string): Buffer => createHash('sha256').update(b).digest();

// ---- minimal CBOR encoder (ints, byte strings, text, maps) ----
type Cbor = number | string | Uint8Array | Map<Cbor, Cbor>;
function head(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 0x100) return Buffer.from([(major << 5) | 24, n]);
  if (n < 0x10000) return Buffer.from([(major << 5) | 25, n >> 8, n & 0xff]);
  const b = Buffer.alloc(5);
  b[0] = (major << 5) | 26;
  b.writeUInt32BE(n, 1);
  return b;
}
export function cbor(v: Cbor): Buffer {
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)]);
  if (v instanceof Uint8Array) return Buffer.concat([head(2, v.length), v]);
  return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
}

const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};

export const FLAGS = { UP: 0x01, UV: 0x04, BE: 0x08, BS: 0x10, AT: 0x40 } as const;

export interface Ceremony { origin: string; rpId: string; challenge: string; type?: string; flags?: number }

export class SoftAuthenticator {
  readonly credentialId = randomBytes(32);
  readonly id = b64u(this.credentialId);
  private readonly key: KeyObject;
  private readonly cose: Buffer;
  private counter = 0;

  constructor() {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.key = privateKey;
    const jwk = publicKey.export({ format: 'jwk' });
    const coord = (s: string | undefined) => Buffer.from(s ?? '', 'base64url');
    this.cose = cbor(new Map<Cbor, Cbor>([[1, 2], [3, -7], [-1, 1], [-2, coord(jwk.x)], [-3, coord(jwk.y)]]));
  }

  private clientData(c: Ceremony, type: string): Buffer {
    return Buffer.from(JSON.stringify({ type: c.type ?? type, challenge: c.challenge, origin: c.origin, crossOrigin: false }));
  }

  /** navigator.credentials.create() result, as JSON (the shape @simplewebauthn/browser produces). */
  register(c: Ceremony) {
    const flags = c.flags ?? FLAGS.UP | FLAGS.UV | FLAGS.BE | FLAGS.BS | FLAGS.AT;
    const idLen = Buffer.from([this.credentialId.length >> 8, this.credentialId.length & 0xff]);
    const authData = Buffer.concat([sha256(c.rpId), Buffer.from([flags]), u32(0), Buffer.alloc(16), idLen, this.credentialId, this.cose]);
    const attestationObject = cbor(new Map<Cbor, Cbor>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      response: { clientDataJSON: b64u(this.clientData(c, 'webauthn.create')), attestationObject: b64u(attestationObject), transports: ['internal', 'hybrid'] },
      clientExtensionResults: { prf: { enabled: true } },
      authenticatorAttachment: 'platform',
    };
  }

  /** navigator.credentials.get() result, as JSON. */
  assert(c: Ceremony, opts: { corruptSignature?: boolean } = {}) {
    const flags = c.flags ?? FLAGS.UP | FLAGS.UV | FLAGS.BE | FLAGS.BS;
    const authenticatorData = Buffer.concat([sha256(c.rpId), Buffer.from([flags]), u32(++this.counter)]);
    const clientDataJSON = this.clientData(c, 'webauthn.get');
    const signature = sign('sha256', Buffer.concat([authenticatorData, sha256(clientDataJSON)]), { key: this.key, dsaEncoding: 'der' });
    if (opts.corruptSignature) signature[signature.length - 1] = (signature.at(-1) ?? 0) ^ 0xff;
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authenticatorData), signature: b64u(signature), userHandle: b64u(randomBytes(16)) },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }
}
