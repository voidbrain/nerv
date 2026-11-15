import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { Store } from '../src/store.ts';

describe('F-098-T01: FPV fleet and spares model', () => {
  it('stores drones by name, parts by position and component model, and spares with new/used counts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nerv-fleet-'));
    try {
      const dbPath = join(dir, 'nerv.sqlite');
      const store = new Store(dbPath);
      const smoke = store.fleet.addDrone({ name: 'Smoke', frame: '5-inch freestyle' });
      assert.equal(smoke.name, 'Smoke');
      assert.equal(store.fleet.getDroneByName('smoke')?.id, smoke.id);

      const motorRL = store.fleet.setPart({
        droneIdOrName: 'Smoke',
        category: 'motor',
        position: 'rear-left',
        componentModel: 'Xing2 2207 1855KV',
      });
      const motorFR = store.fleet.setPart({
        droneIdOrName: smoke.id,
        category: 'motor',
        position: 'front-right',
        componentModel: 'Xing2 2207 1855KV',
      });
      assert.equal(motorRL.position, 'rear-left');
      assert.equal(motorFR.componentModel, 'Xing2 2207 1855KV');
      assert.equal(store.fleet.listParts('Smoke').length, 2);

      // Replacing a part in the same position updates the slot rather than duplicating.
      store.fleet.setPart({
        droneIdOrName: 'Smoke',
        category: 'motor',
        position: 'rear-left',
        componentModel: 'Xing2 2207 1855KV',
        status: 'damaged',
      });
      const parts = store.fleet.listParts('Smoke');
      assert.equal(parts.length, 2);
      assert.equal(parts.find((p) => p.position === 'rear-left')?.status, 'damaged');

      // Spares inventory tracks new and used counts separately and refuses negative counts.
      const spare = store.fleet.upsertSpare({
        componentModel: 'Xing2 2207 1855KV',
        category: 'motor',
        newCount: 3,
        usedCount: 1,
      });
      assert.equal(spare.newCount, 3);
      assert.equal(spare.usedCount, 1);

      const adjusted = store.fleet.adjustSpare('Xing2 2207 1855KV', { newDelta: -1, usedDelta: 1 });
      assert.equal(adjusted.newCount, 2);
      assert.equal(adjusted.usedCount, 2);
      assert.throws(() => store.fleet.adjustSpare('Xing2 2207 1855KV', { newDelta: -5 }), /below zero/);
      store.close();

      // Persists across Store reopen.
      const reopened = new Store(dbPath);
      assert.equal(reopened.fleet.listDrones().length, 1);
      assert.equal(reopened.fleet.listParts('Smoke').length, 2);
      assert.equal(reopened.fleet.getSpare('Xing2 2207 1855KV')?.newCount, 2);
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
