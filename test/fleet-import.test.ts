import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { parseFleetImport } from '../src/fleet.ts';
import { databasePath, readScrolls } from '../src/config.ts';
import { Store } from '../src/store.ts';

// Invented fleet: neutral drone names and generic component models.
const FLEET = {
  version: 1,
  drones: [
    {
      name: 'Kestrel',
      frame: '5-inch test frame',
      parts: [
        {
          category: 'motor',
          model: 'Generic 2207 1750KV',
          positions: ['front-left', 'front-right', 'rear-left', 'rear-right'],
        },
        { category: 'fc', model: 'Generic F7 FC' },
      ],
    },
    {
      name: 'Wren',
      notes: 'bench quad',
      parts: [
        { category: 'motor', model: 'Generic 2207 1750KV', positions: ['front-left', 'rear-left'] },
        { category: 'vtx', model: 'Generic Analog VTX' },
      ],
    },
  ],
};

function tempStore(): { dir: string; store: Store } {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-fleet-import-'));
  return { dir, store: new Store(join(dir, 'nerv.sqlite')) };
}

describe('F-098-T05: fleet import file validation', () => {
  it('accepts the documented shape', () => {
    const parsed = parseFleetImport(FLEET);
    assert.equal(parsed.drones.length, 2);
    assert.deepEqual(parsed.drones[0]!.parts[0]!.positions, ['front-left', 'front-right', 'rear-left', 'rear-right']);
    assert.equal(parsed.drones[0]!.parts[1]!.positions, undefined);
  });

  const bad: Array<[string, unknown, RegExp]> = [
    ['not an object', [], /fleet file must be a JSON object/],
    ['wrong version', { ...FLEET, version: 2 }, /version must be 1/],
    ['unknown top-level field', { ...FLEET, extra: true }, /unknown field "extra"/],
    ['drones not an array', { version: 1, drones: {} }, /drones must be an array/],
    ['drone without name', { version: 1, drones: [{ parts: [] }] }, /drones\[0\]\.name must be a non-empty string/],
    ['drone frame not a string', { version: 1, drones: [{ name: 'A', frame: 5, parts: [] }] }, /drones\[0\]\.frame/],
    ['drone unknown field', { version: 1, drones: [{ name: 'A', parts: [], colour: 'red' }] }, /drones\[0\]: unknown field "colour"/],
    ['parts missing', { version: 1, drones: [{ name: 'A' }] }, /drones\[0\]\.parts must be an array/],
    [
      'part without model',
      { version: 1, drones: [{ name: 'A', parts: [{ category: 'motor' }] }] },
      /drones\[0\]\.parts\[0\]\.model must be a non-empty string/,
    ],
    [
      'part without category',
      { version: 1, drones: [{ name: 'A', parts: [{ model: 'M' }] }] },
      /drones\[0\]\.parts\[0\]\.category must be a non-empty string/,
    ],
    [
      'empty positions',
      { version: 1, drones: [{ name: 'A', parts: [{ category: 'motor', model: 'M', positions: [] }] }] },
      /drones\[0\]\.parts\[0\]\.positions must be a non-empty array/,
    ],
    [
      'blank position',
      { version: 1, drones: [{ name: 'A', parts: [{ category: 'motor', model: 'M', positions: ['front-left', ' '] }] }] },
      /drones\[0\]\.parts\[0\]\.positions\[1\] must be a non-empty string/,
    ],
    [
      'same slot twice in one drone',
      {
        version: 1,
        drones: [
          {
            name: 'A',
            parts: [
              { category: 'motor', model: 'M', positions: ['front-left'] },
              { category: 'motor', model: 'N', positions: ['front-left'] },
            ],
          },
        ],
      },
      /drones\[0\]\.parts\[1\]: duplicate slot motor\/front-left/,
    ],
    [
      'duplicate drone name',
      { version: 1, drones: [{ name: 'A', parts: [] }, { name: 'a', parts: [] }] },
      /drones\[1\]\.name: duplicate drone "a"/,
    ],
  ];
  for (const [label, input, error] of bad) {
    it(`rejects ${label} with an error naming the field`, () => {
      assert.throws(() => parseFleetImport(input), error);
    });
  }
});

