// F-049-T05: the T01 gate (docs/decisions/eva-runner.md, "Required test gate") on the EVA-03 runner.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { runEva03Job, type Eva03LedgerEvent } from '../src/eva-runner.ts';

const isDarwinWithSandbox = process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec');
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
