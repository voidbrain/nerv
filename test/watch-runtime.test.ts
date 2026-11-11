import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Runtime } from '../src/runtime.ts';
import type { Config } from '../src/config.ts';
import { watchQuiet, type WatchConfig, type WatchTrigger } from '../src/watch.ts';
const trigger: WatchTrigger = {
  id: 'fixture-check',
  request: 'Read fixture status',
  schedule: { everyMinutes: 1440 },
  maxActions: 1,
  maxSteps: 3,
};
const quietNow = () => {
  const at = new Date(),
    m = at.getUTCHours() * 60 + at.getUTCMinutes();
  const format = (n: number) =>
    `${String(Math.floor(((n + 1440) % 1440) / 60)).padStart(2, '0')}:${String((n + 1440) % 60).padStart(2, '0')}`;
  return { from: format(m - 30), until: format(m + 30) };
};
async function setup(script: string[], watch: WatchConfig = { triggers: [trigger] }) {
  const calls: { model: string; system: string; prompt: string }[] = [];
  let onPlan: (() => Promise<void>) | undefined;
  const server = createServer((req, res) => {
    let raw = '';
    req
      .on('data', (c) => (raw += c))
      .on('end', () => {
        void (async () => {
          const input = JSON.parse(raw) as { model: string; messages: { content: string }[] };
          const system = input.messages[0]!.content,
            prompt = input.messages.at(-1)!.content;
          calls.push({ model: input.model, system, prompt });
          const casper = system.startsWith('You are Casper');
          if (!casper) await onPlan?.();
          const content = casper
            ? '{"vote":"approve","reason":"Fixture matches","confidence":1}'
            : (script.shift() ?? '{"reply":"Fixture done."}');
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ model: input.model, choices: [{ message: { content }, finish_reason: 'stop' }] }));
        })().catch(() => {
          res.statusCode = 500;
          res.end();
        });
      });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const home = mkdtempSync(join(tmpdir(), 'nerv-watch-runtime-')),
    database = join(home, 'nerv.sqlite');
  const config: Config = {
    port: 4317,
    language: 'en',
    timeZone: 'UTC',
    base: { id: 'FIXTURE-01', name: 'Fixture' },
    models: {
      local: {
        baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
        model: 'fixture-default',
      },
      roles: { misato: { route: 'cloud', model: 'fixture-cloud-disabled' } },
    },
    watch,
  };
  const save = () => writeFileSync(join(home, 'config.json'), JSON.stringify(config));
  save();
  let runtime = new Runtime(database, undefined, home);
  await runtime.ready();
  return {
    home,
    database,
    config,
    save,
    calls,
    get runtime() {
      return runtime;
    },
    hold: (fn: () => Promise<void>) => {
      onPlan = fn;
    },
    restart: async () => {
      await runtime.close();
      runtime = new Runtime(database, undefined, home);
      await runtime.ready();
    },
    read: <T>(sql: string) => {
      const db = new DatabaseSync(database, { readOnly: true });
      try {
        return db
          .prepare(sql)
          .all()
          .map((row) => ({ ...row })) as unknown as T;
      } finally {
        db.close();
      }
    },
    close: async () => {
      await runtime.close();
      await new Promise<void>((done) => {
        server.close(() => done());
        server.closeAllConnections();
      });
      rmSync(home, { recursive: true, force: true });
    },
  };
}

test('F-026: explicit watch uses local planning once through A/B/C, shares concurrent polls and publishes one separate Hyuga brief', async () => {
  const t = await setup(['{"reply":"Fixture status is ready."}']);
  try {
    const [one, two] = await Promise.all([t.runtime.checkWatch(), t.runtime.checkWatch()]);
    assert.ok(one);
    assert.equal(one.sortieId, two?.sortieId);
    assert.equal(one.proactive, true);
    assert.equal(one.reply, 'Fixture status is ready.');
    assert.equal(t.calls.length, 1);
    assert.equal(
      t.calls[0]?.model,
      'fixture-default',
      'watch stays local even though ordinary Misato is configured for cloud',
    );
    assert.doesNotMatch(
      t.calls[0]!.system,
      /reminders\.add/,
      'nonproduction tools shown to the planner are reads only',
    );
    assert.equal((await t.runtime.sortie(one.sortieId))?.source, 'hyuga');
    assert.equal((await t.runtime.sortie(one.sortieId))?.status, 'done');
    const page = await t.runtime.inboxPage();
    assert.deepEqual(
      page.items.map((i) => [i.kind, i.message]),
      [['brief', 'Fixture status is ready.']],
    );
    assert.equal(
      await t.runtime.nervous.call('inbox.lastBrief'),
      null,
      'watch output does not move daily-brief checkpoints',
    );
    assert.equal(await t.runtime.checkWatch(), null);
    assert.equal(t.calls.length, 1);
    const exchanges = await t.runtime.nervous.call('memory.exchanges', {
      since: new Date(Date.now() - 60_000).toISOString(),
      until: new Date(Date.now() + 1000).toISOString(),
    });
    assert.deepEqual(exchanges, [], 'automatic requests never become owner-stated memory');
  } finally {
    await t.close();
  }
});

