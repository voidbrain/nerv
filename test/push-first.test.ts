import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createECDH, randomBytes } from 'node:crypto';
import { Store } from '../src/store.ts';
import { makeServer } from '../src/server.ts';
import { TelegramApi, TelegramChannel } from '../src/telegram.ts';
import { FALLBACK_CLAIM_LEASE_MS, PUSH_FALLBACK_MS } from '../src/delivery-state.ts';
import { fakeBotApi, fakePushService, until, wait } from './fixtures/delivery-fakes.ts';

const OWNER = 5150;
const TOKEN = '123456:' + 'p'.repeat(35);
const dashboardLive = readFileSync('web/public/dashboard/live.js', 'utf8');
const dashboardShell = readFileSync('web/public/dashboard/dashboard.js', 'utf8');
type Payload = { notification: { title: string; data: Record<string, unknown> } };

function dashboardSeen(
  state: object,
  api: (path: string, init?: RequestInit) => Promise<unknown>,
  localStorage: object,
  renderAll: () => void = () => {},
) {
  const start = dashboardLive.indexOf('  const VISIT = "nerv.dashboard.lastVisit";');
  const end = dashboardLive.indexOf('  window.renderAway = function ()', start);
  assert.ok(start >= 0 && end > start, 'the dashboard exposes its Mark as read handler');
  const window: Record<string, unknown> = {};
  new Function(
    'state',
    'window',
    'api',
    'localStorage',
    'HOUR',
    'renderAll',
    `${dashboardLive.slice(start, end)}; return window.liveSeen;`,
  )(state, window, api, localStorage, 60 * 60 * 1000, renderAll);
  return window.liveSeen as () => Promise<void>;
}

function clickDashboardSeen(state: object, window: object, renderAll: () => void) {
  const start = dashboardShell.indexOf('  if (t.id === "btn-seen")');
  const end = dashboardShell.indexOf('\n', start);
  assert.ok(start >= 0 && end > start, 'the dashboard binds #btn-seen');
  new Function('t', 'state', 'LIVE', 'window', 'renderAll', dashboardShell.slice(start, end))(
    { id: 'btn-seen' },
    state,
    true,
    window,
    renderAll,
  );
}

/** The dashboard's real service worker (web/public/dashboard/sw.js) in a sandbox whose fetch reaches `origin`. */
function phone(origin: string) {
  const listeners = new Map<string, (e: unknown) => void>();
  const shown: { title: string; data: Record<string, unknown> }[] = [];
  const self = {
    addEventListener: (type: string, fn: (e: unknown) => void) => listeners.set(type, fn),
    skipWaiting: () => {},
    registration: {
      showNotification: async (title: string, options: { data: Record<string, unknown> }) =>
        void shown.push({ title, data: options.data }),
    },
    clients: { claim: async () => {}, matchAll: async () => [], openWindow: async () => null },
  };
  const sandboxFetch = (path: string, init: RequestInit) => fetch(origin + path, init);
  runInNewContext(readFileSync('web/public/dashboard/sw.js', 'utf8'), { self, fetch: sandboxFetch, URL, JSON });
  const fire = async (type: string, event: object) => {
    const work: Promise<unknown>[] = [];
    listeners.get(type)!({ ...event, waitUntil: (p: Promise<unknown>) => work.push(p) });
    await Promise.all(work);
  };
  return {
    shown,
    receive: (payload: Payload) => fire('push', { data: { json: () => payload, text: () => JSON.stringify(payload) } }),
    tap: (data: Record<string, unknown>) => fire('notificationclick', { notification: { data, close: () => {} } }),
  };
}

