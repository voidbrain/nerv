// F-049-T05: the T01 gate (docs/decisions/eva-runner.md, "Required test gate") on the EVA-03 runner.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSocket } from 'node:dgram';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runEva03Job, type Eva03LedgerEvent } from '../src/eva-runner.ts';

const isDarwinWithSandbox = process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec');
/** Drops the profile and runs the command as is: every confinement test must show its breach through it. */
const UNCONFINED = join(import.meta.dirname, 'fixtures', 'eva', 'unconfined-sandbox-exec');
const MODES = [
  { name: 'confined', sandboxExecPath: undefined },
  { name: 'unconfined fixture', sandboxExecPath: UNCONFINED },
] as const;
const DENIED = /^DENIED/;

/**
 * Runs `attempts` (CommonJS; each `t(name, fn)` records fn's value or "DENIED:<code>") in a job and returns what it
 * recorded. `wait` keeps the job up for asynchronous attempts that record themselves into `r`.
 */
async function probe(attempts: string, opts: { sandboxExecPath?: string; deniedReadPaths?: string[]; wait?: number }) {
  const code = [
    'const fs = require("node:fs"), net = require("node:net"), dgram = require("node:dgram"), dns = require("node:dns"), cp = require("node:child_process");',
    'const r = {};',
    'const t = (k, f) => { try { r[k] = String(f()); } catch (e) { r[k] = "DENIED:" + (e.code ?? e.status ?? e.message); } };',
    attempts,
    `setTimeout(() => { console.log(JSON.stringify(r)); process.exit(0); }, ${opts.wait ?? 0});`,
  ].join('\n');
  const result = await runEva03Job({
    jobId: 'gate',
    command: process.execPath,
    args: ['-e', code],
    timeoutMs: 15_000,
    ...(opts.sandboxExecPath ? { sandboxExecPath: opts.sandboxExecPath } : {}),
    ...(opts.deniedReadPaths ? { deniedReadPaths: opts.deniedReadPaths } : {}),
  });
  assert.equal(result.exitCode, 0, result.stderr);
  return JSON.parse(result.stdout.trim()) as Record<string, string>;
}
const scratch = (name: string) => realpathSync(mkdtempSync(join(tmpdir(), `nerv-gate-${name}-`)));
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const settle = () => new Promise((done) => setTimeout(done, 600));

/** A job that starts one child in its process group and one in its own session, prints both pids, then hangs. */
const HANGING_WITH_CHILDREN = [
  'const cp = require("node:child_process");',
  'const hang = ["-e", "setInterval(() => {}, 1000)"];',
  'const same = cp.spawn(process.execPath, hang, { stdio: "ignore" });',
  'const own = cp.spawn(process.execPath, hang, { stdio: "ignore", detached: true });',
  'own.unref();',
  'console.log(JSON.stringify({ same: same.pid, own: own.pid }));',
  'setInterval(() => {}, 1000);',
].join(' ');

