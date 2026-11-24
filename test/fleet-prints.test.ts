import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import { execute } from '../src/executors.ts';
import { FleetStore, parseFleetImport, validatePrintPath } from '../src/fleet.ts';
import { handleFleetEditChat, parseFleetEditPhrase } from '../src/fleet-chat.ts';
import { detectToolDomains } from '../src/misato.ts';
import { resolvePrintFile } from '../src/print-library.ts';
import { readSlicerProfiles } from '../src/slicer.ts';
import { Store } from '../src/store.ts';

// Invented models, parts, paths and profiles only: the owner's real list stays in private fleet data.
const PROFILES = ['Test TPU 0.4', 'Test PLA 0.4'];
const PROFILE_FILE = PROFILES.map((name) => ({
  name,
  machineProfile: `${name}.machine.json`,
  materialProfile: `${name}.filament.json`,
}));

function withStore(work: (store: Store, home: string) => void): void {
  const home = mkdtempSync(join(tmpdir(), 'nerv-fleet-prints-'));
  const store = new Store(join(home, 'nerv.sqlite'), undefined, { home });
  try {
    work(store, home);
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
}

/** Two invented models sharing one enclosure file; Kite also has its own feet and a two-object band file. */
const PRINT_FLEET: {
  version: 1;
  models: Array<{ name: string; parts: Array<Record<string, unknown>> }>;
  drones: Array<{ name: string; model: string; parts: unknown[] }>;
} = {
  version: 1,
  models: [
    {
      name: 'Kite 5',
      parts: [
        { name: 'motor foot', aliases: ['feet'], file: 'kite-5/foot.stl', count: 4, profile: 'test tpu 0.4' },
        {
          name: 'camera band',
          file: 'kite-5/camera-bands.3mf',
          count: 1,
          objectsPerPrint: 2,
          variant: 'left+right',
          profile: 'Test TPU 0.4',
        },
        { name: 'sensor case', file: 'shared/sensor-case.stl', profile: 'Test TPU 0.4' },
      ],
    },
    { name: 'Moth 2', parts: [{ name: 'sensor case', file: 'shared/sensor-case.stl' }] },
  ],
  drones: [
    { name: 'Kestrel', model: 'Kite 5', parts: [] },
    { name: 'Wren', model: 'Kite 5', parts: [] },
    { name: 'Gnat', model: 'Moth 2', parts: [] },
  ],
};

describe('F-121-T01: part file paths stay inside the print library', () => {
  it('accepts a relative path with a model folder and a slicer extension', () => {
    assert.equal(validatePrintPath('kite-5/foot.stl'), 'kite-5/foot.stl');
    assert.equal(validatePrintPath('  shared/sensor-case.3mf '), 'shared/sensor-case.3mf');
  });

  for (const [path, reason] of [
    ['/Users/someone/prints/foot.stl', /relative/],
    ['~/prints/foot.stl', /relative/],
    ['C:/prints/foot.stl', /relative/],
    ['\\\\server\\share\\foot.stl', /relative|\//],
    ['kite-5\\foot.stl', /\//],
    ['kite-5/../../secret/foot.stl', /\.\./],
    ['../foot.stl', /\.\./],
    ['kite-5//foot.stl', /empty|\./],
    ['./foot.stl', /\./],
    ['kite-5/foot.txt', /\.stl/],
    ['', /required/],
  ] as const) {
    it(`refuses ${JSON.stringify(path)}`, () => {
      assert.throws(() => validatePrintPath(path), reason);
    });
  }

  it('resolves a file in the library, reports a missing one by its relative path, and refuses a link that leaves it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nerv-print-lib-'));
    try {
      const root = join(dir, 'prints');
      const outside = join(dir, 'outside');
      mkdirSync(join(root, 'kite-5'), { recursive: true });
      mkdirSync(outside);
      writeFileSync(join(root, 'kite-5', 'foot.stl'), 'solid test\nendsolid test\n');
      writeFileSync(join(outside, 'secret.stl'), 'solid x\nendsolid x\n');
      symlinkSync(join(outside, 'secret.stl'), join(root, 'kite-5', 'escape.stl'));
      symlinkSync(outside, join(root, 'linked-dir'));
      symlinkSync(join(root, 'kite-5', 'foot.stl'), join(root, 'kite-5', 'alias.stl'));

      const ok = resolvePrintFile(root, 'kite-5/foot.stl');
      assert.equal(ok.status, 'ok');
      assert.equal(resolvePrintFile(root, 'kite-5/alias.stl').status, 'ok');

      const missing = resolvePrintFile(root, 'kite-5/tail.stl');
      assert.equal(missing.status, 'missing');
      assert.match(missing.status === 'missing' ? missing.reason : '', /prints\/kite-5\/tail\.stl/);

      for (const escape of ['kite-5/escape.stl', 'linked-dir/secret.stl']) {
        const refused = resolvePrintFile(root, escape);
        assert.equal(refused.status, 'refused', escape);
        assert.match(refused.status === 'refused' ? refused.reason : '', /outside the print library/);
      }
      assert.equal(resolvePrintFile(root, '../outside/secret.stl').status, 'refused');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('F-121-T01: printed parts on drone models', () => {
  it('a drone inherits its model parts; a shared file is one part on two models', () => {
    withStore((store) => {
      const fleet = store.fleet;
      fleet.addDroneModel({ name: 'Kite 5' });
      fleet.addDroneModel({ name: 'Moth 2' });
      fleet.addDrone({ name: 'Kestrel' });
      fleet.addDrone({ name: 'Gnat' });
      fleet.addPrintedPart(
        'Kite 5',
        { name: 'motor foot', file: 'kite-5/foot.stl', count: 4, profile: 'Test TPU 0.4' },
        PROFILES,
      );
      const kiteCase = fleet.addPrintedPart(
        'Kite 5',
        { name: 'sensor case', file: 'shared/sensor-case.stl', profile: 'Test TPU 0.4' },
        PROFILES,
      );
      const mothCase = fleet.addPrintedPart('Moth 2', { name: 'sensor case' }, PROFILES);
      assert.equal(kiteCase.created, true);
      assert.equal(mothCase.created, false);
      assert.equal(mothCase.part.id, kiteCase.part.id);

      fleet.linkDroneModel('Kestrel', 'Kite 5');
      fleet.linkDroneModel('Gnat', 'moth 2');
      const kestrel = fleet.printedPartsForDrone('Kestrel');
      assert.deepEqual(
        kestrel.map((p) => [p.model, p.name, p.file, p.count, p.material, p.slicerProfile, p.externalSpool]),
        [
          ['Kite 5', 'motor foot', 'kite-5/foot.stl', 4, 'TPU', 'Test TPU 0.4', true],
          ['Kite 5', 'sensor case', 'shared/sensor-case.stl', 1, 'TPU', 'Test TPU 0.4', true],
        ],
      );
      const gnat = fleet.printedPartsForDrone('Gnat');
      assert.deepEqual(
        gnat.map((p) => [p.name, p.file]),
        [['sensor case', 'shared/sensor-case.stl']],
      );
      assert.equal(gnat[0]!.id, kestrel[1]!.id);
      assert.equal(fleet.droneModel('Gnat')?.name, 'Moth 2');
      assert.deepEqual(fleet.printedPartsForDrone('Nobody'), []);
    });
  });

  it('a file with several objects counts prints, not objects', () => {
    withStore((store) => {
      store.fleet.addDroneModel({ name: 'Kite 5' });
      const { part } = store.fleet.addPrintedPart(
        'Kite 5',
        {
          name: 'camera band',
          file: 'kite-5/camera-bands.3mf',
          count: 1,
          objectsPerPrint: 2,
          variant: 'left+right',
          profile: 'Test TPU 0.4',
        },
        PROFILES,
      );
      assert.equal(part.count, 1);
      assert.equal(part.objectsPerPrint, 2);
      assert.equal(part.variant, 'left+right');
    });
  });

  it('refuses an unknown slicer profile, a bad path, and a shared file with a different profile', () => {
    withStore((store) => {
      const fleet = store.fleet;
      fleet.addDroneModel({ name: 'Kite 5' });
      fleet.addDroneModel({ name: 'Moth 2' });
      assert.throws(
        () =>
          fleet.addPrintedPart('Kite 5', { name: 'foot', file: 'kite-5/foot.stl', profile: 'Mystery PETG' }, PROFILES),
        /Unknown slicer profile "Mystery PETG"\. Allowed profiles: Test TPU 0\.4, Test PLA 0\.4/,
      );
      assert.throws(
        () => fleet.addPrintedPart('Kite 5', { name: 'foot', file: 'kite-5/foot.stl', profile: 'Test TPU 0.4' }, []),
        /Allowed profiles: \(none\)/,
      );
      assert.throws(
        () => fleet.addPrintedPart('Kite 5', { name: 'foot', file: '../foot.stl', profile: 'Test TPU 0.4' }, PROFILES),
        /\.\./,
      );
      assert.throws(
        () => fleet.addPrintedPart('Kite 5', { name: 'foot', file: 'kite-5/foot.stl' }, PROFILES),
        /profile/i,
      );
      fleet.addPrintedPart('Kite 5', { name: 'case', file: 'shared/case.stl', profile: 'Test TPU 0.4' }, PROFILES);
      assert.throws(
        () =>
          fleet.addPrintedPart('Moth 2', { name: 'case', file: 'shared/case.stl', profile: 'Test PLA 0.4' }, PROFILES),
        /shared\/case\.stl.*Test TPU 0\.4/,
      );
      assert.throws(() => fleet.addPrintedPart('Moth 2', { name: 'tail' }, PROFILES), /file/i);
      assert.throws(
        () => fleet.addPrintedPart('Nope', { name: 'tail', file: 'x/tail.stl', profile: 'Test TPU 0.4' }, PROFILES),
        /model not found/i,
      );
      assert.equal(fleet.printedPartsForModel('Moth 2').length, 0);
    });
  });

  it('adds the tables to a live fleet database without touching its rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nerv-fleet-prints-migrate-'));
    try {
      const path = join(dir, 'nerv.sqlite');
      const old = new DatabaseSync(path);
      // The F-098-T06 fleet schema as shipped, with one drone, one part and one crash.
      old.exec(`CREATE TABLE drones(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, frame TEXT, notes TEXT, created_at TEXT NOT NULL);
CREATE TABLE drone_parts(id TEXT PRIMARY KEY, drone_id TEXT NOT NULL REFERENCES drones(id) ON DELETE CASCADE, category TEXT NOT NULL,
  position TEXT NOT NULL, component_model TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'installed', installed_at TEXT NOT NULL);
CREATE UNIQUE INDEX drone_parts_slot_idx ON drone_parts(drone_id, category, position) WHERE status <> 'removed';
CREATE TABLE spares(id TEXT PRIMARY KEY, component_model TEXT NOT NULL UNIQUE, category TEXT NOT NULL, new_count INTEGER NOT NULL DEFAULT 0,
  used_count INTEGER NOT NULL DEFAULT 0, notes TEXT, updated_at TEXT NOT NULL);
CREATE TABLE drone_crashes(id TEXT PRIMARY KEY, drone_id TEXT NOT NULL REFERENCES drones(id) ON DELETE CASCADE, part_id TEXT REFERENCES drone_parts(id) ON DELETE SET NULL,
  category TEXT NOT NULL, position TEXT NOT NULL, component_model TEXT, damage TEXT NOT NULL, spare_used TEXT, crashed_at TEXT NOT NULL);
INSERT INTO drones VALUES ('drone-1', 'Kestrel', 'Test frame', NULL, '2026-01-01T00:00:00.000Z');
INSERT INTO drone_parts VALUES ('part-1', 'drone-1', 'motor', 'front-left', 'Generic 2207', 'damaged', '2026-01-01T00:00:00.000Z');
INSERT INTO drone_crashes VALUES ('crash-1', 'drone-1', 'part-1', 'motor', 'front-left', 'Generic 2207', 'rotto', NULL, '2026-01-02T00:00:00.000Z');`);
      const dump = (db: DatabaseSync) =>
        JSON.stringify(
          ['drones', 'drone_parts', 'spares', 'drone_crashes'].map((t) => db.prepare(`SELECT * FROM ${t}`).all()),
        );
      const before = dump(old);
      old.exec('PRAGMA foreign_keys = ON');
      const fleet = new FleetStore(old);
      assert.equal(dump(old), before);
      fleet.addDroneModel({ name: 'Kite 5' });
      fleet.linkDroneModel('Kestrel', 'Kite 5');
      assert.equal(fleet.droneModel('Kestrel')?.name, 'Kite 5');
      assert.equal(dump(old), before, 'linking a model leaves the drone row as it was');
      old.close();
      const reopened = new DatabaseSync(path);
      new FleetStore(reopened);
      assert.equal(dump(reopened), before);
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('F-121-T01: fleet import adds models, printed parts and drone links', () => {
  it('imports a shared part once, links drones and is idempotent', () => {
    withStore((store) => {
      const file = parseFleetImport(PRINT_FLEET, { slicerProfiles: PROFILES });
      const first = store.fleet.importFleet(file, undefined, { slicerProfiles: PROFILES });
      assert.deepEqual(first.models, { created: ['Kite 5', 'Moth 2'], present: [] });
      assert.deepEqual(first.printedParts, { created: 3, shared: 1, present: 0 });
      assert.deepEqual(first.droneModels, { linked: 3, present: 0 });
      assert.equal(store.fleet.printedPartsForDrone('Wren').length, 3);
      assert.equal(store.fleet.printedPartsForDrone('Gnat')[0]!.file, 'shared/sensor-case.stl');
      assert.equal(
        store.fleet.printedPartsForModel('Kite 5').find((p) => p.name === 'motor foot')?.slicerProfile,
        'Test TPU 0.4',
      );
      assert.deepEqual(store.fleet.printedPartsForModel('Kite 5').find((p) => p.name === 'motor foot')?.aliases, [
        'feet',
      ]);

      const again = store.fleet.importFleet(parseFleetImport(PRINT_FLEET, { slicerProfiles: PROFILES }), undefined, {
        slicerProfiles: PROFILES,
      });
      assert.deepEqual(again.models, { created: [], present: ['Kite 5', 'Moth 2'] });
      assert.deepEqual(again.printedParts, { created: 0, shared: 0, present: 4 });
      assert.deepEqual(again.droneModels, { linked: 0, present: 3 });
    });
  });

  it('refuses an unknown profile by field, an unknown model, and relinking a drone to another model', () => {
    const bad = structuredClone(PRINT_FLEET);
    bad.models[0]!.parts[0]!.profile = 'Mystery PETG';
    assert.throws(
      () => parseFleetImport(bad, { slicerProfiles: PROFILES }),
      /models\[0\]\.parts\[0\]\.profile: Unknown slicer profile "Mystery PETG"/,
    );
    assert.throws(
      () => parseFleetImport(PRINT_FLEET),
      /models\[0\]\.parts\[0\]\.profile: Unknown slicer profile .*\(none\)/,
    );
    const badPath = structuredClone(PRINT_FLEET);
    badPath.models[0]!.parts[0]!.file = '/abs/foot.stl';
    assert.throws(() => parseFleetImport(badPath, { slicerProfiles: PROFILES }), /models\[0\]\.parts\[0\]\.file/);
    withStore((store) => {
      assert.throws(
        () =>
          store.fleet.importFleet(
            parseFleetImport({ version: 1, drones: [{ name: 'Kestrel', model: 'Ghost 9', parts: [] }] }),
          ),
        /drones\[0\]\.model: drone model "Ghost 9"/,
      );
      assert.equal(store.fleet.getDroneByName('Kestrel'), undefined, 'the failed import changed nothing');
      store.fleet.importFleet(parseFleetImport(PRINT_FLEET, { slicerProfiles: PROFILES }), undefined, {
        slicerProfiles: PROFILES,
      });
      const moved = structuredClone(PRINT_FLEET);
      moved.drones[0]!.model = 'Moth 2';
      assert.throws(
        () =>
          store.fleet.importFleet(parseFleetImport(moved, { slicerProfiles: PROFILES }), undefined, {
            slicerProfiles: PROFILES,
          }),
        /Kestrel is already a Kite 5/,
      );
    });
  });

  it('nerv fleet import reads the home slicer-profiles.json and nerv fleet prints lists inherited parts with file status', () => {
    const home = mkdtempSync(join(tmpdir(), 'nerv-fleet-prints-cli-'));
    const run = (...a: string[]) =>
      spawnSync(process.execPath, [join('src', 'cli.ts'), 'fleet', ...a], {
        env: { ...process.env, NERV_HOME: home },
        encoding: 'utf8',
      });
    try {
      const file = join(home, 'fleet.json');
      writeFileSync(file, JSON.stringify(PRINT_FLEET));
      const refused = run('import', file);
      assert.notEqual(refused.status, 0);
      assert.match(refused.stderr, /Unknown slicer profile .*\(none\)/);

      writeFileSync(join(home, 'slicer-profiles.json'), JSON.stringify(PROFILE_FILE));
      const imported = run('import', file);
      assert.equal(imported.status, 0, imported.stderr);
      mkdirSync(join(home, 'prints', 'kite-5'), { recursive: true });
      writeFileSync(join(home, 'prints', 'kite-5', 'foot.stl'), 'solid test\nendsolid test\n');

      const prints = run('prints', 'Kestrel');
      assert.equal(prints.status, 0, prints.stderr);
      const listed = JSON.parse(prints.stdout) as Array<{ name: string; count: number; fileStatus: string }>;
      assert.deepEqual(
        listed.map((p) => [p.name, p.count, p.fileStatus]),
        [
          ['camera band', 1, 'missing'],
          ['motor foot', 4, 'ok'],
          ['sensor case', 1, 'missing'],
        ],
      );
      assert.equal((JSON.parse(run('prints', 'Moth 2').stdout) as unknown[]).length, 1);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('reads the slicer profile allowlist from the NERV home', () => {
    const home = mkdtempSync(join(tmpdir(), 'nerv-slicer-profiles-'));
    try {
      assert.deepEqual(readSlicerProfiles(home), []);
      writeFileSync(join(home, 'slicer-profiles.json'), JSON.stringify(PROFILE_FILE));
      assert.deepEqual(
        readSlicerProfiles(home).map((p) => p.name),
        PROFILES,
      );
      writeFileSync(join(home, 'slicer-profiles.json'), JSON.stringify([{ name: 'x' }]));
      assert.throws(() => readSlicerProfiles(home), /slicer-profiles\.json/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('F-121-T01: printed parts by chat', () => {
  it('parses model, link and printed part phrases in Italian and English', () => {
    assert.deepEqual(parseFleetEditPhrase('nuovo modello di drone Kite 5'), { kind: 'add-model', name: 'Kite 5' });
    assert.deepEqual(parseFleetEditPhrase('new drone model Kite 5.'), { kind: 'add-model', name: 'Kite 5' });
    assert.deepEqual(parseFleetEditPhrase('il drone Kestrel è un Kite 5'), {
      kind: 'link-model',
      droneName: 'Kestrel',
      model: 'Kite 5',
    });
    assert.deepEqual(parseFleetEditPhrase('drone Kestrel is a Kite 5'), {
      kind: 'link-model',
      droneName: 'Kestrel',
      model: 'Kite 5',
    });
    const part = {
      kind: 'printed-part',
      model: 'Kite 5',
      part: {
        name: 'motor foot',
        file: 'kite-5/foot.stl',
        count: 4,
        profile: 'Test TPU 0.4',
        aliases: ['feet', 'piedini'],
      },
    };
    assert.deepEqual(
      parseFleetEditPhrase(
        'parte stampata per Kite 5: motor foot, file kite-5/foot.stl, 4 pezzi, profilo Test TPU 0.4, alias feet/piedini',
      ),
      part,
    );
    assert.deepEqual(
      parseFleetEditPhrase(
        'printed part for Kite 5: motor foot, file kite-5/foot.stl, x4, profile Test TPU 0.4, aliases feet/piedini.',
      ),
      part,
    );
    assert.deepEqual(
      parseFleetEditPhrase(
        'parte stampata per Kite 5: camera band, file kite-5/bands.3mf, 2 oggetti, variante left+right, materiale TPU, bobina esterna',
      ),
      {
        kind: 'printed-part',
        model: 'Kite 5',
        part: {
          name: 'camera band',
          file: 'kite-5/bands.3mf',
          objectsPerPrint: 2,
          variant: 'left+right',
          material: 'TPU',
          externalSpool: true,
        },
      },
    );
    assert.equal(parseFleetEditPhrase('parte stampata per Kite 5: foot, colore blu')?.kind, 'ask');
  });

  it('chat phrases unlock the fleet domain', () => {
    for (const request of [
      'parte stampata per Kite 5: motor foot, file kite-5/foot.stl',
      'printed part for Kite 5: motor foot, file kite-5/foot.stl',
      'nuovo modello di drone Kite 5',
      'il drone Kestrel è un Kite 5',
    ]) {
      assert.equal(detectToolDomains({ request }).has('fleet'), true, request);
    }
  });

  it('asks instead of guessing: unknown model, unknown profile, bad path', () => {
    withStore((store) => {
      store.fleet.addDrone({ name: 'Kestrel' });
      const linkUnknown = handleFleetEditChat(store.fleet, 'il drone Kestrel è un Kite 5', undefined, {
        slicerProfiles: PROFILES,
      });
      assert.equal(linkUnknown.needsAnswer, true);
      assert.match(linkUnknown.reply!, /nuovo modello di drone Kite 5/);
      handleFleetEditChat(store.fleet, 'nuovo modello di drone Kite 5');
      for (const phrase of [
        'parte stampata per Kite 5: foot, file kite-5/foot.stl, profilo Mystery PETG',
        'parte stampata per Kite 5: foot, file ../foot.stl, profilo Test TPU 0.4',
        'parte stampata per Ghost 9: foot, file kite-5/foot.stl, profilo Test TPU 0.4',
      ]) {
        const reply = handleFleetEditChat(store.fleet, phrase, undefined, { slicerProfiles: PROFILES });
        assert.equal(reply.needsAnswer, true, phrase);
      }
      assert.equal(store.fleet.printedPartsForModel('Kite 5').length, 0);
    });
  });

  it('fleet.chat adds a model, a part, a shared part and links drones in the real store', () => {
    withStore((store, home) => {
      writeFileSync(join(home, 'slicer-profiles.json'), JSON.stringify(PROFILE_FILE));
      const run = (phrase: string) =>
        execute(store as unknown as Parameters<typeof execute>[0], 'fleet.chat', { phrase }) as {
          handled: boolean;
          reply?: string;
          needsAnswer?: boolean;
        };
      assert.match(run('nuovo drone Kestrel, frame Test 5').reply!, /Added drone Kestrel/);
      assert.match(run('nuovo drone Gnat, frame Test 2').reply!, /Added drone Gnat/);
      assert.match(run('nuovo modello di drone Kite 5').reply!, /Added drone model Kite 5/);
      assert.match(run('new drone model Moth 2').reply!, /Added drone model Moth 2/);
      assert.match(
        run('parte stampata per Kite 5: motor foot, file kite-5/foot.stl, 4 pezzi, profilo test tpu 0.4').reply!,
        /Added printed part motor foot to Kite 5: file kite-5\/foot\.stl, x4, TPU, profile Test TPU 0\.4, external spool/,
      );
      assert.match(
        run('printed part for Kite 5: sensor case, file shared/sensor-case.stl, profile Test TPU 0.4').reply!,
        /Added printed part sensor case/,
      );
      assert.match(
        run('printed part for Moth 2: sensor case').reply!,
        /Shared printed part sensor case .*shared\/sensor-case\.stl.* with Moth 2/,
      );
      assert.match(
        run('il drone Kestrel è un Kite 5').reply!,
        /Kestrel is now a Kite 5; it inherits 2 printed parts: motor foot x4, sensor case x1/,
      );
      assert.match(run('drone Gnat is a Moth 2').reply!, /Gnat is now a Moth 2/);
      assert.equal(
        run('parte stampata per Kite 5: tail, file kite-5/tail.stl, profilo Mystery PETG').needsAnswer,
        true,
      );

      assert.deepEqual(
        store.fleet.printedPartsForDrone('Gnat').map((p) => [p.name, p.file, p.slicerProfile]),
        [['sensor case', 'shared/sensor-case.stl', 'Test TPU 0.4']],
      );
      assert.equal(store.fleet.printedPartsForDrone('Kestrel').length, 2);
    });
  });
});
