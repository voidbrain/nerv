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

  it('records crash details and changes inventory only when spare usage is explicit', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nerv-crash-'));
    const store = new Store(join(dir, 'nerv.sqlite'));
    try {
      const smoke = store.fleet.addDrone({ name: 'Smoke' });
      store.fleet.setPart({
        droneIdOrName: smoke.id,
        category: 'motor',
        position: 'rear-left',
        componentModel: 'Fictional 2207',
      });
      store.fleet.upsertSpare({
        componentModel: 'Fictional 2207',
        category: 'motor',
        newCount: 1,
        usedCount: 1,
      });

      const crash = store.fleet.recordCrash({
        droneName: 'Smoke',
        category: 'motor',
        position: 'rear-left',
        damage: 'broken',
        spareUsed: 'used',
        crashedAt: '2026-11-16T12:00:00.000Z',
      });
      assert.equal(crash.droneId, smoke.id);
      assert.equal(crash.category, 'motor');
      assert.equal(crash.position, 'rear-left');
      assert.equal(crash.componentModel, 'Fictional 2207');
      assert.equal(crash.spareUsed, 'used');
      assert.equal(store.fleet.getSpare('Fictional 2207')?.usedCount, 0);

      store.fleet.addDrone({ name: 'NoSpare' });
      store.fleet.setPart({
        droneIdOrName: 'NoSpare',
        category: 'motor',
        position: 'rear-left',
        componentModel: 'Missing motor',
      });
      assert.throws(
        () =>
          store.fleet.recordCrash({
            droneName: 'NoSpare',
            category: 'motor',
            position: 'rear-left',
            damage: 'broken',
            spareUsed: 'new',
          }),
        /Spare not found/,
      );
      assert.equal(store.fleet.listCrashes({ droneName: 'NoSpare' }).length, 0);
      assert.equal(store.fleet.listParts('NoSpare')[0]?.status, 'installed');

      store.fleet.addDrone({ name: 'ZeroSpare' });
      store.fleet.setPart({
        droneIdOrName: 'ZeroSpare',
        category: 'motor',
        position: 'rear-left',
        componentModel: 'Empty motor',
      });
      store.fleet.upsertSpare({
        componentModel: 'Empty motor',
        category: 'motor',
        newCount: 0,
        usedCount: 0,
      });
      assert.throws(
        () =>
          store.fleet.recordCrash({
            droneName: 'ZeroSpare',
            category: 'motor',
            position: 'rear-left',
            damage: 'broken',
            spareUsed: 'new',
          }),
        /cannot go below zero/,
      );
      assert.equal(store.fleet.listCrashes({ droneName: 'ZeroSpare' }).length, 0);
      assert.equal(store.fleet.listParts('ZeroSpare')[0]?.status, 'installed');
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