test('F-026: quiet hours defer new watch briefs while due reminders and existing daily deliveries stay available, then release once', async () => {
  const t = await setup(['{"reply":"Deferred fixture status."}'], { triggers: [trigger], quietHours: quietNow() });
  try {
    await t.runtime.nervous.call('inbox.brief', {
      message: 'Existing daily fixture',
      day: new Date().toISOString().slice(0, 10),
    });
    const daily = await t.runtime.nervous.call('inbox.lastBrief');
    await t.runtime.checkWatch();
    assert.deepEqual(
      (await t.runtime.inboxPage()).items.map((i) => i.message),
      ['Existing daily fixture'],
    );
    await t.runtime.add('Due fixture reminder', new Date(Date.now() + 100).toISOString());
    await new Promise((done) => setTimeout(done, 400));
    assert.ok(
      (await t.runtime.inboxPage()).items.some((i) => i.kind === 'reminder' && i.message === 'Due fixture reminder'),
    );
    delete t.config.watch!.quietHours;
    t.save();
    assert.equal(await t.runtime.nervous.call('watch.poll'), 1);
    assert.equal(await t.runtime.nervous.call('watch.poll'), 0);
    const page = await t.runtime.inboxPage();
    assert.equal(page.items.filter((i) => i.message === 'Deferred fixture status.').length, 1);
    assert.equal(await t.runtime.nervous.call('inbox.lastBrief'), daily);
    const dashboard = (await t.runtime.dashboardHistory(new Date(Date.now() - 3600_000).toISOString())) as {
      brief: { message: string };
    };
    assert.equal(dashboard.brief.message, 'Existing daily fixture');
  } finally {
    await t.close();
  }
});

test('F-026: quiet watch cards remain inspectable but silent; ordinary owner cards and already-due inbox entries stay normal', async () => {
  const t = await setup(['{"action":{"tool":"reminders.list","args":{}}}'], {
    triggers: [trigger],
    quietHours: quietNow(),
  });
  try {
    const run = await t.runtime.checkWatch();
    assert.equal(run?.waiting.length, 1);
    const watchCard = (await t.runtime.approvals())[0]!;
    assert.equal(watchCard.notify, false);
    assert.equal((await t.runtime.inboxPage()).items.length, 0);
    const owner = await t.runtime.act({
      request: 'Remember fixture preference',
      tool: 'memory.remember',
      args: { text: 'Fixture prefers tea' },
    });
    assert.equal(owner.outcome, 'approval');
    assert.equal((await t.runtime.approvals()).find((a) => a.id === owner.approvalId)?.notify, undefined);
    assert.equal((await t.runtime.inboxPage()).items.length, 1, 'ordinary owner review notice is immediate');
    delete t.config.watch!.quietHours;
    t.save();
    await t.runtime.nervous.call('watch.poll');
    assert.equal((await t.runtime.approvals()).find((a) => a.id === watchCard.id)?.notify, undefined);
    assert.equal((await t.runtime.inboxPage()).items.length, 2);
    await t.runtime.nervous.call('watch.poll');
    assert.equal((await t.runtime.inboxPage()).items.length, 2);
  } finally {
    await t.close();
  }
});

test('F-026: approval survives restart without resetting planner reservations or sending a direct resumed-channel reply', async () => {
  const t = await setup(['{"action":{"tool":"reminders.list","args":{}}}'], {
    triggers: [{ ...trigger, maxSteps: 1 }],
  });
  try {
    const first = await t.runtime.checkWatch();
    assert.equal(first?.waiting.length, 1);
    assert.equal(t.calls.length, 1);
    await t.restart();
    assert.equal(await t.runtime.checkWatch(), null, 'waiting work is retained, never re-claimed as a fresh attempt');
    const delivered: unknown[] = [];
    t.runtime.onResumed((r) => delivered.push(r));
    await t.runtime.decide(first!.waiting[0]!.approvalId, 'approve');
    await t.runtime.sweep();
    assert.equal((await t.runtime.sortie(first!.sortieId))?.status, 'done');
    assert.equal(t.calls.length, 1, 'the consumed one-step budget survives restart/approval');
    assert.equal(delivered.length, 0, 'only the durable inbox path may notify a watch result');
    assert.ok((await t.runtime.inboxPage()).items.some((i) => i.kind === 'brief'));
    assert.deepEqual(t.read<{ used: number }[]>('SELECT used FROM watch_steps'), [{ used: 1 }]);
  } finally {
    await t.close();
  }
});

