import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { serviceFixture } from './mac-service-fixture.ts';
import {
  applyService,
  compatibleServiceRevision,
  macServiceAdapter,
  planService,
  recoverServiceUpdate,
  releaseObservedService,
  serviceReceipt,
  type ServicePlan,
  type ServiceReceipt,
} from '../src/node-lifecycle-execution.ts';
import { lifecycleRecovery } from '../src/node-lifecycle.ts';
import { CONTRACT_ENTRY, READER_ENTRY, rehearseUpgrade } from '../src/upgrade-rehearsal.ts';
import { NODE_FLAGS } from '../src/process-client.ts';
import { Store } from '../src/store.ts';

const supported = { skip: process.platform === 'win32' || process.getuid?.() === 0 };
const NEXT = 'b'.repeat(40);
type Fixture = ReturnType<typeof serviceFixture>;
/** An installed, stopped service: the state every update plan starts from. */
async function stopped(f: Fixture): Promise<void> {
  const install = await planService(f.host, 'install');
  await applyService(f.host, install, install.digest);
  const stop = await planService(f.host, 'stop');
  await applyService(f.host, stop, stop.digest);
}
const titles = (path: string) => {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db
      .prepare('SELECT id,title FROM reminders ORDER BY id')
      .all()
      .map((row) => ({ ...row }));
  } finally {
    db.close();
  }
};

test(
  'update rehearses the candidate reader on its own backup after fetch and before checkout, and records the result',
  supported,
  async () => {
    const f = serviceFixture();
    try {
      await stopped(f);
      const seen: string[] = [];
      f.setReader((database) => {
        seen.push(database);
        const db = new DatabaseSync(database);
        try {
          db.exec('CREATE TABLE IF NOT EXISTS neutral_added(id TEXT PRIMARY KEY)');
        } finally {
          db.close();
        }
      });
      const plan = await planService(f.host, 'update', NEXT),
        receipt = await applyService(f.host, plan, plan.digest);
      assert.equal(receipt.state, 'completed');
      assert.deepEqual(
        receipt.steps,
        ['backup', 'fetch', 'rehearse', 'checkout', 'dependencies', 'build', 'start', 'verify'].map(
          (s) => s + ':completed',
        ),
      );
      assert.deepEqual(receipt.rehearsal!.blockers, []);
      assert.equal(receipt.rehearsal!.source.schema, 5);
      assert.equal(receipt.rehearsal!.result!.forwardOnly, false);
      assert.equal(seen.length, 2, 'a service restarts: the reader opens the copy twice');
      assert.ok(
        seen.every((path) => !path.startsWith(f.directory)),
        'the reader never receives the backup or the data home',
      );
      assert.deepEqual(
        serviceReceipt(f.host, plan.digest),
        receipt,
        'the journal keeps the rehearsal with the receipt',
      );
      const live = new DatabaseSync(f.data, { readOnly: true });
      try {
        assert.equal(
          live.prepare("SELECT 1 FROM sqlite_master WHERE name='neutral_added'").get(),
          undefined,
          'the rehearsal never touches live data',
        );
      } finally {
        live.close();
      }
    } finally {
      f.close();
    }
  },
);

test(
  'a reader that loses data ends the update as refused before the checkout changes, without leaving a held operation',
  supported,
  async () => {
    const f = serviceFixture();
    try {
      await stopped(f);
      const before = f.calls.length;
      f.setReader((database) => {
        const db = new DatabaseSync(database);
        try {
          db.exec('DELETE FROM reminders');
        } finally {
          db.close();
        }
      });
      const plan = await planService(f.host, 'update', NEXT),
        receipt = await applyService(f.host, plan, plan.digest);
      assert.equal(receipt.state, 'refused');
      assert.deepEqual(receipt.steps, ['backup:completed', 'fetch:completed', 'rehearse:completed']);
      assert.match(receipt.rehearsal!.blockers.join(' '), /reminders lost or renumbered 1/);
      assert.doesNotMatch(JSON.stringify(receipt), /Neutral existing reminder/, 'a receipt never carries row content');
      assert.deepEqual(f.calls.slice(before), ['fetch'], 'no checkout, dependency, build or start effect ran');
      assert.equal(readFileSync(f.revision, 'utf8'), 'a'.repeat(40));
      assert.deepEqual(titles(f.data), [{ id: 'original', title: 'Neutral existing reminder' }]);
      assert.deepEqual(
        titles(join(f.directory, '.nerv-lifecycle/backups', plan.digest, 'database.sqlite')),
        titles(f.data),
        'the backup stays as taken',
      );
      assert.deepEqual(await applyService(f.host, plan, plan.digest), receipt, 'replay returns the refusal');
      assert.deepEqual(f.calls.slice(before), ['fetch']);
      assert.equal(lifecycleRecovery(receipt, {}).action, 'return-receipt', 'a refusal needs no release');
      const start = await planService(f.host, 'start');
      assert.deepEqual(start.blockers, [], 'the installed revision can be started again');
      const started = await applyService(f.host, start, start.digest);
      assert.equal(started.state, 'completed');
      assert.ok(started.fence > receipt.fence);
    } finally {
      f.close();
    }
  },
);

