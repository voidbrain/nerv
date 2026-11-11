import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/store.ts';
import { UPGRADE_CONTRACT } from '../src/upgrade-contract.ts';
import { SERVICE_READER_SCHEMA } from '../src/node-lifecycle-execution.ts';
import { currentReader, rehearseUpgrade, type UpgradeReader } from '../src/upgrade-rehearsal.ts';
import { nodesCommand } from '../src/nodes-cli.ts';

const supported = { skip: process.platform === 'win32' };
const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const ROOT_BOUND = JSON.stringify({
  kaji: {
    root: generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    rootBinding: true,
  },
});
/** A neutral backup in the lifecycle layout, written by the real Store: two reminders, both delivered to the inbox. */
function backup(options: { schema?: number; config?: string } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nerv-rehearsal-test-'))),
    directory = join(root, 'backup');
  mkdirSync(directory, { mode: 0o700 });
  const database = join(directory, 'database.sqlite'),
    store = new Store(join(root, 'live.sqlite'));
  store.db.exec(
    "INSERT INTO reminders(id,title,due,created) VALUES('first','Neutral first','2030-01-01T00:00:00.000Z','2029-01-01T00:00:00.000Z'),('second','Neutral second','2030-01-02T00:00:00.000Z','2029-01-01T00:00:00.000Z');INSERT INTO deliveries(rowid,id,reminder_id,kind,message,created) VALUES(7,'d-first','first','reminder','Neutral first','2029-01-01T00:00:00.000Z'),(9,'d-second','second','reminder','Neutral second','2029-01-01T00:00:00.000Z');" +
      (options.schema ? 'PRAGMA user_version=' + options.schema : ''),
  );
  // The same consistent copy the lifecycle update backup takes.
  store.db.prepare('VACUUM INTO ?').run(database);
  store.db.close();
  chmodSync(database, 0o600);
  if (options.config) {
    writeFileSync(join(directory, 'config.json'), options.config, { mode: 0o600 });
  }
  return { root, directory, database, remove: () => rmSync(root, { recursive: true, force: true }) };
}
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

test('the reviewed contract is what the Store and the service lifecycle actually enforce', () => {
  assert.equal(SERVICE_READER_SCHEMA, UPGRADE_CONTRACT.readerSchema);
  const fresh = new Store(':memory:');
  try {
    const version = Number(fresh.db.prepare('PRAGMA user_version').get()!.user_version);
    assert.ok(version >= UPGRADE_CONTRACT.minimumServiceSchema && version <= UPGRADE_CONTRACT.readerSchema);
  } finally {
    fresh.db.close();
  }
  const f = backup({ schema: UPGRADE_CONTRACT.readerSchema + 1 });
  try {
    assert.throws(() => new Store(f.database), /newer than this NERV Agency version/);
  } finally {
    f.remove();
  }
});

test(
  'the real reader opens a copy of real data twice; the backup stays byte-identical and no copy remains',
  supported,
  async () => {
    const f = backup();
    try {
      const before = digest(f.database),
        files = readdirSync(f.directory);
      let work = '';
      const report = await rehearseUpgrade(f.directory, (database, home) => {
        work = home;
        return currentReader(database, home);
      });
      assert.deepEqual(report.blockers, []);
      assert.equal(report.execution, 'rehearsal-only');
      assert.equal(report.source.digest, before);
      assert.equal(report.source.schema, 5);
      assert.deepEqual(report.result && { schema: report.result.schema, forwardOnly: report.result.forwardOnly }, {
        schema: 5,
        forwardOnly: false,
      });
      assert.ok(report.result!.rows >= 4);
      assert.equal(digest(f.database), before);
      assert.deepEqual(readdirSync(f.directory), files);
      assert.ok(work && !existsSync(work), 'the private working copy is removed');
      assert.ok(
        !JSON.stringify(report).includes('Neutral first'),
        'a report carries counts and names of tables, never row content',
      );
    } finally {
      f.remove();
    }
  },
);

