// F-049-T13: EVA-03 job receipts, ledger events and the recovery join (decisions/eva-runner.md, test 6).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OWNER_SOURCE, Store } from '../src/store.ts';
import { EvaJobs, EvaLockedError, EvaReplayError, runEva03Durably } from '../src/eva-jobs.ts';
import { runEva03Job } from '../src/eva-runner.ts';

const isDarwinWithSandbox = process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec');
const evaKinds = (store: Store, sortieId: string) =>
  store.ledger
    .events(sortieId)
    .filter((e) => e.kind.startsWith('eva03.'))
    .map((e) => e.kind);

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'nerv-eva-jobs-'));
  const dbPath = join(home, 'nerv.sqlite');
  const store = new Store(dbPath);
  return {
    home,
    dbPath,
    store,
    jobs: new EvaJobs(store.db),
    sortie: () => store.ledger.openSortie(OWNER_SOURCE, 'eva job', 'trusted'),
    done: () => {
      store.close();
      rmSync(home, { recursive: true, force: true });
    },
  };
}

describe('F-049-T13: EVA-03 receipts and the recovery join', () => {
  it('a receipt comes before the job: a replay never runs, a held resource waits, an uncertain one stays held', () => {
    const f = fixture();
    try {
      const s = f.sortie();
      f.jobs.begin({ id: 'j1', sortieId: s, key: 'notes', hash: 'h' });
      assert.throws(() => f.jobs.begin({ id: 'j1', sortieId: s, key: 'other', hash: 'h' }), EvaReplayError);
      assert.throws(() => f.jobs.begin({ id: 'j2', sortieId: s, key: 'notes', hash: 'h' }), EvaLockedError);
      f.jobs.finish('j1', 'completed');
      f.jobs.begin({ id: 'j2', sortieId: s, key: 'notes', hash: 'h' });
      f.jobs.finish('j2', 'uncertain', 'timed out');
      assert.throws(
        () => f.jobs.begin({ id: 'j3', sortieId: s, key: 'notes', hash: 'h' }),
        (e: Error) => e instanceof EvaLockedError && /the owner reconciles it first/.test(e.message),
      );
      assert.throws(() => f.jobs.begin({ id: 'j1', sortieId: s, key: 'notes', hash: 'h' }), EvaReplayError);
    } finally {
      f.done();
    }
  });

  it('after a restart an interrupted job is uncertain and keeps its lock; a live runner’s job is left alone', () => {
    const f = fixture();
    try {
      const s = f.sortie();
      f.jobs.begin({ id: 'gone', sortieId: s, key: 'notes', hash: 'h' });
      f.jobs.begin({ id: 'live', sortieId: s, key: 'calendar', hash: 'h' });
      f.store.db.prepare("UPDATE eva_jobs SET runner=? WHERE id='gone'").run(999_001);
      f.store.db.prepare("UPDATE eva_jobs SET runner=? WHERE id='live'").run(999_002);
      const recovered = f.jobs.recover(f.store.ledger, new Date(), (pid) => pid === 999_002);
      assert.deepEqual(
        recovered.map((r) => [r.id, r.state]),
        [['gone', 'uncertain']],
      );
      assert.equal(f.jobs.receipt('live')?.state, 'running', 'another runner’s job is still running');
      assert.deepEqual(evaKinds(f.store, s), ['eva03.recovered']);
      assert.throws(() => f.jobs.begin({ id: 'next', sortieId: s, key: 'notes', hash: 'h' }), EvaLockedError);
      assert.throws(() => f.jobs.reconcile(f.store.ledger, 'gone', '  '), /Say what you confirmed/);
      assert.throws(() => f.jobs.reconcile(f.store.ledger, 'live', 'x'), /not uncertain/);
      const r = f.jobs.reconcile(f.store.ledger, 'gone', 'checked the notes: nothing was written');
      assert.equal(r.state, 'reconciled');
      assert.match(r.detail ?? '', /Reconciled: checked the notes/);
      f.jobs.begin({ id: 'next', sortieId: s, key: 'notes', hash: 'h' });
      const reconciled = f.store.ledger.events(s).find((e) => e.kind === 'eva03.reconciled');
      assert.deepEqual(reconciled?.payload, {
        jobId: 'gone',
        evaClass: 'eva-03',
        uncertainExternalEffect: true,
        rollbackClaimed: false,
        containment: 'best-effort',
        detail: 'Owner: checked the notes: nothing was written',
      });
    } finally {
      f.done();
    }
  });

  it(
    'the runner’s events land on the sortie; a timeout leaves the job uncertain with its lock',
    { skip: !isDarwinWithSandbox },
    async () => {
      const f = fixture();
      try {
        const s = f.sortie();
        const ok = await runEva03Durably({
          jobs: f.jobs,
          ledger: f.store.ledger,
          sortieId: s,
          jobId: 'quick',
          key: 'notes',
          hash: 'h',
          run: (onLedgerEvent) =>
            runEva03Job({ jobId: 'quick', command: process.execPath, args: ['-e', 'console.log(1)'], onLedgerEvent }),
        });
        assert.equal(ok.exitCode, 0, ok.stderr);
        assert.equal(f.jobs.receipt('quick')?.state, 'completed');
        const hung = await runEva03Durably({
          jobs: f.jobs,
          ledger: f.store.ledger,
          sortieId: s,
          jobId: 'hung',
          key: 'notes',
          hash: 'h',
          run: (onLedgerEvent) =>
            runEva03Job({
              jobId: 'hung',
              command: process.execPath,
              args: ['-e', 'setInterval(() => {}, 1000)'],
              timeoutMs: 300,
              onLedgerEvent,
            }),
        });
        assert.equal(hung.timedOut, true);
        assert.equal(f.jobs.receipt('hung')?.state, 'uncertain');
        assert.deepEqual(evaKinds(f.store, s), [
          'eva03.started',
          'eva03.completed',
          'eva03.started',
          'eva03.timed_out',
        ]);
        const timedOut = f.store.ledger.events(s).find((e) => e.kind === 'eva03.timed_out');
        assert.equal((timedOut?.payload as { uncertainExternalEffect: boolean }).uncertainExternalEffect, true);
        assert.equal((timedOut?.payload as { rollbackClaimed: boolean }).rollbackClaimed, false);
        assert.throws(() => f.jobs.begin({ id: 'after', sortieId: s, key: 'notes', hash: 'h' }), EvaLockedError);
      } finally {
        f.done();
      }
    },
  );

  it(
    'recovery join: the runner is killed mid-job; on restart the receipt and lock remain, a replay is refused, and it reconciles cleanly',
    { skip: !isDarwinWithSandbox, timeout: 30_000 },
    async () => {
      const f = fixture();
      f.store.close();
      let jobPid = 0;
      try {
        const runner = spawn(process.execPath, ['test/fixtures/eva/crash-runner.ts', f.dbPath, 'crash-1'], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let out = '';
        runner.stderr.on('data', (c: Buffer) => {
          const m = /"jobPid":(\d+)/.exec(String(c));
          if (m) jobPid = Number(m[1]);
        });
        const started = await new Promise<{ sortieId: string }>((resolve, reject) => {
          runner.stdout.on('data', (c: Buffer) => {
            out += String(c);
            const line = out.split('\n').find((l) => l.startsWith('{'));
            if (line) resolve(JSON.parse(line) as { sortieId: string });
          });
          runner.on('exit', (code) => reject(new Error(`runner exited early (${code}): ${out}`)));
        });
        runner.kill('SIGKILL');
        await new Promise((done) => runner.once('exit', done));

        const store = new Store(f.dbPath);
        try {
          const jobs = new EvaJobs(store.db);
          assert.equal(jobs.receipt('crash-1')?.state, 'running', 'the receipt survived the crash');
          const recovered = jobs.recover(store.ledger);
          assert.deepEqual(
            recovered.map((r) => r.id),
            ['crash-1'],
          );
          assert.equal(jobs.receipt('crash-1')?.state, 'uncertain');
          assert.deepEqual(evaKinds(store, started.sortieId), ['eva03.started', 'eva03.recovered']);
          assert.throws(
            () => jobs.begin({ id: 'crash-1', sortieId: started.sortieId, key: 'fixture:resource', hash: 'fixture' }),
            EvaReplayError,
            'a duplicate replay never runs',
          );
          assert.throws(
            () => jobs.begin({ id: 'crash-2', sortieId: started.sortieId, key: 'fixture:resource', hash: 'fixture' }),
            EvaLockedError,
            'the uncertain lock holds',
          );
          assert.deepEqual(jobs.recover(store.ledger), [], 'recovery runs once');
          jobs.reconcile(store.ledger, 'crash-1', 'the fixture job writes nothing');
          jobs.begin({ id: 'crash-2', sortieId: started.sortieId, key: 'fixture:resource', hash: 'fixture' });
        } finally {
          store.close();
        }
      } finally {
        if (jobPid) spawnSync('/bin/kill', ['-9', String(jobPid)]);
        rmSync(f.home, { recursive: true, force: true });
      }
    },
  );
});
