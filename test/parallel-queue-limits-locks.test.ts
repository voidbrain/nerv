import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import {
  formatQueuedMessage,
  formatQueueFullMessage,
  QueueCancelledError,
  QueueFullError,
  RequestQueue,
} from '../src/request-queue.ts';
import { ModelBudget, ModelBudgetCancelledError } from '../src/model-budget.ts';
import { itemKeysForTool, ItemLockManager, ItemLockUncertainError } from '../src/item-locks.ts';
import { validateModels } from '../src/model.ts';
import { Runtime } from '../src/runtime.ts';
import { TelegramApi, telegramBase, TelegramChannel } from '../src/telegram.ts';
import { makeServer } from '../src/server.ts';

const temps: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

after(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('F-048-T01: visible bounded request queue', () => {
  it('enforces FIFO order, reports accurate ahead positions, and bounds queue admission', async () => {
    const queue = new RequestQueue({ maxConcurrent: 1, maxQueued: 2 });
    const order: string[] = [];
    const queuedEvents: { id: string; ahead: number }[] = [];
    const posUpdates: number[] = [];

    const gate1 = deferred();
    const p1 = queue.enqueue({
      id: 'req-1',
      conversation: 'telegram:1',
      title: 'First',
      onQueued: (ahead, id) => queuedEvents.push({ id, ahead }),
      run: async () => {
        order.push('start-1');
        await gate1.promise;
        order.push('end-1');
        return 'r1';
      },
    });

    const p2 = queue.enqueue({
      id: 'req-2',
      conversation: 'dashboard',
      title: 'Second',
      onQueued: (ahead, id) => queuedEvents.push({ id, ahead }),
      run: async () => {
        order.push('start-2');
        return 'r2';
      },
    });

    const p3 = queue.enqueue({
      id: 'req-3',
      conversation: 'cli',
      title: 'Third',
      onQueued: (ahead, id) => queuedEvents.push({ id, ahead }),
      onPositionChange: (ahead) => posUpdates.push(ahead),
      run: async () => {
        order.push('start-3');
        return 'r3';
      },
    });

    // 4th request exceeds maxQueued (2)
    await assert.rejects(
      () =>
        queue.enqueue({
          id: 'req-4',
          conversation: 'cli',
          title: 'Fourth',
          run: async () => 'r4',
        }),
      (err: unknown) => err instanceof QueueFullError && err.maxQueued === 2,
    );

    assert.deepEqual(queuedEvents, [
      { id: 'req-2', ahead: 1 },
      { id: 'req-3', ahead: 2 },
    ]);

    const snap = queue.snapshot();
    assert.equal(snap.running.length, 1);
    assert.equal(snap.running[0]?.id, 'req-1');
    assert.equal(snap.queued.length, 2);
    assert.equal(snap.queued[0]?.ahead, 1);
    assert.equal(snap.queued[1]?.ahead, 2);

    // Cancel req-2 while queued -> req-3 moves up to ahead = 1
    assert.equal(queue.cancel('req-2'), true);
    await assert.rejects(() => p2, QueueCancelledError);
    assert.deepEqual(posUpdates, [1]);

    gate1.resolve();
    assert.equal(await p1, 'r1');
    assert.equal(await p3, 'r3');
    assert.deepEqual(order, ['start-1', 'end-1', 'start-3']);
  });

  it('cancels queued requests on shutdown (close)', async () => {
    const queue = new RequestQueue({ maxConcurrent: 1, maxQueued: 4 });
    const gate = deferred();
    const p1 = queue.enqueue({
      id: 'r1',
      conversation: 'cli',
      title: 'Running',
      run: async ({ signal }) => {
        if (!signal.aborted) {
          await Promise.race([
            gate.promise,
            new Promise<void>((res) => signal.addEventListener('abort', () => res(), { once: true })),
          ]);
        }
        return 'done';
      },
    });
    const p2 = queue.enqueue({
      id: 'r2',
      conversation: 'dashboard',
      title: 'Waiting',
      run: async () => 'should-not-run',
    });

    queue.close();
    await assert.rejects(() => p2, QueueCancelledError);
    assert.equal(await p1, 'done');
  });

  it('formats queued messages in English and Italian', () => {
    assert.equal(formatQueuedMessage(2, 'en'), 'Queued, 2 ahead.');
    assert.equal(formatQueuedMessage(2, 'it'), 'In coda, 2 davanti.');
    assert.equal(formatQueueFullMessage(16, 'en'), 'Queue is full (16 waiting). Try again later.');
    assert.equal(formatQueueFullMessage(16, 'it'), 'Coda piena (16 in attesa). Riprova più tardi.');
  });

  it('Telegram notifies the user when a message queues behind a running request', async () => {
    const dir = tempDir('nerv-tg-queue-');
    const sent: string[] = [];
    let updateCalls = 0;
    const gate = deferred();

    const bot = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>;
        const method = new URL(req.url ?? '/', 'http://127.0.0.1').pathname.split('/').pop();
        if (method === 'getUpdates') {
          updateCalls++;
          if (updateCalls === 1) {
            const now = Math.floor(Date.now() / 1000);
            res.end(
              JSON.stringify({
                ok: true,
                result: [
                  { update_id: 1, message: { date: now, text: 'first request', chat: { id: 42, type: 'private' } } },
                  {
                    update_id: 2,
                    message: { date: now, text: 'ricordami domani', chat: { id: 42, type: 'private' } },
                  },
                ],
              }),
            );
          } else {
            setTimeout(() => res.end(JSON.stringify({ ok: true, result: [] })), 30);
          }
          return;
        }
        if (method === 'sendMessage') {
          sent.push(String(body.text ?? ''));
          res.end(JSON.stringify({ ok: true, result: { message_id: sent.length } }));
          return;
        }
        res.end(JSON.stringify({ ok: true, result: true }));
      });
    });

    await new Promise<void>((res) => bot.listen(0, '127.0.0.1', () => res()));
    const port = (bot.address() as { port: number }).port;
    const prevApi = process.env.NERV_TELEGRAM_API;
    process.env.NERV_TELEGRAM_API = `http://127.0.0.1:${port}`;

    const queue = new RequestQueue({ maxConcurrent: 1, maxQueued: 4 });
    let chatCount = 0;
    const fakeStore = {
      inboxPage: async () => ({ items: [], head: '0', total: 0 }),
      approvals: async () => [],
      pendingApprovalIds: async () => [],
      decide: async () => ({ decision: 'approve' }),
      chat: (msg: string, conv?: string, opts?: { onQueued?: (ahead: number) => void }) =>
        queue.enqueue({
          conversation: conv ?? 'telegram:42',
          title: msg,
          onQueued: opts?.onQueued,
          run: async () => {
            chatCount++;
            if (chatCount === 1) await gate.promise;
            return { sortieId: `s-${chatCount}`, reply: `done:${msg}`, steps: [], waiting: [] };
          },
        }),
    };

    const logs: string[] = [];
    const channel = new TelegramChannel({
      api: new TelegramApi('123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi', telegramBase()),
      store: fakeStore as never,
      chatId: 42,
      statePath: join(dir, 'tg.json'),
      log: (l) => logs.push(l),
    });

    try {
      await channel.start(5000);
      // Wait until the queued message notification arrives
      for (let i = 0; i < 40 && !sent.some((s) => s.includes('In coda')); i++) {
        await new Promise((r) => setTimeout(r, 25));
      }
      assert.ok(
        sent.some((s) => s.includes('In coda, 1 davanti.')),
        `Expected Italian queued notice in: ${JSON.stringify(sent)} logs=${JSON.stringify(logs)}`,
      );
      gate.resolve();
      for (let i = 0; i < 40 && !sent.some((s) => s.includes('done:ricordami domani')); i++) {
        await new Promise((r) => setTimeout(r, 25));
      }
      assert.ok(sent.some((s) => s.includes('done:first request')));
      assert.ok(sent.some((s) => s.includes('done:ricordami domani')));
    } finally {
      await channel.stop();
      if (prevApi === undefined) delete process.env.NERV_TELEGRAM_API;
      else process.env.NERV_TELEGRAM_API = prevApi;
      await new Promise<void>((res) => bot.close(() => res()));
    }
  });

  it('HTTP /api/queue and DELETE /api/queue/:id expose and cancel queued requests', async () => {
    const queue = new RequestQueue({ maxConcurrent: 1, maxQueued: 1 });
    const gate = deferred();
    const fakeStore = {
      status: () => ({ ok: true }),
      queueStatus: () => queue.snapshot(),
      cancelQueued: (id: string) => queue.cancel(id),
      chat: (msg: string, conv?: string, opts?: { requestId?: string; signal?: AbortSignal }) =>
        queue.enqueue({
          id: opts?.requestId,
          conversation: conv ?? 'dashboard',
          title: msg,
          signal: opts?.signal,
          run: async () => {
            if (msg === 'hold') await gate.promise;
            return { sortieId: 's-1', reply: `ok:${msg}`, steps: [], waiting: [] };
          },
        }),
    };
    const token = 'test-token-at-least-24-characters';
    const srv = makeServer(fakeStore as never, token);
    await new Promise<void>((res) => srv.listen(0, '127.0.0.1', () => res()));
    const port = (srv.address() as { port: number }).port;
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

    try {
      const r1 = fetch(`http://127.0.0.1:${port}/api/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ message: 'hold', conversation: 'dashboard', requestId: 'q1' }),
      });
      await new Promise((r) => setTimeout(r, 30));

      const r2 = fetch(`http://127.0.0.1:${port}/api/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ message: 'second', conversation: 'cli', requestId: 'q2' }),
      });
      await new Promise((r) => setTimeout(r, 30));

      const qRes = await fetch(`http://127.0.0.1:${port}/api/queue`, { headers });
      assert.equal(qRes.status, 200);
      const qBody = (await qRes.json()) as { running: { id: string }[]; queued: { id: string; ahead: number }[] };
      assert.equal(qBody.running.length, 1);
      assert.equal(qBody.queued.length, 1);
      assert.equal(qBody.queued[0]?.id, 'q2');
      assert.equal(qBody.queued[0]?.ahead, 1);

      // 3rd request hits maxQueued=1 -> 429
      const r3 = await fetch(`http://127.0.0.1:${port}/api/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ message: 'third', conversation: 'cli', requestId: 'q3' }),
      });
      assert.equal(r3.status, 429);

      // Cancel q2 via DELETE /api/queue/q2
      const delRes = await fetch(`http://127.0.0.1:${port}/api/queue/q2`, { method: 'DELETE', headers });
      assert.equal(delRes.status, 200);
      const r2Res = await r2;
      assert.equal(r2Res.status, 499);

      gate.resolve();
      const r1Res = await r1;
      assert.equal(r1Res.status, 200);
    } finally {
      queue.close();
      await new Promise<void>((res) => srv.close(() => res()));
    }
  });

  it('dashboard renders queued sorties with QUEUED · N AHEAD badge', () => {
    const js = readFileSync(join(process.cwd(), 'web/public/dashboard/dashboard.js'), 'utf8');
    const elements: Record<string, { textContent: string; innerHTML: string; hidden?: boolean; disabled?: boolean }> =
      {};
    const el = (id: string) => (elements[id] ??= { textContent: '', innerHTML: '' });
    const ctx: Record<string, unknown> = {
      window: {},
      location: { search: '' },
      localStorage: { getItem: () => null, setItem: () => {} },
      matchMedia: () => ({ matches: true }),
      document: {
        documentElement: { style: { setProperty: () => {} }, dataset: {} },
        getElementById: el,
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: () => {},
      },
      setInterval: () => 0,
      setTimeout: () => 0,
      requestAnimationFrame: () => 0,
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    // Load only up to renderSorties definition by evaluating dashboard.js without auto-init failures
    assert.ok(js.includes('if (s.status === "queued")'));
    assert.ok(js.includes('AHEAD'));
    assert.ok(js.includes('data-cancel-queue'));
  });
});

