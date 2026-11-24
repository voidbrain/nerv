import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { savePrivateJson } from './session-book.ts';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** A paired device lapses after 90 days without use (owner decision 2026-11-23); each use moves the limit. */
export const DEVICE_IDLE_MS = 90 * 24 * HOUR;
/** Last use is written at most once an hour, so a busy device does not rewrite the file on every request. */
const USE_WRITE_MS = HOUR;
export const MAX_DEVICES = 10;
const NAME_MAX = 40;

export type DeviceInfo = { id: string; name: string; created: number; lastUse: number; expires: number };
type Device = { id: string; name: string; created: number; lastUse: number };

/** A device name as shown in Settings: trimmed, 1–40 characters, no control or invisible formatting characters. */
export function deviceName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.normalize('NFC').trim();
  return name.length >= 1 && name.length <= NAME_MAX && !/[\p{Cc}\p{Cf}]/u.test(name) ? name : undefined;
}

/**
 * Paired devices (F-118): the installed phone app signs in once with a device credential instead of a 12-hour session.
 * Like the session book (B-113), the file keeps only the SHA-256 of each credential, bound to a fingerprint of the admin
 * token: a rotated token ends every device. Each device lapses after `idleMs` without use; a use slides the limit and is
 * written at most once an hour. Writes are best-effort (never throw); a revoke that cannot be written removes the file.
 * A device credential has dashboard-session powers; the server enforces that.
 */
export class DeviceBook {
  private readonly entries = new Map<string, Device>();
  private readonly token: () => string;
  private readonly file: string | undefined;
  private readonly idleMs: number;
  private readonly max: number;
  private readonly now: () => number;
  private boundTo: string;

  constructor(token: () => string, file?: string, options: { idleMs?: number; max?: number; now?: () => number } = {}) {
    this.token = token;
    this.file = file;
    this.idleMs = options.idleMs ?? DEVICE_IDLE_MS;
    this.max = options.max ?? MAX_DEVICES;
    this.now = options.now ?? Date.now;
    this.boundTo = sha256(token());
    if (!file || !existsSync(file)) return;
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as { version?: number; token?: string; devices?: unknown };
      const now = this.now();
      if (saved.version === 1 && saved.token === this.boundTo && Array.isArray(saved.devices)) {
        const valid: [string, Device][] = [];
        for (const item of saved.devices as unknown[]) {
          if (!Array.isArray(item) || item.length !== 2) continue;
          const [hash, d] = item as [unknown, Partial<Device> | null];
          if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash) || !d || typeof d !== 'object') continue;
          const name = deviceName(d.name);
          if (typeof d.id !== 'string' || !/^[a-f0-9]{16}$/.test(d.id) || !name) continue;
          if (!Number.isFinite(d.created) || !Number.isFinite(d.lastUse)) continue;
          // Never a use in the future (that would stretch the limit), never created after the last use.
          const lastUse = Math.min(d.lastUse!, now);
          if (now - lastUse >= this.idleMs) continue;
          valid.push([hash, { id: d.id, name, created: Math.min(d.created!, lastUse), lastUse }]);
        }
        // Never more than the cap: the most recently used win.
        valid.sort((a, b) => a[1].lastUse - b[1].lastUse);
        for (const [hash, d] of valid.slice(-this.max)) this.entries.set(hash, d);
      }
    } catch {
      /* an unreadable file starts empty; the next write replaces it */
    }
    this.save();
  }

  /** A rotated admin token ends every device, in memory and on disk. */
  private current(): Map<string, Device> {
    const fp = sha256(this.token());
    if (fp !== this.boundTo) {
      this.boundTo = fp;
      this.entries.clear();
      this.save(true);
    }
    return this.entries;
  }

  private save(revoking = false): boolean {
    if (!this.file) return true;
    return savePrivateJson(
      this.file,
      { version: 1, token: this.boundTo, devices: [...this.entries] },
      revoking,
      'Paired devices',
    );
  }

  private dropLapsed(book: Map<string, Device>, now: number): void {
    let changed = false;
    for (const [hash, d] of book)
      if (now - d.lastUse >= this.idleMs) {
        book.delete(hash);
        changed = true;
      }
    if (changed) this.save();
  }

  /** Pairs a device; undefined when the name is invalid or the book is full (revoke one first). */
  pair(name: unknown): { id: string; name: string; credential: string } | undefined {
    const clean = deviceName(name);
    if (!clean) return undefined;
    const book = this.current();
    const now = this.now();
    this.dropLapsed(book, now);
    if (book.size >= this.max) return undefined;
    const credential = randomBytes(32).toString('hex');
    const id = randomBytes(8).toString('hex');
    book.set(sha256(credential), { id, name: clean, created: now, lastUse: now });
    this.save();
    return { id, name: clean, credential };
  }

  /** True when no device can pair until one is revoked or lapses. */
  full(): boolean {
    const book = this.current();
    this.dropLapsed(book, this.now());
    return book.size >= this.max;
  }

  /** True for a live device credential, without moving its limit (a stream's keep-alive check). */
  has(credential: string): boolean {
    if (!credential) return false;
    const d = this.current().get(sha256(credential));
    return !!d && this.now() - d.lastUse < this.idleMs;
  }

  /** Authenticates a request: true for a live device credential, and the use moves its 90-day limit. */
  use(credential: string): boolean {
    if (!credential) return false;
    const book = this.current();
    const hash = sha256(credential);
    const d = book.get(hash);
    if (!d) return false;
    const now = this.now();
    if (now - d.lastUse >= this.idleMs) {
      book.delete(hash);
      this.save();
      return false;
    }
    if (now - d.lastUse >= USE_WRITE_MS) {
      d.lastUse = now;
      this.save();
    }
    return true;
  }

  /** The paired devices, oldest first; never a credential or its hash. */
  list(): DeviceInfo[] {
    const book = this.current();
    this.dropLapsed(book, this.now());
    return [...book.values()]
      .sort((a, b) => a.created - b.created)
      .map((d) => ({ ...d, expires: d.lastUse + this.idleMs }));
  }

  /** The ID of a live device credential, so Settings can mark "this device"; undefined otherwise. */
  idOf(credential: string): string | undefined {
    if (!credential || !this.has(credential)) return undefined;
    return this.current().get(sha256(credential))?.id;
  }

  /** Revokes one device by its ID; false when there is none. */
  revoke(id: string): boolean {
    const book = this.current();
    for (const [hash, d] of book)
      if (d.id === id) {
        book.delete(hash);
        this.save(true);
        return true;
      }
    return false;
  }
}

