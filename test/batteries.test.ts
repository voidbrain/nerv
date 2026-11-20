import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { formatDueResistancePrompt, type OneMoreBatteryExport } from '../src/batteries.ts';

describe('F-008-T06: battery registry and one-more-battery import', () => {
  it('registers batteries with number, optional colour series, type, brand, mAh, purchase date, and required initial resistance', () => {
    const store = new Store(':memory:');
    try {
      // Missing or mismatched per-cell resistance is refused
      assert.throws(
        () =>
          store.batteries.register({
            packNumber: 7,
            series: 'blu',
            seriesColor: 'blu',
            brand: 'Tattu',
            batteryType: 'LiPo 6S',
            cellCount: 6,
            capacityMah: 1300,
            purchaseDate: '2026-10-01',
            initialResistanceMohm: [3.1, 3.2],
          }),
        /exactly 6 per-cell value/,
      );

      const bat7 = store.batteries.register({
        packNumber: 7,
        series: 'blu',
        seriesColor: 'blu',
        brand: 'Tattu',
        batteryType: 'LiPo 6S',
        cellCount: 6,
        capacityMah: 1300,
        purchaseDate: '2026-10-01',
        initialResistanceMohm: [3.1, 3.2, 3.0, 3.3, 3.1, 3.2],
      });
      assert.equal(bat7.packNumber, 7);
      assert.equal(bat7.seriesColor, 'blu');
      assert.equal(bat7.batteryType, 'LiPo 6S');
      assert.equal(bat7.capacityMah, 1300);
      assert.equal(bat7.currentState, 'stored');
      assert.equal(bat7.cycles, 0);

      // Cycle counted on charged -> discharged
      store.batteries.recordState(bat7.id, 'charged', '2026-11-10T10:00:00.000Z');
      const afterFlight = store.batteries.recordState(bat7.id, 'discharged', '2026-11-10T12:00:00.000Z');
      assert.equal(afterFlight.cycles, 1);
      assert.equal(afterFlight.currentState, 'discharged');

      assert.equal(store.batteries.findByNumberAndSeries(7, 'blu').length, 1);
      assert.equal(store.batteries.resistanceHistory(bat7.id).length, 1);
    } finally {
      store.close();
    }
  });

  it('imports invented one-more-battery exports with usage and resistance history and skips deleted packs', () => {
    const store = new Store(':memory:');
    try {
      const fixture: OneMoreBatteryExport = {
        brands: [{ id: 1, label: 'GNB', deleted: 0, enabled: 1 }],
        series: [
          { id: 10, label: 'red', color: 'red', deleted: 0, enabled: 1 },
          { id: 11, label: 'yellow', color: 'yellow', deleted: 0, enabled: 1 },
        ],
        batteryTypes: [
          { id: 1, label: 'LiPo 6S', deleted: 0, enabled: 1 },
          { id: 2, label: 'LiHV 3S', deleted: 0, enabled: 1 },
        ],
        batteries: [
          {
            id: 101,
            brandId: 1,
            seriesId: 10,
            typeId: 1,
            cellsNumber: 6,
            date: '2026-08-15',
            label: 'Pack 4 red',
            mA: 1500,
            deleted: 0,
            enabled: 1,
          },
          {
            id: 102,
            brandId: 1,
            seriesId: 11,
            typeId: 2,
            cellsNumber: 3,
            date: '2026-09-01',
            label: 'Pack 2 yellow',
            mA: 650,
            deleted: 0,
            enabled: 1,
          },
          {
            id: 103,
            brandId: 1,
            seriesId: 10,
            typeId: 1,
            cellsNumber: 6,
            date: '2025-01-01',
            label: 'Pack 99 retired',
            mA: 1300,
            deleted: 1,
            enabled: 0,
          },
        ],
        usageRecords: [
          { id: 1, idBattery: 101, date: '2026-08-16T09:00:00.000Z', status: 1, deleted: 0, enabled: 1 },
          { id: 2, idBattery: 101, date: '2026-08-16T11:00:00.000Z', status: 3, deleted: 0, enabled: 1 },
          { id: 3, idBattery: 101, date: '2026-08-16T20:00:00.000Z', status: 2, deleted: 0, enabled: 1 },
          { id: 4, idBattery: 102, date: '2026-09-02T08:00:00.000Z', status: 1, deleted: 0, enabled: 1 },
        ],
        resistanceRecords: [
          {
            id: 1,
            idBattery: 101,
            date: '2026-08-15T10:00:00.000Z',
            resistance_values: [3.0, 3.1, 3.0, 3.2, 3.1, 3.0],
            deleted: 0,
            enabled: 1,
          },
          {
            id: 2,
            idBattery: 101,
            date: '2026-09-15T10:00:00.000Z',
            resistance_values: [3.2, 3.3, 3.1, 3.4, 3.2, 3.1],
            deleted: 0,
            enabled: 1,
          },
          {
            id: 3,
            idBattery: 102,
            date: '2026-09-01T10:00:00.000Z',
            resistance_values: [4.0, 4.2, 4.1],
            deleted: 0,
            enabled: 1,
          },
        ],
      };

      const summary = store.batteries.importOneMoreBattery(fixture);
      assert.equal(summary.importedBatteries, 2);
      assert.equal(summary.skippedDeleted, 1);
      assert.equal(summary.importedUsageRecords, 4);
      assert.equal(summary.importedResistanceRecords, 3);

      const pack4 = store.batteries.get('omb-101');
      assert.equal(pack4?.packNumber, 4);
      assert.equal(pack4?.seriesColor, 'red');
      assert.equal(pack4?.currentState, 'stored');
      assert.equal(pack4?.cycles, 1);
      assert.equal(store.batteries.resistanceHistory('omb-101').length, 2);
      assert.equal(store.batteries.usageHistory('omb-101').length, 3);

      const pack2 = store.batteries.get('omb-102');
      assert.equal(pack2?.batteryType, 'LiHV 3S');
      assert.equal(pack2?.currentState, 'charged');
    } finally {
      store.close();
    }
  });

  it('F-008-T07: sets charge state and counts cycles by Italian/English chat, asking on ambiguity', () => {
    const store = new Store(':memory:');
    try {
      const b7blu = store.batteries.register({
        packNumber: 7,
        series: 'Blu',
        seriesColor: 'blu',
        brand: 'GNB',
        batteryType: 'LiPo 6S',
        cellCount: 6,
        capacityMah: 1300,
        purchaseDate: '2026-10-01',
        initialResistanceMohm: [5.0, 5.1, 5.0, 5.2, 5.1, 5.0],
      });
      const b8blu = store.batteries.register({
        packNumber: 8,
        series: 'Blu',
        seriesColor: 'blu',
        brand: 'GNB',
        batteryType: 'LiPo 6S',
        cellCount: 6,
        capacityMah: 1300,
        purchaseDate: '2026-10-01',
        initialResistanceMohm: [5.0, 5.1, 5.0, 5.2, 5.1, 5.0],
      });
      const b7red = store.batteries.register({
        packNumber: 7,
        series: 'Red',
        seriesColor: 'red',
        brand: 'Tattu',
        batteryType: 'LiPo 6S',
        cellCount: 6,
        capacityMah: 1300,
        purchaseDate: '2026-10-01',
        initialResistanceMohm: [4.8, 4.9, 4.8, 4.9, 5.0, 4.8],
      });

      // Ambiguous: pack 7 exists in both Blu and Red series; must ask, never guess.
      const ambiguous = store.batteries.applyChatPhrase('carica la batteria 7');
      assert.equal(ambiguous.status, 'ambiguous');
      assert.equal(ambiguous.matches?.length, 2);
      assert.equal(store.batteries.get(b7blu.id)?.currentState, 'stored');
      assert.equal(store.batteries.get(b7red.id)?.currentState, 'stored');

      // Italian phrase sets charged for multiple batteries in series blu.
      const charged = store.batteries.applyChatPhrase('carica le batterie 7 e 8 blu', '2026-11-15T10:00:00Z');
      assert.equal(charged.status, 'updated');
      assert.equal(charged.state, 'charged');
      assert.equal(store.batteries.get(b7blu.id)?.currentState, 'charged');
      assert.equal(store.batteries.get(b8blu.id)?.currentState, 'charged');
      assert.equal(store.batteries.get(b7blu.id)?.cycles, 0);

      // English phrase marks used/discharged and increments cycles on charged -> discharged.
      const used = store.batteries.applyChatPhrase('batteries 7 and 8 blue used', '2026-11-15T12:00:00Z');
      assert.equal(used.status, 'updated');
      assert.equal(used.state, 'discharged');
      assert.equal(store.batteries.get(b7blu.id)?.cycles, 1);
      assert.equal(store.batteries.get(b8blu.id)?.cycles, 1);
      assert.match(used.message, /#7 \(Blu\): discharged · 1 cycle/);

      // Stored phrase sets stored without extra cycle.
      const stored = store.batteries.applyChatPhrase('metti in storage le batterie 7 e 8 blu', '2026-11-15T14:00:00Z');
      assert.equal(stored.status, 'updated');
      assert.equal(stored.state, 'stored');
      assert.equal(store.batteries.get(b7blu.id)?.cycles, 1);
      assert.match(stored.message, /#8 \(Blu\): stored · 1 ciclo/);
    } finally {
      store.close();
    }
  });

  it('F-008-T08: validates ordered per-cell resistance against cell count and asks when due by 90 days or 30 cycles', () => {
    const store = new Store(':memory:');
    try {
      const lipo = store.batteries.register({
        packNumber: 1,
        series: 'Alpha',
        brand: 'Tattu',
        batteryType: 'LiPo 6S',
        cellCount: 6,
        capacityMah: 1480,
        purchaseDate: '2026-08-01',
        initialResistanceMohm: [2.1, 2.2, 2.0, 2.3, 2.1, 2.2],
        recordedAt: '2026-08-01T10:00:00Z',
      });
      const lihv = store.batteries.register({
        packNumber: 2,
        series: 'Beta',
        brand: 'GNB',
        batteryType: 'LiHV 3S',
        cellCount: 3,
        capacityMah: 550,
        purchaseDate: '2026-11-01',
        initialResistanceMohm: [3, 3.4, 4.1],
        recordedAt: '2026-11-01T10:00:00Z',
      });

      // Cell count checked against type when recording new values in order.
      assert.throws(() => store.batteries.recordResistance(lihv.id, '3.1, 3.5'), /exactly 3 per-cell value/);
      const recorded = store.batteries.recordResistance(lihv.id, '3.1, 3.5, 4.2 mΩ', '2026-11-02T10:00:00Z');
      assert.deepEqual(recorded.valuesMohm, [3.1, 3.5, 4.2]);

      // Simulate 30 cycles on lihv -> due by cycles.
      for (let i = 0; i < 30; i += 1) {
        store.batteries.recordState(lihv.id, 'charged', `2026-11-03T10:${String(i).padStart(2, '0')}:00Z`);
        store.batteries.recordState(lihv.id, 'discharged', `2026-11-03T11:${String(i).padStart(2, '0')}:00Z`);
      }

      // Check at 2026-11-05: lipo is >= 90 days old (96 days), lihv has >= 30 cycles.
      const due = store.batteries.dueResistanceChecks(new Date('2026-11-05T12:00:00Z'));
      assert.equal(due.length, 2);
      assert.deepEqual(due[0]!.reasons, ['days']);
      assert.deepEqual(due[1]!.reasons, ['cycles']);

      const prompt = formatDueResistancePrompt(due, 'en');
      assert.match(prompt, /#1 \(Alpha\).*6 per-cell values in mΩ in order/);
      assert.match(prompt, /#2 \(Beta\).*3 per-cell values in mΩ in order/);

      // Store.tick delivers inbox ask once per due record, and clears after recording.
      store.tick(new Date('2026-11-05T12:00:00Z'));
      const inbox1 = store.inbox() as Array<{ kind: string; message: string }>;
      assert.equal(inbox1.filter((d) => d.kind === 'battery_resistance').length, 2);

      // Second tick does not spam duplicate asks for the same record.
      store.tick(new Date('2026-11-05T12:05:00Z'));
      const inbox2 = store.inbox() as Array<{ kind: string; message: string }>;
      assert.equal(inbox2.filter((d) => d.kind === 'battery_resistance').length, 2);

      // Recording new values clears due status until another 90 days or 30 cycles.
      store.batteries.recordResistance(lipo.id, [2.2, 2.3, 2.1, 2.4, 2.2, 2.3], '2026-11-05T12:10:00Z');
      store.batteries.recordResistance(lihv.id, [3.2, 3.6, 4.3], '2026-11-05T12:10:00Z');
      assert.equal(store.batteries.dueResistanceChecks(new Date('2026-11-05T12:15:00Z')).length, 0);
    } finally {
      store.close();
    }
  });

  it('F-008-T13: registers a new battery from Italian and English chat phrases and asks for per-cell resistance', () => {
    const store = new Store(':memory:');
    try {
      const itRes = store.batteries.applyChatPhrase('nuova batteria 9 blu LiPo 6S 1300 mAh', '2026-11-20T10:00:00Z');
      assert.equal(itRes.status, 'registered');
      assert.match(itRes.message, /#9 \(blu\)/);
      assert.match(itRes.message, /6.*mΩ/i);

      const enRes = store.batteries.applyChatPhrase('new battery 10 red LiHV 3S 550 mAh', '2026-11-20T10:05:00Z');
      assert.equal(enRes.status, 'registered');
      assert.match(enRes.message, /#10 \(red\)/);
      assert.match(enRes.message, /3.*mΩ/i);

      const list = store.batteries.list();
      assert.equal(list.length, 2);
      assert.equal(list[0]!.packNumber, 9);
      assert.equal(list[0]!.cellCount, 6);
      assert.equal(list[0]!.capacityMah, 1300);
      assert.equal(list[1]!.packNumber, 10);
      assert.equal(list[1]!.cellCount, 3);
      assert.equal(list[1]!.capacityMah, 550);
    } finally {
      store.close();
    }
  });
});
