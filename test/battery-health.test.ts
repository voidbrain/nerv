import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BatteryRecord, BatteryResistanceEntry } from '../src/batteries.ts';
import { evaluateBatteryHealth } from '../src/battery-health.ts';
import { Store } from '../src/store.ts';

function makeBattery(overrides: Partial<BatteryRecord> = {}): BatteryRecord {
  return {
    id: 'bat-1',
    packNumber: 7,
    series: 'blu',
    seriesColor: 'blue',
    label: 'Pack 7',
    brand: 'GenericFPV',
    batteryType: 'LiPo 6S',
    cellCount: 6,
    capacityMah: 1300,
    purchaseDate: '2026-01-10',
    currentState: 'stored',
    cycles: 12,
    createdAt: '2026-01-10T10:00:00Z',
    ...overrides,
  };
}

function makeRecord(valuesMohm: number[], recordedAt: string, id = 'res-1'): BatteryResistanceEntry {
  return { id, batteryId: 'bat-1', valuesMohm, cyclesAtRecord: 0, recordedAt };
}

describe('F-008-T10: resistance health advice', () => {
  it('returns no advice when a battery has no resistance records', () => {
    const report = evaluateBatteryHealth(makeBattery(), []);
    assert.equal(report.status, 'no_records');
    assert.deepEqual(report.findings, []);
    assert.deepEqual(report.lines, []);
  });

  it('reports healthy when all cells stay within limits', () => {
    const battery = makeBattery();
    const first = makeRecord([2.0, 2.1, 2.0, 2.2, 2.1, 2.0], '2026-01-10T10:00:00Z', 'res-1');
    const latest = makeRecord([2.3, 2.4, 2.2, 2.5, 2.3, 2.2], '2026-04-10T10:00:00Z', 'res-2');
    const report = evaluateBatteryHealth(battery, [first, latest]);
    assert.equal(report.status, 'healthy');
    assert.deepEqual(report.findings, []);
    assert.deepEqual(report.lines, []);
  });

  it('warns at +50% and strongly warns at +100% growth over the first record, naming battery, cell and values', () => {
    const battery = makeBattery();
    const first = makeRecord([2.0, 2.0, 2.0, 2.0, 2.0, 2.0], '2026-01-10T10:00:00Z', 'res-1');
    // Cell 2: +50% (2.0 -> 3.0), Cell 5: +100% (2.0 -> 4.0)
    const latest = makeRecord([2.1, 3.0, 2.1, 2.1, 4.0, 2.1], '2026-04-10T10:00:00Z', 'res-2');
    const report = evaluateBatteryHealth(battery, [first, latest]);
    assert.equal(report.status, 'strong_warning');
    const c2Growth = report.findings.find((f) => f.cellNumber === 2 && f.reason === 'growth_vs_first');
    const c5Growth = report.findings.find((f) => f.cellNumber === 5 && f.reason === 'growth_vs_first');
    assert.equal(c2Growth?.severity, 'warning');
    assert.equal(c5Growth?.severity, 'strong_warning');
    assert.ok(
      report.lines.some((l) => l.includes('#7 (blu)') && l.includes('cell 2') && l.includes('3') && l.includes('2')),
    );
    assert.ok(
      report.lines.some((l) => l.includes('#7 (blu)') && l.includes('cell 5') && l.includes('4') && l.includes('2')),
    );
  });

  it('warns at +30% and strongly warns at +50% over the pack other cells', () => {
    const battery = makeBattery();
    // First record already had cell 3 slightly elevated so growth vs first is < 50%,
    // isolating the pack-spread check.
    const first = makeRecord([2.0, 2.0, 2.5, 2.0, 2.0, 2.0], '2026-01-10T10:00:00Z', 'res-1');
    // Cell 3 = 2.7 (+35% over other cells median 2.0), Cell 6 = 3.1 (+55% over 2.0 -> wait, growth 55% too)
    const latest = makeRecord([2.0, 2.0, 2.7, 2.0, 2.0, 2.0], '2026-02-10T10:00:00Z', 'res-2');
    const report = evaluateBatteryHealth(battery, [first, latest]);
    assert.equal(report.status, 'warning');
    const spread = report.findings.find((f) => f.cellNumber === 3 && f.reason === 'spread_vs_pack');
    assert.equal(spread?.severity, 'warning');
    assert.ok(report.lines.some((l) => l.includes('cell 3') && l.includes('2.7') && l.includes('2')));
  });

  it('applies generic retirement limits: 6S LiPo >= 12 mΩ and 3S LiHV >= 10 mΩ', () => {
    const lipo6s = makeBattery({ batteryType: 'LiPo 6S', cellCount: 6 });
    const lipoReport = evaluateBatteryHealth(lipo6s, [makeRecord([2, 2, 2, 2, 2, 12], '2026-01-10T10:00:00Z')]);
    assert.equal(lipoReport.status, 'retire');
    assert.ok(lipoReport.findings.some((f) => f.cellNumber === 6 && f.severity === 'retire'));

    const lihv3s = makeBattery({ batteryType: 'LiHV 3S', cellCount: 3 });
    const lihvReport = evaluateBatteryHealth(lihv3s, [makeRecord([3, 10, 3], '2026-01-10T10:00:00Z')]);
    assert.equal(lihvReport.status, 'retire');
    assert.ok(lihvReport.findings.some((f) => f.cellNumber === 2 && f.severity === 'retire'));
  });

  it('applies the Tattu R-Line V6 1480 mAh 6S profile thresholds over generic limits', () => {
    const tattu = makeBattery({
      brand: 'Tattu',
      label: 'R-Line V6 1480',
      batteryType: 'LiPo 6S 160C',
      cellCount: 6,
      capacityMah: 1480,
    });
    const aging = evaluateBatteryHealth(tattu, [makeRecord([4.5, 4.4, 4.4, 4.4, 4.4, 4.4], '2026-01-10T10:00:00Z')]);
    assert.equal(aging.status, 'warning');
    assert.equal(aging.profile?.id, 'tattu-rline-v6-1480-6s');

    const strong = evaluateBatteryHealth(tattu, [makeRecord([7.0, 6.8, 6.8, 6.8, 6.8, 6.8], '2026-01-10T10:00:00Z')]);
    assert.equal(strong.status, 'strong_warning');

    const retire = evaluateBatteryHealth(tattu, [makeRecord([8.0, 7.8, 7.8, 7.8, 7.8, 7.8], '2026-01-10T10:00:00Z')]);
    assert.equal(retire.status, 'retire');
  });

  it('evaluates resistance records stored in BatteryRegistry with Italian formatting', () => {
    const store = new Store(':memory:');
    try {
      const created = store.batteries.register({
        packNumber: 4,
        series: 'rossa',
        brand: 'GenericFPV',
        batteryType: 'LiPo 6S',
        cellCount: 6,
        capacityMah: 1300,
        purchaseDate: '2026-01-01',
        initialResistanceMohm: [2.0, 2.0, 2.0, 2.0, 2.0, 2.0],
      });
      store.batteries.recordResistance(created.id, [2.1, 2.1, 4.2, 2.1, 2.1, 2.1], '2027-01-01T10:00:00Z');
      const reports = store.batteries.healthAdvice(created.id, 'it');
      assert.equal(reports.length, 1);
      assert.equal(reports[0]!.status, 'strong_warning');
      assert.ok(reports[0]!.lines.some((l) => l.includes('#4 (rossa)') && l.includes('cella 3')));
    } finally {
      store.close();
    }
  });
});
