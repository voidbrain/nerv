import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { makeServer } from '../src/server.ts';
import { Store } from '../src/store.ts';

describe('F-008-T11: battery cards API', () => {
  it('returns battery cards with state, cycles, last resistance, due dates, and health status', async () => {
    const store = new Store(':memory:');
    const token = 'b'.repeat(32);
    const server = makeServer(store, token);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const b1 = store.batteries.register({
        packNumber: 7,
        series: 'blu',
        seriesColor: 'blu',
        brand: 'Tattu',
        batteryType: 'LiPo 6S',
        cellCount: 6,
        capacityMah: 1480,
        purchaseDate: '2026-01-10',
        initialResistanceMohm: [2.0, 2.0, 2.0, 2.0, 2.0, 2.0],
      });
      store.batteries.recordState(b1.id, 'charged', '2026-11-19T10:00:00Z');
      store.batteries.recordState(b1.id, 'discharged', '2026-11-19T11:00:00Z');

      const addr = server.address();
      assert.ok(addr && typeof addr === 'object');
      const res = await fetch(`http://127.0.0.1:${addr.port}/api/batteries`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 200);
      const data = (await res.json()) as {
        items: Array<{
          id: string;
          packNumber: number;
          series?: string;
          batteryType: string;
          currentState: string;
          cycles: number;
          lastResistance: { valuesMohm: number[] } | null;
          resistanceDueAt: string | null;
          storageReminderActive: boolean;
          healthStatus: string;
        }>;
      };
      assert.equal(data.items.length, 1);
      const card = data.items[0]!;
      assert.equal(card.packNumber, 7);
      assert.equal(card.series, 'blu');
      assert.equal(card.batteryType, 'LiPo 6S');
      assert.equal(card.currentState, 'discharged');
      assert.equal(card.cycles, 1);
      assert.deepEqual(card.lastResistance?.valuesMohm, [2, 2, 2, 2, 2, 2]);
      assert.ok(card.resistanceDueAt);
      assert.equal(card.storageReminderActive, true);
      assert.equal(card.healthStatus, 'healthy');
    } finally {
      server.close();
      store.close();
    }
  });
});
