// F-130-T01: the workspace Session and LiveFeed services, against the real API (the join) and with fakes for the
// sign-in rules. An unchanged poll keeps every signal value by identity, so Angular redraws nothing (B-144).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computed } from '@angular/core';
import { makeServer } from '../src/server.ts';
import { Store } from '../src/store.ts';
import { FALLBACK_POLL_MS, LiveFeed, MAX_BACKOFF_MS, type FeedTimers } from '../web/src/live-feed.ts';
import { RequestError, Session, takeLoginCode, type SessionDeps } from '../web/src/session.ts';

const noTimers: FeedTimers = { set: () => null, clear: () => {} };

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

function deps(over: Partial<SessionDeps> = {}): SessionDeps & { app: ReturnType<typeof memoryStorage> } {
  const app = memoryStorage();
  return {
    app,
    fetch: async () => new Response('{}', { status: 500 }),
    appStorage: () => app,
    installed: false,
    userAgent: 'Mozilla/5.0 (Macintosh)',
    ...over,
  };
}

test('F-130-T01: the live feed reads the real API and an unchanged poll changes no value', async () => {
  const store = new Store(':memory:');
  const token = 'f'.repeat(32);
  const server = makeServer(store, token);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  const http: typeof fetch = (input, init) => fetch(origin + String(input), init);
  try {
    const first = store.ledger.openSortie('owner', 'Neutral sortie one', 'trusted');
    store.runAction(store.ledger.openSortie('owner', 'Neutral sortie two', 'trusted'), {
      tool: 'reminders.add',
      args: { title: 'Neutral reminder', due: '2099-01-01T00:00:00Z' },
      stage: 'prototype',
    });
    const session = new Session(deps({ fetch: http }));
    await session.signIn(token);
    const feed = new LiveFeed(session, http, noTimers, '2026-11-25T00:00:00.000Z');
    const count = computed(() => feed.sorties().length + feed.approvals().length);
    await feed.refresh();
    assert.equal(feed.sorties().length, 2);
    assert.equal(feed.approvals().length, 1, 'the reminder waits for approval');
    assert.ok(feed.history(), 'the fallback history page was read');
    assert.equal(feed.problem(), null);
    assert.equal(count(), 3);

    const sorties = feed.sorties(),
      approvals = feed.approvals(),
      history = feed.history();
    await feed.refresh();
    assert.equal(feed.sorties(), sorties, 'unchanged sorties keep their list');
    assert.equal(feed.approvals(), approvals, 'unchanged approvals keep their list');
    assert.equal(feed.history(), history, 'an equal history keeps its value');

    store.ledger.close(first, 'done');
    await feed.refresh();
    assert.notEqual(feed.sorties(), sorties, 'a closed sortie changes the list');
    const closed = feed.sorties().find((s) => s.realId === first)!;
    const other = feed.sorties().find((s) => s.realId !== first)!;
    assert.equal(closed.status, 'done');
    assert.equal(
      other,
      sorties.find((s) => s.realId === other.realId),
      'the unchanged row keeps its object',
    );
  } finally {
    server.close();
    store.close();
  }
});

/** Timers the test runs by hand: what is scheduled, and after how long. */
function manualTimers() {
  const due = new Map<number, { run: () => void; ms: number }>();
  let next = 0;
  const timers: FeedTimers = {
    set: (run, ms) => (due.set(++next, { run, ms }), next),
    clear: (h) => void due.delete(h as number),
  };
  return { timers, due };
}

/** Lets chained reads (a refresh asked for during a read) finish. */
const settle = () => new Promise((done) => setTimeout(done, 5));

const reply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

async function feedWith(fetcher: typeof fetch, timers: FeedTimers = noTimers) {
  const session = new Session(deps({ fetch: fetcher }));
  await session.signIn('t'.repeat(32));
  return { session, feed: new LiveFeed(session, fetcher, timers, '2026-11-25T00:00:00.000Z') };
}

test('F-130-T01 review: a 401 sends the dashboard back to the sign-in box', async () => {
  const { session, feed } = await feedWith(reply(401, { error: 'Unauthorized' }));
  feed.start();
  await feed.refresh();
  assert.equal(session.token(), '', 'the credential is dropped');
  assert.equal(session.ended(), 'session');
  assert.equal(feed.mode(), 'idle', 'the feed stops');
});

test("F-130-T01 review: 403 and 5xx keep the status and the server's message; no reply says not reached", async () => {
  for (const [status, error] of [
    [403, 'Placement commands require the local admin token.'],
    [500, 'Database is locked.'],
    [503, 'Dashboard stream capacity reached.'],
  ] as const) {
    const { session, feed } = await feedWith(reply(status, { error }));
    await feed.refresh();
    assert.deepEqual(feed.problem(), { kind: 'server', status, message: error }, String(status));
    assert.ok(session.token(), 'the session stays');
  }
  const { feed } = await feedWith(async () => {
    throw new TypeError('fetch failed');
  });
  await feed.refresh();
  assert.deepEqual(feed.problem(), { kind: 'offline' });
});

