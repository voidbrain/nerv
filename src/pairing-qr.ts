// F-118-T05 (owner 2026-11-24): pairing as a QR code. The QR holds the dashboard's address with the pairing code in the
// URL fragment (#pair=XXXX-XXXX&until=<ms>): a browser never sends a fragment to the server, so the code is not logged
// and never reaches a referrer. Scanned, Safari opens the dashboard, which shows the code and how to install the app; it
// never pairs. The owner types the code in the installed app, which pairs.

/** A QR encoder: the text in, the module matrix out (true = dark), without a quiet zone. */
export type QrEncoder = (text: string) => boolean[][];

/** Until the encoder is vendored (named to the owner first), a QR is unavailable and the code is shown alone. */
export const noQrEncoder: QrEncoder = () => {
  throw new Error('No QR encoder is installed in this version: type the code shown instead.');
};

/** The address the phone opens: an http(s) origin, nothing else (no credentials, path, query or fragment kept). */
export function pairingBase(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 200) return undefined;
  try {
    const url = new URL(value);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

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