test(
  'an unreported rehearsal outcome or a source change during it stays uncertain and never reaches checkout',
  supported,
  async () => {
    for (const fault of ['export', 'drift'] as const) {
      const f = serviceFixture();
      try {
        await stopped(f);
        const before = f.calls.length;
        if (fault === 'export')
          f.host.rehearse = async () => {
            throw Error('Neutral export failure');
          };
        else
          f.setReader(() => {
            f.controls.clean = false;
          });
        const plan = await planService(f.host, 'update', NEXT);
        await assert.rejects(
          applyService(f.host, plan, plan.digest),
          fault === 'export' ? /export failure/ : /source changed/,
        );
        const receipt = serviceReceipt(f.host, plan.digest) as ServiceReceipt;
        assert.equal(receipt.state, 'uncertain');
        assert.equal(receipt.steps.at(-1), 'rehearse:started');
        assert.equal(receipt.rehearsal, undefined);
        assert.deepEqual(f.calls.slice(before), ['fetch']);
        assert.equal(readFileSync(f.revision, 'utf8'), 'a'.repeat(40));
        f.controls.clean = true;
        assert.ok((await planService(f.host, 'start')).blockers.some((s) => s.includes('owns')));
      } finally {
        f.close();
      }
    }
  },
);

/** Runs the commands the rehearsal needs for real; anything else would be a service effect and fails the test. */
const real =
  (node: string) =>
  async (program: string, args: string[], cwd?: string, _timeout?: number, extra: Record<string, string> = {}) => {
    assert.ok(
      (program === 'git' && args[2] === 'archive') || program === 'tar' || program === node,
      'unexpected command ' + program + ' ' + args.join(' '),
    );
    const r = spawnSync(program, args, { cwd, env: { PATH: process.env.PATH ?? '', ...extra }, encoding: 'utf8' });
    return { status: r.status, out: r.stdout, err: r.stderr };
  };
const READER = (sql: string) =>
  "import {DatabaseSync} from 'node:sqlite';\nconst db=new DatabaseSync(process.argv[2]);db.exec(" +
  JSON.stringify(sql) +
  ');db.close();\n';

