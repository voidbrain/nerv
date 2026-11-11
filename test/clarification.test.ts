import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { Runtime } from '../src/runtime.ts';
import { makeServer } from '../src/server.ts';
import { misatoAsk, parsePlan } from '../src/misato.ts';
import { authorize, validateParams } from '../src/rpc.ts';

test('clarification shape is explicit, bounded and exclusive; only the coordinator can claim an answer', () => {
  assert.deepEqual(parsePlan('{"ask":" Which file? "}'), { ask: 'Which file?' });
  for (const text of ['{"ask":""}', '{"ask":"x","reply":"y"}', '{"ask":42}', '{"ask":"x","action":{"tool":"x"}}'])
    assert.equal(parsePlan(text), undefined);
  assert.equal((parsePlan(JSON.stringify({ ask: 'x'.repeat(5000) })) as { ask: string }).ask.length, 4000);
  assert.throws(() => authorize('interface', 'nervous', 'misato.answer'));
  assert.throws(() =>
    validateParams('misato.answer', { conversation: 'dashboard', sequence: 1, text: 'x'.repeat(4001) }),
  );
});

test('durable questions stay open across restart, claims are conversation/sequence bound, expiry closes exactly once', () => {
  const home = mkdtempSync(join(tmpdir(), 'nerv-question-'));
  const path = join(home, 'db');
  let store = new Store(path);
  const now = new Date('2030-01-01T00:00:00Z');
  const id = store.ledger.openSortie('misato', 'Read a file', 'trusted', now);
  try {
    store.ledger.note(id, 'misato.request', { text: 'Read a file', conversation: 'dashboard' }, now);
    const q = store.ledger.ask(id, 'Which file?', 'dashboard', undefined, now);
    assert.equal(q.expires, '2030-01-02T00:00:00.000Z');
    assert.deepEqual(store.ledger.resumable(), []);
    assert.deepEqual(store.ledger.interrupted('2030-01-01T01:00:00Z'), []);
    store.close();
    store = new Store(path);
    const pending = store.ledger.question('dashboard', now)!;
    assert.equal(pending.sortieId, id);
    assert.equal(store.ledger.answer('telegram:1111', pending.sequence, 'shopping.txt', now), null);
    assert.equal(store.ledger.answer('dashboard', pending.sequence + 1, 'shopping.txt', now), null);
    assert.deepEqual(store.ledger.answer('dashboard', pending.sequence, 'shopping.txt', now), { sortieId: id });
    assert.equal(store.ledger.answer('dashboard', pending.sequence, 'twice', now), null);
    store.ledger.ask(id, 'Anything else?', 'dashboard', undefined, now);
    assert.equal(store.ledger.expire(new Date('2030-01-01T23:59:59Z')), 0);
    assert.equal(store.ledger.expire(new Date(q.expires)), 1);
    assert.equal(store.ledger.expire(new Date(q.expires)), 0);
    assert.equal(store.ledger.sortie(id)!.status, 'failed');
    assert.equal(store.ledger.question('dashboard', new Date(q.expires)), null);
    assert.equal(store.ledger.events(id).filter((e) => e.kind === 'misato.unanswered').length, 1);
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});

async function fixture(script: string[]) {
  const asked: { consults: Record<string, unknown>[]; plans: Record<string, unknown>[] } = { consults: [], plans: [] };
  const model = createServer((req, res) => {
    let body = '';
    req
      .on('data', (c) => (body += c))
      .on('end', () => {
        const r = JSON.parse(body) as { messages: { content: string }[] };
        const system = r.messages[0]!.content;
        const prompt = JSON.parse(r.messages.at(-1)!.content) as Record<string, unknown>;
        const consult = system.startsWith('You are a consultant');
        let content: string;
        if (consult) {
          asked.consults.push(prompt);
          content = 'Keep the original file request in view.';
        } else if (system.startsWith('You are Casper'))
          content = '{"vote":"approve","reason":"Matches","confidence":1}';
        else {
          asked.plans.push(prompt);
          content = script.shift() ?? '{"reply":"Done"}';
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }));
      });
  });
  await new Promise<void>((done) => model.listen(0, '127.0.0.1', done));
  const home = mkdtempSync(join(tmpdir(), 'nerv-clarify-runtime-'));
  writeFileSync(
    join(home, 'config.json'),
    JSON.stringify({
      models: {
        local: { baseUrl: `http://127.0.0.1:${(model.address() as { port: number }).port}/v1`, model: 'test' },
        roles: { consultant: { model: 'adviser' } },
      },
    }),
  );
  let runtime = new Runtime(join(home, 'db'), undefined, home);
  await runtime.ready();
  return {
    asked,
    home,
    get runtime() {
      return runtime;
    },
    restart: async () => {
      await runtime.close();
      runtime = new Runtime(join(home, 'db'), undefined, home);
      await runtime.ready();
    },
    close: async () => {
      await runtime.close();
      await new Promise<void>((done) => {
        model.close(() => done());
        model.closeAllConnections();
      });
      rmSync(home, { recursive: true, force: true });
    },
  };
}

