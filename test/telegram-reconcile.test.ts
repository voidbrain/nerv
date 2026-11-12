import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { defaultPolicy } from '../src/policy.ts';
import { makeServer } from '../src/server.ts';
import { TelegramApi, TelegramChannel } from '../src/telegram.ts';
import type { StoreApi } from '../src/runtime.ts';
const pause = () => {
  let release!: () => void;
  const promise = new Promise<void>((done) => (release = done));
  return { promise, release };
};
async function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'nerv-card-reconcile-')),
    store = new Store(':memory:', { policy: { ...defaultPolicy, blue: ['reminders.add'] }, source: 'fixture' });
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  let sending: (() => Promise<void>) | undefined,
    failEdits = 0;
  const bot = createServer((req, res) => {
    let raw = '';
    req
      .on('data', (c) => (raw += c))
      .on('end', async () => {
        const method = req.url!.split('/').at(-1)!,
          body = JSON.parse(raw) as Record<string, unknown>;
        calls.push({ method, body });
        if (method === 'sendMessage') await sending?.();
        res.setHeader('content-type', 'application/json');
        if (method === 'editMessageReplyMarkup' && failEdits-- > 0) {
          res.statusCode = 503;
          res.end('{"ok":false,"description":"fixture edit failure"}');
          return;
        }
        res.end(JSON.stringify({ ok: true, result: { message_id: 73 } }));
      });
  });
  await new Promise<void>((done) => bot.listen(0, '127.0.0.1', done));
  const token = 'r'.repeat(32),
    server = makeServer(store as unknown as StoreApi, token);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const api = new TelegramApi('fixture-token', `http://127.0.0.1:${(bot.address() as { port: number }).port}`),
    statePath = join(home, 'telegram.json');
  const proposal = (title: string) => {
    const sortie = store.ledger.openSortie('owner', title, 'trusted');
    return store.runAction(sortie, {
      tool: 'reminders.add',
      args: { title, due: '2031-01-01T09:00:00Z' },
      stage: 'production',
    }).approvalId!;
  };
  const decide = async (id: string) => {
    const r = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/api/approvals/${id}`, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: '{"decision":"approve"}',
    });
    assert.equal(r.status, 200);
  };
  const channel = (oneChannel?: { quiet: () => Promise<boolean> }) =>
    new TelegramChannel({
      api,
      store: store as unknown as StoreApi,
      chatId: 1111,
      statePath,
      log: () => {},
      ...(oneChannel ? { oneChannel: { ...oneChannel, relay: async () => false } } : {}),
    });
  return {
    store,
    calls,
    proposal,
    decide,
    channel,
    setSending: (fn: () => Promise<void>) => (sending = fn),
    failNextEdit: () => (failEdits = 1),
    close: async () => {
      await Promise.all([
        new Promise<void>((done) => bot.close(() => done())),
        new Promise<void>((done) => server.close(() => done())),
      ]);
      store.close();
      rmSync(home, { recursive: true, force: true });
    },
  };
}
test('B-042: dashboard decision during route lookup suppresses the unsent Telegram card', async () => {
  const f = await fixture(),
    entered = pause(),
    gate = pause(),
    channel = f.channel({
      quiet: async () => {
        entered.release();
        await gate.promise;
        return false;
      },
    });
  try {
    const id = f.proposal('Stretch');
    const delivery = channel.deliver();
    await entered.promise;
    await f.decide(id);
    gate.release();
    await delivery;
    assert.equal(
      f.calls.filter((c) => c.method === 'sendMessage').length,
      0,
      'a decided card is not sent from the stale pending snapshot',
    );
    assert.equal(f.store.list().length, 1);
  } finally {
    gate.release();
    await channel.stop();
    await f.close();
  }
});
test('B-042: a dashboard decision during send removes buttons, retries failed edits after restart, and never executes twice', async () => {
  const f = await fixture(),
    entered = pause(),
    gate = pause();
  let channel = f.channel();
  try {
    const id = f.proposal('Stretch');
    f.setSending(async () => {
      entered.release();
      await gate.promise;
    });
    const delivery = channel.deliver();
    await entered.promise;
    await f.decide(id);
    f.failNextEdit();
    gate.release();
    await delivery;
    assert.ok(
      f.calls.some((c) => c.method === 'editMessageReplyMarkup'),
      'in-flight send is reconciled immediately',
    );
    await channel.stop();
    channel = f.channel();
    await channel.deliver();
    const edits = f.calls.filter((c) => c.method === 'editMessageReplyMarkup');
    assert.ok(edits.length >= 2, 'failed cleanup survives restart');
    assert.deepEqual(edits.at(-1)!.body.reply_markup, { inline_keyboard: [] });
    assert.equal(f.calls.filter((c) => c.method === 'sendMessage').length, 1, 'cleanup never resends the card');
    f.store.decide(id, 'approve', 'telegram');
    assert.equal(f.store.list().length, 1);
  } finally {
    gate.release();
    await channel.stop();
    await f.close();
  }
});
test('B-042: status point lookups preserve pending cards outside the first page and exclude expiry', async () => {
  const f = await fixture();
  try {
    const ids = Array.from({ length: 22 }, (_, i) => f.proposal('Neutral ' + i));
    assert.ok(!f.store.approvals(20).some((a) => a.id === ids[21]));
    assert.deepEqual(f.store.pendingApprovalIds([ids[21]!]), [ids[21]]);
    assert.deepEqual(f.store.ledger.pendingApprovalIds([ids[21]!], new Date('2040-01-01')), []);
    for (const bad of [['bad'], Array.from({ length: 201 }, () => ids[0]!), [ids[0]!, ids[0]!]])
      assert.throws(() => f.store.pendingApprovalIds(bad), /Invalid/);
  } finally {
    await f.close();
  }
});
test(
  'B-042: dashboard decision removes only its bundled row, preserving the other pending fact',
  { timeout: 10000 },
  async () => {
    const f = await fixture(),
      channel = f.channel();
    try {
      const sortie = f.store.ledger.openSortie('owner', 'Remember two neutral facts', 'trusted');
      const ids = ['Tea at 8', 'Stretch at 9'].map(
        (text) =>
          f.store.runAction(sortie, { tool: 'memory.remember', args: { text }, stage: 'production' }).approvalId!,
      );
      await channel.deliver();
      await new Promise((done) => setTimeout(done, 3050));
      await channel.deliver();
      await f.decide(ids[0]!);
      await channel.deliver();
      const edit = f.calls.filter((c) => c.method === 'editMessageReplyMarkup').at(-1)!;
      const rows = (edit.body.reply_markup as { inline_keyboard: { callback_data: string }[][] }).inline_keyboard;
      assert.equal(rows.length, 1);
      assert.ok(rows[0]!.every((b) => b.callback_data.endsWith(':' + ids[1])));
      assert.equal(f.store.memory.list().length, 1);
    } finally {
      await channel.stop();
      await f.close();
    }
  },
);
test('B-042: a delivery awaited after a dashboard decision is not a pass that read status before it', async () => {
  const f = await fixture(),
    channel = f.channel(),
    entered = pause(),
    gate = pause();
  const lookup = f.store.pendingApprovalIds.bind(f.store);
  try {
    const id = f.proposal('Stretch');
    await channel.deliver();
    assert.equal(f.calls.filter((c) => c.method === 'sendMessage').length, 1, 'the card is sent and tracked');
    // A periodic pass reads the card's status while it is still pending, then stalls.
    f.store.pendingApprovalIds = (ids: string[]) => {
      const snapshot = lookup(ids);
      entered.release();
      return gate.promise.then(() => snapshot) as unknown as string[];
    };
    const periodic = channel.deliver();
    await entered.promise;
    f.store.pendingApprovalIds = lookup;
    await f.decide(id);
    const awaited = channel.deliver();
    gate.release();
    await awaited;
    assert.ok(
      f.calls.some((c) => c.method === 'editMessageReplyMarkup'),
      'the awaited delivery reconciles the decision it follows',
    );
    await periodic;
  } finally {
    f.store.pendingApprovalIds = lookup;
    gate.release();
    await channel.stop();
    await f.close();
  }
});
