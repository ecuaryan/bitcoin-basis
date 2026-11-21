// HTTP plumbing: uniform JSON responses, request guards and bounded body reading.
import { SECURITY_HEADERS } from './headers.ts';

const STATUS_CODES = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  409: 'conflict',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  429: 'rate_limited',
  500: 'server_error',
  502: 'bad_gateway',
} as const;

export type ErrorStatus = keyof typeof STATUS_CODES;

/** Thrown anywhere in a handler; becomes `{ "error": "<code>" }` with that status. Never carries internals. */
export class HttpError extends Error {
  constructor(readonly status: ErrorStatus) {
    super(STATUS_CODES[status]);
  }
}

export const fail = (status: ErrorStatus): never => {
  throw new HttpError(status);
};

/** Adds the security headers and `Cache-Control: no-store` to a Worker response. */
export function finish(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  out.headers.set('Cache-Control', 'no-store');
  return out;
}

export const json = (data: unknown, status = 200, headers: HeadersInit = {}): Response =>
  Response.json(data, { status, headers });

export const errorResponse = (status: ErrorStatus): Response => json({ error: STATUS_CODES[status] }, status);

/** Non-GET requests must come from our own origin with the expected content type. */
export function guard(req: Request, origin: string, contentType: string): void {
  if (req.headers.get('Origin') !== origin) fail(403);
  const type = (req.headers.get('Content-Type') ?? '').split(';')[0]?.trim().toLowerCase();
  if (type !== contentType) fail(415);
}

/** Reads at most `max` bytes, rejecting larger bodies without buffering them. */
export async function readBytes(req: Request, max: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get('Content-Length') ?? '0');
  if (declared > max) fail(413);
  if (!req.body) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of req.body) {
    size += chunk.byteLength;
    if (size > max) fail(413);
    chunks.push(chunk);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** Parses a JSON object body (an empty body counts as `{}`). */
export async function readJson(req: Request, max: number): Promise<Record<string, unknown>> {
  const bytes = await readBytes(req, max);
  if (bytes.length === 0) return {};
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    return fail(400);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(400);
  return value as Record<string, unknown>;
}