/**
 * F-118-T03: the device `nerv devices revoke NAME|ID` means: an exact ID, or a name compared without case. Several
 * devices with that name are refused with their IDs (the same kind of phone and app gives the same name).
 */
export function matchDevice<D extends { id: string; name: string }>(
  devices: readonly D[],
  query: string,
): { device: D } | { error: string } {
  const wanted = query.trim();
  const byId = devices.find((d) => d.id === wanted.toLowerCase());
  if (byId) return { device: byId };
  const named = devices.filter((d) => d.name.toLowerCase() === wanted.toLowerCase());
  if (named.length === 1) return { device: named[0]! };
  if (named.length > 1)
    return {
      error: `${named.length} devices are called ${named[0]!.name}: revoke one by its ID (${named.map((d) => d.id).join(', ')}).`,
    };
  return { error: `No paired device is called or has the ID ${wanted}: run nerv devices to see them.` };
}

/** F-118-T03: `nerv devices`: one line per device with its name, ID, pairing day, last use and when it lapses. */
export function formatDevices(devices: readonly DeviceInfo[], now: number): string {
  if (!devices.length) return 'No paired devices. Pair a phone with: nerv open --phone';
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  const ago = (t: number) => {
    const m = Math.max(0, Math.round((now - t) / 60_000));
    return m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
  };
  return [
    `${devices.length} paired device${devices.length === 1 ? '' : 's'} (each lapses after 90 days unused):`,
    ...devices.map(
      (d) =>
        `  ${d.name} · ${d.id} · paired ${day(d.created)} · last used ${ago(d.lastUse)} · lapses ${day(d.expires)}`,
    ),
    'Revoke one with: nerv devices revoke NAME (or its ID)',
  ].join('\n');
}

/** A pairing code is typed on a phone: 8 characters, shown XXXX-XXXX, without 0/O, 1/I. 32 symbols, 40 bits. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const PAIRING_CODE_TTL_MS = 5 * MINUTE;
const MAX_PENDING_CODES = 3;
/**
 * Failed attempts: 5 a minute per client; 20 a minute in all locks pairing for a minute, doubling up to an hour, back to a
 * minute after a quiet period as long as the last lockout.
 */
