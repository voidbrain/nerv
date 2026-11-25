import type { ServerResponse } from 'node:http';
/** Coalesced invalidations, not event replay: clients re-read bounded authenticated pages after connect/change. */
export class DashboardFeed {
  private readonly clients = new Map<ServerResponse, { authorized: () => boolean; revision?: string; sent: number }>();
  private timer?: NodeJS.Timeout;
  private busy = false;
  private readonly revision: () => Promise<string> | string;
  constructor(revision: () => Promise<string> | string) {
    this.revision = revision;
  }
  connect(res: ServerResponse, authorized: () => boolean): boolean {
    if (this.clients.size >= 8) return false;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setTimeout(0);
    res.write(': connected\n\n');
    this.clients.set(res, { authorized, sent: 0 });
    res.once('close', () => {
      this.clients.delete(res);
      if (!this.clients.size) {
        clearInterval(this.timer);
        this.timer = undefined;
      }
    });
    if (!this.timer)
      this.timer = setInterval(() => {
        void this.tick();
      }, 500);
    void this.tick();
    return true;
  }
  private async tick(): Promise<void> {
    for (const [res, c] of this.clients)
      if (!c.authorized() || res.writableLength > 32768) {
        res.destroy();
        this.clients.delete(res);
      }
    if (this.busy || !this.clients.size) return;
    this.busy = true;
    try {
      const revision = await this.revision();
      if (!/^\d+:\d+$/.test(revision)) throw new Error('Invalid dashboard revision.');
      for (const [res, c] of this.clients) {
        // Recheck after the asynchronous database read: an expiry/revocation must not receive another notification.
        if (!c.authorized()) {
          res.destroy();
          continue;
        }
        if (c.revision !== revision) {
          c.revision = revision;
          c.sent = Date.now();
          if (!res.write('event: refresh\ndata: {}\n\n')) res.destroy();
        } else if (Date.now() - c.sent >= 10000) {
          c.sent = Date.now();
          if (!res.write(': heartbeat\n\n')) res.destroy();
        }
      }
    } catch {
      for (const res of this.clients.keys()) res.destroy();
    } finally {
      this.busy = false;
    }
  }
  close() {
    clearInterval(this.timer);
    this.timer = undefined;
    for (const res of this.clients.keys()) res.destroy();
    this.clients.clear();
  }
}
