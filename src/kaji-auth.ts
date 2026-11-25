import { createHash, randomBytes, sign, verify, type KeyObject } from 'node:crypto';
import { publicKeyFrom, keyIdentity, type BaseEntry } from './kaji.ts';
export const KAJI_CLOCK_SKEW_MS = 120_000;
const NONCE_MS = 10 * 60_000;
const digest = (body: string) => createHash('sha256').update(body).digest('base64');
export interface RootTrust {
  root: string;
  required: boolean;
}
const message = (
  kind: 'req' | 'res',
  method: string,
  path: string,
  time: string,
  nonce: string,
  body: string,
  root?: string,
  replyTo?: string,
) =>
  [
    ...(root === undefined ? [] : ['root-v1', root]),
    ...(replyTo === undefined ? [] : ['reply-to-v1', replyTo]),
    kind,
    method,
    path,
    time,
    nonce,
    digest(body),
  ].join('\n');
/** B-125: an updated base answers only with a reply bound to the request's nonce; an older one sends it unbound. */
export const KAJI_REPLY_UNBOUND = 'reply_unbound';
/** B-125: a signed reply whose binding names another request (captured elsewhere and replayed). */
export const KAJI_REPLY_MISMATCH = 'reply_not_bound_to_this_request';
const NONCE = /^[a-f0-9]{32}$/;
export function signedHeaders(
  baseId: string,
  key: KeyObject,
  kind: 'req' | 'res',
  method: string,
  path: string,
  body: string,
  now = new Date(),
  root?: string,
  replyTo?: string,
): Record<string, string> {
  const time = now.toISOString(),
    nonce = randomBytes(16).toString('hex');
  // B-125: a reply answering a signed request carries that request's nonce under its signature.
  const bound = kind === 'res' && replyTo !== undefined && NONCE.test(replyTo) ? replyTo : undefined;
  return {
    ...(root === undefined ? {} : { 'x-kaji-root': root }),
    ...(bound === undefined ? {} : { 'x-kaji-reply-to': bound }),
    'x-kaji-base': baseId,
    'x-kaji-time': time,
    'x-kaji-nonce': nonce,
    'x-kaji-signature': sign(
      null,
      Buffer.from(message(kind, method, path, time, nonce, body, root, bound)),
      key,
    ).toString('base64'),
  };
}
/** Replay guard: a nonce is accepted once within its window; old ones are forgotten. */
export class Nonces {
  private seen = new Map<string, number>();
  private readonly limit: number;
  constructor(limit = 100000) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid replay-cache bound.');
    this.limit = limit;
  }
  fresh(nonce: string, now = Date.now()): boolean {
    for (const [n, t] of this.seen) if (t < now - NONCE_MS) this.seen.delete(n);
    if (this.seen.has(nonce) || this.seen.size >= this.limit) return false;
    this.seen.set(nonce, now);
    return true;
  }
}
/**
 * Returns the sender's base id, or throws: unknown or revoked base, stale time, replayed nonce, bad signature. With
 * `request` (the nonce of the request this base sent), a reply must be bound to it (B-125): an unbound reply, from a base
 * running an older NERV, throws `reply_unbound`; one bound to another request throws `reply_not_bound_to_this_request`.
 */
export function verifySigned(
  headers: Record<string, string | undefined>,
  kind: 'req' | 'res',
  method: string,
  path: string,
  body: string,
  bases: BaseEntry[],
  nonces: Nonces,
  now = Date.now(),
  trust?: RootTrust,
  request?: string,
): string {
  const id = headers['x-kaji-base'],
    time = headers['x-kaji-time'],
    nonce = headers['x-kaji-nonce'],
    signature = headers['x-kaji-signature'];
  if (
    typeof id !== 'string' ||
    typeof time !== 'string' ||
    typeof nonce !== 'string' ||
    typeof signature !== 'string' ||
    !id ||
    !time ||
    !nonce ||
    !signature
  )
    throw new Error('unsigned');
  const root = headers['x-kaji-root'];
  if (root !== undefined && (typeof root !== 'string' || !/^([A-Za-z0-9+/=]{40,120})$/.test(root)))
    throw new Error('invalid root generation');
  if (root !== undefined && keyIdentity(root) !== root) throw new Error('noncanonical root generation');
  if (
    trust &&
    ((root !== undefined && keyIdentity(root) !== keyIdentity(trust.root)) || (root === undefined && trust.required))
  )
    throw new Error('root generation mismatch or required binding missing');
  const replyTo = headers['x-kaji-reply-to'];
  if (replyTo !== undefined && (kind !== 'res' || typeof replyTo !== 'string' || !NONCE.test(replyTo)))
    throw new Error('invalid reply binding');
  if (request !== undefined && kind === 'res') {
    if (replyTo === undefined)
      throw Object.assign(
        new Error(`${KAJI_REPLY_UNBOUND}: ${id} answered without binding the reply to the request; update that base`),
        { code: KAJI_REPLY_UNBOUND },
      );
    if (replyTo !== request)
      throw Object.assign(new Error(`${KAJI_REPLY_MISMATCH}: the reply answers another request`), {
        code: KAJI_REPLY_MISMATCH,
      });
  }
  const base = bases.find((b) => b.baseId === id);
  if (!base || base.status !== 'enrolled') throw new Error('unknown or revoked base');
  if (!Number.isFinite(Date.parse(time)) || Math.abs(now - Date.parse(time)) > KAJI_CLOCK_SKEW_MS)
    throw new Error('stale or future time');
  if (!NONCE.test(nonce)) throw new Error('replayed');
  if (
    !verify(
      null,
      Buffer.from(message(kind, method, path, time, nonce, body, root, replyTo)),
      publicKeyFrom(base.publicKey),
      Buffer.from(signature, 'base64'),
    )
  )
    throw new Error('bad signature');
  if (!nonces.fresh(nonce, now)) throw new Error('replayed or replay cache full');
  return id;
}
