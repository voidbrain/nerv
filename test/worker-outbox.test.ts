import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { Runtime } from '../src/runtime.ts';
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function until(check: () => Promise<boolean>) {
  const end = Date.now() + 10000;
  while (!(await check())) {
    if (Date.now() > end) throw Error('Outbox condition timed out');
    await wait(20);
  }
}
test('F-014: upgrade preserves completed receipts and quarantines every old pending request until explicit reconciliation', () => {
  const home = mkdtempSync(join(tmpdir(), 'nerv-worker-upgrade-')),
    path = join(home, 'db');
  let store = new Store(path);
  try {
    const sortie = store.ledger.openSortie('owner', 'Neutral old queue', 'trusted'),
      first = store.queueRemote(sortie, 'NERV-02', 'reminders.list', {}),
      second = store.queueRemote(sortie, 'NERV-02', 'reminders.list', {}),
      sequence = store.outbox()[0]!.sequence;
    store.db.exec(
      'CREATE TABLE kaji_runs(id TEXT PRIMARY KEY,from_base TEXT NOT NULL,result TEXT NOT NULL,created TEXT NOT NULL)',
    );
    const completed = '00000000-0000-4000-8000-000000000333';
    store.db
      .prepare('INSERT INTO kaji_runs VALUES(?,?,?,?)')
      .run(completed, 'NERV-01', JSON.stringify({ outcome: 'grant', result: [] }), new Date().toISOString());
    store.close();
    store = new Store(path);
    assert.deepEqual(store.outbox(), []);
    assert.equal(store.heldWorkerOutbox().length, 2);
    assert.equal(
      store.workerJobs.claim('NERV-01', { id: completed, request: '', tool: 'reminders.list', args: {} }).state,
      'completed',
    );
    assert.throws(() => store.reconcileWorkerOutbox(first.id, 'retry', 'Verified not executed', false), /confirmation/);
    assert.deepEqual(store.outbox(), []);
    store.reconcileWorkerOutbox(first.id, 'retry', 'Destination trace verified not executed', true);
    assert.equal(store.outbox()[0]!.id, first.id);
    assert.equal(store.outbox()[0]!.sequence, sequence);
    assert.ok(store.outbox()[0]!.deadline > Date.now());
    assert.equal(store.outbox()[0]!.attempted, false);
    store.reconcileWorkerOutbox(second.id, 'abandon', 'Prior effects remain unknown; no replay requested');
    assert.equal(store.heldWorkerOutbox().length, 0);
    const row = store.db.prepare('SELECT result FROM kaji_outbox WHERE id=?').get(second.id) as { result: string };
    assert.equal(JSON.parse(row.result).outcome, 'uncertain');
    assert.equal(
      (store.db.prepare('SELECT count(*) AS n FROM worker_outbox_reconciliations').get() as { n: number }).n,
      2,
    );
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});
for (const attempted of [false, true])
  test(
    `F-014: expired ${attempted ? 'attempted' : 'unsent'} work is never dispatched again and its uncertainty stays honest`,
    { timeout: 15000 },
    async () => {
      const home = mkdtempSync(join(tmpdir(), 'nerv-worker-expired-')),
        path = join(home, 'nerv.sqlite');
      writeFileSync(
        join(home, 'config.json'),
        JSON.stringify({ models: { local: { model: 'unused-fixture', baseUrl: 'http://127.0.0.1:9/v1' } } }),
      );
      const store = new Store(path);
      let id: string;
      try {
        const sortie = store.ledger.openSortie('owner', 'Neutral expired queue', 'trusted');
        id = store.queueRemote(sortie, 'NERV-02', 'reminders.list', {}).id;
        if (attempted) store.attemptWorkerOutbox(id);
        store.db.prepare('UPDATE kaji_outbox SET created=? WHERE id=?').run('2000-01-01T00:00:00.000Z', id);
      } finally {
        store.close();
      }
      const runtime = new Runtime(path, undefined, home);
      let sent = 0;
      try {
        await runtime.ready();
        runtime.startOutbox(async () => {
          sent++;
          return { reached: false };
        }, 30);
        await until(async () => !((await runtime.nervous.call('kaji.outbox')) as unknown[]).length);
        assert.equal(sent, 0);
        const read = new Store(path);
        try {
          const result = JSON.parse(
            (read.db.prepare('SELECT result FROM kaji_outbox WHERE id=?').get(id!) as { result: string }).result,
          );
          assert.equal(result.outcome, attempted ? 'uncertain' : 'reject');
          if (attempted) assert.doesNotMatch(JSON.stringify(result), /nothing was sent|nothing ran/);
        } finally {
          read.close();
        }
      } finally {
        await runtime.close();
        rmSync(home, { recursive: true, force: true });
      }
    },
  );
test('F-014: remote waiting progress is reported once and remains pending until the actual owner decision', () => {
  const store = new Store(':memory:');
  try {
    const sortie = store.ledger.openSortie('owner', 'Neutral remote approval', 'trusted'),
      q = store.queueRemote(sortie, 'NERV-02', 'memory.remember', { text: 'Neutral fact' }),
      result = { outcome: 'approval', approvalId: 'neutral-card' },
      said = { base: 'Harbor', text: 'Waiting for destination approval.' };
    assert.equal(store.outboxProgress(q.id, result, said), true);
    assert.equal(store.outboxProgress(q.id, result, said), false);
    assert.equal(store.outbox().length, 1);
    assert.equal(store.events(sortie).filter((e) => e.kind === 'kaji.result').length, 1);
    assert.equal(
      store.outboxDone(
        q.id,
        { outcome: 'grant', result: { text: 'Neutral fact' } },
        { base: 'Harbor', text: 'Completed after approval.' },
      ),
      true,
    );
    assert.equal(store.outbox().length, 0);
    assert.equal(store.events(sortie).filter((e) => e.kind === 'kaji.result').length, 2);
  } finally {
    store.close();
  }
});
test('F-014: standing down a source sortie cancels its unsent outbox intents before dispatch', () => {
  const store = new Store(':memory:');
  try {
    const sortie = store.ledger.openSortie('owner', 'Neutral queued request', 'trusted'),
      q = store.queueRemote(sortie, 'NERV-02', 'reminders.list', {});
    assert.equal(store.spear(sortie, 'Owner stood down').remotePending, 1);
    assert.deepEqual(store.outbox(), []);
    assert.equal(store.cancelledWorkerOutbox()[0]!.id, q.id);
    assert.throws(() => store.attemptWorkerOutbox(q.id), /cancelled/);
    assert.equal(store.cancelledWorkerOutbox()[0]!.attempted, false);
  } finally {
    store.close();
  }
});
test('F-014: legacy approval migration rejects still-pending cards, preserves observed completion and retains genuinely uncertain locks', () => {
  const home = mkdtempSync(join(tmpdir(), 'nerv-worker-legacy-card-')),
    path = join(home, 'db');
  let store = new Store(path);
  try {
    store.db.exec(
      'CREATE TABLE kaji_runs(id TEXT PRIMARY KEY,from_base TEXT NOT NULL,result TEXT NOT NULL,created TEXT NOT NULL)',
    );
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const sortie = store.ledger.openSortie('owner', 'Neutral old card ' + i, 'trusted'),
        result = store.runAction(sortie, {
          tool: 'memory.remember',
          args: { text: 'Neutral old fact ' + i },
          stage: 'production',
        }),
        id = `00000000-0000-4000-8000-${String(300 + i).padStart(12, '0')}`;
      ids.push(id);
      if (i === 1) store.decide(result.approvalId!, 'approve', 'cli');
      if (i >= 2) {
        const grant = store.ledger.decide(result.approvalId!, 'approve', 'cli');
        if (i === 2) store.ledger.authorize(grant.grantId!, 'memory.remember', { text: 'Neutral old fact ' + i });
      }
      store.db
        .prepare('INSERT INTO kaji_runs VALUES(?,?,?,?)')
        .run(id, 'NERV-01', JSON.stringify(result), new Date().toISOString());
    }
    store.close();
    store = new Store(path);
    assert.equal(store.approvals().length, 0);
    assert.equal((store.workerJobs.receipt(ids[0]!)!.result as { outcome: string }).outcome, 'reject');
    assert.equal((store.workerJobs.receipt(ids[1]!)!.result as { outcome: string }).outcome, 'grant');
    assert.equal(store.memory.list().length, 1);
    assert.equal(store.workerJobs.receipt(ids[2]!)!.state, 'running');
    assert.equal(store.workerJobs.pending().length, 1);
    assert.equal((store.workerJobs.receipt(ids[3]!)!.result as { outcome: string }).outcome, 'reject');
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test(
  'F-026: proactive remote progress/results persist atomically, respect quiet hours and never use direct resumed callbacks',
  { timeout: 15000 },
  async () => {
    const home = mkdtempSync(join(tmpdir(), 'nerv-watch-outbox-')),
      path = join(home, 'nerv.sqlite');
    const minutes = new Date().getUTCHours() * 60 + new Date().getUTCMinutes(),
      clock = (n: number) =>
        String(Math.floor(((n + 1440) % 1440) / 60)).padStart(2, '0') + ':' + String((n + 1440) % 60).padStart(2, '0');
    const pilot = {
      id: 'fixture-pilot',
      name: 'Fixture',
      domain: 'Fixture',
      keywords: ['fixture'],
      model: 'unused-fixture',
      stage: 'production' as const,
    };
    const config = {
      timeZone: 'UTC',
      models: { local: { model: 'unused-fixture', baseUrl: 'http://127.0.0.1:9/v1' } },
      pilots: [pilot],
      watch: {
        triggers: [
          {
            id: 'fixture-check',
            request: 'Read remote fixture',
            schedule: { everyMinutes: 1440 },
            maxActions: 1,
            maxSteps: 2,
            pilot: pilot.id,
          },
        ],
        quietHours: { from: clock(minutes - 30), until: clock(minutes + 30) } as
          { from: string; until: string } | undefined,
      },
    };
    const save = () => writeFileSync(join(home, 'config.json'), JSON.stringify(config));
    save();
    const store = new Store(path, undefined, { home });
    let sortieId: string;
    try {
      const run = store.watch.admit(config.watch, config.pilots, 'UTC')[0]!;
      sortieId = run.sortieId;
      store.watch.claim();
      store.queueRemote(sortieId, 'NERV-02', 'reminders.list', {});
      store.watch.finish(sortieId, 'done');
    } finally {
      store.close();
    }
    const runtime = new Runtime(path, undefined, home);
    const follow: unknown[] = [];
    let completed = false;
    try {
      await runtime.ready();
      runtime.onResumed((x) => follow.push(x));
      runtime.startOutbox(async (_base, _item, dispatching) => {
        await dispatching();
        return {
          reached: true,
          result: completed
            ? { outcome: 'grant', result: [] }
            : { outcome: 'approval', approvalId: '00000000-0000-4000-8000-000000000222' },
        };
      }, 20);
      await until(async () => (await runtime.events(sortieId)).filter((e) => e.kind === 'kaji.result').length === 1);
      completed = true;
      await until(async () => (await runtime.events(sortieId)).filter((e) => e.kind === 'kaji.result').length === 2);
      assert.equal(follow.length, 0);
      await runtime.nervous.call('watch.poll');
      assert.equal((await runtime.inboxPage()).items.length, 0);
      config.watch.quietHours = undefined;
      save();
      assert.equal(await runtime.nervous.call('watch.poll'), 2);
      assert.equal(await runtime.nervous.call('watch.poll'), 0);
      const messages = (await runtime.inboxPage()).items;
      assert.equal(messages.length, 2);
      assert.ok(messages.every((m) => m.kind === 'brief'));
      assert.match(messages[0]!.message, /approval/);
      assert.match(messages[1]!.message, /ran/);
      assert.equal(await runtime.nervous.call('inbox.lastBrief'), null);
    } finally {
      await runtime.close();
      rmSync(home, { recursive: true, force: true });
    }
  },
);

test('F-026: transport dispatch revalidates removed/demoted/replaced watch authority, including already completed planners', () => {
  for (const change of ['remove', 'demote', 'model', 'retire'] as const)
    for (const completed of [false, true]) {
      const home = mkdtempSync(join(tmpdir(), 'nerv-watch-dispatch-')),
        path = join(home, 'db');
      const pilot = {
        id: 'fixture-pilot',
        name: 'Fixture',
        domain: 'Fixture',
        keywords: ['fixture'],
        model: 'fixture-model',
        stage: 'production' as 'prototype' | 'test' | 'production',
        retired: false,
      };
      const config = {
        pilots: [pilot],
        watch: {
          triggers: [
            {
              id: 'fixture-check',
              request: 'Read remote fixture',
              schedule: { everyMinutes: 1440 },
              maxActions: 1,
              maxSteps: 2,
              pilot: pilot.id,
            },
          ],
        },
      };
      const save = () => writeFileSync(join(home, 'config.json'), JSON.stringify(config));
      save();
      const store = new Store(path, undefined, { home });
      try {
        const run = store.watch.admit(config.watch, config.pilots, 'UTC')[0]!;
        store.watch.claim();
        const queued = store.queueRemote(run.sortieId, 'NERV-02', 'reminders.list', {});
        if (completed) store.watch.finish(run.sortieId, 'done');
        if (change === 'remove') config.watch.triggers = [];
        else if (change === 'demote') pilot.stage = 'prototype';
        else if (change === 'model') pilot.model = 'replacement-model';
        else pilot.retired = true;
        save();
        // No poll is allowed to hide a dispatch-time validation gap.
        assert.throws(() => store.attemptWorkerOutbox(queued.id));
        assert.equal(store.outbox().length, 0);
        assert.equal(store.cancelledWorkerOutbox().find((q) => q.id === queued.id)?.attempted, false);
        assert.equal(store.db.prepare('SELECT 1 FROM worker_outbox_attempts WHERE id=?').get(queued.id), undefined);
      } finally {
        store.close();
        rmSync(home, { recursive: true, force: true });
      }
    }
});

test('F-026: watch polling creates remote cancellation intents; restart interruption preserves attempted uncertainty', () => {
  const home = mkdtempSync(join(tmpdir(), 'nerv-watch-interrupt-outbox-')),
    path = join(home, 'db');
  const config = {
    watch: {
      triggers: [
        {
          id: 'fixture-check',
          request: 'Read remote fixture',
          schedule: { everyMinutes: 1440 },
          maxActions: 1,
          maxSteps: 2,
        },
      ],
    },
  };
  writeFileSync(join(home, 'config.json'), JSON.stringify(config));
  let store = new Store(path, undefined, { home });
  try {
    const run = store.watch.admit(config.watch, [], 'UTC')[0]!;
    store.watch.claim();
    const queued = store.queueRemote(run.sortieId, 'NERV-02', 'reminders.list', {});
    store.attemptWorkerOutbox(queued.id);
    // Age the neutral unfinished-attempt fixture before reopening; the dispatch above belongs to its original process.
    store.db
      .prepare('UPDATE watch_runs SET started=? WHERE sortie_id=?')
      .run(new Date(Date.now() - 1000).toISOString(), run.sortieId);
    store.close();
    store = new Store(path, undefined, { home });
    assert.throws(() => store.attemptWorkerOutbox(queued.id));
    assert.equal(store.watch.get(run.sortieId)?.state, 'interrupted');
    assert.equal(
      store.cancelledWorkerOutbox().find((q) => q.id === queued.id)?.attempted,
      true,
      'attempted work stays uncertain until its remote receipt is reconciled',
    );
    const next = store.watch.admit(
      { triggers: [{ ...config.watch.triggers[0]!, id: 'second-fixture' }] },
      [],
      'UTC',
    )[0]!;
    store.watch.claim();
    const second = store.queueRemote(next.sortieId, 'NERV-02', 'reminders.list', {});
    config.watch.triggers = [];
    writeFileSync(join(home, 'config.json'), JSON.stringify(config));
    store.watchPoll();
    assert.ok(store.cancelledWorkerOutbox().some((q) => q.id === second.id));
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});