test(
  'root-bound schema 6 data is rehearsed with its copied configuration, and refused without it',
  supported,
  async () => {
    const bound = backup({ schema: 6, config: ROOT_BOUND }),
      bare = backup({ schema: 6, config: '{}' });
    try {
      const ok = await rehearseUpgrade(bound.directory);
      assert.deepEqual(ok.blockers, []);
      assert.equal(ok.result!.schema, 6);
      const refused = await rehearseUpgrade(bare.directory);
      assert.match(refused.blockers.join(' '), /first open: Migrated trust requires root-bound peer authentication/);
      assert.equal(refused.result, undefined);
    } finally {
      bound.remove();
      bare.remove();
    }
  },
);

test('an input schema outside the lifecycle range is refused before any reader runs', supported, async () => {
  let ran = 0;
  const spy: UpgradeReader = () => {
    ran++;
  };
  for (const schema of [UPGRADE_CONTRACT.minimumServiceSchema - 1, UPGRADE_CONTRACT.readerSchema + 1]) {
    const f = backup({ schema });
    try {
      const report = await rehearseUpgrade(f.directory, spy);
      assert.match(report.blockers.join(' '), /outside what the service lifecycle accepts/);
      assert.equal(report.result, undefined);
    } finally {
      f.remove();
    }
  }
  assert.equal(ran, 0);
});

test(
  'a reader that loses, renumbers or downgrades existing data is reported, whatever it claims',
  supported,
  async () => {
    const cases: [string, UpgradeReader, RegExp][] = [
      [
        'deleted row',
        edit("DELETE FROM deliveries WHERE id='d-second'"),
        /Table deliveries lost or renumbered 1 existing row/,
      ],
      [
        'renumbered inbox cursor',
        edit("UPDATE deliveries SET rowid=20 WHERE id='d-second'"),
        /Table deliveries lost or renumbered 1 existing row/,
      ],
      ['dropped table', edit('DROP TABLE deliveries'), /Table deliveries is missing/],
      [
        'dropped key column',
        edit(
          'CREATE TABLE r2(title TEXT,due TEXT,created TEXT);INSERT INTO r2 SELECT title,due,created FROM reminders;PRAGMA foreign_keys=OFF;DROP TABLE reminders;ALTER TABLE r2 RENAME TO reminders',
        ),
        /foreign keys that can no longer be checked.*Table reminders lost column id/,
      ],
      ['downgrade', edit('PRAGMA user_version=4'), /lowered the schema from 5 to 4/],
      [
        'beyond its contract',
        edit('PRAGMA user_version=' + (UPGRADE_CONTRACT.readerSchema + 1)),
        /beyond its own contract/,
      ],
      [
        'failure',
        () => {
          throw Error('Neutral reader\nfailure');
        },
        /first open: Neutral reader failure/,
      ],
    ];
    for (const [name, reader, expected] of cases) {
      const f = backup();
      try {
        const before = digest(f.database),
          report = await rehearseUpgrade(f.directory, reader);
        assert.match(report.blockers.join(' '), expected, name);
        assert.equal(digest(f.database), before, name);
      } finally {
        f.remove();
      }
    }
  },
);

test(
  'a reader must be safe to run again: damage or a schema change on the second open is reported',
  supported,
  async () => {
    for (const [second, expected] of [
      ["DELETE FROM deliveries WHERE id='d-first'", /Table deliveries lost or renumbered 1 existing row/],
      ['PRAGMA user_version=6', /Opening the data again changed its schema/],
    ] as const) {
      const f = backup();
      let opens = 0;
      try {
        const report = await rehearseUpgrade(f.directory, (database) => {
          if (++opens === 2) edit(second)(database, '');
        });
        assert.equal(opens, 2);
        assert.match(report.blockers.join(' '), expected);
      } finally {
        f.remove();
      }
    }
    const f = backup();
    let opens = 0;
    try {
      const report = await rehearseUpgrade(f.directory, () => {
        if (++opens === 2) throw Error('Neutral restart failure');
      });
      assert.match(report.blockers.join(' '), /second open: Neutral restart failure/);
      assert.equal(report.result?.schema, 5);
    } finally {
      f.remove();
    }
  },
);

