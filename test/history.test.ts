import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { Store } from '../src/store.ts';
import { Runtime } from '../src/runtime.ts';
import { makeServer } from '../src/server.ts';
import { HISTORY_BYTES } from '../src/history.ts';
import { MAX_FRAME_BYTES } from '../src/rpc.ts';

test('F-013: keyset pages traverse ties without gaps, exclude later inserts and fit Unicode payloads', () => {
  const store = new Store(':memory:');
  try {
    for (let i = 0; i < 123; i++) {
      store.add('Row ' + i + '界'.repeat(480), '2035-01-01T00:00:00Z');
      store.addBrief('界'.repeat(4000));
    }
    let page = store.reminderPage(0, 7);
    const ids = page.items.map((x) => x.id);
    store.add('New row', '2035-01-01T00:00:00Z');
    while (page.next !== null) {
      page = store.reminderPage(page.next, 7);
      ids.push(...page.items.map((x) => x.id));
    }
    assert.equal(ids.length, 123);
    assert.equal(new Set(ids).size, 123);
    let before = 0;
    let count = 0;
    do {
      const p = store.inboxHistory(before, 50);
      assert.ok(Buffer.byteLength(JSON.stringify(p)) < MAX_FRAME_BYTES);
      assert.ok(Buffer.byteLength(JSON.stringify(p.items)) <= HISTORY_BYTES);
      count += p.items.length;
      before = p.next ?? 0;
    } while (before);
    assert.equal(count, 123);
    for (const [cursor, limit] of [
      [-1, 20],
      [0, 0],
      [0, 51],
      [1.2, 20],
      [Number.MAX_SAFE_INTEGER + 1, 20],
    ])
      assert.throws(() => store.reminderPage(cursor, limit));
    assert.deepEqual(
      store.dashboardHistory('2000-01-01T00:00:00Z'),
      store.dashboardHistory('2000-01-01T02:00:00+02:00'),
    );
    assert.equal(store.dashboardHistory('2000-01-01T00:00:00Z').pending, 124);
    assert.equal(store.dashboardHistory('2000-01-01T00:00:00Z').reminders.length, 10);
  } finally {
    store.close();
  }
});
test('F-013: authenticated HTTP through real IPC traverses large history; legacy reads fail explicitly', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-history-'));
  const db = join(dir, 'db');
  const seed = new Store(db);
  for (let i = 0; i < 83; i++) {
    seed.add('History ' + i, '2035-01-01T00:00:00Z');
    seed.addBrief('Brief ' + i);
  }
  seed.close();
  const runtime = new Runtime(db);
  const token = 'a'.repeat(32);
  const server = makeServer(runtime, token, {});
  try {
    await runtime.ready();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
    const headers = { Authorization: 'Bearer ' + token };
    for (const path of ['reminders/page', 'inbox/history']) {
      assert.equal((await fetch(base + '/api/' + path)).status, 401);
      let before = 0;
      const ids: string[] = [];
      do {
        const response = await fetch(base + '/api/' + path + '?before=' + before + '&limit=11', { headers });
        assert.equal(response.status, 200);
        const p = (await response.json()) as { items: { id: string }[]; next: number | null };
        ids.push(...p.items.map((i) => i.id));
        before = p.next ?? 0;
      } while (before);
      assert.equal(ids.length, 83);
      assert.equal(new Set(ids).size, 83);
      for (const query of ['limit=51', 'before=-1', 'before=1.5', 'unknown=1'])
        assert.equal((await fetch(base + '/api/' + path + '?' + query, { headers })).status, 400);
    }
    for (const path of ['reminders', 'inbox']) {
      const response = await fetch(base + '/api/' + path, { headers });
      assert.equal(response.status, 400);
      assert.match(((await response.json()) as { error: string }).error, /History requires/);
    }
    const response = await fetch(base + '/api/dashboard/history?since=2000-01-01T00%3A00%3A00Z', { headers });
    assert.equal(response.status, 200);
    const summary = (await response.json()) as { pending: number; reminders: unknown[] };
    assert.equal(summary.pending, 83);
    assert.equal(summary.reminders.length, 10);
    assert.equal((await runtime.list()).length, 83, 'internal brief reads traverse bounded pages');
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    await runtime.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('F-013: history indexes are added after the legacy inbox migrates, preserving delivery cursors', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-old-history-'));
  const path = join(dir, 'db');
  const old = new DatabaseSync(path);
  old.exec(
    "CREATE TABLE deliveries(id TEXT PRIMARY KEY, reminder_id TEXT UNIQUE, message TEXT NOT NULL, created TEXT NOT NULL, read_at TEXT); INSERT INTO deliveries(rowid,id,reminder_id,message,created) VALUES(42,'old',NULL,'Old delivery','2020-01-01T00:00:00Z'); PRAGMA user_version=4",
  );
  old.close();
  try {
    const store = new Store(path);
    try {
      assert.equal(store.inboxHistory().items[0]!.sequence, 42);
      assert.equal(store.inboxHistory().items[0]!.kind, 'reminder');
      assert.ok(store.db.prepare("SELECT name FROM sqlite_master WHERE name='deliveries_kind_created'").get());
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
