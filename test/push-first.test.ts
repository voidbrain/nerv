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
import { PUSH_FALLBACK_MS } from '../src/delivery-state.ts';
import { fakeBotApi, fakePushService, until, wait } from './fixtures/delivery-fakes.ts';

const OWNER = 5150;
const TOKEN = '123456:' + 'p'.repeat(35);
type Payload = { notification: { title: string; data: Record<string, unknown> } };

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

test('F-004-T09: a fallback claimed but cut off by a crash is not sent again; a failed send is retried once it works', async () => {
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
    const claim = () => store.deliveryChannels.claimFallback(PUSH_FALLBACK_MS, later);
    assert.equal(claim().length, 1, 'due once the deadline passed');
    assert.equal(claim().length, 0, 'claimed: in flight, never handed out twice (also after a crash)');
    store.deliveryChannels.record(id, 'telegram', 'failed', new Date('2030-05-01T07:20:01Z'), 'HTTP 503');
    assert.equal(claim().length, 1, 'a recorded failure is retried');
    store.recordDelivery(id, 'telegram', 'sent');
    assert.equal(claim().length, 0);
    assert.equal(store.pushOpened('not-a-receipt'), false);
    assert.equal(store.pushOpened('A'.repeat(24)), false, 'an unknown receipt opens nothing');
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
