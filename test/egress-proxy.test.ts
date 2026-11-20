import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer, request as httpRequest, type Server as HttpServer } from 'node:http';
import { createServer as createNetServer, connect as netConnect, type Server as NetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readScrolls } from '../src/config.ts';
import { isBlockedEgressIp, startEgressProxy, type EgressDecision } from '../src/egress-proxy.ts';
import { EvaSandboxUnavailableError, runEvaJob } from '../src/eva-runner.ts';
import { parseEgressDestination, validatePolicy } from '../src/policy.ts';

const isDarwinWithSandbox = process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec');
const UNCONFINED = join(import.meta.dirname, 'fixtures', 'eva', 'unconfined-sandbox-exec');

async function startNeutralHttpServer(
  handler: (url: string, res: import('node:http').ServerResponse) => void,
): Promise<{ server: HttpServer; port: number; hits: () => number; close: () => Promise<void> }> {
  let count = 0;
  const server = createHttpServer((req, res) => {
    count += 1;
    handler(req.url ?? '/', res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return {
    server,
    port,
    hits: () => count,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function startNeutralTcpServer(): Promise<{
  server: NetServer;
  port: number;
  hits: () => number;
  close: () => Promise<void>;
}> {
  let count = 0;
  const server = createNetServer((socket) => {
    count += 1;
    socket.end('OK');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return {
    server,
    port,
    hits: () => count,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function viaHttpProxy(
  proxyPort: number,
  targetUrl: string,
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: proxyPort,
        method: 'GET',
        path: targetUrl,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function viaConnectProxy(proxyPort: number, authority: string): Promise<{ statusLine: string; payload: string }> {
  return new Promise((resolve, reject) => {
    const sock = netConnect(proxyPort, '127.0.0.1', () => {
      sock.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
    });
    const chunks: Buffer[] = [];
    sock.on('data', (c: Buffer) => chunks.push(c));
    sock.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const [head, ...rest] = text.split('\r\n\r\n');
      resolve({ statusLine: head.split('\r\n')[0] ?? '', payload: rest.join('\r\n\r\n') });
    });
    sock.on('error', reject);
  });
}

describe('F-027-T02: Scrolls egress validation and proxy enforcement', () => {
  it('validates Scrolls egressAllow with default-deny and rejects wildcards, metadata, and NERV ports', () => {
    const def = validatePolicy({});
    assert.deepEqual(def.egressAllow, []);

    const valid = validatePolicy({
      egressAllow: ['api.example.com', 'api.example.com:8443', '127.0.0.1:8080', '[::1]:9090'],
    });
    assert.equal(valid.egressAllow?.length, 4);
    assert.deepEqual(parseEgressDestination('API.Example.COM'), { host: 'api.example.com', port: 443 });

    for (const bad of [
      '',
      '*.example.com',
      'https://api.example.com',
      'api.example.com/path',
      'user@api.example.com',
      '169.254.169.254:80',
      'metadata.google.internal',
      '127.0.0.1:4317',
      'localhost:4319',
      'api.example.com:0',
      'api.example.com:70000',
      '[0:0:0:0:0:ffff:169.254.169.254]:80',
      '[::ffff:169.254.169.254]:80',
      '[::169.254.169.254]:80',
      '[fe81::1]:80',
      '[fd00:0ec2::254]:80',
      '[0:0:0:0:0:0:0:0]:80',
      '2852039166:80',
      '0251.0376.0251.0376:80',
      '::ffff:169.254.169.254',
    ]) {
      assert.throws(() => validatePolicy({ egressAllow: [bad] }), `Expected rejection for ${bad}`);
    }
    assert.throws(() => validatePolicy({ egressAllow: null as unknown as string[] }));
    assert.throws(() => validatePolicy({ localOnly: null as unknown as string[] }));
  });

  it('enforces default-deny and allowlisted HTTP and CONNECT traffic without leaking to denied servers', async () => {
    const allowedHttp = await startNeutralHttpServer((url, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`allowed:${url}`);
    });
    const deniedHttp = await startNeutralHttpServer((_url, res) => {
      res.writeHead(200);
      res.end('should-never-run');
    });
    const allowedTcp = await startNeutralTcpServer();
    const deniedTcp = await startNeutralTcpServer();

    const emptyProxy = await startEgressProxy({ allowedDestinations: [] });
    const decisions: EgressDecision[] = [];
    const allowProxy = await startEgressProxy({
      allowedDestinations: [`127.0.0.1:${allowedHttp.port}`, `127.0.0.1:${allowedTcp.port}`],
      onDecision: (d) => decisions.push(d),
    });

    try {
      const rEmpty = await viaHttpProxy(emptyProxy.port, `http://127.0.0.1:${allowedHttp.port}/hello`);
      assert.equal(rEmpty.status, 403);
      assert.equal(allowedHttp.hits(), 0);

      const rAllowed = await viaHttpProxy(allowProxy.port, `http://127.0.0.1:${allowedHttp.port}/ok`);
      assert.equal(rAllowed.status, 200);
      assert.equal(rAllowed.body, 'allowed:/ok');
      assert.equal(allowedHttp.hits(), 1);

      const rDenied = await viaHttpProxy(allowProxy.port, `http://127.0.0.1:${deniedHttp.port}/secret`);
      assert.equal(rDenied.status, 403);
      assert.equal(deniedHttp.hits(), 0, 'denied HTTP server must receive zero traffic');

      const cAllowed = await viaConnectProxy(allowProxy.port, `127.0.0.1:${allowedTcp.port}`);
      assert.match(cAllowed.statusLine, /^HTTP\/1\.1 200/);
      assert.equal(cAllowed.payload, 'OK');
      assert.equal(allowedTcp.hits(), 1);

      const cDenied = await viaConnectProxy(allowProxy.port, `127.0.0.1:${deniedTcp.port}`);
      assert.match(cDenied.statusLine, /^HTTP\/1\.1 403/);
      assert.equal(deniedTcp.hits(), 0, 'denied TCP server must receive zero traffic');

      assert.equal(decisions.filter((d) => !d.allowed).length, 2);
      assert.equal(decisions.filter((d) => d.allowed).length, 2);
    } finally {
      await emptyProxy.close();
      await allowProxy.close();
      await allowedHttp.close();
      await deniedHttp.close();
      await allowedTcp.close();
      await deniedTcp.close();
    }
  });

  it('blocks HTTP redirects to denied destinations and metadata addresses', async () => {
    const denied = await startNeutralHttpServer((_url, res) => {
      res.writeHead(200);
      res.end('leaked');
    });
    const redirector = await startNeutralHttpServer((url, res) => {
      if (url === '/to-denied') {
        res.writeHead(302, { location: `http://127.0.0.1:${denied.port}/steal` });
        res.end();
        return;
      }
      if (url === '/to-metadata') {
        res.writeHead(301, { location: 'http://169.254.169.254/latest/meta-data/' });
        res.end();
        return;
      }
      if (url === '/to-ftp') {
        res.writeHead(302, { location: `ftp://127.0.0.1:${redirector.port}/file` });
        res.end();
        return;
      }
      res.writeHead(302, { location: '/final' });
      res.end();
    });
    const proxy = await startEgressProxy({
      allowedDestinations: [`127.0.0.1:${redirector.port}`],
    });
    try {
      const r1 = await viaHttpProxy(proxy.port, `http://127.0.0.1:${redirector.port}/to-denied`);
      assert.equal(r1.status, 403);
      assert.equal(r1.headers['x-nerv-egress-denied'], 'redirect');
      assert.equal(denied.hits(), 0);

      const r2 = await viaHttpProxy(proxy.port, `http://127.0.0.1:${redirector.port}/to-metadata`);
      assert.equal(r2.status, 403);
      assert.equal(r2.headers['x-nerv-egress-denied'], 'redirect');

      const rFtp = await viaHttpProxy(proxy.port, `http://127.0.0.1:${redirector.port}/to-ftp`);
      assert.equal(rFtp.status, 403);
      assert.equal(rFtp.headers['x-nerv-egress-denied'], 'redirect');

      const r3 = await viaHttpProxy(proxy.port, `http://127.0.0.1:${redirector.port}/to-self`);
      assert.equal(r3.status, 302);
    } finally {
      await proxy.close();
      await redirector.close();
      await denied.close();
    }
  });

  it('blocks DNS rebinding across IPv4, IPv4-mapped IPv6, NAT64, 6to4, and non-canonical IPv6', async () => {
    for (const [ip, allowLoopback] of [
      ['169.254.169.254', true],
      ['10.0.0.1', true],
      ['192.168.1.1', true],
      ['fe80::1', true],
      ['fe81::1', true],
      ['0:0:0:0:0:ffff:169.254.169.254', true],
      ['::169.254.169.254', true],
      ['64:ff9b::169.254.169.254', false],
      ['2002:a9fe:a9fe::1', false],
      ['0:0:0:0:0:ffff:127.0.0.1', false],
      ['0:0::1', false],
      ['127.0.0.1', false],
    ] as const) {
      assert.ok(isBlockedEgressIp(ip, allowLoopback), `Expected ${ip} (allowLoopback=${allowLoopback}) to be blocked`);
    }
    assert.equal(isBlockedEgressIp('127.0.0.1', true), null);
    assert.equal(isBlockedEgressIp('0:0:0:0:0:0:0:1', true), null);

    const localTarget = await startNeutralHttpServer((_u, res) => {
      res.writeHead(200);
      res.end('rebound');
    });
    const proxy = await startEgressProxy({
      allowedDestinations: [
        `rebind.example:${localTarget.port}`,
        `rebind6.example:${localTarget.port}`,
        `meta.example:80`,
      ],
      lookup: async (host) => {
        if (host === 'rebind.example') return [{ address: '127.0.0.1', family: 4 }];
        if (host === 'rebind6.example') return [{ address: '0:0:0:0:0:ffff:127.0.0.1', family: 6 }];
        if (host === 'meta.example') return [{ address: '169.254.169.254', family: 4 }];
        return [];
      },
    });
    try {
      const r1 = await viaHttpProxy(proxy.port, `http://rebind.example:${localTarget.port}/`);
      assert.equal(r1.status, 403);
      assert.equal(localTarget.hits(), 0);

      const c6 = await viaConnectProxy(proxy.port, `rebind6.example:${localTarget.port}`);
      assert.match(c6.statusLine, /^HTTP\/1\.1 403/);
      assert.equal(localTarget.hits(), 0);

      const r2 = await viaHttpProxy(proxy.port, 'http://meta.example:80/latest/meta-data/');
      assert.equal(r2.status, 403);
    } finally {
      await proxy.close();
      await localTarget.close();
    }
  });

  it('does not dial upstream when CONNECT client aborts during DNS lookup', async () => {
    const target = await startNeutralTcpServer();
    let releaseLookup!: () => void;
    const lookupGate = new Promise<void>((resolve) => {
      releaseLookup = resolve;
    });
    const proxy = await startEgressProxy({
      allowedDestinations: [`slow.example:${target.port}`],
      lookup: async () => {
        await lookupGate;
        return [{ address: '93.184.216.34', family: 4 }];
      },
    });
    try {
      await new Promise<void>((resolve) => {
        const sock = netConnect(proxy.port, '127.0.0.1', () => {
          sock.write(`CONNECT slow.example:${target.port} HTTP/1.1\r\nHost: slow.example:${target.port}\r\n\r\n`);
          setTimeout(() => {
            sock.destroy();
            resolve();
          }, 20);
        });
      });
      releaseLookup();
      await new Promise((resolve) => setTimeout(resolve, 40));
      assert.equal(target.hits(), 0);
    } finally {
      await proxy.close();
      await target.close();
    }
  });

  it('fails closed when sandbox binary is missing or when EVA-03 is given egress destinations', async () => {
    await assert.rejects(
      () =>
        runEvaJob({
          jobId: 'missing-sandbox',
          evaClass: 'eva-01',
          command: process.execPath,
          args: ['-e', 'process.exit(0)'],
          sandboxExecPath: '/nonexistent/sandbox-exec',
          bwrapPath: '/nonexistent/bwrap',
          scrollsEgressAllow: [],
        }),
      EvaSandboxUnavailableError,
    );

    if (isDarwinWithSandbox) {
      await assert.rejects(
        () =>
          runEvaJob({
            jobId: 'eva03-egress',
            evaClass: 'eva-03',
            command: process.execPath,
            args: ['-e', 'process.exit(0)'],
            scrollsEgressAllow: ['api.example.com'],
          }),
        /has no network/,
      );
      await assert.rejects(
        () =>
          runEvaJob({
            jobId: 'eva02-raw-bypass',
            evaClass: 'eva-02',
            command: process.execPath,
            args: ['-e', 'process.exit(0)'],
            egress: { anyHost: [443] },
            scrollsEgressAllow: ['api.example.com'],
          }),
        /cannot be combined with raw egress/,
      );
    }
    if (process.platform === 'linux' && existsSync('/usr/bin/bwrap')) {
      await assert.rejects(
        () =>
          runEvaJob({
            jobId: 'linux-eva01-egress',
            evaClass: 'eva-01',
            command: process.execPath,
            args: ['-e', 'process.exit(0)'],
            scrollsEgressAllow: [],
          }),
        EvaSandboxUnavailableError,
      );
    }
  });

  it(
    'join: EVA-01 sandbox enforces Scrolls egressAllow from scrolls.json for proxy, direct sockets, and DNS',
    { skip: !isDarwinWithSandbox },
    async () => {
      const home = mkdtempSync(join(tmpdir(), 'nerv-scrolls-egress-'));
      const allowed = await startNeutralHttpServer((_u, res) => {
        res.writeHead(200);
        res.end('ok-from-allowed');
      });
      const denied = await startNeutralHttpServer((_u, res) => {
        res.writeHead(200);
        res.end('should-never-reach');
      });
      try {
        const scrollsPath = join(home, 'scrolls.json');
        writeFileSync(scrollsPath, JSON.stringify({ egressAllow: [`127.0.0.1:${allowed.port}`] }), { mode: 0o600 });
        chmodSync(scrollsPath, 0o600);
        const scrolls = readScrolls(home);

        const script = [
          'const http = require("node:http"), net = require("node:net"), dns = require("node:dns");',
          'const proxy = new URL(process.env.HTTP_PROXY);',
          'const out = {};',
          'function getViaProxy(target) {',
          '  return new Promise((res) => {',
          '    const req = http.request({ host: proxy.hostname, port: Number(proxy.port), path: target, method: "GET" }, (r) => {',
          '      let b = ""; r.on("data", (c) => b += c); r.on("end", () => res({ status: r.statusCode, body: b }));',
          '    });',
          '    req.on("error", (e) => res({ err: e.code || e.message }));',
          '    req.end();',
          '  });',
          '}',
          'function directSocket(port) {',
          '  return new Promise((res) => {',
          '    const s = net.connect(port, "127.0.0.1");',
          '    s.on("connect", () => { s.destroy(); res("CONNECTED"); });',
          '    s.on("error", (e) => res("DENIED:" + e.code));',
          '  });',
          '}',
          'function dnsProbe() {',
          '  return new Promise((res) => {',
          '    dns.lookup("example.com", (e) => res(e ? "DENIED:" + e.code : "RESOLVED"));',
          '  });',
          '}',
          `(async () => {`,
          `  out.allowed = await getViaProxy("http://127.0.0.1:${allowed.port}/hi");`,
          `  out.deniedProxy = await getViaProxy("http://127.0.0.1:${denied.port}/bye");`,
          `  out.directDenied = await directSocket(${denied.port});`,
          `  out.dns = await dnsProbe();`,
          '  console.log(JSON.stringify(out));',
          '})();',
        ].join('\n');

        const confined = await runEvaJob({
          jobId: 'scrolls-join-confined',
          evaClass: 'eva-01',
          command: process.execPath,
          args: ['-e', script],
          timeoutMs: 15_000,
          scrollsEgressAllow: scrolls.policy.egressAllow,
        });
        assert.equal(confined.exitCode, 0, confined.stderr);
        const parsed = JSON.parse(confined.stdout.trim()) as {
          allowed: { status: number; body: string };
          deniedProxy: { status: number };
          directDenied: string;
          dns: string;
        };
        assert.equal(parsed.allowed.status, 200);
        assert.equal(parsed.allowed.body, 'ok-from-allowed');
        assert.equal(parsed.deniedProxy.status, 403);
        assert.match(parsed.directDenied, /^DENIED:/);
        assert.match(parsed.dns, /^DENIED:/);
        assert.equal(denied.hits(), 0, 'denied server must receive zero traffic from confined EVA-01');

        // Prove through the unconfined fixture that Seatbelt is what blocked the direct socket.
        const unconfined = await runEvaJob({
          jobId: 'scrolls-join-unconfined',
          evaClass: 'eva-01',
          command: process.execPath,
          args: ['-e', script],
          timeoutMs: 15_000,
          sandboxExecPath: UNCONFINED,
          scrollsEgressAllow: scrolls.policy.egressAllow,
        });
        assert.equal(unconfined.exitCode, 0, unconfined.stderr);
        const unconfinedParsed = JSON.parse(unconfined.stdout.trim()) as { directDenied: string };
        assert.equal(unconfinedParsed.directDenied, 'CONNECTED');
      } finally {
        await allowed.close();
        await denied.close();
        rmSync(home, { recursive: true, force: true });
      }
    },
  );
});