const CLIENT_FAILURES = 5;
const GLOBAL_FAILURES = 20;
const WINDOW_MS = MINUTE;
const LOCKOUT_MAX_MS = HOUR;
const MAX_CLIENTS = 1024;

export type PairingResult = 'ok' | 'invalid' | { retryAfterMs: number };

/**
 * One-use pairing codes (F-118), minted only with the admin token and valid five minutes. Taking one compares in
 * constant time against every pending code. Failures are limited per client and in all: behind a proxy (tailscale
 * serve) every client looks the same, so the global lockout is what bounds guessing.
 */
export class PairingCodes {
  private readonly codes = new Map<string, number>();
  private readonly clients = new Map<string, number[]>();
  private failures: number[] = [];
  private lockedUntil = 0;
  private level = 0;
  private lastLockMs = 0;
  private lastFailure = 0;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly token: (() => string) | undefined;
  private boundTo: string | undefined;

  /** With `token`, pending codes are bound to its fingerprint: a rotated admin token ends them (review of PR #700). */
  constructor(options: { ttlMs?: number; now?: () => number; token?: () => string } = {}) {
    this.ttlMs = options.ttlMs ?? PAIRING_CODE_TTL_MS;
    this.now = options.now ?? Date.now;
    this.token = options.token;
    this.boundTo = options.token && sha256(options.token());
  }

  private prune(now: number): void {
    if (this.token) {
      const fp = sha256(this.token());
      if (fp !== this.boundTo) {
        this.boundTo = fp;
        this.codes.clear();
      }
    }
    // After a quiet period as long as the last lockout (no lockout, no failure), the next one starts from a minute again.
    if (this.level && now - Math.max(this.lockedUntil, this.lastFailure) >= this.lastLockMs) this.level = 0;
    for (const [code, expires] of this.codes) if (expires <= now) this.codes.delete(code);
    for (const [client, times] of this.clients) {
      const recent = times.filter((t) => now - t < WINDOW_MS);
      if (recent.length) this.clients.set(client, recent);
      else this.clients.delete(client);
    }
    this.failures = this.failures.filter((t) => now - t < WINDOW_MS);
  }

  /** A new code, or undefined while three are unused. */
  mint(): { code: string; expiresInMs: number } | undefined {
    const now = this.now();
    this.prune(now);
    if (this.codes.size >= MAX_PENDING_CODES) return undefined;
    let raw: string;
    do raw = [...randomBytes(8)].map((b) => ALPHABET[b & 31]).join('');
    while (this.codes.has(raw));
    this.codes.set(raw, now + this.ttlMs);
    return { code: `${raw.slice(0, 4)}-${raw.slice(4)}`, expiresInMs: this.ttlMs };
  }

  /** Swaps a typed code once. Case, spaces and the hyphen do not matter. */
  take(input: string, client: string): PairingResult {
    const now = this.now();
    this.prune(now);
    if (now < this.lockedUntil) return { retryAfterMs: this.lockedUntil - now };
    const mine = this.clients.get(client) ?? [];
    if (mine.length >= CLIENT_FAILURES) return { retryAfterMs: mine[0]! + WINDOW_MS - now };
    const cleaned = input.toUpperCase().replace(/[\s-]/g, '');
    // Always 8 ASCII bytes, so every comparison takes the same time; a malformed input matches nothing.
    const typed = Buffer.from(/^[A-Z0-9]{8}$/.test(cleaned) ? cleaned : '????????');
    let found: string | undefined;
    for (const code of this.codes.keys()) if (timingSafeEqual(Buffer.from(code), typed) && !found) found = code;
    if (found !== undefined) {
      this.codes.delete(found);
      this.level = 0;
      return 'ok';
    }
    if (!this.clients.has(client) && this.clients.size >= MAX_CLIENTS)
      this.clients.delete(this.clients.keys().next().value!);
    this.clients.set(client, [...mine, now]);
    this.failures.push(now);
    this.lastFailure = now;
    if (this.failures.length >= GLOBAL_FAILURES) {
      this.lastLockMs = Math.min(WINDOW_MS * 2 ** this.level, LOCKOUT_MAX_MS);
      this.lockedUntil = now + this.lastLockMs;
      this.level++;
      this.failures = [];
    }
    return 'invalid';
  }
}
