import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ThinkingRegistry, type ThinkingEntry } from '../src/thinking.ts';

// F-148: who is thinking right now. Unit tests for the registry, then the join across the brain, the service and
// (F-148-T03) the endpoint: a model call shows while it runs and is gone when it ends, however it ends.

test('F-148-T01: begin lists an entry with pilot, role, model, sortie and start; end removes it; a second end is nothing', () => {
  let now = Date.UTC(2030, 0, 1, 9, 0, 0);
  const r = new ThinkingRegistry(60_000, () => now);
  const a = r.begin({ pilot: 'Maya', role: 'consultant', model: 'gemma4:26b', sortieId: 'sortie-1' });
  const v = r.version;
  assert.deepEqual(r.snapshot(), [
    {
      id: a.id,
      pilot: 'Maya',
      role: 'consultant',
      model: 'gemma4:26b',
      sortieId: 'sortie-1',
      startedAt: '2030-01-01T09:00:00.000Z',
    },
  ]);
  now += 1000;
  r.begin({ pilot: 'Misato', role: 'planner', model: 'm' });
  assert.deepEqual(
    r.snapshot().map((e) => [e.pilot, e.sortieId]),
    [
      ['Maya', 'sortie-1'],
      ['Misato', undefined],
    ],
  );
  a.end();
  assert.ok(r.version > v);
  const after = r.version;
  a.end();
  r.end('t999');
  assert.equal(r.version, after, 'a second end and an unknown id change nothing');
  assert.deepEqual(
    r.snapshot().map((e) => e.pilot),
    ['Misato'],
  );
});

test('F-148-T01: an entry past the ceiling expires, so a lost end never shows thinking forever', () => {
  let now = 0;
  const r = new ThinkingRegistry(1000, () => now);
  r.begin({ pilot: 'Casper', role: 'casper', model: 'm' });
  now = 1000;
  assert.equal(r.snapshot().length, 1);
  const v = r.version;
  now = 1001;
  assert.deepEqual(r.snapshot(), []);
  assert.ok(r.version > v, 'an expiry is a change the feed announces');
});

test('F-148-T01: invalid input is refused and a mirrored list keeps only valid entries', () => {
  const r = new ThinkingRegistry();
  for (const bad of [
    { pilot: '', role: 'planner', model: 'm' },
    { pilot: 'x'.repeat(41), role: 'planner', model: 'm' },
    { pilot: 'Maya', role: 'worker', model: 'm' },
    { pilot: 'Maya', role: 'planner', model: 'x'.repeat(101) },
    { pilot: 'Maya', role: 'planner', model: 'm', sortieId: '' },
  ])
    assert.throws(() => r.begin(bad as never), /Invalid thinking entry/);
  const good = { id: 't1', pilot: 'Maya', role: 'consultant', model: 'm', startedAt: '2030-01-01T09:00:00.000Z' };
  r.replace([good, { ...good, id: 't2', role: 'worker' }, { ...good, id: 't3', startedAt: 'never' }, 'x']);
  assert.deepEqual(
    r.snapshot().map((e) => e.id),
    ['t1'],
  );
  const v = r.version;
  r.replace([good]);
  assert.equal(r.version, v, 'the same list again is no change');
  r.replace('not a list');
  assert.deepEqual(r.snapshot(), []);
  r.clear();
  assert.equal(r.version, v + 1, 'clearing an empty list is no change');
});

// ---- The join: a real brain process and service against a fake local model -----------------------------------------

type Role = 'consultant' | 'casper' | 'planner';
/** A fake local model that holds each request until the test answers it, so the test can look while the call runs. */
async function heldModel() {
  const waiting: { role: Role; res: ServerResponse; model: string }[] = [];
  let arrived: (() => void) | undefined;
  const s = createServer((req, res) => {
    let raw = '';
    req
      .on('data', (c) => (raw += c))
      .on('end', () => {
        const r = JSON.parse(raw) as { model: string; messages: { content: string }[] };
        const sys = r.messages[0]!.content;
        const role: Role = sys.startsWith('You are a consultant')
          ? 'consultant'
          : sys.startsWith('You are Casper')
            ? 'casper'
            : 'planner';
        waiting.push({ role, res, model: r.model });
        arrived?.();
      });
  });
  await new Promise<void>((d) => s.listen(0, '127.0.0.1', d));
  const next = async (): Promise<{ role: Role; res: ServerResponse; model: string }> => {
    while (!waiting.length) await new Promise<void>((d) => (arrived = d));
    return waiting.shift()!;
  };
  const answer = (res: ServerResponse, model: string, content: string) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ model, choices: [{ message: { content }, finish_reason: 'stop' }] }));
  };
  return {
    url: `http://127.0.0.1:${(s.address() as { port: number }).port}/v1`,
    next,
    answer,
    close: () =>
      new Promise<void>((d) => {
        s.close(() => d());
        s.closeAllConnections();
      }),
  };
}
async function service(url: string) {
  const { Runtime } = await import('../src/runtime.ts');
  const home = mkdtempSync(join(tmpdir(), 'nerv-thinking-'));
  writeFileSync(
    join(home, 'config.json'),
    JSON.stringify({
      models: {
        local: { baseUrl: url, model: 'm' },
        roles: { misato: { route: 'local' }, consultant: { model: 'advisor' } },
      },
    }),
  );
  // reminders.add is Blue here, so Casper is asked before the owner's card.
  writeFileSync(join(home, 'scrolls.json'), JSON.stringify({ blue: ['reminders.add'] }), { mode: 0o600 });
  const r = new Runtime(join(home, 'nerv.sqlite'), undefined, home);
  await r.ready();
  return {
    r,
    close: async () => {
      await r.close();
      rmSync(home, { recursive: true, force: true });
    },
  };
}
/** The brain tells the service over IPC, the model hears over HTTP: wait for the service to agree. */
async function until(
  read: () => Promise<ThinkingEntry[]>,
  ok: (e: ThinkingEntry[]) => boolean,
): Promise<ThinkingEntry[]> {
  const deadline = Date.now() + 5000;
  let last = await read();
  while (!ok(last) && Date.now() < deadline) {
    await new Promise((d) => setTimeout(d, 20));
    last = await read();
  }
  return last;
}
const ADD = '{"action":{"tool":"reminders.add","args":{"title":"Call Ada","due":"2031-01-01T09:00:00Z"}}}';

