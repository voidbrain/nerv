import { lookup as dnsLookup } from 'node:dns/promises';
import {
  createServer as createHttpServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { connect as netConnect, isIP, type Socket } from 'node:net';
import {
  EVA_DENIED_LOCAL_PORTS,
  isBlockedEgressIp,
  isEgressDestinationAllowed,
  parseEgressDestination,
  type EgressDestination,
} from './policy.ts';

export { isBlockedEgressIp };

export interface EgressDecision {
  readonly allowed: boolean;
  readonly host: string;
  readonly port: number;
  readonly reason: string;
}

export interface EgressLookupResult {
  readonly address: string;
  readonly family: number;
}

export interface EgressProxyOptions {
  readonly allowedDestinations: readonly string[];
  readonly lookup?: (host: string) => Promise<readonly EgressLookupResult[]>;
  readonly onDecision?: (decision: EgressDecision) => void;
}

export interface EgressProxyHandle {
  readonly port: number;
  readonly url: string;
  readonly close: () => Promise<void>;
}

const DENIED_PORTS = new Set(EVA_DENIED_LOCAL_PORTS);
const HOP_BY_HOP_HEADERS = [
  'proxy-connection',
  'proxy-authorization',
  'connection',
  'keep-alive',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
];

const defaultLookup = async (host: string): Promise<readonly EgressLookupResult[]> =>
  dnsLookup(host, { all: true, verbatim: true });

export type ResolvedTarget =
  | { readonly ok: true; readonly ip: string; readonly host: string; readonly port: number }
  | { readonly ok: false; readonly reason: string };

/** Validates `(host, port)` against the Scrolls allowlist and resolves DNS without allowing rebinding to blocked IPs. */
export async function resolveAndValidateEgressTarget(
  host: string,
  port: number,
  allowlist: readonly EgressDestination[],
  lookup: (host: string) => Promise<readonly EgressLookupResult[]> = defaultLookup,
): Promise<ResolvedTarget> {
  const normalized = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, reason: `Invalid port: ${port}` };
  }
  if (DENIED_PORTS.has(port)) {
    return { ok: false, reason: `NERV admin port ${port} is always denied.` };
  }
  if (!isEgressDestinationAllowed(normalized, port, allowlist)) {
    return { ok: false, reason: `Destination ${normalized}:${port} is not in Scrolls egressAllow.` };
  }
  const explicitLoopback = isIP(normalized) !== 0 || normalized === 'localhost';
  if (isIP(normalized) !== 0) {
    const blocked = isBlockedEgressIp(normalized, true);
    return blocked ? { ok: false, reason: blocked } : { ok: true, ip: normalized, host: normalized, port };
  }
  let addrs: readonly EgressLookupResult[];
  try {
    addrs = await lookup(normalized);
  } catch (err) {
    return {
      ok: false,
      reason: `DNS lookup failed for ${normalized}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!addrs.length) return { ok: false, reason: `DNS lookup returned no addresses for ${normalized}.` };
  for (const addr of addrs) {
    const blocked = isBlockedEgressIp(addr.address, explicitLoopback);
    if (blocked) {
      return { ok: false, reason: `DNS for ${normalized} resolved to blocked address ${addr.address}: ${blocked}` };
    }
  }
  return { ok: true, ip: addrs[0].address, host: normalized, port };
}

function parseConnectAuthority(raw: string | undefined): { host: string; port: number } | null {
  if (!raw) return null;
  if (raw.startsWith('[')) {
    const close = raw.indexOf(']');
    if (close <= 1) return null;
    const host = raw.slice(1, close);
    const rest = raw.slice(close + 1);
    if (!rest) return { host, port: 443 };
    if (!rest.startsWith(':') || !/^\d+$/.test(rest.slice(1))) return null;
    return { host, port: Number(rest.slice(1)) };
  }
  const colon = raw.lastIndexOf(':');
  if (colon === -1) return { host: raw, port: 443 };
  const portStr = raw.slice(colon + 1);
  if (!/^\d+$/.test(portStr)) return null;
  return { host: raw.slice(0, colon), port: Number(portStr) };
}

function denyHttp(res: ServerResponse, reason: string, headerValue = 'destination'): void {
  if (res.headersSent || res.destroyed) {
    res.destroy();
    return;
  }
  res.writeHead(403, {
    'content-type': 'text/plain; charset=utf-8',
    'x-nerv-egress-denied': headerValue,
  });
  res.end(`Forbidden by Scrolls egress policy: ${reason}`);
}

/**
 * Starts a local HTTP/CONNECT egress proxy that enforces Scrolls `egressAllow` (default-deny),
 * blocks DNS rebinding to private/link-local/metadata IPs, and rejects HTTP redirects to denied destinations.
 */
export async function startEgressProxy(options: EgressProxyOptions): Promise<EgressProxyHandle> {
  const allowlist = options.allowedDestinations.map(parseEgressDestination);
  const lookup = options.lookup ?? defaultLookup;
  const sockets = new Set<Socket>();

  const decide = (allowed: boolean, host: string, port: number, reason: string) => {
    try {
      options.onDecision?.({ allowed, host, port, reason });
    } catch {
      // Observability callbacks must never crash the proxy.
    }
  };

  const handleHttp = async (req: IncomingMessage, res: ServerResponse) => {
    let target: URL;
    try {
      target = new URL(req.url ?? '');
    } catch {
      denyHttp(res, 'Malformed proxy request URL.');
      return;
    }
    if (target.protocol !== 'http:') {
      denyHttp(res, `Unsupported proxy protocol ${target.protocol}; use CONNECT for HTTPS.`);
      return;
    }
    const port = target.port ? Number(target.port) : 80;
    const resolved = await resolveAndValidateEgressTarget(target.hostname, port, allowlist, lookup);
    if (!resolved.ok) {
      decide(false, target.hostname, port, resolved.reason);
      denyHttp(res, resolved.reason);
      return;
    }
    decide(true, resolved.host, resolved.port, 'Allowed by Scrolls egressAllow.');

    const headers: Record<string, string | string[] | undefined> = { ...req.headers, host: target.host };
    for (const h of HOP_BY_HOP_HEADERS) delete headers[h];

    const upstream = httpRequest(
      {
        hostname: resolved.ip,
        port: resolved.port,
        method: req.method,
        path: `${target.pathname}${target.search}`,
        headers,
      },
      (upRes) => {
        void (async () => {
          const status = upRes.statusCode ?? 500;
          const location = upRes.headers.location;
          if (status >= 300 && status < 400 && typeof location === 'string') {
            let redirectUrl: URL;
            try {
              redirectUrl = new URL(location, target);
            } catch {
              upRes.destroy();
              req.unpipe(upstream);
              upstream.destroy();
              decide(false, target.hostname, port, 'Invalid redirect URL.');
              denyHttp(res, 'Invalid redirect URL.', 'redirect');
              return;
            }
            if (redirectUrl.protocol !== 'http:' && redirectUrl.protocol !== 'https:') {
              upRes.destroy();
              req.unpipe(upstream);
              upstream.destroy();
              decide(false, redirectUrl.hostname, port, `Blocked redirect protocol: ${redirectUrl.protocol}`);
              denyHttp(res, `Blocked redirect protocol: ${redirectUrl.protocol}`, 'redirect');
              return;
            }
            const rPort = redirectUrl.port ? Number(redirectUrl.port) : redirectUrl.protocol === 'https:' ? 443 : 80;
            const rCheck = await resolveAndValidateEgressTarget(redirectUrl.hostname, rPort, allowlist, lookup);
            if (!rCheck.ok) {
              upRes.destroy();
              req.unpipe(upstream);
              upstream.destroy();
              decide(false, redirectUrl.hostname, rPort, `Redirect blocked: ${rCheck.reason}`);
              denyHttp(res, `Redirect target blocked: ${rCheck.reason}`, 'redirect');
              return;
            }
          }
          if (res.destroyed) {
            upRes.destroy();
            return;
          }
          res.writeHead(status, upRes.headers);
          upRes.pipe(res);
        })().catch(() => {
          upRes.destroy();
          upstream.destroy();
          denyHttp(res, 'Proxy error while validating response.');
        });
      },
    );
    res.on('close', () => {
      if (!res.writableEnded) {
        req.unpipe(upstream);
        upstream.destroy();
      }
    });
    upstream.on('error', (err) => {
      if (!res.headersSent && !res.destroyed) {
        res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(`Upstream connection failed: ${err.message}`);
      } else {
        res.destroy();
      }
    });
    req.pipe(upstream);
  };

  const server = createHttpServer((req, res) => {
    void handleHttp(req, res).catch(() => {
      denyHttp(res, 'Proxy error.');
    });
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  server.on('connect', (req, clientSocket: Socket, head: Buffer) => {
    sockets.add(clientSocket);
    clientSocket.on('close', () => sockets.delete(clientSocket));
    void (async () => {
      const parsed = parseConnectAuthority(req.url);
      if (!parsed) {
        clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        return;
      }
      const resolved = await resolveAndValidateEgressTarget(parsed.host, parsed.port, allowlist, lookup);
      if (clientSocket.destroyed) return;
      if (!resolved.ok) {
        decide(false, parsed.host, parsed.port, resolved.reason);
        clientSocket.end('HTTP/1.1 403 Forbidden\r\nX-Nerv-Egress-Denied: destination\r\n\r\n');
        return;
      }
      decide(true, resolved.host, resolved.port, 'Allowed by Scrolls egressAllow.');
      let established = false;
      const upstream = netConnect(resolved.port, resolved.ip, () => {
        if (clientSocket.destroyed) {
          upstream.destroy();
          return;
        }
        established = true;
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
      });
      const cleanup = () => upstream.destroy();
      clientSocket.once('error', cleanup);
      clientSocket.once('close', cleanup);
      sockets.add(upstream);
      upstream.on('close', () => {
        sockets.delete(upstream);
        clientSocket.destroy();
      });
      upstream.on('error', () => {
        if (!established && !clientSocket.destroyed) {
          clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        } else {
          clientSocket.destroy();
        }
      });
    })().catch(() => {
      if (!clientSocket.destroyed) clientSocket.destroy();
    });
  });

  let port = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    port = (server.address() as { port: number }).port;
    if (!DENIED_PORTS.has(port)) break;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (attempt === 4) throw new Error('Unable to bind egress proxy outside NERV reserved ports.');
  }

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}
