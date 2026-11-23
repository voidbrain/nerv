import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * Dashboard sessions (F-039, B-113). An update restarts the service, and sessions held only in memory signed every open
 * dashboard out mid-update. With a file, the book keeps only the SHA-256 of each session and its expiry, bound to a
 * fingerprint of the admin token: a rotated token discards every stored session. Without a file it is memory only.
 */
export class SessionBook {
  private readonly entries = new Map<string, number>();
  private readonly token: () => string;
  private readonly file: string | undefined;
  private boundTo: string;

  constructor(token: () => string, file?: string) {
    this.token = token;
    this.file = file;
    this.boundTo = sha256(token());
    if (!file || !existsSync(file)) return;
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as { token?: string; sessions?: [string, number][] };
      const now = Date.now();
      if (saved.token === this.boundTo && Array.isArray(saved.sessions))
        for (const [hash, expires] of saved.sessions)
          if (typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash) && Number.isFinite(expires) && expires > now)
            this.entries.set(hash, expires);
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
      this.save();
    }
    return this.entries;
  }

  private save(): void {
    if (!this.file) return;
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, JSON.stringify({ version: 1, token: this.boundTo, sessions: [...this.entries] }) + '\n', {
      mode: 0o600,
    });
    renameSync(tmp, this.file);
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
  add(session: string, expires: number, max: number): void {
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
    this.save();
    return n;
  }
}