test(
  'production adapter joins the pinned Git tree, a private staging export, the candidate reader process and the installed comparison',
  supported,
  async () => {
    const f = serviceFixture();
    try {
      const source = f.host.context.source,
        git = (args: string[]) =>
          execFileSync(
            'git',
            [
              '-C',
              source,
              '-c',
              'user.name=Neutral Fixture',
              '-c',
              'user.email=fixture@example.invalid',
              '-c',
              'commit.gpgsign=false',
              ...args,
            ],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
          ).trim();
      const commit = (reader: string | undefined, label: string, contract?: string) => {
        mkdirSync(join(source, 'src'), { recursive: true });
        if (reader === undefined) rmSync(join(source, READER_ENTRY), { force: true });
        else writeFileSync(join(source, READER_ENTRY), reader);
        if (contract !== undefined) writeFileSync(join(source, CONTRACT_ENTRY), contract);
        else rmSync(join(source, CONTRACT_ENTRY), { force: true });
        writeFileSync(join(source, 'LABEL'), label);
        git(['add', '-A']);
        git(['commit', '-m', label]);
        return git(['rev-parse', 'HEAD']);
      };
      git(['init']);
      const installed = commit(READER('SELECT 1'), 'Neutral installed'),
        adds = commit(
          READER('CREATE TABLE IF NOT EXISTS neutral_added(id TEXT PRIMARY KEY)'),
          'Neutral additive reader',
        ),
        raisesSchema = commit(
          READER('CREATE TABLE IF NOT EXISTS neutral_v7(id TEXT PRIMARY KEY);PRAGMA user_version=7'),
          'Neutral forward-schema reader',
          'export const UPGRADE_CONTRACT = { version: 1, readerSchema: 7, minimumServiceSchema: 5 } as const;\n',
        ),
        loses = commit(READER('DELETE FROM reminders'), 'Neutral lossy reader'),
        absent = commit(undefined, 'Neutral tree without a reader entry');
      git(['checkout', '--detach', installed]);
      const host = macServiceAdapter(f.host.context, real(f.host.context.node)),
        area = join(f.directory, '.nerv-lifecycle');
      mkdirSync(join(area, 'backups'), { recursive: true, mode: 0o700 });
      const run = async (nextRevision: string) => {
        const digest = nextRevision.padEnd(64, '0'),
          dest = join(area, 'backups', digest);
        mkdirSync(dest, { mode: 0o700 });
        await host.backup(dest);
        return host.rehearse({ digest, nextRevision } as ServicePlan, dest);
      };
      const clean = await run(adds);
      assert.deepEqual(clean.blockers, []);
      assert.equal(clean.result!.tables, 1);
      const forward = await run(raisesSchema);
      assert.deepEqual(forward.blockers, []);
      assert.equal(forward.result!.forwardOnly, true);
      assert.equal(forward.result!.schema, 7);
      assert.deepEqual(forward.contract, { readerSchema: 7, minimumServiceSchema: 5 });
      assert.match((await run(loses)).blockers.join(' '), /reminders lost or renumbered 1/);
      assert.match(
        (await run(absent)).blockers.join(' '),
        /reader refused or failed on the first open: The candidate reader exited with a failure/,
      );
      await assert.rejects(run('c'.repeat(40)), /could not be exported/);
      assert.deepEqual(readdirSync(join(area, 'staging')), [], 'no exported tree or archive is left behind');
      assert.equal(git(['rev-parse', 'HEAD']), installed);
      assert.equal(git(['status', '--porcelain']), '', 'the installed checkout is untouched');
      assert.deepEqual(titles(f.data), [{ id: 'original', title: 'Neutral existing reminder' }]);
    } finally {
      f.close();
    }
  },
);

