// Regressions for the independent review of the first F-005-T06 slice (2026-11-11). Committed failing before the fixes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  closeSync,
  writeSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/store.ts';
import { compatibleServiceRevision, macServiceAdapter } from '../src/node-lifecycle-execution.ts';
import { UPGRADE_CONTRACT } from '../src/upgrade-contract.ts';
import { rehearseUpgrade, type UpgradeReader } from '../src/upgrade-rehearsal.ts';
import { serviceFixture } from './mac-service-fixture.ts';

const supported = { skip: process.platform === 'win32' };
const edit =
  (sql: string): UpgradeReader =>
  (database) => {
    const db = new DatabaseSync(database);
    try {
      db.exec(sql);
    } finally {
      db.close();
    }
  };
/** A data home written by the real Store, backed up by the production lifecycle adapter. */
async function realBackup(seed = '', config = '{}') {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nerv-rehearsal-test-'))),
    home = join(root, '.nerv'),
    source = join(root, 'source'),
    directory = join(root, 'backup');
  for (const dir of [home, source, directory]) mkdirSync(dir, { mode: 0o700 });
  const store = new Store(join(home, 'nerv.sqlite'));
  store.db.exec(
    "INSERT INTO reminders(id,title,due,created) VALUES('first','Neutral first','2030-01-01T00:00:00.000Z','2029-01-01T00:00:00.000Z');INSERT INTO deliveries(rowid,id,reminder_id,kind,message,created) VALUES(7,'d-first','first','reminder','Neutral first','2029-01-01T00:00:00.000Z'),(9,'d-brief',NULL,'brief','Neutral brief','2029-01-01T00:00:00.000Z');INSERT INTO facts_fts(text,fact_id) VALUES('Neutral fact','f-1');" +
      seed,
  );
  store.db.close();
  chmodSync(join(home, 'nerv.sqlite'), 0o600);
  for (const [name, content] of [
    ['config.json', config],
    ['token', 'neutral-fixture-token'],
    ['base-key', 'neutral-fixture-private'],
    ['base.pub', 'neutral-fixture-public'],
    ['telegram-token', 'neutral-fixture-telegram'],
  ] as const)
    writeFileSync(join(home, name), content, { mode: 0o600 });
  await macServiceAdapter({
    userHome: root,
    home,
    source,
    node: realpathSync(process.execPath),
    uid: process.getuid!(),
  }).backup(directory);
  return {
    root,
    directory,
    database: join(directory, 'database.sqlite'),
    remove: () => rmSync(root, { recursive: true, force: true }),
  };
}
async function blockersAfter(reader: UpgradeReader, seed = ''): Promise<string> {
  const f = await realBackup(seed);
  try {
    return (await rehearseUpgrade(f.directory, reader)).blockers.join(' | ');
  } finally {
    f.remove();
  }
}

test(
  'B1: a backup written by the real lifecycle adapter is rehearsed, and its credentials are never copied',
  supported,
  async () => {
    const f = await realBackup();
    try {
      assert.ok(readdirSync(f.directory).includes('base-key') && readdirSync(f.directory).includes('manifest.json'));
      const report = await rehearseUpgrade(f.directory);
      assert.deepEqual(report.blockers, []);
      let seen: string[] = [];
      await rehearseUpgrade(f.directory, (_, home) => {
        seen = readdirSync(home);
      });
      assert.deepEqual(seen.filter((name) => !/-(wal|shm)$/.test(name)).sort(), [
        'config.json',
        'nerv.sqlite',
        'prior.sqlite',
      ]);
    } finally {
      f.remove();
    }
  },
);

test('N1: a table rebuilt without row ids loses its channel cursors and is reported', supported, async () => {
  assert.match(
    await blockersAfter(
      edit(
        "CREATE TABLE d2(id TEXT PRIMARY KEY,reminder_id TEXT,kind TEXT NOT NULL DEFAULT 'reminder',message TEXT NOT NULL,created TEXT NOT NULL,read_at TEXT) WITHOUT ROWID;INSERT INTO d2 SELECT id,reminder_id,kind,message,created,read_at FROM deliveries;PRAGMA foreign_keys=OFF;DROP TABLE deliveries;ALTER TABLE d2 RENAME TO deliveries",
      ),
    ),
    /Table deliveries lost its row ids/,
  );
});

