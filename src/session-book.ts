import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const DAY = 24 * 3600_000;

/**
 * Dashboard sessions (F-039, B-113). An update restarts the service, and sessions held only in memory signed every open
 * dashboard out mid-update. With a file, the book keeps only the SHA-256 of each session and its expiry, bound to a
 * fingerprint of the admin token: a rotated token discards every stored session. Without a file it is memory only.
 * Persistence is best-effort: a failed write is logged and never throws (the request path and startup stay up), and a
 * revoke that cannot be written removes the file, so a revoked session can never come back after a restart.
 */
export class SessionBook {
  private readonly entries = new Map<string, number>();
  private readonly token: () => string;
  private readonly file: string | undefined;
  private readonly ttlMs: number;
  private readonly max: number;
  private boundTo: string;

  constructor(token: () => string, file?: string, ttlMs = DAY / 2, max = 64) {
    this.token = token;
    this.file = file;
    this.ttlMs = ttlMs;
    this.max = max;
    this.boundTo = sha256(token());
    if (!file || !existsSync(file)) return;
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as {
        version?: number;
        token?: string;
        sessions?: [string, number][];
      };
      const now = Date.now();
      if (saved.version === 1 && saved.token === this.boundTo && Array.isArray(saved.sessions)) {
        // Never longer than the lifetime, never more than the cap (the newest expiries win).
        const valid = saved.sessions
          .filter(
            ([hash, expires]) =>
              typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash) && Number.isFinite(expires) && expires > now,
          )
          .map(([hash, expires]) => [hash, Math.min(expires, now + ttlMs)] as const)
          .sort((a, b) => a[1] - b[1])
          .slice(-max);
        for (const [hash, expires] of valid) this.entries.set(hash, expires);
      }
    } catch {
      /* an unreadable file starts empty; the next write replaces it */
    }
    this.save();
  }

  /** A rotated admin token ends every session, in memory and on disk. */
  private current(): Map<string, number> {
    const fp = sha256(this.token());
    if (fp !== this.boundTo) {
      this.boundTo = fp;
      this.entries.clear();
      this.save(true);
    }
    return this.entries;
  }

  /** Best-effort write; true when written. A revoke that cannot be written removes the file instead. */
  private save(revoking = false): boolean {
    if (!this.file) return true;
    const tmp = this.file + '.tmp';
    try {
      // A leftover temp (or a symlink there) is removed, so the new one is created private and never followed.
      rmSync(tmp, { force: true });
      writeFileSync(tmp, JSON.stringify({ version: 1, token: this.boundTo, sessions: [...this.entries] }) + '\n', {
        mode: 0o600,
        flag: 'wx',
      });
      renameSync(tmp, this.file);
      return true;
    } catch (error) {
      console.error(`Dashboard sessions not saved: ${error instanceof Error ? error.message : String(error)}`);
      if (revoking)
        try {
          unlinkSync(this.file);
        } catch {
          /* nothing left to remove */
        }
      return false;
    }
  }

  get size(): number {
    return this.current().size;
  }

  /** Expiry of a live session, or 0. */
  expiresAt(session: string): number {
    const expires = this.current().get(sha256(session)) ?? 0;
    return expires > Date.now() ? expires : 0;
  }

  has(session: string): boolean {
    return this.expiresAt(session) > 0;
  }

  /** Adds a session; when full, the oldest one goes first. */
  add(session: string, expires: number, max = this.max): void {
    const book = this.current();
    while (book.size >= max) book.delete(book.keys().next().value!);
    book.set(sha256(session), expires);
    this.save();
  }

  dropExpired(now = Date.now()): void {
    const book = this.current();
    let changed = false;
    for (const [hash, expires] of book)
      if (expires <= now) {
        book.delete(hash);
        changed = true;
      }
    if (changed) this.save();
  }

  /** Revokes every session; returns how many there were. */
  clear(): number {
    const book = this.current();
    const n = book.size;
    book.clear();
    this.save(true);
    return n;
  }
}
