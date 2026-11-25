import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { Store } from '../src/store.ts';
import { Runtime } from '../src/runtime.ts';
import { initialize, databasePath } from '../src/config.ts';

test(
  'F-013: 10,000 history rows, page traffic and concurrent CLI writes keep delivery within the measured budget',
  { timeout: 20000 },
  async (t) => {
    const home = mkdtempSync(join(tmpdir(), 'nerv-load-'));
    initialize(home);
    const db = databasePath(home);
    const seed = new Store(db);
    seed.db.exec('BEGIN');
    const reminder = seed.db.prepare('INSERT INTO reminders VALUES(?,?,?,?,?,NULL)');
    const delivery = seed.db.prepare("INSERT INTO deliveries VALUES(?,?,'reminder',?,?,NULL)");
    for (let i = 0; i < 10000; i++) {
      const id = 'history-' + i;
      reminder.run(
        id,
        'Historical reminder ' + i,
        '2020-01-01T00:00:00Z',
        '2019-01-01T00:00:00Z',
        '2020-01-01T00:00:00Z',
      );
      delivery.run('delivery-' + i, id, 'Historical reminder ' + i, '2020-01-01T00:00:00Z');
    }
    seed.db.exec('COMMIT');
    seed.close();
    const runtime = new Runtime(db, new URL('./fixtures/busy-brain.ts', import.meta.url));
    const latencies: number[] = [];
    const children: ReturnType<typeof spawn>[] = [];
    try {
      await runtime.ready();
      const blocked = runtime.brain.call('runtime.ping').catch((e) => e);
      const due = Date.now() + 1000;
      const target = await runtime.add('Latency target', new Date(due).toISOString());
      const spans: { start: number; end: number }[] = [];
      const writeMs: number[] = [];
      const writes = Array.from({ length: 8 }, async (_, i) => {
        let n = 0;
        do {
          const start = Date.now();
          await new Promise<void>((done, fail) => {
            const child = spawn(
              process.execPath,
              ['src/cli.ts', 'remind', 'CLI reminder ' + i + '-' + n++, '2035-01-01T00:00:00Z'],
              { env: { ...process.env, NERV_HOME: home }, stdio: ['ignore', 'ignore', 'pipe'] },
            );
            children.push(child);
            let error = '';
            child.stderr.on('data', (d) => (error += d));
            child.once('error', fail);
            child.once('exit', (code) => (code === 0 ? done() : fail(new Error(error))));
          });
          spans.push({ start, end: Date.now() });
          writeMs.push(Date.now() - start);
        } while (Date.now() < due + 500);
      });
      let before = 0;
      for (let i = 0; i < 100; i++) {
        const start = performance.now();
        const p = await runtime.reminderPage(before, 50);
        latencies.push(performance.now() - start);
        assert.equal(p.items.length, 50);
        before = p.next!;
      }
      await Promise.all(writes);
      assert.ok(
        spans.some((x) => x.start <= due && x.end >= due),
        'CLI work overlaps the due window',
      );
      let deliveredAt = 0;
      while (Date.now() < due + 5000) {
        const p = await runtime.inboxHistory();
        if (p.items.some((x) => x.message === target.title)) {
          deliveredAt = Date.parse(p.items.find((x) => x.message === target.title)!.created);
          break;
        }
        await new Promise((done) => setTimeout(done, 25));
      }
      assert.ok(deliveredAt, 'due reminder arrives while Brain is blocked and CLI processes write');
      assert.ok(deliveredAt - due < 5000);
      assert.ok((await blocked) instanceof Error);
      runtime.brain.child.kill('SIGKILL');
      assert.equal((await runtime.inboxHistory()).items[0]!.message, target.title);
      const afterDeath = await runtime.add('After Brain death', new Date(Date.now() + 400).toISOString());
      let arrived = false;
      const end = Date.now() + 5000;
      while (Date.now() < end) {
        if ((await runtime.inboxHistory()).items.some((x) => x.message === afterDeath.title)) {
          arrived = true;
          break;
        }
        await new Promise((done) => setTimeout(done, 25));
      }
      assert.ok(arrived, 'a new reminder is delivered after Brain is killed');
      const sorted = latencies.toSorted((a, b) => a - b);
      t.diagnostic(
        JSON.stringify({
          historyRows: 10000,
          pageReads: 100,
          cliWriters: 8,
          cliOperations: writeMs.length,
          pageP95Ms: Math.round(sorted[94]!),
          pageMaxMs: Math.round(sorted.at(-1)!),
          cliMaxMs: Math.round(Math.max(...writeMs)),
          persistedDeliveryLagMs: deliveredAt - due,
          budgetMs: 5000,
          node: process.version,
          platform: process.platform,
        }),
      );
    } finally {
      await runtime.close();
      for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      rmSync(home, { recursive: true, force: true });
    }
  },
);
