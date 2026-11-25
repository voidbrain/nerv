// F-130-T01: the workspace Session and LiveFeed services, against the real API (the join) and with fakes for the
// sign-in rules. An unchanged poll keeps every signal value by identity, so Angular redraws nothing (B-144).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computed } from '@angular/core';
import { makeServer } from '../src/server.ts';
import { Store } from '../src/store.ts';
import { LiveFeed, type FeedTimers } from '../web/src/live-feed.ts';
import { Session, SESSION_KEY, takeLoginCode, type SessionDeps } from '../web/src/session.ts';

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

function deps(
  over: Partial<SessionDeps> = {},
): SessionDeps & { tab: ReturnType<typeof memoryStorage>; app: ReturnType<typeof memoryStorage> } {
  const tab = memoryStorage(),
    app = memoryStorage();
  return {
    tab,
    app,
    fetch: async () => new Response('{}', { status: 500 }),
    tabStorage: () => tab,
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
    assert.equal(feed.stale(), false);
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

test('F-130-T01: a refused credential stops the feed and ends the session', async () => {
  const d = deps({ fetch: async () => new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }) });
  const session = new Session(d);
  d.tab.setItem(SESSION_KEY, 'kept-session');
  await session.start(null);
  assert.equal(session.token(), 'kept-session', 'a kept session signs in after a reload');
  const feed = new LiveFeed(session, d.fetch, noTimers, '2026-11-25T00:00:00.000Z');
  await feed.refresh();
  assert.equal(feed.stale(), true);
  assert.equal(session.token(), '');
  assert.equal(session.ended(), 'session');
  assert.equal(d.tab.getItem(SESSION_KEY), null, 'the kept session is forgotten');
});

test('F-130-T01: sign-in rules: session kept per tab, admin token in memory, pairing only installed', async () => {
  const exchanged = deps({
    fetch: async () => new Response(JSON.stringify({ token: 'session-token' }), { status: 200 }),
  });
  const a = new Session(exchanged);
  assert.equal(await a.start('a'.repeat(32)), null);
  assert.equal(a.token(), 'session-token');
  assert.equal(exchanged.tab.getItem(SESSION_KEY), 'session-token');

  const admin = deps();
  const b = new Session(admin);
  await b.signIn('x'.repeat(32));
  assert.equal(b.token(), 'x'.repeat(32));
  assert.equal(admin.tab.map.size + admin.app.map.size, 0, 'the admin token is never stored');

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
