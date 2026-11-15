import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import type { OneMoreBatteryExport } from '../src/batteries.ts';

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
});