describe('F-049-T05: EVA-03 gate', { skip: !isDarwinWithSandbox }, () => {
  for (const mode of MODES) {
    const confined = mode.name === 'confined';
    const outcome = confined ? 'refused' : 'succeeds through the unconfined fixture';
    const expect = (value: string | undefined, breach: RegExp | string, what: string) =>
      confined
        ? assert.match(value ?? '', DENIED, `${what} is refused`)
        : typeof breach === 'string'
          ? assert.equal(value, breach, `${what} succeeds without the profile`)
          : assert.match(value ?? '', breach, `${what} succeeds without the profile`);

    it(`1. filesystem escape (NERV state, keys, $HOME, writes outside, symlink and hardlink) ${outcome}`, async () => {
      const state = scratch('state'),
        outside = scratch('outside');
      writeFileSync(join(state, 'nerv.sqlite'), 'STATE-FIXTURE');
      writeFileSync(join(state, 'kaji.key'), 'KEY-FIXTURE');
      try {
        const db = JSON.stringify(join(state, 'nerv.sqlite')),
          key = JSON.stringify(join(state, 'kaji.key'));
        const r = await probe(
          [
            `t('state', () => fs.readFileSync(${db}, 'utf8'));`,
            `t('key', () => fs.readFileSync(${key}, 'utf8'));`,
            `t('home', () => fs.readdirSync(${JSON.stringify(process.env.HOME)}).length >= 0 ? 'LISTED' : '');`,
            `t('write', () => { fs.writeFileSync(${JSON.stringify(join(outside, 'planted'))}, 'x'); return 'WROTE'; });`,
            `t('symlink', () => { fs.symlinkSync(${db}, 'via-symlink'); return fs.readFileSync('via-symlink', 'utf8'); });`,
            `t('hardlink', () => { fs.linkSync(${key}, 'via-hardlink'); return fs.readFileSync('via-hardlink', 'utf8'); });`,
          ].join('\n'),
          { sandboxExecPath: mode.sandboxExecPath, deniedReadPaths: [state] },
        );
        expect(r.state, 'STATE-FIXTURE', 'reading NERV state');
        expect(r.key, 'KEY-FIXTURE', 'reading a key file');
        expect(r.home, 'LISTED', 'listing $HOME');
        expect(r.write, 'WROTE', 'writing outside the workspace');
        expect(r.symlink, 'STATE-FIXTURE', 'reading state through a symlink');
        expect(r.hardlink, 'KEY-FIXTURE', 'reading a key through a hardlink');
        assert.equal(existsSync(join(outside, 'planted')), !confined);
      } finally {
        rmSync(state, { recursive: true, force: true });
        rmSync(outside, { recursive: true, force: true });
      }
    });

    it(`2. network egress (TCP, UDP, DNS, a loopback port probe) ${outcome}`, async () => {
      const heard = { tcp: 0, udp: 0, dns: 0 };
      const tcp = createServer((s) => {
        heard.tcp++;
        s.end();
      });
      const udp = createSocket('udp4').on('message', () => heard.udp++);
      const dnsServer = createSocket('udp4').on('message', () => heard.dns++);
      await new Promise<void>((done) => tcp.listen(0, '127.0.0.1', done));
      await new Promise<void>((done) => udp.bind(0, '127.0.0.1', done));
      await new Promise<void>((done) => dnsServer.bind(0, '127.0.0.1', done));
      const port = (s: { address(): unknown }) => (s.address() as { port: number }).port;
      try {
        const r = await probe(
          [
            `const s = net.connect(${port(tcp)}, '127.0.0.1');`,
            `s.on('connect', () => { r.tcp = 'CONNECTED'; s.destroy(); }); s.on('error', (e) => { r.tcp = 'DENIED:' + e.code; });`,
            `const u = dgram.createSocket('udp4'); u.on('error', (e) => { r.udp = 'DENIED:' + e.code; });`,
            `u.send('x', ${port(udp)}, '127.0.0.1', (e) => { r.udp = e ? 'DENIED:' + e.code : 'SENT'; });`,
            `const res = new dns.Resolver({ timeout: 500, tries: 1 }); res.setServers(['127.0.0.1:${port(dnsServer)}']);`,
            // The fixture server never answers: whether the query left the job is what it counted, checked below.
            `res.resolve4('gate.invalid', () => {});`,
          ].join('\n'),
          { sandboxExecPath: mode.sandboxExecPath, wait: 1500 },
        );
        expect(r.tcp, 'CONNECTED', 'a TCP connection to a loopback port');
        assert.equal(heard.tcp > 0, !confined, 'the loopback listener saw a connection');
        assert.equal(heard.udp > 0, !confined, 'a UDP datagram arrived');
        assert.equal(heard.dns > 0, !confined, 'a DNS query arrived');
        if (confined) assert.match(r.udp ?? '', DENIED);
      } finally {
        tcp.close();
        udp.close();
        dnsServer.close();
      }
    });

    it(`3. credentials: environment secrets never reach the job; listing the Keychain ${outcome}`, async () => {
      const planted = { ANTHROPIC_API_KEY: 'sk-fixture', NERV_TOKEN: 'token-fixture', KAJI_KEY: 'kaji-fixture' };
      Object.assign(process.env, planted);
      try {
        const r = await probe(
          [
            `t('env', () => Object.keys(process.env).filter((k) => ${JSON.stringify(Object.keys(planted))}.includes(k)).join(',') || 'NONE');`,
            `t('keychain', () => cp.execFileSync('/usr/bin/security', ['list-keychains'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim() ? 'LISTED' : 'LISTED');`,
          ].join('\n'),
          { sandboxExecPath: mode.sandboxExecPath },
        );
        // The environment is the runner's own (buildEva03CleanEnv), not the profile's: clean in both modes.
        assert.equal(r.env, 'NONE');
        expect(r.keychain, 'LISTED', 'listing the Keychain');
      } finally {
        for (const k of Object.keys(planted)) delete process.env[k];
      }
    });

    it(`4. grader tampering (read hidden grader data, write grader outputs) ${outcome}`, async () => {
      const grader = scratch('grader');
      mkdirSync(join(grader, 'hidden'));
      mkdirSync(join(grader, 'out'));
      writeFileSync(join(grader, 'hidden', 'oracle.json'), '{"answer":42}');
      writeFileSync(join(grader, 'out', 'score.json'), '{"score":0}');
      try {
        const r = await probe(
          [
            `t('oracle', () => fs.readFileSync(${JSON.stringify(join(grader, 'hidden', 'oracle.json'))}, 'utf8'));`,
            `t('score', () => { fs.writeFileSync(${JSON.stringify(join(grader, 'out', 'score.json'))}, '{"score":100}'); return 'WRITTEN'; });`,
          ].join('\n'),
          { sandboxExecPath: mode.sandboxExecPath, deniedReadPaths: [join(grader, 'hidden')] },
        );
        expect(r.oracle, '{"answer":42}', 'reading the hidden oracle');
        expect(r.score, 'WRITTEN', 'writing the grader output');
        assert.equal(
          readFileSync(join(grader, 'out', 'score.json'), 'utf8'),
          confined ? '{"score":0}' : '{"score":100}',
        );
      } finally {
        rmSync(grader, { recursive: true, force: true });
      }
    });
  }

  for (const end of ['timeout', 'cancel'] as const) {
    it(`B-099: after a ${end} no process the job started survives, including one in its own session`, async () => {
      const events: Eva03LedgerEvent[] = [];
      const abort = new AbortController();
      const run = runEva03Job({
        jobId: `orphans-${end}`,
        command: process.execPath,
        args: ['-e', HANGING_WITH_CHILDREN],
        timeoutMs: end === 'timeout' ? 1500 : 30_000,
        signal: abort.signal,
        onLedgerEvent: (e) => events.push(e),
      });
      if (end === 'cancel') setTimeout(() => abort.abort(), 1500);
      const result = await run;
      const pids = JSON.parse(result.stdout.trim()) as { same: number; own: number };
      try {
        await settle();
        assert.equal(end === 'timeout' ? result.timedOut : result.cancelled, true);
        assert.equal(alive(pids.same), false, 'the child in the job’s process group is gone');
        assert.equal(alive(pids.own), false, 'the child in its own session is gone');
        assert.equal(events.at(-1)?.kind, end === 'timeout' ? 'eva03.timed_out' : 'eva03.cancelled');
        assert.equal(events.at(-1)?.rollbackClaimed, false);
      } finally {
        for (const pid of [pids.same, pids.own]) if (alive(pid)) process.kill(pid, 'SIGKILL');
      }
    });
  }
});
