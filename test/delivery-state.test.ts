import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Runtime } from '../src/runtime.ts';
import { Store } from '../src/store.ts';
import { TelegramApi, TelegramChannel } from '../src/telegram.ts';
import { fakeBotApi, fakePushService, until } from './fixtures/delivery-fakes.ts';

const OWNER = 4242;
const TOKEN = '123456:' + 'd'.repeat(35);

test('F-124-T01: one reminder delivered by push and by Telegram shows both channel states on one delivery, across a restart', async () => {
  const push = await fakePushService(201);
  const bot = await fakeBotApi(TOKEN);
  const home = mkdtempSync(join(tmpdir(), 'nerv-delivery-state-'));
  const db = join(home, 'nerv.sqlite');
  let runtime = new Runtime(db);
  const aoba = () =>
    new TelegramChannel({
      api: new TelegramApi(TOKEN, bot.base),
      store: runtime,
      chatId: OWNER,
      statePath: join(home, 'telegram-state.json'),
      log: () => {},
    });
  let channel = aoba();
  try {
    await runtime.ready();
    await runtime.savePushSubscription(push.subscription);
    await channel.start(50);
    await runtime.add('Annaffiare il basilico', new Date(Date.now() + 400).toISOString());
    await until(() => bot.sent.some((t) => t.includes('Annaffiare il basilico')) && push.received.length > 0);
    const item = (await runtime.inboxPage(0, 20)).items.find((i) => i.message.includes('Annaffiare il basilico'))!;
    await until(async () => {
      const s = await runtime.deliveryState(item.id);
      return s.push?.state === 'sent' && s.telegram?.state === 'sent';
    });
    assert.equal(await runtime.recordDelivery(item.id, 'push', 'opened'), true);
    const before = await runtime.deliveryState(item.id);
    assert.equal(before.push?.state, 'opened', 'opened on the phone');
    assert.ok(before.push?.sentAt && before.push.openedAt, 'the push keeps when it was sent and when it was opened');
    assert.equal(before.telegram?.state, 'sent', 'the same delivery holds Telegram as sent');

    await channel.stop();
    await runtime.close();
    runtime = new Runtime(db);
    await runtime.ready();
    channel = aoba();
    await channel.start(50);
    assert.deepEqual(await runtime.deliveryState(item.id), before, 'the shared state survives a restart unchanged');
    assert.equal(bot.sent.filter((t) => t.includes('Annaffiare il basilico')).length, 1, 'and nothing is resent');
  } finally {
    await channel.stop();
    await runtime.close();
    await bot.close();
    await push.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('F-124-T01: failures are recorded per channel with their reason, and a later success makes the channel sent', async () => {
  const push = await fakePushService(500);
  const bot = await fakeBotApi(TOKEN);
  const store = new Store(':memory:');
  bot.failSends(true);
  const channel = new TelegramChannel({
    api: new TelegramApi(TOKEN, bot.base),
    store,
    chatId: OWNER,
    statePath: join(mkdtempSync(join(tmpdir(), 'nerv-delivery-fail-')), 'telegram-state.json'),
    log: () => {},
  });
  try {
    store.savePushSubscription(push.subscription);
    await channel.start(50);
    store.add('Ritirare il pacco', '2030-03-01T09:00:00Z');
    store.tick(new Date('2030-03-01T09:01:00Z'));
    const item = store.inboxPage(0, 20).items.find((i) => i.message.includes('Ritirare il pacco'))!;
    await until(() => store.deliveryState(item.id).push?.state === 'failed');
    await until(() => store.deliveryState(item.id).telegram?.state === 'failed');
    assert.match(store.deliveryState(item.id).push!.reason!, /HTTP 500 InvalidTestStatus/);
    bot.failSends(false);
    await until(() => store.deliveryState(item.id).telegram?.state === 'sent');
    const s = store.deliveryState(item.id).telegram!;
    assert.ok(s.failedAt && s.sentAt, 'the failure stays on record next to the success');
    assert.equal(bot.sent.filter((t) => t.includes('Ritirare il pacco')).length, 1);
    assert.equal(store.recordDelivery('no-such-delivery', 'push', 'opened'), false, 'an unknown item is refused');
    assert.throws(() => store.recordDelivery(item.id, 'sms' as 'push', 'sent'), /Invalid delivery channel/);
  } finally {
    await channel.stop();
    store.close();
    await bot.close();
    await push.close();
  }
});

test('F-124-T01: the delivery state table is additive: an older database gains it and keeps every inbox rowid', () => {
  const home = mkdtempSync(join(tmpdir(), 'nerv-delivery-migrate-'));
  const path = join(home, 'nerv.sqlite');
  try {
    let store = new Store(path);
    store.add('Chiamare il fabbro', '2030-04-01T08:00:00Z');
    store.tick(new Date('2030-04-01T08:01:00Z'));
    store.close();
    const raw = new DatabaseSync(path);
    raw.exec('DROP TABLE delivery_channels');
    const rows = raw.prepare('SELECT rowid, id FROM deliveries ORDER BY rowid').all();
    raw.close();
    store = new Store(path);
    try {
      assert.deepEqual(store.db.prepare('SELECT rowid, id FROM deliveries ORDER BY rowid').all(), rows);
      const id = (rows[0] as { id: string }).id;
      assert.deepEqual(store.deliveryState(id), {}, 'no channel has handled it yet');
      assert.equal(store.recordDelivery(id, 'telegram', 'sent'), true);
      assert.equal(store.deliveryState(id).telegram?.state, 'sent');
    } finally {
      store.close();
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