test('F-026: removing or changing a pilot while planning fences the effect, and missing local route never falls back to cloud', async () => {
  const t = await setup([
    '{"action":{"tool":"reminders.add","args":{"title":"Should not run","due":"2030-01-02T00:00:00Z"}}}',
  ]);
  let release: () => void = () => {};
  let entered: () => void = () => {};
  const reached = new Promise<void>((done) => {
      entered = done;
    }),
    blocked = new Promise<void>((done) => {
      release = done;
    });
  try {
    t.config.pilots = [
      {
        id: 'fixture-pilot',
        name: 'Fixture',
        domain: 'Fixture',
        keywords: ['fixture'],
        model: 'fixture-specialist',
        stage: 'production',
      },
    ];
    t.config.watch!.triggers = [{ ...trigger, pilot: 'fixture-pilot' }];
    t.save();
    t.hold(async () => {
      entered();
      await blocked;
    });
    const checking = t.runtime.checkWatch();
    await reached;
    t.config.pilots[0]!.retired = true;
    t.save();
    release();
    const out = await checking;
    assert.equal(t.calls[0]?.model, 'fixture-specialist');
    assert.equal((await t.runtime.list()).length, 0);
    assert.equal((await t.runtime.sortie(out!.sortieId))?.status, 'revoked');
    assert.equal(t.read<{ state: string }[]>('SELECT state FROM watch_runs')[0]?.state, 'cancelled');
  } finally {
    release();
    await t.close();
  }
  const down = await setup([]);
  try {
    delete down.config.models.local;
    down.save();
    await down.restart();
    await down.runtime.add('Offline fixture reminder', new Date(Date.now() + 100).toISOString());
    const run = await down.runtime.checkWatch();
    assert.ok(run?.error);
    assert.equal(down.calls.length, 0);
    assert.equal((await down.runtime.sortie(run!.sortieId))?.status, 'failed');
    assert.ok((await down.runtime.inboxPage()).items.some((i) => /did not finish/.test(i.message)));
    await new Promise((done) => setTimeout(done, 400));
    assert.ok((await down.runtime.inboxPage()).items.some((i) => i.kind === 'reminder'));
  } finally {
    await down.close();
  }
});

test('F-026: quiet-hours boundaries follow local wall time with an exclusive end', () => {
  for (const [at, quiet] of [
    ['21:59', false],
    ['22:00', true],
    ['06:59', true],
    ['07:00', false],
  ] as const)
    assert.equal(watchQuiet(new Date('2030-01-01T' + at + ':00Z'), 'UTC', { from: '22:00', until: '07:00' }), quiet);
  assert.equal(watchQuiet(new Date('2030-01-01T12:00:00Z'), 'UTC', { from: '09:00', until: '17:00' }), true);
});

test('F-026: absent opt-in creates no work, while a subscribed owner completion produces one non-recursive event watch', async () => {
  const t = await setup(['{"reply":"Event fixture status."}'], { triggers: [] });
  try {
    assert.equal(await t.runtime.checkWatch(), null);
    assert.equal(t.calls.length, 0);
    assert.deepEqual(await t.runtime.sorties(), []);
    t.config.watch = { triggers: [{ ...trigger, schedule: { event: 'sortie.done' } }] };
    t.save();
    assert.equal(await t.runtime.checkWatch(), null);
    const owner = await t.runtime.act({
      request: 'Add fixture reminder',
      tool: 'reminders.add',
      args: { title: 'Event fixture', due: new Date(Date.now() + 86400_000).toISOString() },
    });
    assert.equal(owner.outcome, 'grant');
    const run = await t.runtime.checkWatch();
    assert.equal(run?.reply, 'Event fixture status.');
    assert.equal(t.calls.length, 1);
    assert.equal(await t.runtime.checkWatch(), null);
    assert.equal((await t.runtime.sorties()).length, 2);
  } finally {
    await t.close();
  }
});

