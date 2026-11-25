import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/store.ts';
import { fillLcl, LCL_CHARS, misatoAsk, type Recalled } from '../src/misato.ts';
test("recall finds Instrumentality's summaries as well as facts; summaries written before the index existed are indexed once", () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-recall-'));
  const path = join(dir, 'nerv.sqlite');
  try {
    const a = new Store(path);
    a.memory.saveEpisode({
      since: '2030-01-01T00:00:00Z',
      until: '2030-01-02T00:00:00Z',
      summary: 'The owner planned a trip to Kyoto with Ada.',
      exchanges: 4,
      proposed: 1,
    });
    // An older install: the summary is there, its index row is not.
    a.db.exec(
      "INSERT INTO episodes(id,since,until,summary,exchanges,proposed,created) VALUES('old','2029-12-01T00:00:00Z','2029-12-02T00:00:00Z','Bought a new espresso machine.',2,0,'2029-12-02T00:00:00Z')",
    );
    a.close();
    const raw = new DatabaseSync(path);
    raw.exec('DELETE FROM episodes_fts');
    raw.close();
    const b = new Store(path);
    try {
      assert.deepEqual(
        b.memory.recallEpisodes('when is the Kyoto trip?').map((e) => e.summary),
        ['The owner planned a trip to Kyoto with Ada.'],
      );
      assert.deepEqual(
        b.memory.recallEpisodes('espresso').map((e) => e.id),
        ['old'],
        'backfilled on open',
      );
      assert.deepEqual(b.memory.recallEpisodes('?!'), [], 'a query without words finds nothing rather than everything');
    } finally {
      b.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
const fact = (id: string, text: string, shareable = false): Recalled => ({ id, text, shareable, tainted: false });
test("the LCL fills memory first, then the newest exchanges, within the route's budget; whole items only; local-only stays local", () => {
  const summary: Recalled = {
    id: 'e1',
    text: 'Planned Kyoto with Ada.',
    shareable: false,
    tainted: false,
    kind: 'summary',
    when: '2030-01-02',
  };
  const memory = [fact('f1', 'Coffee at 8', true), fact('f2', 'Ada is a sister'), summary];
  const context = [
    { request: 'first', reply: 'a' },
    { request: 'second', reply: 'b' },
    { request: 'third', reply: 'c' },
  ];
  const local = fillLcl(memory, context, 'local');
  assert.deepEqual(
    local.memory.map((m) => m.id),
    ['f1', 'f2', 'e1'],
    'facts in recall order, then the summary',
  );
  assert.equal(local.memory[2]!.summary, '2030-01-02');
  assert.deepEqual(
    local.earlier.map((t) => t.request),
    ['first', 'second', 'third'],
    'chronological order kept',
  );
  const cloud = fillLcl(memory, context, 'cloud');
  assert.deepEqual(
    cloud.memory.map((m) => m.id),
    ['f1'],
    'the cloud route gets only shareable facts, never a summary',
  );
  // Sizes: each fact is 62 characters of JSON, each long exchange 91; budget 220: memory may use 88 (one fact), then the third exchange fits (153) and the second would not (244).
  const long = [
    { request: 'first', reply: 'a'.repeat(60) },
    { request: 'second', reply: 'b'.repeat(60) },
    { request: 'third', reply: 'c'.repeat(60) },
  ];
  const tight = fillLcl([fact('f1', 'x'.repeat(40)), fact('f2', 'y'.repeat(40))], long, 'local', 220);
  assert.deepEqual(
    tight.memory.map((m) => m.id),
    ['f1'],
    'memory takes at most 40% of the budget, whole facts only',
  );
  assert.deepEqual(
    tight.earlier.map((t) => t.request),
    ['third'],
    'then the newest exchanges until the budget is used',
  );
  assert.ok(LCL_CHARS.cloud < LCL_CHARS.local, 'the paid route gets less');
  const ask = misatoAsk(
    {
      request: 'Kyoto?',
      history: [],
      tools: [],
      now: '2030-01-03T08:00:00Z',
      timeZone: 'Europe/Rome',
      memory,
      context,
    },
    'local',
  );
  assert.match(ask.prompt, /"summary":"2030-01-02"/);
  assert.ok(JSON.parse(ask.prompt).memory.length === 3);
  assert.doesNotMatch(
    misatoAsk(
      {
        request: 'Kyoto?',
        history: [],
        tools: [],
        now: '2030-01-03T08:00:00Z',
        timeZone: 'Europe/Rome',
        memory,
        context,
      },
      'cloud',
    ).prompt,
    /Kyoto with Ada|Ada is a sister/,
  );
});
test(
  'through the scheduler process: memory.recall returns matching facts and summaries, summaries marked local-only',
  { timeout: 20000 },
  async () => {
    const { Runtime } = await import('../src/runtime.ts');
    const dir = mkdtempSync(join(tmpdir(), 'nerv-recall-rpc-'));
    const path = join(dir, 'nerv.sqlite');
    const s = new Store(path);
    s.memory.add('Ada lives in Kyoto', 'owner');
    s.memory.saveEpisode({
      since: '2030-01-01T00:00:00Z',
      until: '2030-01-02T00:00:00Z',
      summary: 'Talked about visiting Kyoto in April.',
      exchanges: 3,
      proposed: 0,
    });
    s.close();
    const runtime = new Runtime(path, undefined, dir);
    try {
      await runtime.ready();
      const got = (await runtime.nervous.call('memory.recall', { text: 'Kyoto plans' })) as Recalled[];
      assert.deepEqual(
        got.map((r) => [r.text, r.kind ?? 'fact', r.shareable]),
        [
          ['Ada lives in Kyoto', 'fact', false],
          ['Talked about visiting Kyoto in April.', 'summary', false],
        ],
      );
      assert.equal(got[1]!.when, '2030-01-02');
    } finally {
      await runtime.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
test('B-021: on an answer turn, originalRequest and pendingQuestion count inside the LCL budget of each route', () => {
  const long = (w: string) => `${w} `.repeat(400).trim();
  const context = [
    { request: long('original') },
    { request: long('second'), reply: long('first question') },
    { request: long('third'), reply: long('pending question') },
  ];
  for (const route of ['local', 'cloud'] as const) {
    const prompt = JSON.parse(
      misatoAsk(
        {
          request: 'an answer',
          history: [],
          tools: [],
          now: '2030-01-03T08:00:00Z',
          timeZone: 'UTC',
          context,
          clarification: true,
        },
        route,
      ).prompt,
    ) as Record<string, unknown>;
    assert.ok(prompt.originalRequest && prompt.pendingQuestion);
    const used = ['earlier', 'memory', 'originalRequest', 'pendingQuestion']
      .filter((k) => prompt[k] !== undefined)
      .reduce((n, k) => n + JSON.stringify(prompt[k]).length + 1, 0);
    assert.ok(used <= LCL_CHARS[route], `${route}: ${used} > ${LCL_CHARS[route]}`);
  }
});
