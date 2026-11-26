import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { Store } from '../src/store.ts';
import { makeServer } from '../src/server.ts';
import { TelegramApi, TelegramChannel } from '../src/telegram.ts';
import { fakeBotApi, fakePushService, until, wait } from './fixtures/delivery-fakes.ts';

// F-133: brief-kind inbox items (the morning brief, update notices, watch and session-limit notices) follow F-004-T09's
// order: push first, a tap counts as delivered, Telegram once after the deadline when untapped, at once with no device.
const OWNER = 5150;
const TOKEN = '123456:' + 'b'.repeat(35);
const ADMIN = 'a'.repeat(32);

/** The dashboard's real service worker (web/public/dashboard/sw.js) in a sandbox whose fetch reaches `origin`. */
function phone(origin: string) {
  const listeners = new Map<string, (e: unknown) => void>();
  const self = {
    addEventListener: (type: string, fn: (e: unknown) => void) => listeners.set(type, fn),
    skipWaiting: () => {},
    registration: { showNotification: async () => {} },
    clients: { claim: async () => {}, matchAll: async () => [], openWindow: async () => null },
  };
  runInNewContext(readFileSync('web/public/dashboard/sw.js', 'utf8'), {
    self,
    fetch: (path: string, init: RequestInit) => fetch(origin + path, init),
    URL,
    JSON,
  });
  return {
    async tap(data: Record<string, unknown>) {
      const work: Promise<unknown>[] = [];
      listeners.get('notificationclick')!({
        notification: { data, close: () => {} },
        waitUntil: (p: Promise<unknown>) => work.push(p),
      });
      await Promise.all(work);
    },
  };
}

