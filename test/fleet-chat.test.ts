import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { execute } from '../src/executors.ts';
import { FleetStore } from '../src/fleet.ts';
import { handleFleetEditChat, parseFleetEditPhrase } from '../src/fleet-chat.ts';
import { Store } from '../src/store.ts';

// Invented fleet: neutral drone names and generic component models.
const QUAD = ['front-left', 'front-right', 'rear-left', 'rear-right'];

function withStore(work: (store: Store) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-fleet-chat-'));
  const store = new Store(join(dir, 'nerv.sqlite'));
  try {
    work(store);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function seedSmoke(store: Store): void {
  store.fleet.addDrone({ name: 'Smoke' });
  for (const position of QUAD) {
    store.fleet.setPart({ droneIdOrName: 'Smoke', category: 'motor', position, componentModel: 'Testmot 2207 1750KV' });
  }
  store.fleet.setPart({ droneIdOrName: 'Smoke', category: 'fc', position: 'main', componentModel: 'Generic F7 FC' });
  store.fleet.upsertSpare({ componentModel: 'Testmot 2207 1750KV', category: 'motor', newCount: 1, usedCount: 1 });
  store.fleet.upsertSpare({ componentModel: 'Generic F7 FC', category: 'fc', newCount: 0, usedCount: 0 });
}

describe('F-098-T06: fleet edit phrases (Italian and English)', () => {
  it('parses "new drone" with a frame and motors at the four positions', () => {
    const expected = {
      kind: 'add-drone',
      name: 'Ghost',
      frame: 'Apex 5',
      parts: [
        { category: 'frame', model: 'Apex 5' },
        { category: 'motor', model: 'Testmot 2207 1750KV', positions: QUAD },
      ],
    };
    assert.deepEqual(parseFleetEditPhrase('nuovo drone Ghost, frame Apex 5, motori Testmot 2207 1750KV'), expected);
    assert.deepEqual(parseFleetEditPhrase('new drone Ghost: frame Apex 5, motors Testmot 2207 1750KV.'), expected);
    assert.deepEqual(parseFleetEditPhrase('aggiungi drone Ghost, telaio Apex 5, motori Testmot 2207 1750KV'), expected);
  });

  it('parses a part replacement with its position', () => {
    const expected = {
      kind: 'replace-part',
      droneName: 'Smoke',
      category: 'motor',
      position: 'front-left',
      model: 'Testmot 2207 1950KV',
    };
    assert.deepEqual(
      parseFleetEditPhrase('sostituito motore anteriore sinistro di Smoke con Testmot 2207 1950KV'),
      expected,
    );
    assert.deepEqual(
      parseFleetEditPhrase('ho sostituito il motore anteriore sinistro di Smoke con un Testmot 2207 1950KV'),
      expected,
    );
    assert.deepEqual(parseFleetEditPhrase("replaced Smoke's front-left motor with Testmot 2207 1950KV"), expected);
    assert.deepEqual(
      parseFleetEditPhrase('replaced the front-left motor on Smoke with a Testmot 2207 1950KV'),
      expected,
    );
    assert.deepEqual(parseFleetEditPhrase('sostituito fc di Smoke con Generic H7 FC'), {
      kind: 'replace-part',
      droneName: 'Smoke',
      category: 'fc',
      model: 'Generic H7 FC',
    });
  });

  it('parses spare stock counts', () => {
    assert.deepEqual(parseFleetEditPhrase('ho 3 motori Testmot nuovi'), {
      kind: 'set-stock',
      category: 'motor',
      model: 'Testmot',
      newCount: 3,
    });
    assert.deepEqual(parseFleetEditPhrase('ho 2 motori Testmot usati'), {
      kind: 'set-stock',
      category: 'motor',
      model: 'Testmot',
      usedCount: 2,
    });
    assert.deepEqual(parseFleetEditPhrase('ho 3 motori Testmot nuovi e 2 usati'), {
      kind: 'set-stock',
      category: 'motor',
      model: 'Testmot',
      newCount: 3,
      usedCount: 2,
    });
    assert.deepEqual(parseFleetEditPhrase('I have 3 new Testmot motors'), {
      kind: 'set-stock',
      category: 'motor',
      model: 'Testmot',
      newCount: 3,
    });
    assert.deepEqual(parseFleetEditPhrase('I have 3 new and 2 used Testmot motors'), {
      kind: 'set-stock',
      category: 'motor',
      model: 'Testmot',
      newCount: 3,
      usedCount: 2,
    });
  });

  it('leaves crash and inventory phrases to the existing handler', () => {
    assert.equal(parseFleetEditPhrase('ho crashato Smoke, motore sinistro inferiore rotto'), undefined);
    assert.equal(parseFleetEditPhrase('quanti ne sono rimasti di scorta?'), undefined);
  });
});

describe('F-098-T06: fleet edits against a temp store', () => {
  it('adds a drone with parts by position and a spares record at 0 for each new model, keeping existing counts', () => {
    withStore((store) => {
      seedSmoke(store);
      const result = handleFleetEditChat(
        store.fleet,
        'nuovo drone Ghost, frame Apex 5, motori Testmot 2207 1750KV, fc Generic F7 FC',
      );
      assert.equal(result.handled, true);
      assert.equal(result.needsAnswer, undefined);
      assert.match(result.reply!, /Added drone Ghost/);
      assert.equal(store.fleet.getDroneByName('Ghost')?.frame, 'Apex 5');
      const parts = store.fleet.listParts('Ghost');
      assert.deepEqual(
        parts.filter((p) => p.category === 'motor').map((p) => p.position),
        ['front-left', 'front-right', 'rear-left', 'rear-right'],
      );
      assert.ok(parts.some((p) => p.category === 'frame' && p.position === 'main' && p.componentModel === 'Apex 5'));
      assert.ok(parts.some((p) => p.category === 'fc' && p.position === 'main'));
      assert.deepEqual([store.fleet.getSpare('Apex 5')?.newCount, store.fleet.getSpare('Apex 5')?.usedCount], [0, 0]);
      // An existing spares record keeps its counts.
      assert.equal(store.fleet.getSpare('Testmot 2207 1750KV')?.newCount, 1);
      assert.equal(store.fleet.getSpare('Testmot 2207 1750KV')?.usedCount, 1);
    });
  });

  it('re-adding the same drone is idempotent', () => {
    withStore((store) => {
      const phrase = 'new drone Ghost, frame Apex 5, motors Testmot 2207 1750KV';
      handleFleetEditChat(store.fleet, phrase);
      store.fleet.upsertSpare({ componentModel: 'Apex 5', category: 'frame', newCount: 2, usedCount: 0 });
      const again = handleFleetEditChat(store.fleet, phrase);
      assert.equal(again.handled, true);
      assert.match(again.reply!, /already/i);
      assert.equal(store.fleet.listDrones().length, 1);
      assert.equal(store.fleet.listParts('Ghost').length, 5);
      assert.equal(store.fleet.getSpare('Apex 5')?.newCount, 2);
    });
  });

  it('replaces a part: the old one is marked removed, the new one installed, its spares record added', () => {
    withStore((store) => {
      seedSmoke(store);
      const result = handleFleetEditChat(
        store.fleet,
        'sostituito motore anteriore sinistro di Smoke con Testmot 2207 1950KV',
        '2026-11-24T10:00:00.000Z',
      );
      assert.equal(result.handled, true);
      assert.match(result.reply!, /Replaced Smoke motor \(front-left\): Testmot 2207 1750KV → Testmot 2207 1950KV/);
      const slot = store.fleet.listParts('Smoke').filter((p) => p.category === 'motor' && p.position === 'front-left');
      assert.deepEqual(slot.map((p) => [p.componentModel, p.status]).sort(), [
        ['Testmot 2207 1750KV', 'removed'],
        ['Testmot 2207 1950KV', 'installed'],
      ]);
      assert.deepEqual(
        [store.fleet.getSpare('Testmot 2207 1950KV')?.newCount, store.fleet.getSpare('Testmot 2207 1950KV')?.usedCount],
        [0, 0],
      );
      // Spare counts change only when a phrase explicitly says so.
      assert.equal(store.fleet.getSpare('Testmot 2207 1750KV')?.newCount, 1);
      // The crash log finds the installed part at that slot, not the removed one.
      const crash = store.fleet.recordCrash({
        droneName: 'Smoke',
        category: 'motore',
        position: 'anteriore sinistro',
        damage: 'rotto',
      });
      assert.equal(crash.componentModel, 'Testmot 2207 1950KV');
      // The import still sees the slot as present.
      const report = store.fleet.importFleet({
        version: 1,
        drones: [{ name: 'Smoke', parts: [{ category: 'motor', model: 'Testmot 2207 1750KV', positions: QUAD }] }],
      });
      assert.equal(report.parts.created, 0);
    });
  });

  it('replaces a single-slot part without a position', () => {
    withStore((store) => {
      seedSmoke(store);
      const result = handleFleetEditChat(store.fleet, 'replaced Smoke fc with Generic H7 FC');
      assert.equal(result.needsAnswer, undefined, result.reply);
      const fc = store.fleet.listParts('Smoke').filter((p) => p.category === 'fc' && p.status === 'installed');
      assert.deepEqual(
        fc.map((p) => p.componentModel),
        ['Generic H7 FC'],
      );
    });
  });

  it('sets new and used counts for a model', () => {
    withStore((store) => {
      seedSmoke(store);
      assert.match(handleFleetEditChat(store.fleet, 'ho 3 motori Testmot nuovi').reply!, /3 new, 1 used/);
      assert.match(handleFleetEditChat(store.fleet, 'I have 2 used Testmot motors').reply!, /3 new, 2 used/);
      handleFleetEditChat(store.fleet, 'ho 0 motori Testmot nuovi e 4 usati');
      const spare = store.fleet.getSpare('Testmot 2207 1750KV')!;
      assert.deepEqual([spare.newCount, spare.usedCount], [0, 4]);
    });
  });
});

describe('F-098-T06: ambiguous phrases ask instead of guessing', () => {
  const cases: Array<[string, string, RegExp]> = [
    ['unknown drone', 'sostituito motore anteriore sinistro di Phantom con Testmot 2207 1950KV', /Phantom/],
    ['missing position', 'sostituito motore di Smoke con Testmot 2207 1950KV', /front-left.*front-right/],
    ['unknown position', "replaced Smoke's middle motor with Testmot 2207 1950KV", /position/i],
    ['model matching several spares', 'ho 3 motori Testmot nuovi', /Testmot 2207 1750KV.*Testmot 2207 2450KV/],
    ['model matching no spare', 'I have 3 new Zzz motors', /Zzz/],
    ['unknown part category', 'nuovo drone Ghost, frame Apex 5, flusso Generic 9000', /flusso/],
    ['part without a model', 'new drone Ghost, frame Apex 5, motors', /motor/],
  ];
  for (const [name, phrase, question] of cases) {
    it(name, () => {
      withStore((store) => {
        seedSmoke(store);
        store.fleet.upsertSpare({
          componentModel: 'Testmot 2207 2450KV',
          category: 'motor',
          newCount: 0,
          usedCount: 0,
        });
        const before = JSON.stringify([
          store.fleet.listDrones(),
          store.fleet.listParts('Smoke'),
          store.fleet.listSpares(),
        ]);
        const result = handleFleetEditChat(store.fleet, phrase);
        assert.equal(result.handled, true);
        assert.equal(result.needsAnswer, true);
        assert.match(result.reply!, question);
        assert.equal(
          JSON.stringify([store.fleet.listDrones(), store.fleet.listParts('Smoke'), store.fleet.listSpares()]),
          before,
          'nothing changes',
        );
      });
    });
  }
});

describe('F-098-T06: existing fleet databases keep their parts when replacements become possible', () => {
  it('migrates the old one-row-per-slot table without losing parts or crash links', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nerv-fleet-migrate-'));
    try {
      const db = new DatabaseSync(join(dir, 'fleet.sqlite'));
      db.exec(`
        CREATE TABLE drones(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, frame TEXT, notes TEXT, created_at TEXT NOT NULL);
        CREATE TABLE drone_parts(
          id TEXT PRIMARY KEY,
          drone_id TEXT NOT NULL REFERENCES drones(id) ON DELETE CASCADE,
          category TEXT NOT NULL,
          position TEXT NOT NULL,
          component_model TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'installed',
          installed_at TEXT NOT NULL,
          UNIQUE(drone_id, category, position)
        );
        CREATE TABLE drone_crashes(
          id TEXT PRIMARY KEY,
          drone_id TEXT NOT NULL REFERENCES drones(id) ON DELETE CASCADE,
          part_id TEXT REFERENCES drone_parts(id) ON DELETE SET NULL,
          category TEXT NOT NULL, position TEXT NOT NULL, component_model TEXT, damage TEXT NOT NULL,
          spare_used TEXT, crashed_at TEXT NOT NULL
        );
        INSERT INTO drones VALUES ('d1', 'Smoke', NULL, NULL, '2026-01-01T00:00:00.000Z');
        INSERT INTO drone_parts VALUES ('p1', 'd1', 'motor', 'front-left', 'Testmot 2207 1750KV', 'damaged', '2026-01-01T00:00:00.000Z');
        INSERT INTO drone_crashes VALUES ('c1', 'd1', 'p1', 'motor', 'front-left', 'Testmot 2207 1750KV', 'rotto', NULL, '2026-01-02T00:00:00.000Z');
      `);
      const fleet = new FleetStore(db);
      assert.equal(fleet.getCrash('c1')?.partId, 'p1');
      assert.equal(fleet.getPart('p1')?.status, 'damaged');
      const replaced = fleet.replacePart({
        droneName: 'Smoke',
        category: 'motor',
        position: 'front-left',
        componentModel: 'Testmot 2207 1950KV',
      });
      assert.equal(replaced.removed?.id, 'p1');
      assert.equal(fleet.getPart('p1')?.status, 'removed');
      assert.equal(fleet.getCrash('c1')?.partId, 'p1');
      // A second FleetStore on the migrated table is a no-op.
      new FleetStore(db);
      assert.equal(fleet.listParts('Smoke').length, 2);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// The fleet tables as they were before F-098-T06 (one row per slot as a table constraint).
const OLD_LAYOUT = `
  CREATE TABLE drones(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, frame TEXT, notes TEXT, created_at TEXT NOT NULL);
  CREATE TABLE drone_parts(
    id TEXT PRIMARY KEY,
    drone_id TEXT NOT NULL REFERENCES drones(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    position TEXT NOT NULL,
    component_model TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'installed',
    installed_at TEXT NOT NULL,
    UNIQUE(drone_id, category, position)
  );
  CREATE TABLE drone_crashes(
    id TEXT PRIMARY KEY,
    drone_id TEXT NOT NULL REFERENCES drones(id) ON DELETE CASCADE,
    part_id TEXT REFERENCES drone_parts(id) ON DELETE SET NULL,
    category TEXT NOT NULL, position TEXT NOT NULL, component_model TEXT, damage TEXT NOT NULL,
    spare_used TEXT, crashed_at TEXT NOT NULL
  );
  INSERT INTO drones VALUES ('d1', 'Smoke', NULL, NULL, '2026-01-01T00:00:00.000Z');
`;

function withOldDb(rows: string, work: (db: DatabaseSync) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-fleet-migrate-'));
  const db = new DatabaseSync(join(dir, 'fleet.sqlite'));
  try {
    db.exec(OLD_LAYOUT + rows);
    work(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function partsTableSql(db: DatabaseSync): string {
  return (
    db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'drone_parts'").get() as {
      sql: string;
    }
  ).sql;
}

describe('F-098-T06 review: the drone_parts rebuild is safe for crash links and old raw values', () => {
  it('refuses to rebuild inside an open transaction, where foreign keys cannot be switched off', () => {
    withOldDb(
      `INSERT INTO drone_parts VALUES ('p1', 'd1', 'motor', 'front-left', 'Testmot 2207 1750KV', 'damaged', '2026-01-01T00:00:00.000Z');
       INSERT INTO drone_crashes VALUES ('c1', 'd1', 'p1', 'motor', 'front-left', 'Testmot 2207 1750KV', 'rotto', NULL, '2026-01-02T00:00:00.000Z');`,
      (db) => {
        db.exec('BEGIN');
        assert.throws(() => new FleetStore(db), /transaction/i);
        db.exec('ROLLBACK');
        assert.match(partsTableSql(db), /UNIQUE\(drone_id, category, position\)/);
        const fleet = new FleetStore(db);
        assert.equal(fleet.getCrash('c1')?.partId, 'p1');
      },
    );
  });

  it('rewrites stored categories and positions through the shared normalisers, keeping ids and crash links', () => {
    withOldDb(
      `INSERT INTO drone_parts VALUES ('p1', 'd1', 'motors', 'sinistra posteriore', 'Testmot 2207 1750KV', 'damaged', '2026-01-01T00:00:00.000Z');
       INSERT INTO drone_parts VALUES ('p2', 'd1', 'Motore', 'front left', 'Testmot 2207 1750KV', 'installed', '2026-01-01T00:00:00.000Z');
       INSERT INTO drone_crashes VALUES ('c1', 'd1', 'p1', 'motor', 'rear-left', 'Testmot 2207 1750KV', 'rotto', NULL, '2026-01-02T00:00:00.000Z');`,
      (db) => {
        const fleet = new FleetStore(db);
        assert.deepEqual([fleet.getPart('p1')?.category, fleet.getPart('p1')?.position], ['motor', 'rear-left']);
        assert.deepEqual([fleet.getPart('p2')?.category, fleet.getPart('p2')?.position], ['motor', 'front-left']);
        assert.equal(fleet.getCrash('c1')?.partId, 'p1');
        const replaced = fleet.replacePart({
          droneName: 'Smoke',
          category: 'motore',
          position: 'posteriore sinistro',
          componentModel: 'Testmot 2207 1950KV',
        });
        assert.equal(replaced.removed?.id, 'p1');
        const crash = fleet.recordCrash({
          droneName: 'Smoke',
          category: 'motor',
          position: 'front-left',
          damage: 'rotto',
        });
        assert.equal(crash.partId, 'p2');
      },
    );
  });

  it('aborts the rebuild, naming the slot, when two current parts normalise into one slot', () => {
    withOldDb(
      `INSERT INTO drone_parts VALUES ('p1', 'd1', 'motor', 'front left', 'Testmot 2207 1750KV', 'installed', '2026-01-01T00:00:00.000Z');
       INSERT INTO drone_parts VALUES ('p2', 'd1', 'motor', 'front-left', 'Testmot 2207 1950KV', 'installed', '2026-01-01T00:00:00.000Z');`,
      (db) => {
        assert.throws(() => new FleetStore(db), /Smoke.*motor.*front-left/);
        assert.match(partsTableSql(db), /UNIQUE\(drone_id, category, position\)/);
        assert.equal((db.prepare('SELECT count(*) AS n FROM drone_parts').get() as { n: number }).n, 2);
        assert.equal((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys, 1);
      },
    );
  });
});

describe('F-098-T06 review: a failed fleet migration is contained', () => {
  it('the store still opens and serves non-fleet requests; fleet tools refuse and doctor reports the error', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nerv-fleet-contained-'));
    try {
      const path = join(dir, 'nerv.sqlite');
      const seed = new DatabaseSync(path);
      seed.exec(
        OLD_LAYOUT +
          `INSERT INTO drone_parts VALUES ('p1', 'd1', 'motor', 'front left', 'Testmot 2207 1750KV', 'installed', '2026-01-01T00:00:00.000Z');
           INSERT INTO drone_parts VALUES ('p2', 'd1', 'motor', 'front-left', 'Testmot 2207 1950KV', 'installed', '2026-01-01T00:00:00.000Z');`,
      );
      seed.close();
      const store = new Store(path);
      try {
        const backend = store as unknown as Parameters<typeof execute>[0];
        // Non-fleet work still runs.
        assert.deepEqual(execute(backend, 'batteries.list', {}), []);
        // Fleet tools refuse with the migration error and the slot to fix.
        assert.throws(
          () => execute(backend, 'fleet.chat', { phrase: 'ho 3 motori Testmot nuovi' }),
          /Fleet is unavailable.*Smoke.*motor.*front-left.*removed/s,
        );
        assert.throws(() => store.fleet.listDrones(), /Fleet is unavailable/);
        const doctor = store.doctor() as { fleet?: { error: string } };
        assert.match(doctor.fleet?.error ?? '', /Smoke.*motor.*front-left/);
      } finally {
        store.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('F-098-T06: fleet.chat executor joins the edit phrases to the real store', () => {
  it('adds, replaces and sets stock through fleet.chat, then the crash phrases still work', () => {
    withStore((store) => {
      const run = (phrase: string) =>
        execute(store as unknown as Parameters<typeof execute>[0], 'fleet.chat', { phrase }) as {
          handled: boolean;
          reply?: string;
          needsAnswer?: boolean;
        };
      assert.match(run('nuovo drone Ghost, frame Apex 5, motori Testmot 2207 1750KV').reply!, /Added drone Ghost/);
      assert.match(
        run('sostituito motore posteriore destro di Ghost con Testmot 2207 1950KV').reply!,
        /Replaced Ghost motor \(rear-right\)/,
      );
      assert.match(run('ho 2 motori Testmot 2207 1950KV nuovi').reply!, /2 new, 0 used/);
      assert.equal(run('sostituito motore di Ghost con Testmot 2207 1950KV').needsAnswer, true);
      assert.match(
        run('ho crashato Ghost, motore destro inferiore rotto (scorta nuova)').reply!,
        /Recorded crash for Ghost: motor \(rear-right\) rotto \[Testmot 2207 1950KV\], used new spare/,
      );
      assert.equal(store.fleet.getSpare('Testmot 2207 1950KV')?.newCount, 1);
    });
  });
});

describe('B-137: adding a drone with its model and version never misreads them as part categories', () => {
  it('records "modello M, v. 5.1" and English "model M, v. 5.1" with joined version as frame and drone_models link', () => {
    withStore((store) => {
      const run = (phrase: string) =>
        execute(store as unknown as Parameters<typeof execute>[0], 'fleet.chat', { phrase }) as {
          handled: boolean;
          reply?: string;
          needsAnswer?: boolean;
        };

      const itReply = run('aggiungi il drone Testdrone, modello Testframe 5, v. 5.1');
      assert.equal(itReply.handled, true);
      assert.equal(itReply.needsAnswer, undefined);
      assert.equal(store.fleet.getDroneByName('Testdrone')?.frame, 'Testframe 5 v5.1');
      assert.equal(store.fleet.droneModel('Testdrone')?.name, 'Testframe 5 v5.1');

      const enReply = run('add drone Testwing, model Testwing 4, v. 5.1');
      assert.equal(enReply.handled, true);
      assert.equal(enReply.needsAnswer, undefined);
      assert.equal(store.fleet.getDroneByName('Testwing')?.frame, 'Testwing 4 v5.1');
      assert.equal(store.fleet.droneModel('Testwing')?.name, 'Testwing 4 v5.1');

      const withParts = run('aggiungi il drone Testmicro, modello Testmicro 3, v3.2, motori Testmot 1404');
      assert.equal(withParts.handled, true);
      assert.equal(withParts.needsAnswer, undefined);
      assert.equal(store.fleet.getDroneByName('Testmicro')?.frame, 'Testmicro 3 v3.2');
      assert.equal(store.fleet.droneModel('Testmicro')?.name, 'Testmicro 3 v3.2');
      assert.equal(store.fleet.listParts('Testmicro').filter((p) => p.category === 'motor').length, 4);

      const enVersionWord = run('add new drone Testcine, model Testcine 35, version 2.0');
      assert.equal(enVersionWord.handled, true);
      assert.equal(enVersionWord.needsAnswer, undefined);
      assert.equal(store.fleet.getDroneByName('Testcine')?.frame, 'Testcine 35 v2.0');
      assert.equal(store.fleet.droneModel('Testcine')?.name, 'Testcine 35 v2.0');

      // Links to an existing drone_models row and inherits its printed parts when already present.
      store.fleet.addDroneModel({ name: 'Prebuilt 5 v5.1' });
      store.fleet.addPrintedPart(
        'Prebuilt 5 v5.1',
        { name: 'motor foot', file: 'prebuilt-5/foot.stl', count: 4, profile: 'Test TPU' },
        ['Test TPU'],
      );
      const linked = run('aggiungi il drone Testlinked, modello Prebuilt 5, v. 5.1');
      assert.equal(linked.handled, true);
      assert.equal(linked.needsAnswer, undefined);
      assert.equal(store.fleet.droneModel('Testlinked')?.name, 'Prebuilt 5 v5.1');
      assert.equal(store.fleet.printedPartsForDrone('Testlinked').length, 1);
    });
  });

  it('"con frame <model> v5.1" and "with model <model>" join the name without a comma (the owner\'s second phrase)', () => {
    withStore((store) => {
      const run = (phrase: string) =>
        execute(store as unknown as Parameters<typeof execute>[0], 'fleet.chat', { phrase }) as {
          handled: boolean;
          needsAnswer?: boolean;
        };
      const withFrame = run('aggiungi il drone Testsmoke con frame Testframe 5 v5.1');
      assert.equal(withFrame.handled, true);
      assert.equal(withFrame.needsAnswer, undefined);
      assert.equal(store.fleet.getDroneByName('Testsmoke')?.frame, 'Testframe 5 v5.1');

      const withModel = run('add drone Testhaze with model Testframe 6, v. 2.0');
      assert.equal(withModel.handled, true);
      assert.equal(withModel.needsAnswer, undefined);
      assert.equal(store.fleet.droneModel('Testhaze')?.name, 'Testframe 6 v2.0');
    });
  });

  it('answering a follow-up with a version segment joins the version and never loops back to the category question', () => {
    withStore((store) => {
      // Missing model name asks once for the model (not a part category), then the answered phrase succeeds.
      const missingModel = handleFleetEditChat(store.fleet, 'aggiungi il drone Testask, modello, v. 5.1');
      assert.equal(missingModel.handled, true);
      assert.equal(missingModel.needsAnswer, true);
      assert.doesNotMatch(missingModel.reply ?? '', /part category/i);

      const answeredModel = handleFleetEditChat(store.fleet, 'aggiungi il drone Testask, modello Testframe 7, v. 5.1');
      assert.equal(answeredModel.handled, true);
      assert.equal(answeredModel.needsAnswer, undefined);
      assert.equal(store.fleet.getDroneByName('Testask')?.frame, 'Testframe 7 v5.1');

      // Unknown category word before ", v. 5.1": clarifying to "frame" joins v5.1 onto the frame instead of rejecting "v. 5.1".
      const unknownCat = handleFleetEditChat(store.fleet, 'aggiungi il drone Testloop, scocca Testframe 6, v. 5.1');
      assert.equal(unknownCat.handled, true);
      assert.equal(unknownCat.needsAnswer, true);
      assert.match(unknownCat.reply ?? '', /scocca/);

      const clarifiedFrame = handleFleetEditChat(store.fleet, 'aggiungi il drone Testloop, frame Testframe 6, v. 5.1');
      assert.equal(clarifiedFrame.handled, true);
      assert.equal(clarifiedFrame.needsAnswer, undefined);
      assert.equal(store.fleet.getDroneByName('Testloop')?.frame, 'Testframe 6 v5.1');
    });
  });
});

describe('B-138: fleet.chat answers category-scoped spares queries with none-registered or new/used counts', () => {
  it('reports when no spares exist for the asked category instead of listing another category, and gives new/used counts when present', () => {
    withStore((store) => {
      const run = (phrase: string) =>
        execute(store as unknown as Parameters<typeof execute>[0], 'fleet.chat', { phrase }) as {
          handled: boolean;
          reply?: string;
        };
      // Invented fleet with only a frame spare row at 0/0 and no motor spares.
      run('nuovo drone Testquad, frame Testframe 5');
      assert.equal(store.fleet.listSpares().length, 1);
      assert.equal(store.fleet.listSpares('motor').length, 0);

      for (const phrase of ['quanti motori di scorta mi restano?', 'how many spare motors do I have?']) {
        const res = run(phrase);
        assert.equal(res.handled, true, phrase);
        assert.match(res.reply ?? '', /no motor spares registered/i, phrase);
        assert.doesNotMatch(res.reply ?? '', /Testframe 5/, phrase);
      }

      store.fleet.upsertSpare({
        componentModel: 'Testmot 2207 1850KV',
        category: 'motor',
        newCount: 3,
        usedCount: 2,
      });

      for (const phrase of ['quanti motori di scorta mi restano?', 'how many spare motors do I have?']) {
        const res = run(phrase);
        assert.equal(res.handled, true, phrase);
        assert.match(res.reply ?? '', /Testmot 2207 1850KV.*3 new, 2 used/, phrase);
        assert.doesNotMatch(res.reply ?? '', /Testframe 5/, phrase);
      }

      // A question about the drones, not the spares shelf, is not read as a spares query.
      for (const phrase of ['quanti droni hanno il gps?', 'does any drone have a camera?']) {
        assert.equal(run(phrase).handled, false, phrase);
      }
      assert.match(run('motors left?').reply ?? '', /Testmot 2207 1850KV/);

      const all = run('quali ricambi di scorta mi restano?');
      assert.equal(all.handled, true);
      assert.match(all.reply ?? '', /Testframe 5/);
      assert.match(all.reply ?? '', /Testmot 2207 1850KV/);
    });
  });
});
