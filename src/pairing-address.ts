// B-128: the address checks pairing QR codes and config.json share, with no imports (config.ts reads them, and the EVA
// runner reads config.ts without the vendored QR encoder).

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

/** Whether an address is this machine's loopback (127.x, localhost, ::1): a phone cannot open it. */
export function isLoopbackBase(base: string): boolean {
  try {
    return /^(127\.\d+\.\d+\.\d+|localhost|\[::1\])$/i.test(new URL(base).hostname);
  } catch {
    return false;
  }
}
