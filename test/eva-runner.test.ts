import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EvaSandboxUnavailableError,
  runEva03Job,
  runToolsProcessInEva03,
  type Eva03LedgerEvent,
} from '../src/eva-runner.ts';

const isDarwinWithSandbox = process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec');

describe('F-049-T04: EVA-03 instance per job', () => {
  it('fails closed when sandbox-exec is missing', async () => {
    await assert.rejects(
      () =>
        runEva03Job({
          jobId: 'missing-sandbox',
          command: process.execPath,
          args: ['-e', 'console.log("hi")'],
          sandboxExecPath: '/nonexistent/sandbox-exec',
        }),
      EvaSandboxUnavailableError,
    );
  });

  it(
    'creates and discards a fresh EVA-03 instance per job with no state carried, stripped env, blocked network/reads, and ledger events',
    { skip: !isDarwinWithSandbox },
    async () => {
      const secretDir = realpathSync(mkdtempSync(join(tmpdir(), 'nerv-eva03-secret-')));
      const secretFile = join(secretDir, 'token.txt');
      writeFileSync(secretFile, 'top-secret-fixture', 'utf8');

      try {
        const events1: Eva03LedgerEvent[] = [];
        const r1 = await runEva03Job({
          jobId: 'job-1',
          command: process.execPath,
          args: [
            '-e',
            [
              'const fs = require("node:fs");',
              'fs.writeFileSync("ephemeral.txt", "job1-state");',
              'let readBlocked = false;',
              `try { fs.readFileSync(${JSON.stringify(secretFile)}, "utf8"); } catch { readBlocked = true; }`,
              'console.log(JSON.stringify({ cwd: process.cwd(), hasEnvSecret: Boolean(process.env.ANTHROPIC_API_KEY), readBlocked }));',
            ].join(' '),
          ],
          deniedReadPaths: [secretDir],
          onLedgerEvent: (e) => events1.push(e),
        });

        assert.equal(r1.exitCode, 0, r1.stderr);
        assert.equal(r1.workspaceDiscarded, true);
        assert.equal(r1.rollbackClaimed, false);
        const parsed1 = JSON.parse(r1.stdout.trim()) as {
          cwd: string;
          hasEnvSecret: boolean;
          readBlocked: boolean;
        };
        assert.equal(parsed1.hasEnvSecret, false);
        assert.equal(parsed1.readBlocked, true);
        assert.equal(existsSync(parsed1.cwd), false, 'ephemeral workspace must be discarded');
        assert.deepEqual(
          events1.map((e) => e.kind),
          ['eva03.started', 'eva03.completed'],
        );

        // Second job has a fresh workspace and does not see job-1's ephemeral.txt.
        const r2 = await runEva03Job({
          jobId: 'job-2',
          command: process.execPath,
          args: [
            '-e',
            'const fs = require("node:fs"); console.log(JSON.stringify({ carried: fs.existsSync("ephemeral.txt") }));',
          ],
        });
        assert.equal(r2.exitCode, 0, r2.stderr);
        assert.deepEqual(JSON.parse(r2.stdout.trim()), { carried: false });

        // Network egress is denied.
        const rNet = await runEva03Job({
          jobId: 'job-net',
          command: process.execPath,
          args: [
            '-e',
            [
              'const net = require("node:net");',
              'const s = net.connect(80, "127.0.0.1");',
              's.on("error", (e) => { console.log(e.code || e.message); process.exit(0); });',
              's.on("connect", () => { console.log("CONNECTED"); process.exit(2); });',
            ].join(' '),
          ],
        });
        assert.equal(rNet.exitCode, 0, rNet.stderr);
        assert.notEqual(rNet.stdout.trim(), 'CONNECTED');

        // Timeout records failed/timed_out ledger event without claiming rollback.
        const timeoutEvents: Eva03LedgerEvent[] = [];
        const rTimeout = await runEva03Job({
          jobId: 'job-timeout',
          command: process.execPath,
          args: ['-e', 'setInterval(() => {}, 1000);'],
          timeoutMs: 150,
          onLedgerEvent: (e) => timeoutEvents.push(e),
        });
        assert.equal(rTimeout.timedOut, true);
        assert.equal(rTimeout.workspaceDiscarded, true);
        assert.equal(rTimeout.rollbackClaimed, false);
        assert.equal(timeoutEvents[1]?.kind, 'eva03.timed_out');
        assert.equal(timeoutEvents[1]?.uncertainExternalEffect, true);
        assert.equal(timeoutEvents[1]?.rollbackClaimed, false);

        // Spawning tools-process.ts inside an ephemeral EVA-03 instance discards cleanly.
        const rTools = await runToolsProcessInEva03({
          jobId: 'tools-eva03',
          repoRoot: process.cwd(),
          timeoutMs: 200,
        });
        assert.equal(rTools.workspaceDiscarded, true);
        assert.equal(rTools.rollbackClaimed, false);
      } finally {
        rmSync(secretDir, { recursive: true, force: true });
      }
    },
  );
});