test('a forward migration is named as forward-only, never as reversible', supported, async () => {
  const f = backup({ config: ROOT_BOUND });
  try {
    const report = await rehearseUpgrade(f.directory, async (database, home) => {
      edit('PRAGMA user_version=6')(database, home);
      await currentReader(database, home);
    });
    assert.deepEqual(report.blockers, []);
    assert.deepEqual([report.source.schema, report.result!.schema, report.result!.forwardOnly], [5, 6, true]);
    assert.match(report.note, /separately reviewed restore/);
  } finally {
    f.remove();
  }
});

test(
  'only a private backup copy is accepted: never a live data home, a link, shared permissions or a stale manifest',
  supported,
  async () => {
    let ran = 0;
    const spy: UpgradeReader = () => {
      ran++;
    };
    const live = backup();
    try {
      writeFileSync(join(live.directory, 'nerv.sqlite'), '');
      await assert.rejects(rehearseUpgrade(live.directory, spy), /live data home/);
    } finally {
      live.remove();
    }
    const wal = backup();
    try {
      writeFileSync(join(wal.directory, 'database.sqlite-wal'), '');
      await assert.rejects(rehearseUpgrade(wal.directory, spy), /live data home/);
    } finally {
      wal.remove();
    }
    const linked = backup();
    try {
      symlinkSync(linked.directory, join(linked.root, 'link'));
      await assert.rejects(rehearseUpgrade(join(linked.root, 'link'), spy), /private, symlink-free copy/);
      await assert.rejects(rehearseUpgrade('backup', spy), /absolute path/);
    } finally {
      linked.remove();
    }
    const shared = backup();
    try {
      chmodSync(shared.database, 0o644);
      await assert.rejects(rehearseUpgrade(shared.directory, spy), /private, symlink-free copy/);
      chmodSync(shared.database, 0o600);
      chmodSync(shared.directory, 0o755);
      await assert.rejects(rehearseUpgrade(shared.directory, spy), /private, symlink-free copy/);
    } finally {
      shared.remove();
    }
    const stale = backup();
    try {
      writeFileSync(join(stale.directory, 'manifest.json'), JSON.stringify({ database: '0'.repeat(64) }), {
        mode: 0o600,
      });
      await assert.rejects(rehearseUpgrade(stale.directory, spy), /differs from its backup manifest/);
      writeFileSync(join(stale.directory, 'manifest.json'), JSON.stringify({ database: digest(stale.database) }));
      assert.deepEqual((await rehearseUpgrade(stale.directory)).blockers, []);
    } finally {
      stale.remove();
    }
    assert.equal(ran, 0);
  },
);

test(
  'nodes upgrade-rehearse joins the CLI to the rehearsal: private report, no target command',
  supported,
  async () => {
    const f = backup();
    try {
      const refuse = async () => {
          throw Error('no command may run');
        },
        out = join(f.root, 'report.json');
      assert.deepEqual(await nodesCommand(['upgrade-rehearse', '--backup', f.directory, '--out', out], refuse), {
        saved: out,
        execution: 'rehearsal-only',
      });
      assert.equal(statSync(out).mode & 0o777, 0o600);
      const saved = JSON.parse(readFileSync(out, 'utf8'));
      assert.deepEqual(saved.blockers, []);
      assert.equal(saved.source.digest, digest(f.database));
      await assert.rejects(nodesCommand(['upgrade-rehearse', '--backup', f.directory, '--out', out], refuse), /EEXIST/);
      await assert.rejects(nodesCommand(['upgrade-rehearse'], refuse), /Missing --backup/);
      assert.ok(existsSync(f.database));
    } finally {
      f.remove();
    }
  },
);