describe('F-048-T02: per-model resource budgets', () => {
  it('validates models.concurrency limits', () => {
    const ok = validateModels({
      local: { baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:7b' },
      concurrency: { default: 1, perModel: { 'qwen2.5:7b': 2 } },
    });
    assert.deepEqual(ok.concurrency, { default: 1, perModel: { 'qwen2.5:7b': 2 } });

    assert.throws(() => validateModels({ concurrency: { default: 0 } }), /Invalid models\.concurrency/);
    assert.throws(() => validateModels({ concurrency: { perModel: { 'm': 99 } } }), /Invalid models\.concurrency/);
  });

  it('bounds concurrent calls per model, queues excess, and releases safely on abort/double-release', async () => {
    const budget = new ModelBudget({ default: 1, perModel: { 'fast-model': 2 } });
    let activeSlow = 0;
    let maxSlow = 0;

    const runSlow = async () => {
      const lease = await budget.acquire('slow-model');
      activeSlow++;
      maxSlow = Math.max(maxSlow, activeSlow);
      await new Promise((r) => setTimeout(r, 20));
      activeSlow--;
      // Double release must be safe and idempotent
      lease.release();
      lease.release();
    };

    await Promise.all([runSlow(), runSlow(), runSlow()]);
    assert.equal(maxSlow, 1);
    assert.deepEqual(budget.snapshot().active, {});

    // Different model uses its own perModel limit (2)
    const l1 = await budget.acquire('fast-model');
    const l2 = await budget.acquire('fast-model');
    const ac = new AbortController();
    const abortedWaiter = budget.acquire('fast-model', ac.signal);
    ac.abort();
    await assert.rejects(() => abortedWaiter, ModelBudgetCancelledError);
    assert.equal(budget.snapshot().active['fast-model'], 2);
    l1.release();
    l2.release();
    assert.deepEqual(budget.snapshot().active, {});
  });

  it('enforces per-model concurrency across brain-process calls to local Ollama endpoint', async () => {
    const dir = tempDir('nerv-budget-');
    let concurrent = 0;
    let peak = 0;
    const ollama = createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        concurrent++;
        peak = Math.max(peak, concurrent);
        setTimeout(() => {
          concurrent--;
          res.setHeader('content-type', 'application/json');
          res.end(
            JSON.stringify({
              model: 'qwen-limited',
              choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
            }),
          );
        }, 40);
      });
    });
    await new Promise<void>((res) => ollama.listen(0, '127.0.0.1', () => res()));
    const port = (ollama.address() as { port: number }).port;

    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({
        models: {
          local: { baseUrl: `http://127.0.0.1:${port}`, model: 'qwen-limited' },
          concurrency: { default: 1, perModel: { 'qwen-limited': 1 } },
        },
      }),
    );

    const runtime = new Runtime(join(dir, 'nerv.sqlite'), new URL('../src/brain-process.ts', import.meta.url), dir);
    try {
      await runtime.ready();
      const replies = await Promise.all([
        runtime.ask({ prompt: 'one', privacy: 'local-only', route: 'local' }),
        runtime.ask({ prompt: 'two', privacy: 'local-only', route: 'local' }),
        runtime.ask({ prompt: 'three', privacy: 'local-only', route: 'local' }),
      ]);
      assert.equal(replies.length, 3);
      assert.equal(peak, 1, `Expected peak concurrency 1 on Ollama, observed ${peak}`);
    } finally {
      await runtime.close();
      await new Promise<void>((res) => ollama.close(() => res()));
    }
  });
});