test(
  'N2/N3: search index content and ordinary tables that only look like index tables are compared',
  supported,
  async () => {
    assert.match(await blockersAfter(edit('DELETE FROM facts_fts')), /facts_fts lost 1 indexed row/);
    const seed =
      "CREATE TABLE facts_fts_archive(id TEXT PRIMARY KEY);INSERT INTO facts_fts_archive VALUES('kept');CREATE TABLE sqlitex_data(id TEXT PRIMARY KEY);";
    assert.match(
      await blockersAfter(edit('DELETE FROM facts_fts_archive'), seed),
      /Table facts_fts_archive lost or renumbered 1 existing row/,
    );
    assert.match(await blockersAfter(edit('DROP TABLE sqlitex_data'), seed), /Table sqlitex_data is missing/);
  },
);

test('N4: dropped columns, indexes and safeguard triggers are reported', supported, async () => {
  assert.match(
    await blockersAfter(edit('ALTER TABLE deliveries DROP COLUMN read_at')),
    /Table deliveries lost column read_at/,
  );
  assert.match(await blockersAfter(edit('DROP TRIGGER events_no_update')), /trigger events_no_update is missing/);
  assert.match(await blockersAfter(edit('DROP INDEX reminders_due')), /index reminders_due is missing/);
});

test(
  'N5/N6: a reader that keeps changing row counts on reopen, or lowers an id counter, is reported',
  supported,
  async () => {
    let opens = 0;
    assert.match(
      await blockersAfter((database) =>
        edit(
          "INSERT INTO reminders(id,title,due,created) VALUES('extra-" +
            ++opens +
            "','Neutral extra','2030-01-01T00:00:00.000Z','2029-01-01T00:00:00.000Z')",
        )(database, ''),
      ),
      /Opening the data again changed the row count of reminders/,
    );
    const seed =
      "CREATE TABLE counter_fixture(id INTEGER PRIMARY KEY AUTOINCREMENT,note TEXT);INSERT INTO counter_fixture(note) VALUES('a'),('b');";
    assert.match(
      await blockersAfter(edit("UPDATE sqlite_sequence SET seq=0 WHERE name='counter_fixture'"), seed),
      /id counter of counter_fixture was lowered/,
    );
  },
);

test('a damaged backup is refused before any reader runs', supported, async () => {
  const f = await realBackup();
  try {
    const size = statSync(f.database).size,
      fd = openSync(f.database, 'r+');
    try {
      writeSync(fd, Buffer.alloc(8192, 0xa5), 0, 8192, Math.min(4096, size - 8192));
    } finally {
      closeSync(fd);
    }
    rmSync(join(f.directory, 'manifest.json'));
    let ran = 0;
    const report = await rehearseUpgrade(f.directory, () => {
      ran++;
    });
    assert.match(report.blockers.join(' '), /backup fails its integrity check/);
    assert.equal(ran, 0);
    assert.equal(report.result, undefined);
  } finally {
    f.remove();
  }
});

test('N8: a reader error never carries configuration text into the report', supported, async () => {
  const f = await realBackup('PRAGMA user_version=6;', '{"kaji": NEUTRALSECRETVALUE');
  try {
    const report = await rehearseUpgrade(f.directory);
    assert.equal(report.blockers.length, 1);
    assert.ok(!JSON.stringify(report).includes('NEUTRALSECRET'));
  } finally {
    f.remove();
  }
});

test(
  'the lifecycle lower bound is the contract value, and the report names it as the lifecycle bound',
  supported,
  async () => {
    const f = serviceFixture();
    try {
      const git = (args: string[]) =>
        execFileSync(
          'git',
          [
            '-C',
            f.host.context.source,
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
      writeFileSync(join(f.host.context.source, 'README.md'), 'Neutral');
      git(['add', '.']);
      git(['commit', '-m', 'Base']);
      const base = git(['rev-parse', 'HEAD']);
      writeFileSync(join(f.host.context.source, 'README.md'), 'Neutral documentation change');
      git(['commit', '-am', 'Docs']);
      const docs = git(['rev-parse', 'HEAD']);
      git(['checkout', '--detach', base]);
      const setSchema = (n: number) => {
        const db = new DatabaseSync(f.data);
        db.exec('PRAGMA user_version=' + n);
        db.close();
      };
      setSchema(UPGRADE_CONTRACT.minimumServiceSchema - 1);
      assert.equal(await compatibleServiceRevision(f.host.context, docs), false);
      setSchema(UPGRADE_CONTRACT.minimumServiceSchema);
      assert.equal(await compatibleServiceRevision(f.host.context, docs), true);
    } finally {
      f.close();
    }
    const old = await realBackup('PRAGMA user_version=' + (UPGRADE_CONTRACT.minimumServiceSchema - 1) + ';');
    try {
      assert.match(
        (await rehearseUpgrade(old.directory)).blockers.join(' '),
        /outside what the service lifecycle accepts/,
      );
    } finally {
      old.remove();
    }
  },
);