test(
  'F-148-T01: the consultant, Misato and Casper each show as thinking while their call runs and are gone after it',
  { timeout: 30000 },
  async () => {
    const m = await heldModel();
    const t = await service(m.url);
    try {
      const chat = t.r.chat('Remind me to call Ada');
      chat.catch(() => undefined);
      const seen: Record<string, ThinkingEntry> = {};
      for (const [role, content] of [
        ['consultant', 'Check the date.'],
        ['planner', ADD],
        ['casper', '{"vote":"approve","reason":"Matches.","confidence":0.9}'],
      ] as const) {
        const call = await m.next();
        assert.equal(call.role, role);
        // The previous call's entry is gone and this one is the only one: the end ran before the next begin.
        const now = await until(
          () => t.r.thinking(),
          (e) => e.length === 1 && e[0]!.role === role,
        );
        assert.equal(now.length, 1, `only the ${role} thinks: ${JSON.stringify(now)}`);
        assert.equal(now[0]!.role, role);
        seen[role] = now[0]!;
        m.answer(call.res, call.model, content);
      }
      const out = await chat;
      assert.deepEqual(
        await until(
          () => t.r.thinking(),
          (e) => !e.length,
        ),
        [],
        'nothing thinks after the answer',
      );
      for (const e of Object.values(seen)) {
        assert.equal(e.sortieId, out.sortieId);
        assert.ok(Number.isFinite(Date.parse(e.startedAt)));
        assert.deepEqual(Object.keys(e).sort(), ['id', 'model', 'pilot', 'role', 'sortieId', 'startedAt']);
      }
      assert.deepEqual(
        [seen.consultant!.pilot, seen.consultant!.model],
        ['Generic pilot', 'advisor'],
        'the consultant reads as the sortie line does',
      );
      assert.deepEqual([seen.planner!.pilot, seen.planner!.model], ['Misato', 'm']);
      assert.deepEqual([seen.casper!.pilot, seen.casper!.model], ['Casper', 'm']);
      assert.doesNotMatch(JSON.stringify(seen), /Call Ada|Check the date|vote/, 'no prompt or answer text');
    } finally {
      await t.close();
      await m.close();
    }
  },
);

test(
  'F-148-T01: a model error and a dropped connection (what a timeout leaves) both clear the entry',
  { timeout: 30000 },
  async () => {
    const m = await heldModel();
    const t = await service(m.url);
    try {
      const first = t.r.chat('Remind me to call Ada');
      first.catch(() => undefined);
      const consult = await m.next();
      await until(
        () => t.r.thinking(),
        (e) => e.length === 1,
      );
      consult.res.statusCode = 500;
      consult.res.end('{"error":"boom"}');
      const plan = await m.next();
      assert.equal(plan.role, 'planner');
      assert.equal(
        (
          await until(
            () => t.r.thinking(),
            (e) => e[0]?.role === 'planner',
          )
        )[0]?.role,
        'planner',
      );
      plan.res.socket?.destroy();
      await first.catch(() => undefined);
      assert.deepEqual(
        await until(
          () => t.r.thinking(),
          (e) => !e.length,
        ),
        [],
      );
    } finally {
      await t.close();
      await m.close();
    }
  },
);

test('F-148-T01: a brain that goes away takes its thinking with it', { timeout: 30000 }, async () => {
  const m = await heldModel();
  const t = await service(m.url);
  try {
    void t.r.chat('Remind me to call Ada').catch(() => undefined);
    await m.next();
    assert.equal(
      (
        await until(
          () => t.r.thinking(),
          (e) => e.length === 1,
        )
      ).length,
      1,
    );
    t.r.brain.child.kill('SIGKILL');
    assert.deepEqual(
      await until(
        () => t.r.thinking(),
        (e) => !e.length,
      ),
      [],
    );
  } finally {
    await t.close();
    await m.close();
  }
});