async function setup(opts: { pushStatus?: number; device?: boolean; fallbackMs: number; dir?: string }) {
  const dir = opts.dir ?? mkdtempSync(join(tmpdir(), 'nerv-push-first-'));
  const push = await fakePushService(opts.pushStatus ?? 201);
  const bot = await fakeBotApi(TOKEN);
  let store = new Store(join(dir, 'nerv.sqlite'));
  if (opts.device !== false) store.savePushSubscription(push.subscription);
  let server = makeServer(store, 's'.repeat(32));
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  let channel = new TelegramChannel({
    api: new TelegramApi(TOKEN, bot.base),
    store,
    chatId: OWNER,
    statePath: join(dir, 'telegram-state.json'),
    log: () => {},
    pushFallbackMs: opts.fallbackMs,
  });
  await channel.start(40);
  const ctx = {
    dir,
    push,
    bot,
    get store() {
      return store;
    },
    get server() {
      return server;
    },
    phone: () => phone(`http://127.0.0.1:${(server.address() as { port: number }).port}`),
    /** A reminder falls due and the scheduler ticks: the delivery decision. Returns its inbox item id. */
    async due(title: string) {
      store.add(title, new Date(Date.now() + 30).toISOString());
      await wait(50);
      store.tick();
      return store.inboxPage(0, 20).items.find((i) => i.message.includes(title))!.id;
    },
    telegrams: (title: string) => bot.sent.filter((t) => t.includes(title)).length,
    async stop() {
      await channel.stop();
      await new Promise<void>((done) => server.close(() => done()));
      store.close();
    },
    /** NERV stops and starts again on the same files. */
    async restart() {
      await ctx.stop();
      store = new Store(join(dir, 'nerv.sqlite'));
      server = makeServer(store, 's'.repeat(32));
      await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
      channel = new TelegramChannel({
        api: new TelegramApi(TOKEN, bot.base),
        store,
        chatId: OWNER,
        statePath: join(dir, 'telegram-state.json'),
        log: () => {},
        pushFallbackMs: opts.fallbackMs,
      });
      await channel.start(40);
    },
    async close() {
      await ctx.stop();
      await bot.close();
      await push.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
  return ctx;
}

test('F-004-T09: the owner decision names the fallback deadline: about 10 minutes', () => {
  assert.equal(PUSH_FALLBACK_MS, 10 * 60_000);
});

test('F-004-T09 join: delivery decision → push → service-worker receipt or deadline → Telegram, never twice', async () => {
  const t = await setup({ fallbackMs: 1500 });
  try {
    // Opened on the phone: the tap's receipt keeps it off Telegram for good.
    const opened = await t.due('Comprare il pane');
    await until(() => t.push.received.length === 1);
    const payload = t.push.received[0]!;
    assert.equal(t.store.deliveryState(opened).push?.state, 'sent', 'the push service took it: sent, not delivered');
    assert.equal(t.telegrams('Comprare il pane'), 0, 'Telegram waits for the phone');
    const device = t.phone();
    await device.receive(payload);
    assert.equal(device.shown.length, 1, 'the worker shows it');
    assert.equal(t.store.deliveryState(opened).push?.state, 'sent', 'shown is not opened');
    await device.tap(device.shown[0]!.data);
    assert.equal(t.store.deliveryState(opened).push?.state, 'opened', 'the receipt reached the service');

    // Not opened: Telegram sends it once at the deadline; a late tap and later passes send nothing more.
    const missed = await t.due('Portare fuori il cane');
    await until(() => t.push.received.length === 2);
    await wait(200);
    assert.equal(t.telegrams('Portare fuori il cane'), 0, 'still inside the deadline');
    await until(() => t.telegrams('Portare fuori il cane') === 1);
    await device.receive(t.push.received[1]!);
    await device.tap(device.shown[1]!.data);
    await wait(400);
    const both = t.store.deliveryState(missed);
    assert.equal(both.push?.state, 'opened');
    assert.equal(both.telegram?.state, 'sent', 'both channels reported on one delivery');
    assert.equal(t.telegrams('Portare fuori il cane'), 1, 'never twice');
    assert.equal(t.telegrams('Comprare il pane'), 0, 'the opened one never reached Telegram');
    assert.equal(t.store.deliveryState(opened).telegram, undefined);
  } finally {
    await t.close();
  }
});

test('F-004-T09: a failed push, no device or an expired subscription goes straight to Telegram', async () => {
  // The deadline is long: anything Telegram sends here was not waiting for it.
  const failing = await setup({ pushStatus: 500, fallbackMs: 60_000 });
  try {
    const id = await failing.due('Pagare la bolletta');
    await until(() => failing.telegrams('Pagare la bolletta') === 1);
    assert.equal(failing.store.deliveryState(id).push?.state, 'failed');
    failing.push.setStatus(410);
    const expired = await failing.due('Rinnovare il passaporto');
    await until(() => failing.telegrams('Rinnovare il passaporto') === 1);
    assert.match(failing.store.deliveryState(expired).push!.reason!, /HTTP 410/);
    assert.equal(failing.store.listPushSubscriptions().length, 0, 'the expired subscription is removed');
    const after = await failing.due('Innaffiare le piante');
    await until(() => failing.telegrams('Innaffiare le piante') === 1);
    assert.equal(failing.store.deliveryState(after).push, undefined, 'no device left: no push at all');
    await wait(300);
    assert.equal(failing.push.received.length, 2, 'nothing pushed once the device expired');
    for (const title of ['Pagare la bolletta', 'Rinnovare il passaporto', 'Innaffiare le piante'])
      assert.equal(failing.telegrams(title), 1, title);
  } finally {
    await failing.close();
  }
  const none = await setup({ device: false, fallbackMs: 60_000 });
  try {
    const id = await none.due('Chiamare la nonna');
    await until(() => none.telegrams('Chiamare la nonna') === 1);
    assert.deepEqual(Object.keys(none.store.deliveryState(id)), ['telegram'], 'push off: Telegram only');
  } finally {
    await none.close();
  }
});

test('F-004-T09: across a NERV restart the fallback is sent once, and an opened push stays off Telegram', async () => {
  const t = await setup({ fallbackMs: 2500 });
  try {
    const waiting = await t.due('Ritirare la giacca');
    const opened = await t.due('Prenotare il dentista');
    await until(() => t.push.received.length === 2);
    const receiptFor = (title: string) =>
      t.push.received.find((p) => p.notification.title.includes(title))!.notification.data;
    await t.restart();
    const device = t.phone();
    await device.tap(receiptFor('Prenotare il dentista'));
    await until(() => t.telegrams('Ritirare la giacca') === 1);
    await t.restart();
    await wait(500);
    assert.equal(t.telegrams('Ritirare la giacca'), 1, 'not resent after the second restart');
    assert.equal(t.telegrams('Prenotare il dentista'), 0, 'opened before the deadline: never on Telegram');
    assert.equal(t.store.deliveryState(waiting).telegram?.state, 'sent');
    assert.equal(t.store.deliveryState(opened).push?.state, 'opened');
  } finally {
    await t.close();
  }
});

// Owner decision 2026-11-25 (B, at least once): this test used to pin "a claim cut off by a crash is never re-offered".
// The requirement changed deliberately: such a claim is re-offered once its lease ends, accepting one duplicate.
test('F-004-T09: a fallback claimed but cut off by a crash is re-offered once after its lease (at least once); a failed send is retried', async () => {
  const store = new Store(':memory:');
  const device = createECDH('prime256v1');
  device.generateKeys();
  let pushed = 0;
  store.pushFetch = (async () => {
    pushed++;
    return new Response(null, { status: 201 });
  }) as typeof fetch;
  try {
    store.savePushSubscription({
      endpoint: 'https://push.example.test/device-1',
      p256dh: device.getPublicKey().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    });
    store.add('Spegnere il forno', '2030-05-01T07:00:00Z');
    store.tick(new Date('2030-05-01T07:01:00Z'));
    await until(() => pushed === 1);
    const id = store.inboxPage(0, 5).items[0]!.id;
    const later = new Date('2030-05-01T07:20:00Z');
    const claim = (at = later) => store.deliveryChannels.claimFallback(PUSH_FALLBACK_MS, at);
    assert.equal(claim().length, 1, 'due once the deadline passed');
    assert.equal(claim().length, 0, 'claimed: in flight, not handed out twice while its lease runs');
    const leaseOver = new Date(later.getTime() + FALLBACK_CLAIM_LEASE_MS + 1000);
    assert.equal(
      claim(leaseOver).length,
      1,
      'a claim with no outcome (NERV crashed mid-send) is re-offered after its lease',
    );
    assert.equal(claim(leaseOver).length, 0, 'once per crash: the re-offer is a new claim with a new lease');
    store.deliveryChannels.record(id, 'telegram', 'failed', new Date(leaseOver.getTime() + 1000), 'HTTP 503');
    assert.equal(claim(new Date(leaseOver.getTime() + 2000)).length, 1, 'a recorded failure is retried');
    store.recordDelivery(id, 'telegram', 'sent');
    assert.equal(claim(new Date(leaseOver.getTime() + 10 * FALLBACK_CLAIM_LEASE_MS)).length, 0, 'sent: never again');
    assert.equal(store.pushOpened('not-a-receipt'), false);
    assert.equal(store.pushOpened('A'.repeat(24)), false, 'an unknown receipt opens nothing');
  } finally {
    store.close();
  }
});

test('F-004-T09 review: a tap in the workspace app (Angular worker) also posts the receipt', async () => {
  const t = await setup({ fallbackMs: 60_000 });
  try {
    const id = await t.due('Stendere il bucato');
    await until(() => t.push.received.length === 1);
    const listeners = new Map<string, (e: unknown) => void>();
    const imported: string[] = [];
    const self = { addEventListener: (type: string, fn: (e: unknown) => void) => listeners.set(type, fn) };
    const origin = `http://127.0.0.1:${(t.server.address() as { port: number }).port}`;
    runInNewContext(readFileSync('web/public/workspace-sw.js', 'utf8'), {
      self,
      importScripts: (...urls: string[]) => imported.push(...urls),
      fetch: (path: string, init: RequestInit) => fetch(origin + path, init),
      JSON,
    });
    assert.deepEqual(
      imported,
      ['ngsw-worker.js'],
      'the Angular worker still runs: offline shell, updates, its own click',
    );
    const work: Promise<unknown>[] = [];
    listeners.get('notificationclick')!({
      notification: { data: t.push.received[0]!.notification.data },
      waitUntil: (p: Promise<unknown>) => work.push(p),
    });
    await Promise.all(work);
    assert.equal(t.store.deliveryState(id).push?.state, 'opened');
    // F-130-T01: the providers moved from main.ts to app.ts (appConfig).
    assert.match(readFileSync('web/src/app.ts', 'utf8'), /provideServiceWorker\('workspace-sw\.js'/);
  } finally {
    await t.close();
  }
});

test('F-004-T09 review: a reminder read or cancelled in the app is never sent to Telegram as the fallback', async () => {
  const store = new Store(':memory:');
  const device = createECDH('prime256v1');
  device.generateKeys();
  store.pushFetch = (async () => new Response(null, { status: 201 })) as typeof fetch;
  try {
    store.savePushSubscription({
      endpoint: 'https://push.example.test/device-2',
      p256dh: device.getPublicKey().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    });
    for (const title of ['Letto in app', 'Annullato in app', 'Ancora da vedere'])
      store.add(title, '2030-06-01T07:00:00Z');
    store.tick(new Date('2030-06-01T07:01:00Z'));
    const item = (title: string) => store.inboxPage(0, 20).items.find((i) => i.message.includes(title))!;
    store.db.prepare('UPDATE deliveries SET read_at=? WHERE id=?').run('2030-06-01T07:02:00Z', item('Letto in app').id);
    store.db
      .prepare('UPDATE reminders SET cancelled=? WHERE id=(SELECT reminder_id FROM deliveries WHERE id=?)')
      .run('2030-06-01T07:03:00Z', item('Annullato in app').id);
    const due = store.deliveryChannels.claimFallback(PUSH_FALLBACK_MS, new Date('2030-06-01T07:30:00Z'));
    assert.deepEqual(
      due.map((d) => d.id),
      [item('Ancora da vedere').id],
      'only the one nobody saw',
    );
  } finally {
    store.close();
  }
});

test('F-004-T09: the receipt endpoint takes JSON only, needs no bearer and refuses unknown receipts', async () => {
  const store = new Store(':memory:');
  const server = makeServer(store, 's'.repeat(32));
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/push/opened`;
  try {
    const post = (body: string, type = 'application/json') =>
      fetch(url, { method: 'POST', headers: { 'Content-Type': type }, body });
    assert.equal((await post(JSON.stringify({ receipt: 'B'.repeat(24) }), 'text/plain')).status, 415);
    assert.equal((await post(JSON.stringify({ receipt: 'B'.repeat(24) }))).status, 404);
    assert.equal((await post(JSON.stringify({ receipt: 'B'.repeat(24), extra: 1 }))).status, 400);
    assert.equal((await post('not json')).status, 400);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    store.close();
  }
});

// B-149-T01: nothing set deliveries.read_at, so a reminder the owner read in the app (without tapping the
// notification) still reached Telegram at the deadline. Across the join: the read call the dashboard and the workspace
// make → the shared inbox state → the Telegram fallback pass.
test('B-149: a pushed reminder read in the app before the deadline never reaches Telegram', async () => {
  const t = await setup({ fallbackMs: 1500 });
  const origin = `http://127.0.0.1:${(t.server.address() as { port: number }).port}`;
  const read = (id: string) =>
    fetch(`${origin}/api/inbox/${encodeURIComponent(id)}/read`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + 's'.repeat(32) },
    });
  const readAt = (id: string) =>
    (t.store.db.prepare('SELECT read_at FROM deliveries WHERE id=?').get(id) as { read_at: string | null }).read_at;
  try {
    const seen = await t.due('Letto nella app');
    const unseen = await t.due('Mai aperto');
    await until(() => t.push.received.length === 2);
    assert.equal((await read(seen)).status, 200, 'the app reports the item it showed');
    const first = readAt(seen);
    assert.ok(first, 'read_at is set');
    await wait(20);
    assert.equal((await read(seen)).status, 200, 'a repeat is accepted');
    assert.equal(readAt(seen), first, 'the first read is kept');
    assert.equal((await read('00000000-0000-4000-8000-000000000000')).status, 404, 'an unknown item is refused');
    // The unread one proves the fallback pass ran past the deadline; the read one stays off Telegram.
    await until(() => t.telegrams('Mai aperto') === 1);
    await wait(400);
    assert.equal(t.telegrams('Letto nella app'), 0, 'read in the app: never on Telegram');
    assert.equal(t.store.deliveryState(seen).telegram, undefined);
    assert.equal(readAt(unseen), null, 'only the item the app showed is read');
  } finally {
    await t.close();
  }
});

test('B-180 join: Mark as read updates every covered delivery so Telegram skips them', async () => {
  const t = await setup({ fallbackMs: 1500 });
  const origin = `http://127.0.0.1:${(t.server.address() as { port: number }).port}`;
  const api = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(origin + '/api/' + path, {
      ...init,
      headers: { Authorization: 'Bearer ' + 's'.repeat(32), ...init.headers },
    });
    const body: unknown = await response.json();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return body;
  };
  const readAt = (id: string) =>
    (t.store.db.prepare('SELECT read_at FROM deliveries WHERE id=?').get(id) as { read_at: string | null })
      .read_at;
  try {
    const outside = await t.due('Not covered by this visit');
    await until(() => t.push.received.length === 1);
    const since = Date.now();
    const first = await t.due('Covered reminder one');
    const second = await t.due('Covered reminder two');
    await until(() => t.push.received.length === 3);
    const history = (await api(
      'dashboard/history?since=' + encodeURIComponent(new Date(since).toISOString()),
    )) as { delivered: number };
    assert.equal(history.delivered, 2, 'the dashboard panel covers both delivered reminders');

    const state = { lastVisit: since, deliveredCount: history.delivered, deliveredSince: since, brief: null };
    const saved: string[] = [];
    const localStorage = { getItem: () => String(since), setItem: (_key: string, value: string) => saved.push(value) };
    await dashboardSeen(state, api, localStorage)();

    assert.ok(readAt(first), 'the first covered delivery is marked read on the service');
    assert.ok(readAt(second), 'the second covered delivery is marked read on the service');
    assert.equal(readAt(outside), null, 'a delivery outside the panel remains unread');
    assert.ok(state.lastVisit > since, 'the dashboard cursor advances after service reads succeed');
    assert.deepEqual(saved, [String(state.lastVisit)], 'the advanced cursor is persisted');
    await until(() => t.telegrams('Not covered by this visit') === 1);
    assert.equal(t.telegrams('Covered reminder one'), 0);
    assert.equal(t.telegrams('Covered reminder two'), 0);
  } finally {
    await t.close();
  }
});