test('F-026: production still uses its reserved-action budget through the real gate and cannot convert repeated budget denials to cards', async () => {
  const due = new Date(Date.now() + 86400_000).toISOString();
  const script = Array.from({ length: 6 }, (_, n) =>
    JSON.stringify({ action: { tool: 'reminders.add', args: { title: 'Budget fixture ' + n, due } } }),
  );
  const t = await setup(script, { triggers: [{ ...trigger, pilot: 'fixture-pilot', maxSteps: 6 }] });
  try {
    t.config.pilots = [
      {
        id: 'fixture-pilot',
        name: 'Fixture',
        domain: 'Fixture',
        keywords: ['fixture'],
        model: 'fixture-specialist',
        stage: 'production',
      },
    ];
    t.save();
    const run = await t.runtime.checkWatch();
    assert.equal(run?.steps[0]?.outcome, 'grant');
    assert.ok(run?.steps.slice(1).every((s) => s.outcome === 'reject'));
    assert.equal(run?.waiting.length, 0);
    assert.equal((await t.runtime.list()).length, 1);
    assert.equal(t.calls.length, 6);
    assert.equal((await t.runtime.approvals()).length, 0);
  } finally {
    await t.close();
  }
});

test('F-026: nonproduction writes remain denied through the planner/gate join even when the model ignores its read-only catalogue', async () => {
  const t = await setup(
    Array.from({ length: 5 }, () => '{"action":{"tool":"memory.remember","args":{"text":"Unapproved fixture fact"}}}'),
    { triggers: [{ ...trigger, maxSteps: 5 }] },
  );
  try {
    const run = await t.runtime.checkWatch();
    assert.equal(run?.steps.length, 5);
    assert.ok(run?.steps.every((s) => s.outcome === 'reject'));
    assert.equal((await t.runtime.approvals()).length, 0);
    assert.deepEqual(await t.runtime.lilith.list(), []);
    assert.equal(
      t.calls.filter((c) => !c.system.startsWith('You are Casper')).length,
      5,
      'planner reservations exclude separate intent checks',
    );
    assert.ok(t.calls.length <= 10);
  } finally {
    await t.close();
  }
});

test(
  'F-026: a process lost during planning is interrupted once after restart, never re-dispatched',
  { timeout: 15000 },
  async () => {
    const t = await setup(['{"reply":"Late fixture reply."}']);
    let release: () => void = () => {};
    const paused = new Promise<void>((done) => {
      release = done;
    });
    try {
      t.hold(() => paused);
      const checking = t.runtime.checkWatch();
      const end = Date.now() + 8000;
      while (!t.calls.length) {
        if (Date.now() > end) throw Error('planner did not start');
        await new Promise((done) => setTimeout(done, 20));
      }
      await t.runtime.nervous.close();
      await t.restart();
      release();
      await checking;
      assert.equal(await t.runtime.checkWatch(), null);
      assert.equal(t.calls.length, 1);
      assert.equal(t.read<{ state: string }[]>('SELECT state FROM watch_runs')[0]?.state, 'interrupted');
      assert.equal((await t.runtime.inboxPage()).items.filter((i) => /interrupted/.test(i.message)).length, 1);
      await t.runtime.nervous.call('watch.poll');
      assert.equal((await t.runtime.inboxPage()).items.filter((i) => /interrupted/.test(i.message)).length, 1);
    } finally {
      release();
      await t.close();
    }
  },
);

test('F-026: stopping a watch while it waits for approval clears running capacity and never publishes its deferred card', async () => {
  const t = await setup(['{"action":{"tool":"reminders.list","args":{}}}'], {
    triggers: [trigger],
    quietHours: quietNow(),
  });
  try {
    const run = await t.runtime.checkWatch();
    assert.equal(run?.waiting.length, 1);
    await t.runtime.spear(run!.sortieId, 'Owner stopped watch fixture');
    assert.equal(await t.runtime.checkWatch(), null);
    assert.equal(t.read<{ state: string }[]>('SELECT state FROM watch_runs')[0]?.state, 'cancelled');
    delete t.config.watch!.quietHours;
    t.save();
    await t.runtime.nervous.call('watch.poll');
    assert.equal((await t.runtime.approvals()).length, 0);
    assert.equal((await t.runtime.inboxPage()).items.length, 0);
  } finally {
    await t.close();
  }
});

test('F-026: a long clarification closes the watch with bounded actionable copy instead of holding the owner chat', async () => {
  const t = await setup([JSON.stringify({ ask: 'Which fixture? ' + 'x'.repeat(4000) })]);
  try {
    const run = await t.runtime.checkWatch();
    assert.equal((await t.runtime.sortie(run!.sortieId))?.status, 'failed');
    assert.ok(run!.reply!.startsWith('This automatic check needs more detail.'));
    assert.ok(run!.reply!.length <= 4000);
    assert.equal(await t.runtime.nervous.call('misato.question', { conversation: 'cli' }), null);
    assert.equal((await t.runtime.inboxPage()).items.length, 1);
    assert.equal(await t.runtime.checkWatch(), null);
  } finally {
    await t.close();
  }
});