test("F-130-T01 review: a 401 on the simple page is the caller's to decide; Session keeps the token", async () => {
  const session = new Session(deps({ fetch: reply(401, { error: 'Unauthorized' }) }));
  await session.signIn('a'.repeat(32));
  await assert.rejects(session.request('doctor'), (e) => e instanceof RequestError && e.status === 401);
  assert.equal(session.token(), 'a'.repeat(32), 'Nodo keeps an admin token after a 401, as before');
});

test('F-130-T01 review: failed reads back off up to a minute; a good read resets it', async () => {
  let fail = true;
  const fetcher: typeof fetch = async (input) => {
    if (fail) throw new TypeError('fetch failed');
    const path = String(input);
    const body = path.includes('history')
      ? { delivered: 0, pending: 0, brief: null }
      : path.includes('doctor')
        ? {}
        : [];
    return new Response(JSON.stringify(body), { status: path.includes('stream') ? 404 : 200 });
  };
  const { timers, due } = manualTimers();
  const { feed } = await feedWith(fetcher, timers);
  feed.start();
  await settle();
  const waits = () => [...due.values()].filter((d) => d.ms >= FALLBACK_POLL_MS).map((d) => d.ms);
  const seen: number[] = [];
  for (let i = 0; i < 6; i++) {
    seen.push(Math.max(...waits()));
    await feed.refresh();
    await settle();
  }
  assert.deepEqual(seen.slice(0, 5), [10_000, 20_000, 40_000, MAX_BACKOFF_MS, MAX_BACKOFF_MS]);
  fail = false;
  await feed.refresh();
  await settle();
  assert.equal(feed.problem(), null);
  assert.ok(waits().includes(FALLBACK_POLL_MS), 'back to the normal poll after a good read');
  feed.stop();
});

test('F-130-T01 review: a hidden page reads nothing and resumes when visible', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (input) => {
    calls++;
    const path = String(input);
    const body = path.includes('history')
      ? { delivered: 0, pending: 0, brief: null }
      : path.includes('doctor')
        ? {}
        : [];
    return new Response(JSON.stringify(body), { status: path.includes('stream') ? 404 : 200 });
  };
  const { timers, due } = manualTimers();
  const { feed } = await feedWith(fetcher, timers);
  feed.start();
  await settle();
  feed.pause();
  assert.equal(due.size, 0, 'no timer left while hidden');
  assert.equal(feed.mode(), 'paused');
  const before = calls;
  await feed.refresh();
  await settle();
  assert.equal(calls, before + 4, 'an explicit refresh still reads');
  assert.equal(due.size, 0, 'but schedules nothing while hidden');
  feed.resume();
  await new Promise((done) => setTimeout(done, 10));
  assert.ok(calls > before + 4, 'visible again: it reads and reconnects');
  assert.ok(due.size > 0, 'and schedules again');
  feed.stop();
});

test('F-130-T01: sign-in rules: sessions and admin tokens in memory, pairing only installed', async () => {
  const exchanged = deps({
    fetch: async () => new Response(JSON.stringify({ token: 'session-token' }), { status: 200 }),
  });
  const a = new Session(exchanged);
  assert.equal(await a.start('a'.repeat(32)), null);
  assert.equal(a.token(), 'session-token');
  assert.equal(exchanged.app.map.size, 0, 'a dashboard session stays in memory: a reload asks again');

  const admin = deps();
  const b = new Session(admin);
  await b.signIn('x'.repeat(32));
  assert.equal(b.token(), 'x'.repeat(32));
  assert.equal(admin.app.map.size, 0, 'the admin token is never stored');

  let called = false;
  const tab = deps({ fetch: async () => ((called = true), new Response('{}')) });
  assert.equal(await new Session(tab).signIn('ABCD-2345'), 'installed-only');
  assert.equal(called, false, 'a tab refuses a pairing code before any request');

  const installed = deps({
    installed: true,
    fetch: async () => new Response(JSON.stringify({ token: 'device-token' }), { status: 200 }),
  });
  const c = new Session(installed);
  assert.equal(await c.signIn('ABCD-2345'), null);
  assert.equal(c.paired(), true);
  assert.equal(installed.app.getItem('nerv.device'), 'device-token');
  const relaunch = new Session(installed);
  await relaunch.start(null);
  assert.equal(relaunch.token(), 'device-token', 'the installed app signs itself in');

  const refused = deps({ fetch: async () => new Response('{}', { status: 400 }) });
  const d = new Session(refused);
  assert.equal(await d.start('b'.repeat(32)), 'code');
  assert.equal(d.startFailure(), 'code');
});

test('F-130-T01: the login code leaves the address before the app starts', () => {
  let replaced = '';
  const win = {
    location: { hash: '#code=' + 'c'.repeat(32), pathname: '/full', search: '' },
    history: { replaceState: (_s: unknown, _t: string, url: string) => void (replaced = url) },
  } as unknown as Pick<Window, 'location' | 'history'>;
  assert.equal(takeLoginCode(win), 'c'.repeat(32));
  assert.equal(replaced, '/full');
  assert.equal(takeLoginCode({ ...win, location: { ...win.location, hash: '#other' } } as typeof win), null);
});