test('B-180 join: Mark as read includes the displayed brief', async () => {
  const t = await setup({ fallbackMs: 1500 });
  const origin = `http://127.0.0.1:${(t.server.address() as { port: number }).port}`;
  const api = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(origin + '/api/' + path, {
      ...init,
      headers: { Authorization: 'Bearer ' + 's'.repeat(32), ...init.headers },
    });
    const body: unknown = await response.json();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return body;
  };
  try {
    const brief = t.store.addBrief('A neutral brief shown in the dashboard panel.');
    const since = Date.now();
    const history = (await api(
      'dashboard/history?since=' + encodeURIComponent(new Date(since).toISOString()),
    )) as { brief: { id: string; created: string; read_at: string | null } };
    assert.equal(history.brief.id, brief.id, 'the service supplies the brief shown in the panel');
    const state = { lastVisit: since, deliveredCount: 0, deliveredSince: since, brief: history.brief };
    await dashboardSeen(state, api, { getItem: () => String(since), setItem: () => {} })();

    const row = t.store.db.prepare('SELECT read_at FROM deliveries WHERE id=?').get(brief.id) as {
      read_at: string | null;
    };
    assert.ok(row.read_at, 'the displayed brief is marked read on the service');
  } finally {
    await t.close();
  }
});

test('B-180 join: clicking #btn-seen reads the old visit panel before advancing its cursor', async () => {
  const t = await setup({ fallbackMs: 1500 });
  const origin = `http://127.0.0.1:${(t.server.address() as { port: number }).port}`;
  let readsSucceeded = false;
  const api = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(origin + '/api/' + path, {
      ...init,
      headers: { Authorization: 'Bearer ' + 's'.repeat(32), ...init.headers },
    });
    const body: unknown = await response.json();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (path.startsWith('inbox/') && path.endsWith('/read')) readsSucceeded = true;
    return body;
  };
  try {
    const since = Date.now() - 10_000;
    const id = await t.due('Covered through the dashboard button');
    const history = (await api(
      'dashboard/history?since=' + encodeURIComponent(new Date(since).toISOString()),
    )) as { delivered: number };
    assert.equal(history.delivered, 1);
    const state = { lastVisit: since, deliveredCount: history.delivered, deliveredSince: since, brief: null };
    const saved: string[] = [];
    const visitStorage = { getItem: () => String(since), setItem: (_key: string, value: string) => saved.push(value) };
    const order: string[] = [];
    const redraw = () => order.push(readsSucceeded ? 'after service read' : 'before service read');
    const liveSeen = dashboardSeen(state, api, visitStorage, redraw);
    let serviceRead: Promise<void> | undefined;
    const window = { liveSeen: () => (serviceRead = liveSeen()) };
    let renders = 0;
    clickDashboardSeen(state, window, () => {
      renders++;
      redraw();
    });
    await serviceRead;

    const readAt = (deliveryId: string) =>
      (t.store.db.prepare('SELECT read_at FROM deliveries WHERE id=?').get(deliveryId) as {
        read_at: string | null;
      }).read_at;
    assert.ok(readAt(id), '#btn-seen marks the delivery shown by the previous visit cursor');
    assert.ok(state.lastVisit > since, 'the visit cursor advances only after the service read');
    assert.deepEqual(saved, [String(state.lastVisit)], 'the advanced cursor is persisted');
    assert.equal(renders, 0, 'the button does not redraw before the service read');
    assert.deepEqual(order, ['after service read'], 'the live handler redraws after the service read succeeds');
  } finally {
    await t.close();
  }
});

test('B-149 review: marking an inbox item read needs sign-in', async () => {
  const store = new Store(':memory:');
  const server = makeServer(store, 's'.repeat(32));
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  try {
    const { id } = store.addBrief('Buongiorno.');
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/inbox/${id}/read`;
    assert.equal((await fetch(url, { method: 'POST' })).status, 401);
    assert.equal(
      (await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + 'x'.repeat(32) } })).status,
      401,
    );
    const row = store.db.prepare('SELECT read_at FROM deliveries WHERE id=?').get(id) as { read_at: string | null };
    assert.equal(row.read_at, null, 'nothing marked');
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    store.close();
  }
});