test(
  'HTTP, coordinator, model and ledger: short answers resume after restart; long answers consult with first advice',
  { timeout: 30000 },
  async () => {
    const f = await fixture([
      '{"ask":"Which file?"}',
      '{"reply":"Other conversation"}',
      '{"ask":"Which part?"}',
      '{"reply":"Read completed"}',
    ]);
    try {
      const first = await f.runtime.chat('Read a file from the project', 'dashboard');
      assert.equal(first.reply, 'Which file?');
      assert.ok(first.question);
      assert.equal((await f.runtime.sorties())[0]!.status, 'open');
      assert.match((await f.runtime.sorties())[0]!.why, /Waiting for your answer/);
      assert.equal(
        (await f.runtime.events(first.sortieId)).some((e) => e.kind === 'sortie.done'),
        false,
      );
      const other = await f.runtime.chat('A separate conversation', 'telegram:1111');
      assert.notEqual(other.sortieId, first.sortieId);
      await f.restart();
      assert.equal(await f.runtime.closeInterrupted(), 0, 'the pending question survives service restart');
      await f.runtime.sweep();
      const server = makeServer(f.runtime, 'c'.repeat(32));
      await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
      const post = async (message: string) => {
        const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/api/chat`, {
          method: 'POST',
          headers: { authorization: 'Bearer ' + 'c'.repeat(32), 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, conversation: 'dashboard' }),
        });
        assert.equal(response.status, 200);
        return (await response.json()) as { sortieId: string; reply: string };
      };
      try {
        const short = await post('one two three four five six seven eight');
        assert.equal(short.sortieId, first.sortieId);
        assert.equal(f.asked.consults.length, 2, 'exactly eight words bypass the consultant');
        const long = await post('one two three four five six seven eight nine');
        assert.equal(long.sortieId, first.sortieId);
        assert.equal(f.asked.consults.length, 3);
        assert.equal(f.asked.consults.at(-1)!.previousAdvice, 'Keep the original file request in view.');
        assert.match(JSON.stringify(f.asked.consults.at(-1)), /Which part/);
        assert.match(JSON.stringify(f.asked.plans.at(-1)), /Read a file from the project/);
        const events = await f.runtime.events(first.sortieId);
        assert.equal(events.filter((e) => e.kind === 'misato.answered').length, 2);
        assert.equal(events.filter((e) => e.kind === 'sortie.done').length, 1);
        assert.equal((await f.runtime.sortie(first.sortieId))!.status, 'done');
      } finally {
        await new Promise<void>((done) => {
          server.close(() => done());
          server.closeAllConnections();
        });
      }
    } finally {
      await f.close();
    }
  },
);

test(
  'question after an action preserves steps; approval resume retains the clarification and does not ask the pilot again',
  { timeout: 30000 },
  async () => {
    const f = await fixture([
      '{"action":{"tool":"reminders.list","args":{}}}',
      '{"ask":"Which fact?"}',
      '{"action":{"tool":"memory.remember","args":{"text":"Likes sketching"}}}',
      '{"reply":"Saved"}',
    ]);
    try {
      const q = await f.runtime.chat('Remember something for me', 'dashboard');
      const answer = await f.runtime.chat('I like sketching', 'dashboard');
      assert.equal(answer.sortieId, q.sortieId);
      assert.equal(answer.waiting.length, 1);
      assert.equal(f.asked.consults.length, 1);
      await f.runtime.decide(answer.waiting[0]!.approvalId, 'approve', 'api');
      await f.runtime.sweep();
      assert.equal(f.asked.consults.length, 1);
      assert.equal(f.asked.plans.at(-1)!.request, 'I like sketching');
      assert.match(JSON.stringify(f.asked.plans.at(-1)), /Remember something for me/);
      assert.equal((await f.runtime.events(q.sortieId)).filter((e) => e.kind === 'action.done').length, 2);
    } finally {
      await f.close();
    }
  },
);

test('dashboard maps unanswered clarification to waiting without lighting Debrief', () => {
  const source = readFileSync('web/public/dashboard/live.js', 'utf8');
  const start = source.indexOf('  function mapStatus(');
  const end = source.indexOf('  function toApproval(', start);
  assert.ok(end > start);
  const map = new Function(
    `const detailCache={},consulted=new Set(),known=new Map(),phaseOf=new Map(),advisedBy=new Map(),forwardedTo=new Map(),originOf=new Map(),remoteSorties=new Map(),TOOLS={};const short=x=>x;${source.slice(start, end)};return toSortie;`,
  ) as () => (s: object) => { status: string; phase: string; done: { debrief: boolean } };
  const view = map()({
    id: 'test',
    source: 'misato',
    status: 'open',
    waiting: 0,
    question: { text: 'Which file?', expires: '2030-01-02T00:00:00Z' },
    patterns: [],
    created: '2030-01-01T00:00:00Z',
  });
  assert.equal(view.status, 'waiting');
  assert.equal(view.phase, 'apt');
  assert.equal(view.done.debrief, false);
});

test(
  'a clear unrelated request cancels the old wait and opens a fresh sortie; it never executes as the old job',
  { timeout: 30000 },
  async () => {
    const f = await fixture(['{"ask":"Which file?"}', '{"newRequest":true}', '{"reply":"New topic answered"}']);
    try {
      const q = await f.runtime.chat('Read a file', 'dashboard');
      const next = await f.runtime.chat('What is the weather tomorrow?', 'dashboard');
      assert.notEqual(next.sortieId, q.sortieId);
      assert.equal(next.reply, 'New topic answered');
      assert.equal((await f.runtime.sortie(q.sortieId))!.status, 'revoked');
      assert.equal((await f.runtime.sortie(next.sortieId))!.status, 'done');
      assert.equal(f.asked.plans[1]!.clarification, true);
      assert.equal(f.asked.plans[2]!.clarification, undefined);
      const old = await f.runtime.events(q.sortieId);
      assert.equal(
        old.some((e) => e.kind === 'action.done'),
        false,
      );
      assert.ok(old.some((e) => e.kind === 'spear' && e.payload.reason.includes('changed topic')));
    } finally {
      await f.close();
    }
  },
);

test(
  'forwarded questions keep both sortie IDs; unavailable main never converts an answer into local work',
  { timeout: 30000 },
  async () => {
    const main = await fixture(['{"ask":"Which file?"}', '{"reply":"Remote completed"}']);
    const secondary = await fixture([]);
    let online = true;
    secondary.runtime.kaji.main = async () => 'NERV-01';
    secondary.runtime.setDispatch(async (message, _conversation, forward) => {
      if (!online) return undefined;
      const base = { id: 'NERV-01', name: 'Main' };
      await forward(base);
      return { ...(await main.runtime.chat(message, 'kaji:nerv-02-dashboard')), base };
    });
    try {
      const q = await secondary.runtime.chat('Read a file', 'dashboard');
      assert.ok(q.question);
      assert.equal((await secondary.runtime.sortie(q.sortieId))!.status, 'open');
      const mainId = (await main.runtime.sorties())[0]!.id;
      online = false;
      const absent = await secondary.runtime.chat('shopping.txt', 'dashboard');
      assert.match(absent.error!, /unavailable/);
      assert.equal(absent.sortieId, q.sortieId);
      assert.equal(secondary.asked.plans.length, 0);
      online = true;
      const answer = await secondary.runtime.chat('shopping.txt', 'dashboard');
      assert.equal(answer.sortieId, q.sortieId);
      assert.equal(answer.reply, 'Remote completed');
      assert.equal((await main.runtime.sorties()).length, 1);
      assert.equal((await main.runtime.sortie(mainId))!.status, 'done');
      assert.equal((await secondary.runtime.sortie(q.sortieId))!.status, 'done');
    } finally {
      await secondary.close();
      await main.close();
    }
  },
);

test(
  'B-021: a forwarded answer that times out after the main base took it leaves no question waiting here; the next message is a new sortie',
  { timeout: 30000 },
  async () => {
    const main = await fixture(['{"ask":"Which file?"}', '{"reply":"Read shopping.txt."}', '{"reply":"Sunny"}']);
    const secondary = await fixture([]);
    const heard: string[] = [];
    let late = false;
    secondary.runtime.kaji.main = async () => 'NERV-01';
    secondary.runtime.setDispatch(async (message, _conversation, forward) => {
      const base = { id: 'NERV-01', name: 'Main' };
      await forward(base);
      heard.push(message);
      const there = await main.runtime.chat(message, 'kaji:nerv-02-dashboard');
      // What KajiLink.chat returns when the request was sent but its reply did not arrive in time: the main base has
      // already taken the answer and moved on.
      if (late)
        return {
          sortieId: '',
          error: 'NERV-01 did not answer (timeout); it may still be working on it, so the request was not repeated here.',
          steps: [],
          waiting: [],
        };
      return { ...there, base };
    });
    try {
      const q = await secondary.runtime.chat('Read a file', 'dashboard');
      assert.ok(q.question);
      late = true;
      const timedOut = await secondary.runtime.chat('shopping.txt', 'dashboard');
      assert.match(timedOut.error ?? '', /did not answer .*not repeated here/);
      assert.equal(timedOut.sortieId, q.sortieId);
      const mainId = (await main.runtime.sorties())[0]!.id;
      assert.equal((await main.runtime.sortie(mainId))!.status, 'done', 'the main base took the answer');
      assert.notEqual(
        (await secondary.runtime.sortie(q.sortieId))!.status,
        'open',
        'this base does not keep waiting for a question the main base no longer asks',
      );
      const answered = async () =>
        (await secondary.runtime.events(q.sortieId)).filter((e) => e.kind === 'misato.answered').length;
      assert.equal(await answered(), 1, 'the answer left this base once');
      late = false;
      const next = await secondary.runtime.chat('What is the weather tomorrow?', 'dashboard');
      assert.notEqual(next.sortieId, q.sortieId, 'the next message is not recorded as an answer to the old question');
      assert.equal(next.reply, 'Sunny');
      assert.deepEqual(heard, ['Read a file', 'shopping.txt', 'What is the weather tomorrow?']);
      assert.equal((await main.runtime.sorties()).length, 2, 'the main base saw a new request, not a second answer');
      assert.equal(await answered(), 1);
      assert.equal(secondary.asked.plans.length, 0, 'nothing was planned on this base');
    } finally {
      await secondary.close();
      await main.close();
    }
  },
);

test('B-021: the first turn of an answer names the pending question and its job, and puts the topic decision last', () => {
  const base = {
    request: 'Tell me what a calendar is instead.',
    history: [],
    tools: [],
    now: '2030-12-01T12:00:00Z',
    timeZone: 'UTC',
    context: [
      { request: 'Set a reminder.' },
      { request: 'For tomorrow', reply: 'What should I remind you about?' },
    ],
  };
  const answer = misatoAsk({ ...base, clarification: true }, 'local');
  const prompt = JSON.parse(answer.prompt) as Record<string, unknown>;
  assert.equal(prompt.clarification, true);
  assert.equal(prompt.originalRequest, 'Set a reminder.');
  assert.equal(prompt.pendingQuestion, 'What should I remind you about?');
  const last = answer.system!.split('\n').slice(-3).join('\n');
  assert.match(last, /\{"newRequest":true\}/);
  assert.match(last, /even when you could answer it yourself/);
  assert.match(last, /Length alone never decides/);
  const plain = misatoAsk(base, 'local');
  const ordinary = JSON.parse(plain.prompt) as Record<string, unknown>;
  assert.equal(ordinary.pendingQuestion, undefined);
  assert.equal(ordinary.originalRequest, undefined);
  assert.doesNotMatch(plain.system!, /even when you could answer it yourself/);
});

test(
  'B-021: the coordinator gives the answer turn its pending question and original request; later turns get neither',
  { timeout: 30000 },
  async () => {
    const f = await fixture([
      '{"ask":"Which file?"}',
      '{"action":{"tool":"reminders.list","args":{}}}',
      '{"reply":"Read shopping.txt"}',
    ]);
    try {
      const q = await f.runtime.chat('Read a file', 'dashboard');
      const answer = await f.runtime.chat('shopping.txt', 'dashboard');
      assert.equal(answer.sortieId, q.sortieId);
      assert.deepEqual(
        [f.asked.plans[1]!.clarification, f.asked.plans[1]!.originalRequest, f.asked.plans[1]!.pendingQuestion],
        [true, 'Read a file', 'Which file?'],
      );
      assert.deepEqual(
        [f.asked.plans[2]!.clarification, f.asked.plans[2]!.originalRequest, f.asked.plans[2]!.pendingQuestion],
        [undefined, undefined, undefined],
      );
    } finally {
      await f.close();
    }
  },
);