async function setup(opts: { device?: boolean; fallbackMs: number }) {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-push-briefs-'));
  const push = await fakePushService(201);
  const bot = await fakeBotApi(TOKEN);
  const store = new Store(join(dir, 'nerv.sqlite'));
  if (opts.device !== false) store.savePushSubscription(push.subscription);
  const server = makeServer(store, ADMIN);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const channel = new TelegramChannel({
    api: new TelegramApi(TOKEN, bot.base),
    store,
    chatId: OWNER,
    statePath: join(dir, 'telegram-state.json'),
    log: () => {},
    pushFallbackMs: opts.fallbackMs,
  });
  await channel.start(40);
  return {
    store,
    push,
    origin,
    telegrams: (text: string) => bot.sent.filter((t) => t.includes(text)).length,
    pushed: (text: string) => push.received.find((p) => JSON.stringify(p).includes(text)),
    async close() {
      await channel.stop();
      await new Promise<void>((done) => server.close(() => done()));
      store.close();
      await bot.close();
      await push.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('F-133 join: a brief and an update notice go to the phone first; a tap or a read in the app stops Telegram, an untapped one reaches it once', async () => {
  const t = await setup({ fallbackMs: 1500 });
  try {
    const morning = t.store.addBrief(
      'Buongiorno.\nOggi: due promemoria e nessuna carta da decidere.',
      new Date(),
      '2030-03-04',
    );
    const update = t.store.addBrief('Update 1a2b3c4 applied.');
    const readInApp = t.store.addBrief('Watch: la stampante ha finito il lavoro.');
    await until(() => t.push.received.length === 3);
    const morningPush = t.pushed('Buongiorno')!;
    assert.ok(morningPush.notification.title.length <= 80, 'a short title');
    assert.equal(morningPush.notification.data.id, morning.id);
    assert.equal(typeof morningPush.notification.data.receipt, 'string', 'the tap receipt travels with the push');
    await wait(300);
    for (const text of ['Buongiorno', 'Update 1a2b3c4', 'la stampante'])
      assert.equal(t.telegrams(text), 0, `${text}: Telegram waits for the phone`);
    assert.equal(t.store.deliveryState(update.id).push?.state, 'sent');

    // The morning brief is tapped on the phone; the watch notice is read in the app (B-149); the update is left alone.
    await phone(t.origin).tap(morningPush.notification.data);
    assert.equal(t.store.deliveryState(morning.id).push?.state, 'opened');
    const read = await fetch(`${t.origin}/api/inbox/${readInApp.id}/read`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + ADMIN },
    });
    assert.equal(read.status, 200);

    await until(() => t.telegrams('Update 1a2b3c4 applied.') === 1);
    await wait(500);
    assert.equal(t.telegrams('Update 1a2b3c4 applied.'), 1, 'once');
    assert.equal(t.telegrams('⏰ Update'), 0, 'a brief keeps its own text on Telegram, no reminder clock');
    assert.equal(t.telegrams('Buongiorno'), 0, 'tapped: never on Telegram');
    assert.equal(t.telegrams('la stampante'), 0, 'read in the app: never on Telegram');
    assert.equal(t.store.deliveryState(update.id).telegram?.state, 'sent');
  } finally {
    await t.close();
  }
});

test('F-133: with no device a brief goes to Telegram at once, as before', async () => {
  const t = await setup({ device: false, fallbackMs: 60_000 });
  try {
    const notice = t.store.addBrief('Update 5d6e7f8 applied.');
    await until(() => t.telegrams('Update 5d6e7f8 applied.') === 1);
    assert.deepEqual(Object.keys(t.store.deliveryState(notice.id)), ['telegram'], 'push off: Telegram only');
    assert.equal(t.push.received.length, 0);
  } finally {
    await t.close();
  }
});

test('F-133-T02: a long brief is cut for the push (short title, short body); the full text stays in the inbox', async () => {
  const { formatBriefPushPayload, BRIEF_PUSH_TITLE_MAX, BRIEF_PUSH_BODY_MAX } = await import('../src/push.ts');
  const message =
    'Riepilogo del mattino con un titolo molto lungo '.repeat(4) + '\n' + 'Una riga di dettaglio. '.repeat(40);
  const { notification } = formatBriefPushPayload({ id: 'brief-1', message }, 'R'.repeat(24));
  assert.ok(notification.title.length <= BRIEF_PUSH_TITLE_MAX && notification.title.endsWith('…'));
  assert.ok(notification.body.length <= BRIEF_PUSH_BODY_MAX && notification.body.endsWith('…'));
  assert.equal(notification.data.receipt, 'R'.repeat(24));
  assert.ok(Buffer.byteLength(JSON.stringify({ notification })) < 3000, 'well inside the Web Push payload limit');
  const short = formatBriefPushPayload({ id: 'brief-2', message: 'Update 1a2b3c4 applied.' }).notification;
  assert.deepEqual([short.title, short.body], ['Update 1a2b3c4 applied.', 'NERV Agency · Brief']);
});

test('F-133 review: a notice written just before NERV stops goes to Telegram at once, never push first', async () => {
  const t = await setup({ fallbackMs: 60_000 });
  try {
    const notice = t.store.addBrief('🔄 Update 9a8b7c6 started: NERV stops.', new Date(), undefined, {
      beforeStop: true,
    });
    await until(() => t.telegrams('Update 9a8b7c6 started') === 1);
    await wait(200);
    assert.equal(t.push.received.length, 0, 'not pushed: the service may be gone before the push leaves');
    assert.deepEqual(Object.keys(t.store.deliveryState(notice.id)), ['telegram']);
  } finally {
    await t.close();
  }
});

test('F-133 review: a brief push dispatch that throws is recorded as failed, logged, and sent to Telegram at once', async () => {
  const t = await setup({ fallbackMs: 60_000 });
  const logged: string[] = [];
  const error = console.error;
  console.error = (...args: unknown[]) => void logged.push(args.join(' '));
  t.store.dispatchPushBriefs = async () => {
    throw new Error('dispatch broke');
  };
  try {
    const brief = t.store.addBrief('Buonasera: nessuna novità.');
    await until(() => t.telegrams('Buonasera: nessuna novità.') === 1);
    const push = t.store.deliveryState(brief.id).push;
    assert.equal(push?.state, 'failed');
    assert.equal(push?.reason, 'dispatch broke');
    assert.ok(logged.some((line) => /brief not pushed \(dispatch broke\)/.test(line)));
  } finally {
    console.error = error;
    await t.close();
  }
});
