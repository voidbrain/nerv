// F-049-T07: EVA-00, EVA-01 and EVA-02 on the runner, each class's profile proved against its own limits, and each
// limit shown to fail through a sandbox-exec that drops the profile (test/fixtures/eva/unconfined-sandbox-exec).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EVA_DENIED_LOCAL_PORTS, buildEvaSeatbeltProfile, runEvaJob, type EvaJobEvent } from '../src/eva-runner.ts';
import type { EvaClass } from '../src/pilots.ts';

const isDarwinWithSandbox = process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec');
const UNCONFINED = join(import.meta.dirname, 'fixtures', 'eva', 'unconfined-sandbox-exec');
const scratch = (name: string) => realpathSync(mkdtempSync(join(tmpdir(), `nerv-class-${name}-`)));
async function listener(host = '127.0.0.1'): Promise<{ server: Server; port: number; heard: () => number }> {
  let n = 0;
  const server = createServer((s) => {
    n++;
    s.end();
  });
  await new Promise<void>((done) => server.listen(0, host, done));
  return { server, port: (server.address() as { port: number }).port, heard: () => n };
}

/** Runs attempts in a job of `evaClass`; each `t(name, fn)` records fn's value or "DENIED:<code>". */
async function probe(
  evaClass: EvaClass,
  attempts: string,
  opts: { unconfined?: boolean; writablePaths?: string[]; egress?: { localhost?: number[]; anyHost?: number[] } },
) {
  const events: EvaJobEvent[] = [];
  const code = [
    'const fs = require("node:fs"), net = require("node:net");',
    'const r = {};',
    'const t = (k, f) => { try { r[k] = String(f()); } catch (e) { r[k] = "DENIED:" + (e.code ?? e.message); } };',
    'const connect = (k, port, host = "127.0.0.1") => { const s = net.connect(port, host); s.on("connect", () => { r[k] = "CONNECTED"; s.destroy(); }); s.on("error", (e) => { r[k] = "DENIED:" + e.code; }); };',
    attempts,
    'setTimeout(() => { console.log(JSON.stringify(r)); process.exit(0); }, 800);',
  ].join('\n');
  const result = await runEvaJob({
    jobId: `class-${evaClass}`,
    evaClass,
    command: process.execPath,
    args: ['-e', code],
    timeoutMs: 15_000,
    ...(opts.unconfined ? { sandboxExecPath: UNCONFINED } : {}),
    ...(opts.writablePaths ? { writablePaths: opts.writablePaths } : {}),
    ...(opts.egress ? { egress: opts.egress } : {}),
    onEvent: (e) => events.push(e),
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(
    events.map((e) => [e.phase, e.evaClass]),
    [
      ['started', evaClass],
      ['completed', evaClass],
    ],
  );
  assert.equal(result.workspaceDiscarded, true);
  return JSON.parse(result.stdout.trim()) as Record<string, string>;
}

describe('F-049-T07: each class gets only what its profile allows', () => {
  it('a class is refused network or writes it may not have, and no class reaches NERV’s own ports', () => {
    const base = { workspaceDir: '/tmp/w', hostHomeDir: '/tmp/h' };
    for (const cls of ['eva-03', 'eva-00'] as const) {
      assert.throws(() => buildEvaSeatbeltProfile(cls, { ...base, egress: { localhost: [8080] } }), /has no network/);
      assert.throws(() => buildEvaSeatbeltProfile(cls, { ...base, writablePaths: ['/tmp/x'] }), /own workspace/);
    }
    assert.throws(
      () => buildEvaSeatbeltProfile('eva-01', { ...base, egress: { anyHost: [443] } }),
      /only to localhost ports/,
    );
    for (const port of EVA_DENIED_LOCAL_PORTS)
      assert.throws(() => buildEvaSeatbeltProfile('eva-02', { ...base, egress: { anyHost: [port] } }), /NERV's own/);
    assert.throws(() => buildEvaSeatbeltProfile('eva-02', { ...base, egress: { anyHost: [0] } }), /1 to 65535/);
    // Every class: no Keychain, no inbound connections, NERV's ports denied, and only granted ports open.
    for (const cls of ['eva-03', 'eva-00', 'eva-01', 'eva-02'] as const) {
      const p = buildEvaSeatbeltProfile(cls, base);
      assert.match(p, /\(deny mach-lookup \(global-name "com\.apple\.SecurityServer"\)/);
      assert.match(p, /\(deny network-inbound\)/);
      assert.match(p, /\(deny network-outbound \(remote ip "localhost:4317"\)\)/);
      assert.doesNotMatch(p, /\(allow network-outbound\)/, 'never all of the network');
    }
  });

  it('a granted path never re-opens $HOME, NERV state or a denied path (review of PR #558)', () => {
    const home = scratch('home');
    const state = join(home, '.nerv');
    const secret = scratch('secret');
    try {
      const base = { workspaceDir: '/tmp/w', hostHomeDir: home, nervStateDir: state, deniedReadPaths: [secret] };
      for (const w of [home, state, '/', join(home, 'Documents'), secret, join(secret, 'inner')])
        assert.throws(
          () => buildEvaSeatbeltProfile('eva-01', { ...base, writablePaths: [w] }),
          /no EVA class writes in \$HOME, NERV state or a denied path/,
          w,
        );
      for (const r of ['/', state, join(state, 'keys'), secret])
        assert.throws(
          () => buildEvaSeatbeltProfile('eva-03', { ...base, readOnlyPaths: [r] }),
          /re-opens NERV state or a denied path/,
          r,
        );
      // A read-only path inside $HOME (the checkout, for instance) is still allowed, and state stays denied after it.
      const p = buildEvaSeatbeltProfile('eva-03', { ...base, readOnlyPaths: [join(home, 'repo')] });
      assert.ok(
        p.lastIndexOf(`(deny file-read* (subpath "${join(realpathSync(home), '.nerv')}"))`) >
          p.lastIndexOf('(allow file-read*'),
        'state is denied after every allow',
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(secret, { recursive: true, force: true });
    }
  });

  for (const unconfined of [false, true]) {
    const how = unconfined ? 'get through the unconfined fixture' : 'are refused';
    it(`EVA-00: network and writes outside its workspace ${how}`, { skip: !isDarwinWithSandbox }, async () => {
      const net = await listener();
      const outside = scratch('outside');
      try {
        const r = await probe(
          'eva-00',
          [
            `t('workspace', () => { fs.writeFileSync('mine.txt', 'x'); return 'WROTE'; });`,
            `t('outside', () => { fs.writeFileSync(${JSON.stringify(join(outside, 'x'))}, 'x'); return 'WROTE'; });`,
            `connect('tcp', ${net.port});`,
          ].join('\n'),
          { unconfined },
        );
        assert.equal(r.workspace, 'WROTE', 'its own workspace is writable');
        assert.equal(r.outside === 'WROTE', unconfined);
        assert.equal(r.tcp === 'CONNECTED', unconfined);
        assert.equal(net.heard() > 0, unconfined);
      } finally {
        net.server.close();
        rmSync(outside, { recursive: true, force: true });
      }
    });

    it(
      `EVA-01: only its granted localhost port and granted path; any other port or path ${how}`,
      { skip: !isDarwinWithSandbox },
      async () => {
        const proxy = await listener(),
          other = await listener('::');
        const granted = scratch('granted'),
          outside = scratch('outside');
        try {
          const r = await probe(
            'eva-01',
            [
              `t('granted', () => { fs.writeFileSync(${JSON.stringify(join(granted, 'out.txt'))}, 'ok'); return 'WROTE'; });`,
              `t('outside', () => { fs.writeFileSync(${JSON.stringify(join(outside, 'x'))}, 'x'); return 'WROTE'; });`,
              `connect('proxy', ${proxy.port});`,
              `connect('other', ${other.port});`,
              `connect('other6', ${other.port}, '::1');`,
            ].join('\n'),
            { unconfined, writablePaths: [granted], egress: { localhost: [proxy.port] } },
          );
          assert.equal(r.granted, 'WROTE');
          assert.equal(readFileSync(join(granted, 'out.txt'), 'utf8'), 'ok');
          assert.equal(r.proxy, 'CONNECTED', 'the granted localhost port (its egress proxy) is reachable');
          assert.equal(r.outside === 'WROTE', unconfined);
          assert.equal(r.other === 'CONNECTED', unconfined);
          assert.equal(r.other6 === 'CONNECTED', unconfined, 'IPv6 loopback on a port it was not granted');
          assert.equal(other.heard() > 0, unconfined);
        } finally {
          proxy.server.close();
          other.server.close();
          rmSync(granted, { recursive: true, force: true });
          rmSync(outside, { recursive: true, force: true });
        }
      },
    );

    it(
      `EVA-02: its granted ports on any host and its granted path; others ${how}`,
      { skip: !isDarwinWithSandbox },
      async () => {
        const allowed = await listener(),
          other = await listener();
        const granted = scratch('granted');
        try {
          const r = await probe(
            'eva-02',
            [
              `t('granted', () => { fs.writeFileSync(${JSON.stringify(join(granted, 'out.txt'))}, 'ok'); return 'WROTE'; });`,
              `t('home', () => fs.readdirSync(${JSON.stringify(process.env.HOME)}).length >= 0 ? 'LISTED' : '');`,
              `connect('allowed', ${allowed.port});`,
              `connect('other', ${other.port});`,
            ].join('\n'),
            { unconfined, writablePaths: [granted], egress: { anyHost: [allowed.port] } },
          );
          assert.equal(r.granted, 'WROTE');
          assert.equal(r.allowed, 'CONNECTED');
          assert.equal(r.home === 'LISTED', unconfined, 'not even EVA-02 reads $HOME');
          assert.equal(r.other === 'CONNECTED', unconfined);
          assert.equal(other.heard() > 0, unconfined);
        } finally {
          allowed.server.close();
          other.server.close();
          rmSync(granted, { recursive: true, force: true });
        }
      },
    );
  }
});