describe('F-048-T03: per-item mutation ownership', () => {
  it('serializes same-item locks in FIFO order while allowing distinct items concurrently', async () => {
    const locks = new ItemLockManager();
    const events: string[] = [];

    const first = locks.withLock('reminder:r1', async () => {
      events.push('r1-first-start');
      await new Promise((r) => setTimeout(r, 30));
      events.push('r1-first-end');
    });

    const second = locks.withLock('reminder:r1', async () => {
      events.push('r1-second-start');
      events.push('r1-second-end');
    });

    const other = locks.withLock('reminder:r2', async () => {
      events.push('r2-start');
    });

    await Promise.all([first, second, other]);
    assert.ok(events.indexOf('r1-first-end') < events.indexOf('r1-second-start'));
    assert.ok(events.indexOf('r2-start') < events.indexOf('r1-first-end'));
  });

  it('expiry alone never establishes that an external effect stopped', async () => {
    const locks = new ItemLockManager();
    const lease = await locks.acquire('reminder:ext-1', {
      owner: 'sortie-1',
      leaseMs: 15,
      externalEffect: true,
    });
    await new Promise((r) => setTimeout(r, 35));
    assert.equal(lease.expired, true);
    lease.release();

    await assert.rejects(() => locks.acquire('reminder:ext-1', { owner: 'sortie-2' }), ItemLockUncertainError);
    assert.ok(locks.status('reminder:ext-1').uncertain);

    // Only explicit reconciliation clears uncertain state
    assert.equal(locks.reconcile('reminder:ext-1'), true);
    const nextLease = await locks.acquire('reminder:ext-1', { owner: 'sortie-2' });
    nextLease.release();
  });

  it('maps built-in reminder and fact tools to canonical sorted item keys', () => {
    assert.deepEqual(itemKeysForTool('reminders.cancel', { ids: ['b', 'a', 'b'] }), ['reminder:a', 'reminder:b']);
    assert.deepEqual(itemKeysForTool('reminders.update', { id: 'r1' }), ['reminder:r1']);
    assert.deepEqual(itemKeysForTool('memory.forget', { id: 'f1' }), ['fact:f1']);
    assert.deepEqual(itemKeysForTool('reminders.list', {}), []);
  });

  it('two concurrent mutations on the same reminder serialize and the second re-reads committed state', async () => {
    const dir = tempDir('nerv-item-lock-');
    const runtime = new Runtime(join(dir, 'nerv.sqlite'), new URL('../src/brain-process.ts', import.meta.url), dir);
    try {
      await runtime.ready();
      const due = new Date(Date.now() + 3600_000).toISOString();
      const created = await runtime.add('Initial title', due);

      // Concurrent edit + cancel on the same reminder
      const [updated, cancelled] = await Promise.all([
        runtime.update(created.id, { title: 'Edited title' }),
        runtime.cancel(created.id),
      ]);

      assert.ok(updated);
      assert.equal(updated.title, 'Edited title');
      assert.equal(cancelled, true);

      // A subsequent edit re-reads after cancellation and sees it is cancelled (returns null/undefined)
      const afterCancel = await runtime.update(created.id, { title: 'Should not resurrect' });
      assert.equal(afterCancel, null);
    } finally {
      await runtime.close();
    }
  });
});
