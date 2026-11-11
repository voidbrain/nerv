import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
test('bounded inbox paging is stable, validates checkpoint identity, and detects restored/missing history', () => {
  const s = new Store(':memory:');
  const now = new Date('2030-01-01T00:00:00Z');
  try {
    for (let i = 0; i < 12; i++) s.add('Promemoria ' + i, '2030-01-01T01:00:00Z', now);
    s.tick(new Date('2030-01-02T00:00:00Z'));
    const first = s.inboxPage(0, 5);
    assert.equal(first.items.length, 5);
    assert.equal(first.head.sequence, 12);
    const next = s.inboxPage(first.next.sequence, 5, first.next.id);
    assert.equal(next.items.length, 5);
    assert.ok(next.items[0]!.sequence > first.next.sequence);
    const tail = s.inboxPage(next.next.sequence, 5, next.next.id);
    assert.equal(tail.items.length, 2);
    assert.equal(s.inboxPage(tail.next.sequence, 5, tail.next.id).items.length, 0);
    assert.equal(s.inboxPage(first.next.sequence, 5, 'different-history').reset, true);
    assert.equal(s.inboxPage(9999, 5, 'missing').next.sequence, 12);
    assert.throws(() => s.inboxPage(1));
    assert.throws(() => s.inboxPage(0, 21));
    assert.throws(() => s.inboxPage(-1));
    assert.equal(s.pendingReminders().length, 0);
    s.add('Future', '2031-01-01T00:00:00Z', now);
    assert.equal(s.pendingReminders().length, 1);
  } finally {
    s.close();
  }
});
