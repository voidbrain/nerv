import { execFile } from 'node:child_process';
import { encode } from '../vendor/uqr/index.mjs';
import { isLoopbackBase, pairingBase } from './pairing-address.ts';

export { isLoopbackBase, pairingBase };

// F-118-T05 (owner 2026-11-24): pairing as a QR code. The QR holds the dashboard's address with the pairing code in the
// URL fragment (#pair=XXXX-XXXX&until=<ms>): a browser never sends a fragment to the server, so the code is not logged
// and never reaches a referrer. Scanned, Safari opens the dashboard, which shows the code and how to install the app; it
// never pairs. The owner types the code in the installed app, which pairs.

/** A QR encoder: the text in, the module matrix out (true = dark), without a quiet zone. */
export type QrEncoder = (text: string) => boolean[][];

/** The vendored encoder (uqr 0.1.3, vendor/uqr.json; owner approved 2026-11-24): medium error correction, no border. */
export const qrEncoder: QrEncoder = (text) => encode(text, { ecc: 'M', border: 0 }).data;

/** The dashboard link a QR carries: the code and its expiry only in the fragment. */
export function pairingLink(base: string, code: string, expiresAt: number): string {
  const origin = pairingBase(base);
  if (!origin) throw new Error('The pairing address must be an http(s) address.');
  return `${origin}/dashboard/#pair=${encodeURIComponent(code)}&until=${Math.floor(expiresAt)}`;
}

/** The matrix as rows of "1" (dark) and "0" (light), the shape the API sends to Settings. */
export function qrRows(matrix: boolean[][]): string[] {
  const size = matrix.length;
  if (!size || matrix.some((row) => row.length !== size)) throw new Error('A QR matrix is square.');
  return matrix.map((row) => row.map((dark) => (dark ? '1' : '0')).join(''));
}

/**
 * A terminal QR: two module rows per text line with half blocks, light modules drawn (a dark terminal shows dark
 * modules as its background), inside a light quiet zone of two modules.
 */
export function terminalQr(rows: string[]): string {
  const quiet = 2;
  const size = rows.length + quiet * 2;
  const dark = (x: number, y: number) => {
    const rx = x - quiet;
    const ry = y - quiet;
    return ry >= 0 && ry < rows.length && rx >= 0 && rx < rows.length && rows[ry]![rx] === '1';
  };
  const lines: string[] = [];
  for (let y = 0; y < size; y += 2) {
    let line = '';
    for (let x = 0; x < size; x++) {
      const top = !dark(x, y);
      const bottom = y + 1 < size ? !dark(x, y + 1) : false;
      line += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' ';
    }
    lines.push(line);
  }
  return lines.join('\n');
}

/** The tailnet HTTPS address of this machine from `tailscale status --json` (where tailscale serve answers). */
export function tailscaleBase(status: unknown): string | undefined {
  const self = (status as { Self?: { DNSName?: unknown } } | null)?.Self;
  const name = typeof self?.DNSName === 'string' ? self.DNSName.replace(/\.$/, '') : '';
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(name) ? `https://${name.toLowerCase()}` : undefined;
}

/** The HTTPS port `tailscale serve status --json` exposes for this service's local port, if any. */
export function tailscaleServePort(status: unknown, localPort: number): number | undefined {
  const web = (status as { Web?: unknown } | null)?.Web;
  if (!web || typeof web !== 'object') return undefined;
  for (const [host, entry] of Object.entries(
    web as Record<string, { Handlers?: Record<string, { Proxy?: unknown }> }>,
  )) {
    const port = Number(/:(\d{1,5})$/.exec(host)?.[1]);
    const proxies = Object.values(entry?.Handlers ?? {}).map((h) => (typeof h?.Proxy === 'string' ? h.Proxy : ''));
    if (
      port > 0 &&
      port < 65536 &&
      proxies.some((p) => /^https?:\/\/(127\.0\.0\.1|localhost):(\d+)\/?$/.exec(p)?.[2] === String(localPort))
    )
      return port;
  }
  return undefined;
}

/** Runs `tailscale ARGS` and returns its standard output. */
export type TailscaleRun = (args: string[]) => Promise<string>;

/** `tailscale` on PATH, else the macOS app's own CLI (the App Store and standalone apps put none on PATH). */
export const runTailscale: TailscaleRun = async (args) => {
  let failure: unknown;
  for (const program of ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'])
    try {
      return await new Promise<string>((resolve, reject) =>
        execFile(program, args, { encoding: 'utf8', timeout: 5000, maxBuffer: 4 << 20 }, (e, out) =>
          e ? reject(e) : resolve(out),
        ),
      );
    } catch (e) {
      failure = e;
    }
  throw failure;
};

/**
 * B-128: this machine's tailnet HTTPS address (MagicDNS name from `tailscale status --json`), with the port
 * `tailscale serve` exposes for localPort when it is not 443; undefined without Tailscale. CLI and server share it.
 */
export async function tailnetBase(localPort: number, run: TailscaleRun = runTailscale): Promise<string | undefined> {
  let base: string | undefined;
  try {
    base = tailscaleBase(JSON.parse(await run(['status', '--json'])));
  } catch {
    return undefined;
  }
  if (!base) return undefined;
  try {
    const port = tailscaleServePort(JSON.parse(await run(['serve', 'status', '--json'])), localPort);
    if (port && port !== 443) return `${base}:${port}`;
  } catch {
    // No serve configuration readable: the default HTTPS port, as before.
  }
  return base;
}

/** The address a phone opens, or undefined when none is known. */
export type PhoneBase = () => Promise<string | undefined>;

/** How to give the phone an address, for Settings when none is found (port: the service's local port). */
export function phoneBaseHint(port: number): string {
  return `No address a phone can open: run tailscale serve --bg ${port} on this Mac, or add "phone": {"url": "https://NAME.TAILNET.ts.net"} to config.json in the data home, then try again.`;
}

/**
 * B-128: the phone's address: the configured one (config phone.url) first, else the tailnet address, looked up at
 * most once per ttlMs (a press of Pair a device should not wait on tailscale each time). Only http(s) origins that are
 * not loopback come back.
 */
export function phoneBaseResolver(sources: {
  configured: () => string | undefined;
  tailnet: PhoneBase;
  ttlMs?: number;
  clock?: () => number;
}): PhoneBase {
  const ttl = sources.ttlMs ?? 60_000;
  const now = sources.clock ?? Date.now;
  let cached: { at: number; value: Promise<string | undefined> } | undefined;
  const usable = (value: unknown) => {
    const base = pairingBase(value);
    return base && !isLoopbackBase(base) ? base : undefined;
  };
  return async () => {
    let configured: string | undefined;
    try {
      configured = usable(sources.configured());
    } catch {
      configured = undefined;
    }
    if (configured) return configured;
    if (!cached || now() - cached.at >= ttl)
      cached = { at: now(), value: sources.tailnet().then(usable, () => undefined) };
    return cached.value;
  };
}
