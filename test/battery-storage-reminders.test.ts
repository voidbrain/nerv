import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';

describe('F-008-T09: battery storage reminders', () => {
  it('schedules 21:00 same day, +5 days follow-up, daily follow-ups, and stops when stored', () => {
    const store = new Store(':memory:');
    try {
      const storage = store.batteryStorageReminders;
      const bat = store.batteries.register({
        packNumber: 7,
        series: 'Blu',
        brand: 'Tattu',
        batteryType: 'LiPo 6S',
        cellCount: 6,
        capacityMah: 1300,
        purchaseDate: '2026-10-01',
        initialResistanceMohm: [3.1, 3.2, 3.0, 3.3, 3.1, 3.2],
      });

      // Charged at 10:00 Europe/Rome -> first reminder at 21:00 same day (20:00Z in winter CET).
      const morning = new Date('2026-11-16T09:00:00.000Z');
      const charged = store.batteries.recordState(bat.id, 'charged', morning.toISOString());
      storage.onBatteryStateChanged(charged, morning);

      assert.equal(store.list().length, 1);
      assert.equal(store.list()[0]?.due, '2026-11-16T20:00:00.000Z');
      assert.match(store.list()[0]?.title ?? '', /#7 \(Blu\)/);

      // Deliver at 21:00 local -> follow-up scheduled 5 days later at 21:00 local.
      const day1Evening = new Date('2026-11-16T20:00:00.000Z');
      assert.equal(store.tick(day1Evening), 1);
      storage.syncAll(store.batteries.list(), day1Evening);

      const pendingAfterDay1 = store.list().filter((r) => !r.delivered && !r.cancelled);
      assert.equal(pendingAfterDay1.length, 1);
      assert.equal(pendingAfterDay1[0]?.due, '2026-11-21T20:00:00.000Z');

      // Deliver 5-day follow-up -> next follow-up scheduled daily (+1 day) at 21:00 local.
      const day6Evening = new Date('2026-11-21T20:00:00.000Z');
      assert.equal(store.tick(day6Evening), 1);
      storage.syncAll(store.batteries.list(), day6Evening);

      const pendingAfterDay6 = store.list().filter((r) => !r.delivered && !r.cancelled);
      assert.equal(pendingAfterDay6.length, 1);
      assert.equal(pendingAfterDay6[0]?.due, '2026-11-22T20:00:00.000Z');

      // Deliver daily follow-up -> another +1 day scheduled.
      const day7Evening = new Date('2026-11-22T20:00:00.000Z');
      assert.equal(store.tick(day7Evening), 1);
      storage.syncAll(store.batteries.list(), day7Evening);

      const pendingAfterDay7 = store.list().filter((r) => !r.delivered && !r.cancelled);
      assert.equal(pendingAfterDay7.length, 1);
      assert.equal(pendingAfterDay7[0]?.due, '2026-11-23T20:00:00.000Z');

      // Marking battery stored cancels pending reminder and stops follow-ups.
      const stored = store.batteries.recordState(bat.id, 'stored', '2026-11-23T10:00:00.000Z');
      storage.onBatteryStateChanged(stored, new Date('2026-11-23T10:00:00.000Z'));

      const remaining = store.list().filter((r) => !r.delivered && !r.cancelled);
      assert.equal(remaining.length, 0);
      assert.equal((store.inbox() as Array<{ kind: string }>).filter((d) => d.kind === 'reminder').length, 3);
    } finally {
      store.close();
    }
  });
});
