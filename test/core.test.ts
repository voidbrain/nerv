import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { makeServer } from '../src/server.ts';
const start = new Date('2030-01-01T00:00:00Z');
const later = new Date('2030-01-02T00:00:00Z');
test('overdue reminder survives restart; delivery is atomic and not duplicated', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-'));
  const path = join(dir, 'db');
  try {
    let s = new Store(path);
    s.add('Insurance', '2030-01-01T01:00:00Z', start);
    s.close();
    s = new Store(path);
    assert.equal(s.tick(later), 1);
    assert.equal(s.tick(later), 0);
    assert.equal(s.inbox().length, 1);
    s.close();
    s = new Store(path);
    assert.equal(s.inbox().length, 1);
    assert.equal(s.tick(later), 0);
    s.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('invalid dates, missing zones, past dates and blank titles are rejected', () => {
  const s = new Store(':memory:');
  try {
    for (const date of [
      'nonsense',
      '2030-01-01T10:00',
      '2020-01-01T00:00:00Z',
      '2030-02-30T10:00:00Z',
      '2030-01-01T24:00:00Z',
      '2030-01-01T10:00:00+14:30',
    ])
      assert.throws(() => s.add('x', date, start));
    assert.throws(() => s.add(' ', '2030-01-02T00:00:00Z', start));
  } finally {
    s.close();
  }
});
test('cancellation prevents delivery', () => {
  const s = new Store(':memory:');
  const r = s.add('x', '2030-01-01T01:00:00Z', start);
  assert.equal(s.cancel(r.id), true);
  assert.equal(s.cancel(r.id), false);
  assert.equal(s.tick(later), 0);
  s.close();
});
test('two connections cannot duplicate a delivery', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-'));
  const a = new Store(join(dir, 'db'));
  const b = new Store(join(dir, 'db'));
  try {
    a.add('x', '2030-01-01T01:00:00Z', start);
    a.tick(later);
    b.tick(later);
    assert.equal(b.inbox().length, 1);
  } finally {
    a.close();
    b.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('HTTP requires authentication and validates writes', async () => {
  const s = new Store(':memory:');
  const token = 'a'.repeat(32);
  const server = makeServer(s, token);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(base + '/api/doctor')).status, 401);
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    assert.equal(
      (
        await fetch(base + '/api/reminders', {
          method: 'POST',
          headers,
          body: JSON.stringify({ title: 'x', due: 'invalid' }),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(base + '/api/reminders', {
          method: 'POST',
          headers,
          body: JSON.stringify({ title: 'x', due: '2099-01-01T00:00:00Z' }),
        })
      ).status,
      201,
    );
    assert.equal((await (await fetch(base + '/api/reminders', { headers })).json()).length, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    s.close();
  }
});
test('a reminder asked for twice is stored once: the same title (any case, outer spaces) and moment returns the pending one (B-003)', async () => {
  const { Store } = await import('../src/store.ts');
  const store = new Store(':memory:');
  try {
    const due = '2031-02-03T09:00:00.000Z';
    const first = store.add('Chiamare il dentista', due);
    const again = store.add('  chiamare il DENTISTA ', due);
    assert.equal(again.id, first.id);
    assert.equal(again.existing, true);
    assert.equal(first.existing, undefined);
    assert.equal(store.list().length, 1);
    assert.notEqual(
      store.add('Chiamare il dentista', '2031-02-03T10:00:00.000Z').id,
      first.id,
      'another time is another reminder',
    );
    store.cancel(first.id);
    assert.notEqual(store.add('Chiamare il dentista', due).id, first.id, 'a cancelled one does not count');
  } finally {
    store.close();
  }
});
test(
  'through the scheduler process: the same reminder action run twice adds it once and says it already existed (B-003)',
  { timeout: 20000 },
  async () => {
    const { Runtime } = await import('../src/runtime.ts');
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const home = mkdtempSync(join(tmpdir(), 'nerv-twice-'));
    const runtime = new Runtime(join(home, 'nerv.sqlite'), undefined, home);
    try {
      await runtime.ready();
      const ask = {
        request: 'Remind me to call the dentist',
        tool: 'reminders.add',
        args: { title: 'Call the dentist', due: '2031-02-03T09:00:00Z' },
      };
      const one = (await runtime.act(ask)) as { outcome: string; result?: { id: string; existing?: boolean } };
      const two = (await runtime.act(ask)) as typeof one;
      assert.equal(one.outcome, 'grant');
      assert.equal(two.outcome, 'grant');
      assert.equal(two.result!.id, one.result!.id);
      assert.equal(two.result!.existing, true);
      assert.equal(one.result!.existing, undefined);
      assert.equal((await runtime.list()).length, 1);
    } finally {
      await runtime.close();
      rmSync(home, { recursive: true, force: true });
    }
  },
);

test('F-043: SQLite migration reads old reminders as "at"; all 5 kinds store, update, reschedule with brief.at and deliver with their kind', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { writeFileSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'nerv-f043-'));
  const dbPath = join(dir, 'db');
  try {
    // 1. Pre-F-043 reminders table without kind or end columns
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`
      CREATE TABLE reminders (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        due TEXT NOT NULL,
        created TEXT NOT NULL,
        delivered TEXT,
        cancelled TEXT
      );
      INSERT INTO reminders (id, title, due, created, delivered, cancelled)
      VALUES ('legacy-1', 'Legacy reminder', '2030-03-03T10:00:00.000Z', '2030-01-01T00:00:00.000Z', NULL, NULL);
    `);
    legacy.close();

    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({ timeZone: 'Europe/Rome', language: 'en', brief: { at: '08:00' } }),
    );
    const s = new Store(dbPath, undefined, { home: dir });
    const migrated = s.list().find((r) => r.id === 'legacy-1')!;
    assert.equal(migrated.kind, 'at');
    assert.equal(migrated.end, null);

    // 2. All 5 kinds store and resolve due/end
    const baseNow = new Date('2030-03-01T00:00:00.000Z');
    const allDay = s.add('Renew car insurance', '2030-03-03T15:42:00.000Z', baseNow, { kind: 'all-day' });
    assert.equal(allDay.kind, 'all-day');
    assert.equal(allDay.due, '2030-03-03T07:00:00.000Z', '08:00 in Europe/Rome (CET, +01:00)');
    assert.equal(allDay.end, null);

    const fromTo = s.add('Team workshop', '2030-03-04T09:00:00.000Z', baseNow, {
      kind: 'from-to',
      end: '2030-03-04T11:00:00.000Z',
    });
    assert.equal(fromTo.kind, 'from-to');
    assert.equal(fromTo.due, '2030-03-04T09:00:00.000Z');
    assert.equal(fromTo.end, '2030-03-04T11:00:00.000Z');
    assert.throws(() =>
      s.add('Bad range', '2030-03-04T11:00:00.000Z', baseNow, { kind: 'from-to', end: '2030-03-04T09:00:00.000Z' }),
    );

    const fromOnly = s.add('Call bank', '2030-03-04T14:00:00.000Z', baseNow, { kind: 'from' });
    assert.equal(fromOnly.kind, 'from');
    assert.equal(fromOnly.due, '2030-03-04T14:00:00.000Z');
    assert.equal(fromOnly.end, null);

    const untilRem = s.add('Send tax form', '2030-03-04T17:00:00.000Z', baseNow, {
      kind: 'until',
      end: '2030-03-04T17:00:00.000Z',
    });
    assert.equal(untilRem.kind, 'until');
    assert.equal(untilRem.end, '2030-03-04T17:00:00.000Z');
    assert.equal(untilRem.due, '2030-03-04T16:00:00.000Z', 'arrives 1 hour ahead of the deadline');

    // 3. Updating brief.at reschedules pending all-day reminders
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({ timeZone: 'Europe/Rome', language: 'en', brief: { at: '09:30' } }),
    );
    s.rescheduleAllDayReminders();
    assert.equal(
      s.list().find((r) => r.id === allDay.id)!.due,
      '2030-03-03T08:30:00.000Z',
      'all-day reminder moves with brief.at (09:30 CET = 08:30Z)',
    );

    // 4. Delivery timing & inbox messages
    assert.equal(s.tick(new Date('2030-03-03T08:00:00.000Z')), 0, 'not due before 09:30 Rome time');
    assert.equal(s.tick(new Date('2030-03-03T08:30:00.000Z')), 1, 'all-day arrives at brief time');
    assert.equal(s.tick(new Date('2030-03-04T16:00:00.000Z')), 4, 'legacy, from-to, from and until (1h ahead) deliver');
    const messages = s.inbox().map((i) => i.message);
    assert.ok(messages.includes('Legacy reminder'), 'at reminder keeps plain title in inbox');
    assert.ok(messages.includes('Renew car insurance (all day)'));
    assert.ok(messages.includes('Team workshop (10:00–12:00)'));
    assert.ok(messages.includes('Call bank (from 15:00)'));
    assert.ok(messages.includes('Send tax form (until 18:00)'));
    s.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