test(
  'the reader entry this revision ships opens a backup of its own data without loss when run as a separate process',
  supported,
  async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'nerv-reader-entry-'))),
      entry = fileURLToPath(new URL('../' + READER_ENTRY, import.meta.url));
    try {
      const backup = join(root, 'backup');
      mkdirSync(backup, { mode: 0o700 });
      const store = new Store(join(root, 'live.sqlite'));
      store.db.exec(
        "INSERT INTO reminders(id,title,due,created) VALUES('first','Neutral first','2030-01-01T00:00:00.000Z','2029-01-01T00:00:00.000Z')",
      );
      store.db.prepare('VACUUM INTO ?').run(join(backup, 'database.sqlite'));
      store.db.close();
      chmodSync(join(backup, 'database.sqlite'), 0o600);
      const child = (args: string[]) =>
        spawnSync(process.execPath, [...NODE_FLAGS, entry, ...args], {
          encoding: 'utf8',
          env: { PATH: process.env.PATH ?? '' },
        });
      const report = await rehearseUpgrade(backup, (database, home) => {
        const r = child([database, home]);
        if (r.status !== 0) throw Error('Neutral child failure');
        assert.equal(r.stdout, '');
      });
      assert.deepEqual(report.blockers, []);
      assert.ok(report.result!.rows >= 1);
      assert.equal(child([]).status, 64, 'without both arguments the entry opens nothing');
      assert.equal(existsSync(join(root, 'nerv.sqlite')), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  'admission beyond documentation: descendant, reader entry and engine range; never a downgrade',
  supported,
  async () => {
    const f = serviceFixture();
    try {
      const source = f.host.context.source;
      const git = (args: string[]) =>
        execFileSync(
          'git',
          [
            '-C',
            source,
            '-c',
            'user.name=Neutral Fixture',
            '-c',
            'user.email=fixture@example.invalid',
            '-c',
            'commit.gpgsign=false',
            ...args,
          ],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        ).trim();
      const commit = (files: Record<string, string | null>, label: string) => {
        mkdirSync(join(source, 'src'), { recursive: true });
        for (const [path, text] of Object.entries(files))
          if (text === null) rmSync(join(source, path), { force: true });
          else writeFileSync(join(source, path), text);
        git(['add', '-A']);
        git(['commit', '--allow-empty', '-m', label]);
        return git(['rev-parse', 'HEAD']);
      };
      const manifest = (node: string | undefined) =>
        JSON.stringify({ name: 'neutral', ...(node ? { engines: { node } } : {}) });
      git(['init']);
      const older = commit(
        { 'src/app.ts': 'export const v = 0;', 'package.json': manifest('>=24.0.0') },
        'Neutral older',
      );
      const installed = commit(
        { [READER_ENTRY]: READER('SELECT 1'), 'src/app.ts': 'export const v = 1;' },
        'Neutral installed',
      );
      const upgrade = commit({ 'src/app.ts': 'export const v = 2;' }, 'Neutral application change');
      const noEntry = commit({ [READER_ENTRY]: null }, 'Neutral candidate without a reader entry');
      git(['checkout', '--detach', upgrade]);
      const tooNew = commit({ 'package.json': manifest('>=99.0.0') }, 'Neutral candidate needing a newer Node');
      git(['checkout', '--detach', upgrade]);
      const caret = commit({ 'package.json': manifest('^24.0.0') }, 'Neutral candidate with another range form');
      git(['checkout', '--detach', upgrade]);
      const unstated = commit({ 'package.json': manifest(undefined) }, 'Neutral candidate without an engine range');
      git(['checkout', '--detach', older]);
      const sibling = commit(
        { [READER_ENTRY]: READER('SELECT 1'), 'src/app.ts': 'export const v = 9;' },
        'Neutral unrelated line',
      );
      git(['checkout', '--detach', installed]);
      const admitted = (revision: string) => compatibleServiceRevision(f.host.context, revision);
      assert.equal(await admitted(upgrade), true, 'a descendant application change with the reader entry is admitted');
      assert.equal(await admitted(older), false, 'an ancestor is a downgrade');
      assert.equal(await admitted(sibling), false, 'a revision that does not contain the installed one is refused');
      assert.equal(await admitted(noEntry), false, 'without the reader entry there is nothing to rehearse');
      assert.equal(await admitted(tooNew), false, 'the declared Node range must be met by this runtime');
      assert.equal(await admitted(caret), false, 'a range form this check cannot evaluate is refused, not guessed');
      assert.equal(await admitted(unstated), false);
      assert.equal(await admitted('f'.repeat(40)), false, 'an unknown commit is refused');
      git(['tag', '-a', 'neutral-tag', '-m', 'Neutral annotated tag', upgrade]);
      assert.equal(await admitted(git(['rev-parse', 'neutral-tag'])), false, 'a tag object is not a commit to pin');
      git(['checkout', '--detach', upgrade]);
      const docsOnly = (parent: string, label: string) => {
        git(['checkout', '--detach', parent]);
        return commit({ 'README.md': label }, label);
      };
      const docsAhead = docsOnly(upgrade, 'Neutral documentation ahead'),
        docsBehind = docsOnly(older, 'Neutral documentation on an older line');
      git(['checkout', '--detach', upgrade]);
      assert.equal(
        await admitted(docsAhead),
        true,
        'documentation that descends from the installed revision is admitted',
      );
      assert.equal(
        await admitted(docsBehind),
        false,
        'no path admits a revision that does not contain the installed one',
      );
      git(['checkout', '--detach', installed]);
      assert.equal(git(['rev-parse', 'HEAD']), installed);
      assert.equal(git(['status', '--porcelain']), '', 'admission changes nothing');
    } finally {
      f.close();
    }
  },
);

test(
  'a candidate that migrates the schema forward within its contract is admitted and updates live data',
  supported,
  async () => {
    const f = serviceFixture();
    try {
      await stopped(f);
      const before = f.calls.length;
      const migrateTo7 = (database: string) => {
        const db = new DatabaseSync(database);
        try {
          db.exec('CREATE TABLE IF NOT EXISTS forward_items(id TEXT PRIMARY KEY);PRAGMA user_version=7');
        } finally {
          db.close();
        }
      };
      f.setReader(migrateTo7, { minimumServiceSchema: 4, readerSchema: 7 });
      f.setBeforeCommand((step) => {
        if (step === 'register') migrateTo7(f.data);
      });
      const plan = await planService(f.host, 'update', NEXT),
        receipt = await applyService(f.host, plan, plan.digest);
      assert.equal(receipt.state, 'completed');
      assert.deepEqual(receipt.rehearsal!.blockers, []);
      assert.equal(receipt.rehearsal!.result!.forwardOnly, true);
      assert.equal(receipt.rehearsal!.result!.schema, 7);
      assert.deepEqual(f.calls.slice(before), ['fetch', 'checkout', 'dependencies', 'build', 'register']);
      assert.equal(readFileSync(f.revision, 'utf8'), NEXT);
      const live = new DatabaseSync(f.data, { readOnly: true });
      try {
        assert.equal(live.prepare('PRAGMA user_version').get()!.user_version, 7, 'live data is migrated to schema 7');
      } finally {
        live.close();
      }
    } finally {
      f.close();
    }
  },
);

test(
  'a failed forward-migrating update never recovers automatically, blocks starting the previous revision on migrated data, and restores backup + previous revision only on explicit owner recovery',
  supported,
  async () => {
    const f = serviceFixture();
    try {
      await stopped(f);
      const migrateTo7 = (database: string) => {
        const db = new DatabaseSync(database);
        try {
          db.exec(
            "CREATE TABLE IF NOT EXISTS migrated_notes(id TEXT PRIMARY KEY,body TEXT);INSERT OR IGNORE INTO migrated_notes VALUES('n1','migrated');PRAGMA user_version=7",
          );
        } finally {
          db.close();
        }
      };
      f.setReader(migrateTo7, { minimumServiceSchema: 4, readerSchema: 7 });
      f.setBeforeCommand((step, p) => {
        if (step === 'register' && p.action === 'update') migrateTo7(f.data);
      });
      f.setHealth(() => ({
        ok: false,
        checkedAt: new Date().toISOString(),
        commit: NEXT,
        baseId: 'BASE-01',
        database: 'ok',
        nervous: true,
        brain: false,
        failures: ['brain process did not answer ping'],
      }));
      const plan = await planService(f.host, 'update', NEXT);
      await assert.rejects(() => applyService(f.host, plan, plan.digest), /failed post-start health check/);
      const failed = serviceReceipt(f.host, plan.digest) as ServiceReceipt;
      assert.equal(failed.state, 'uncertain');
      assert.equal(failed.rehearsal?.result?.forwardOnly, true);
      assert.equal(failed.rehearsal?.result?.schema, 7);
      assert.ok(failed.recovery?.some((s) => s.includes('Never start the previous revision on forward-migrated data')));
      assert.ok(
        failed.recovery?.some((s) =>
          s.includes(`nodes lifecycle-recover --receipt FILE --evidence FILE --confirm-backup-restore ${plan.digest}`),
        ),
      );

      // Live database is still at schema 7 because recovery never runs automatically.
      const checkSchema = () => {
        const db = new DatabaseSync(f.data, { readOnly: true });
        try {
          return Number(db.prepare('PRAGMA user_version').get()!.user_version);
        } finally {
          db.close();
        }
      };
      assert.equal(checkSchema(), 7, 'recovery never ran automatically');

      // Mark the handler process dead in journal so recovery/release can proceed past the handler liveness check.
      const jdb = new DatabaseSync(join(f.directory, '.nerv-lifecycle/journal.sqlite'));
      let deadSnapshot: ServiceReceipt;
      try {
        const stored = JSON.parse(
          (jdb.prepare('SELECT receipt FROM operations WHERE digest=?').get(plan.digest) as { receipt: string })
            .receipt,
        ) as ServiceReceipt;
        deadSnapshot = { ...stored, pid: 2 ** 22 + 7 };
        jdb.prepare('UPDATE operations SET receipt=? WHERE digest=?').run(JSON.stringify(deadSnapshot), plan.digest);
        jdb.prepare('UPDATE resource SET pid=? WHERE id=1').run(deadSnapshot.pid);
      } finally {
        jdb.close();
      }

      const evidence = {
        ...deadSnapshot,
        handlerStopped: true,
        descendantsStopped: true,
        operatorConfirmed: true,
        reason: 'Stopped failed candidate service and verified no descendants remain',
      };

      // Refused while the candidate service is still registered/running.
      await assert.rejects(
        () => recoverServiceUpdate(f.host, deadSnapshot, evidence, plan.digest),
        /still registered or running/,
      );

      // Owner stops the failed candidate service.
      f.setManager(false);

      // Plain lifecycle-release is refused because the candidate update migrates the schema forward.
      await assert.rejects(
        () => releaseObservedService(f.host, deadSnapshot, evidence),
        /Candidate update migrates the database schema forward; never release without restoring the operation backup/,
      );

      // Planning a start of the previous revision on the migrated database (schema 7) is also blocked.
      writeFileSync(f.revision, 'a'.repeat(40));
      const blockedStart = await planService(f.host, 'start');
      assert.ok(blockedStart.blockers.includes('The selected database schema is unsupported.'));
      assert.ok(blockedStart.blockers.includes('A lifecycle operation owns this user service.'));

      // Recovery refuses if the checkout is still at the candidate revision instead of the previous revision.
      writeFileSync(f.revision, NEXT);
      await assert.rejects(
        () => recoverServiceUpdate(f.host, deadSnapshot, evidence, plan.digest),
        /Check out the previous revision/,
      );

      // Owner checks out the previous revision; recovery refuses while pending work or unbuilt state exists.
      writeFileSync(f.revision, 'a'.repeat(40));
      f.controls.pending = true;
      await assert.rejects(
        () => recoverServiceUpdate(f.host, deadSnapshot, evidence, plan.digest),
        /Unresolved worker jobs or outbox effects exist/,
      );
      f.controls.pending = false;
      f.controls.built = false;
      await assert.rejects(
        () => recoverServiceUpdate(f.host, deadSnapshot, evidence, plan.digest),
        /Build the previous revision before restoring/,
      );
      f.controls.built = true;

      await assert.rejects(
        () => recoverServiceUpdate(f.host, deadSnapshot, evidence, 'wrong-digest'),
        /Confirm the exact operation digest/,
      );
      const recovered = await recoverServiceUpdate(f.host, deadSnapshot, evidence, plan.digest);
      assert.equal(recovered.state, 'released');
      assert.deepEqual(recovered.restoredBackup, {
        digest: failed.rehearsal!.source.digest,
        schema: 5,
        revision: 'a'.repeat(40),
      });
      assert.equal(checkSchema(), 5, 'operation backup restored live database to schema 5');
      assert.deepEqual(titles(f.data), [{ id: 'original', title: 'Neutral existing reminder' }]);

      // Now the previous revision can plan and apply a clean start on the restored schema-5 database.
      f.setHealth(undefined);
      const startPlan = await planService(f.host, 'start');
      assert.deepEqual(startPlan.blockers, []);
      const started = await applyService(f.host, startPlan, startPlan.digest);
      assert.equal(started.state, 'completed');
    } finally {
      f.close();
    }
  },
);

test(
  'a candidate that migrates beyond its own declared contract or lacks a verified backup manifest is refused before checkout',
  supported,
  async () => {
    const f = serviceFixture();
    try {
      await stopped(f);
      const before = f.calls.length;
      f.setReader(
        (database) => {
          const db = new DatabaseSync(database);
          try {
            db.exec('PRAGMA user_version=8');
          } finally {
            db.close();
          }
        },
        { minimumServiceSchema: 4, readerSchema: 7 },
      );
      const plan = await planService(f.host, 'update', NEXT),
        receipt = await applyService(f.host, plan, plan.digest);
      assert.equal(receipt.state, 'refused');
      assert.match(receipt.rehearsal!.blockers.join(' '), /wrote schema 8, beyond its own contract/);
      assert.deepEqual(f.calls.slice(before), ['fetch']);
      assert.equal(readFileSync(f.revision, 'utf8'), 'a'.repeat(40));

      // A forward migration within contract bounds is also refused before checkout if the operation backup lacks a verified manifest.
      const origBackup = f.host.backup;
      f.host.backup = async (dest) => {
        await origBackup(dest);
        rmSync(join(dest, 'manifest.json'), { force: true });
      };
      f.setReader(
        (database) => {
          const db = new DatabaseSync(database);
          try {
            db.exec('PRAGMA user_version=7');
          } finally {
            db.close();
          }
        },
        { minimumServiceSchema: 4, readerSchema: 7 },
      );
      const beforeNoManifest = f.calls.length;
      const planNoManifest = await planService(f.host, 'update', NEXT),
        refusedNoManifest = await applyService(f.host, planNoManifest, planNoManifest.digest);
      assert.equal(refusedNoManifest.state, 'refused');
      assert.match(
        refusedNoManifest.rehearsal!.blockers.join(' '),
        /Forward migration requires a verified operation backup for explicit recovery/,
      );
      assert.deepEqual(f.calls.slice(beforeNoManifest), ['fetch']);
      assert.equal(readFileSync(f.revision, 'utf8'), 'a'.repeat(40));
    } finally {
      f.close();
    }
  },
);

test(
  'B-088: the candidate reader resolves packages from the installed checkout, as the real reader imports npm packages',
  supported,
  async () => {
    const f = serviceFixture();
    try {
      const source = f.host.context.source,
        git = (args: string[]) =>
          execFileSync(
            'git',
            [
              '-C',
              source,
              '-c',
              'user.name=Neutral Fixture',
              '-c',
              'user.email=fixture@example.invalid',
              '-c',
              'commit.gpgsign=false',
              ...args,
            ],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
          ).trim();
      git(['init']);
      writeFileSync(join(source, '.gitignore'), 'node_modules/\n');
      mkdirSync(join(source, 'src'), { recursive: true });
      writeFileSync(join(source, READER_ENTRY), READER('SELECT 1'));
      git(['add', '-A']);
      git(['commit', '-m', 'Neutral installed']);
      const installed = git(['rev-parse', 'HEAD']);
      // The installed checkout's dependency, as npm ci leaves it; never committed.
      mkdirSync(join(source, 'node_modules', 'neutral-dep'), { recursive: true });
      writeFileSync(
        join(source, 'node_modules', 'neutral-dep', 'package.json'),
        JSON.stringify({ name: 'neutral-dep', version: '1.0.0', type: 'module', exports: './index.js' }),
      );
      writeFileSync(join(source, 'node_modules', 'neutral-dep', 'index.js'), "export const sql = 'SELECT 1';\n");
      writeFileSync(
        join(source, READER_ENTRY),
        "import {DatabaseSync} from 'node:sqlite';\nimport {sql} from 'neutral-dep';\nconst db=new DatabaseSync(process.argv[2]);db.exec(sql);db.close();\n",
      );
      git(['add', '-A']);
      git(['commit', '-m', 'Neutral reader with a dependency']);
      const candidate = git(['rev-parse', 'HEAD']);
      git(['checkout', '--detach', installed]);
      const host = macServiceAdapter(f.host.context, real(f.host.context.node)),
        area = join(f.directory, '.nerv-lifecycle');
      mkdirSync(join(area, 'backups'), { recursive: true, mode: 0o700 });
      const digest = candidate.padEnd(64, '0'),
        dest = join(area, 'backups', digest);
      mkdirSync(dest, { mode: 0o700 });
      await host.backup(dest);
      const report = await host.rehearse({ digest, nextRevision: candidate } as ServicePlan, dest);
      assert.deepEqual(report.blockers, [], 'the candidate reader finds the installed dependency');
      assert.deepEqual(readdirSync(join(area, 'staging')), [], 'no exported tree, archive or link is left behind');
      assert.ok(existsSync(join(source, 'node_modules', 'neutral-dep', 'index.js')), 'the installed dependencies stay');
      assert.equal(git(['status', '--porcelain']), '', 'the installed checkout is untouched');
    } finally {
      f.close();
    }
  },
);