describe('F-098-T05: fleet import into the store', () => {
  it('expands positions into one part row each and defaults to "main"', () => {
    const { dir, store } = tempStore();
    try {
      store.fleet.importFleet(parseFleetImport(FLEET));
      const kestrel = store.fleet.listParts('Kestrel');
      assert.deepEqual(
        kestrel.map((p) => `${p.category}/${p.position}/${p.componentModel}`),
        [
          'fc/main/Generic F7 FC',
          'motor/front-left/Generic 2207 1750KV',
          'motor/front-right/Generic 2207 1750KV',
          'motor/rear-left/Generic 2207 1750KV',
          'motor/rear-right/Generic 2207 1750KV',
        ],
      );
      assert.equal(store.fleet.getDroneByName('Kestrel')?.frame, '5-inch test frame');
      assert.equal(store.fleet.getDroneByName('Wren')?.notes, 'bench quad');
      assert.equal(store.fleet.listParts('Wren').length, 3);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates one spares record per distinct model at 0 new and 0 used', () => {
    const { dir, store } = tempStore();
    try {
      const report = store.fleet.importFleet(parseFleetImport(FLEET));
      const spares = store.fleet.listSpares();
      assert.deepEqual(
        spares.map((s) => [s.componentModel, s.category, s.newCount, s.usedCount]),
        [
          ['Generic F7 FC', 'fc', 0, 0],
          ['Generic 2207 1750KV', 'motor', 0, 0],
          ['Generic Analog VTX', 'vtx', 0, 0],
        ],
      );
      assert.deepEqual(report.drones, { created: ['Kestrel', 'Wren'], present: [] });
      assert.deepEqual(report.parts, { created: 8, present: 0 });
      assert.deepEqual(report.spares.created.sort(), ['Generic 2207 1750KV', 'Generic Analog VTX', 'Generic F7 FC']);
      assert.deepEqual(report.spares.present, []);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('re-import keeps existing drones, parts and spare counts and reports them as present', () => {
    const { dir, store } = tempStore();
    try {
      const existing = store.fleet.addDrone({ name: 'Kestrel', frame: 'original frame' });
      store.fleet.setPart({
        droneIdOrName: 'Kestrel',
        category: 'motor',
        position: 'front-left',
        componentModel: 'Older 2306 2400KV',
      });
      store.fleet.upsertSpare({ componentModel: 'Generic 2207 1750KV', category: 'motor', newCount: 3, usedCount: 1 });

      const first = store.fleet.importFleet(parseFleetImport(FLEET));
      assert.deepEqual(first.drones, { created: ['Wren'], present: ['Kestrel'] });
      assert.deepEqual(first.parts, { created: 7, present: 1 });
      assert.deepEqual(first.spares.present, ['Generic 2207 1750KV']);

      const kestrel = store.fleet.getDroneByName('Kestrel')!;
      assert.equal(kestrel.id, existing.id);
      assert.equal(kestrel.frame, 'original frame');
      const frontLeft = store.fleet.listParts('Kestrel').find((p) => p.position === 'front-left')!;
      assert.equal(frontLeft.componentModel, 'Older 2306 2400KV');
      const motorSpare = store.fleet.getSpare('Generic 2207 1750KV')!;
      assert.equal(motorSpare.newCount, 3);
      assert.equal(motorSpare.usedCount, 1);

      const second = store.fleet.importFleet(parseFleetImport(FLEET));
      assert.deepEqual(second.drones, { created: [], present: ['Kestrel', 'Wren'] });
      assert.deepEqual(second.parts, { created: 0, present: 8 });
      assert.deepEqual(second.spares.created, []);
      assert.equal(store.fleet.listDrones().length, 2);
      assert.equal(store.fleet.listParts('Kestrel').length, 5);
      assert.equal(store.fleet.listSpares().length, 3);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('F-098-T05: nerv fleet import through the CLI', () => {
  it('imports a file into a temp NERV home, re-imports idempotently, and rejects a bad file', () => {
    const home = mkdtempSync(join(tmpdir(), 'nerv-fleet-cli-'));
    const run = (...a: string[]) =>
      spawnSync(process.execPath, [join('src', 'cli.ts'), 'fleet', ...a], {
        env: { ...process.env, NERV_HOME: home },
        encoding: 'utf8',
      });
    try {
      const file = join(home, 'fleet.json');
      writeFileSync(file, JSON.stringify(FLEET));

      const first = run('import', file);
      assert.equal(first.status, 0, first.stderr);
      const report = JSON.parse(first.stdout) as { drones: { created: string[] }; parts: { created: number } };
      assert.deepEqual(report.drones.created, ['Kestrel', 'Wren']);
      assert.equal(report.parts.created, 8);

      const again = run('import', file);
      assert.equal(again.status, 0, again.stderr);
      assert.deepEqual((JSON.parse(again.stdout) as { drones: { present: string[] } }).drones.present, [
        'Kestrel',
        'Wren',
      ]);

      const spares = JSON.parse(run('spares').stdout) as Array<{ componentModel: string; newCount: number }>;
      assert.equal(spares.length, 3);
      assert.ok(spares.every((s) => s.newCount === 0));

      const store = new Store(databasePath(home), readScrolls(home), { home });
      try {
        assert.equal(store.fleet.listParts('Kestrel').length, 5);
      } finally {
        store.close();
      }

      const badFile = join(home, 'bad.json');
      writeFileSync(badFile, JSON.stringify({ version: 1, drones: [{ name: 'Gull', parts: [{ category: 'motor' }] }] }));
      const bad = run('import', badFile);
      assert.notEqual(bad.status, 0);
      assert.match(bad.stderr, /drones\[0\]\.parts\[0\]\.model must be a non-empty string/);
      const after = new Store(databasePath(home), readScrolls(home), { home });
      try {
        assert.equal(after.fleet.getDroneByName('Gull'), undefined);
      } finally {
        after.close();
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
