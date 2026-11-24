// Worker link (F-014): signed delivery, restart, revocation and deferred approvals across two bases.
// The fixture is test/fixtures/worker-link.ts; B-118 split the file so its tests run in parallel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { signedHeaders } from '../src/kaji-auth.ts';
import { fixture, item, keys, until } from './fixtures/worker-link.ts';
test(
  'F-014: actual outbound WebSocket, signed identities, destination gate, lost result and reconnect replay one effect',
  { timeout: 30000 },
  async () => {
    const f = await fixture();
    let release!: () => void;
    const gate = new Promise<void>((done) => (release = done));
    let committed = false;
    const original = f.adapter;
    try {
      f.setAdapter({
        ...original,
        run: async (o, i, c) => {
          const result = await original.run(o, i, c);
          if (i.id === item(1).id && !committed) {
            committed = true;
            await gate;
          }
          return result;
        },
      });
      await f.start();
      const lost = f.main.run('NERV-02', item(1), 5000);
      const lostOutcome = lost.catch((e) => e);
      await until(() => committed);
      f.main.dropIncoming();
      assert.ok((await lostOutcome) instanceof Error);
      release();
      await until(() => f.main.connected('NERV-02'));
      const replay = (await f.main.run('NERV-02', item(1), 5000)) as { outcome: string };
      assert.equal(replay.outcome, 'grant');
      assert.equal((await f.rb.list()).length, 1);
      await assert.rejects(
        f.main.run('NERV-02', { ...item(1), args: { title: 'Changed', due: '2031-01-01T09:00:00Z' } }, 5000),
      );
      assert.equal((await f.rb.list()).length, 1);
      const second = (await f.main.run('NERV-02', item(2), 5000)) as { outcome: string };
      assert.equal(second.outcome, 'grant');
      assert.equal((await f.rb.list()).length, 2);
    } finally {
      release();
      await f.close();
    }
  },
);
test(
  'F-014: restart during unfinished work preserves uncertainty and resource lock until explicit owner reconciliation',
  { timeout: 30000 },
  async () => {
    const f = await fixture();
    let release!: () => void;
    const gate = new Promise<void>((done) => (release = done));
    let paused = false;
    const call = f.rb.nervous.call.bind(f.rb.nervous);
    f.rb.nervous.call = async (method, params = {}, timeout) => {
      if (method === 'actions.preview') {
        paused = true;
        await gate;
      }
      return call(method, params, timeout);
    };
    try {
      await f.start();
      const request = f.main.run('NERV-02', item(3), 5000).catch((e) => e);
      await until(() => paused);
      await f.restartWorker();
      release();
      await request;
      const retry = (await f.main.run('NERV-02', item(3), 5000)) as { outcome: string };
      assert.equal(retry.outcome, 'uncertain');
      assert.equal((await f.rb.list()).length, 0);
      assert.equal(((await f.main.run('NERV-02', item(4), 5000)) as { retry: boolean }).retry, true);
      assert.throws(() =>
        execFileSync(
          process.execPath,
          ['src/cli.ts', 'workers', 'release', item(3).id, '--reason', 'Fixture stopped'],
          { env: { ...process.env, NERV_HOME: f.homeB }, stdio: 'pipe' },
        ),
      );
      execFileSync(
        process.execPath,
        [
          'src/cli.ts',
          'workers',
          'release',
          item(3).id,
          '--confirmed-stopped',
          '--reason',
          'Fixture process stopped before execution',
        ],
        { env: { ...process.env, NERV_HOME: f.homeB }, stdio: 'pipe' },
      );
      assert.equal(((await f.main.run('NERV-02', item(4), 5000)) as { outcome: string }).outcome, 'grant');
      assert.equal((await f.rb.list()).length, 1);
    } finally {
      release();
      await f.close();
    }
  },
);
test(
  'F-014: upgrade rejects missing/bad identity, Origin and token-bearing URLs; live revocation stops work',
  { timeout: 30000 },
  async () => {
    const f = await fixture();
    try {
      f.main.start();
      for (const [headers, path] of [
        [{}, '/kaji/worker'],
        [
          {
            ...signedHeaders('NERV-02', f.b.privateKey, 'req', 'GET', '/kaji/worker', ''),
            Origin: 'http://example.test',
          },
          '/kaji/worker',
        ],
        [signedHeaders('NERV-02', f.b.privateKey, 'req', 'GET', '/kaji/worker', ''), '/kaji/worker?token=neutral'],
      ] as [Record<string, string>, string][]) {
        const socket = await f.raw(headers, path);
        await new Promise<void>((done, fail) => {
          socket.once('open', () => fail(Error('Unexpected upgrade')));
          socket.once('error', () => {});
          socket.once('unexpected-response', (_req, res) => {
            assert.equal(res.statusCode, 401);
            res.resume();
            socket.terminate();
            done();
          });
        });
      }
      await f.start();
      const revoke = f.record({ kind: 'revoke', baseId: 'NERV-02', publicKey: f.b.publicKey });
      await Promise.all([f.ra.kaji.add([revoke]), f.rb.kaji.add([revoke])]);
      await assert.rejects(f.main.run('NERV-02', item(5), 2000));
      await until(() => !f.main.connected('NERV-02'));
      assert.equal((await f.rb.list()).length, 0);
    } finally {
      await f.close();
    }
  },
);
test('F-014 review: deferred owner approval retains the worker resource', { timeout: 30000 }, async () => {
  const f = await fixture(),
    original = f.adapter;
  f.setAdapter({ ...original, run: (o, i, c) => f.rb.runFromPeer(o, i, ['memory.remember', 'reminders.add'], c) });
  try {
    await f.start();
    const request = { ...item(10), tool: 'memory.remember', args: { text: 'Neutral fact' } };
    const result = (await f.main.run('NERV-02', request, 5000)) as { outcome: string };
    assert.equal(result.outcome, 'approval');
    assert.equal(
      ((await f.main.run('NERV-02', item(11), 5000)) as { retry?: boolean }).retry,
      true,
      'waiting for the owner still owns the worker resource',
    );
  } finally {
    await f.close();
  }
});
test(
  'F-014 review: approval after disconnect cannot execute with an invalidated worker lease',
  { timeout: 30000 },
  async () => {
    const f = await fixture(),
      original = f.adapter;
    let closed = false;
    f.setAdapter({
      ...original,
      close: async (o, s) => {
        await original.close(o, s);
        closed = true;
      },
      run: (o, i, c) => f.rb.runFromPeer(o, i, ['memory.remember'], c),
    });
    try {
      await f.start();
      const result = (await f.main.run(
        'NERV-02',
        { ...item(12), tool: 'memory.remember', args: { text: 'Neutral fact' } },
        5000,
      )) as { approvalId: string };
      f.main.dropIncoming();
      await until(() => closed);
      const decision = await f.rb.decide(result.approvalId, 'approve', 'api');
      assert.notEqual(decision.decision, 'approve', 'stale worker authority cannot create a grant');
      assert.equal((await f.rb.lilith.list()).length, 0);
    } finally {
      await f.close();
    }
  },
);
test(
  'F-014 review: destination revocation is rechecked inside the scheduler immediately before execution',
  { timeout: 30000 },
  async () => {
    const f = await fixture(),
      original = f.adapter;
    f.setAdapter({ ...original, close: async () => {} });
    let entered = false,
      finished = false;
    let release!: () => void;
    const gate = new Promise<void>((done) => (release = done));
    const call = f.rb.nervous.call.bind(f.rb.nervous);
    f.rb.nervous.call = async (method, params = {}, timeout) => {
      if (method === 'actions.preview') {
        entered = true;
        await gate;
      }
      try {
        return await call(method, params, timeout);
      } finally {
        if (method === 'actions.act') finished = true;
      }
    };
    try {
      await f.start();
      const result = f.main.run('NERV-02', item(13), 5000).catch((e) => e);
      await until(() => entered);
      await f.rb.kaji.add([f.record({ kind: 'revoke', baseId: 'NERV-02', publicKey: f.b.publicKey })]);
      release();
      await until(() => finished);
      await result;
      assert.equal(
        (await f.rb.list()).length,
        0,
        'revoked destination cannot execute even when transport cleanup is delayed',
      );
    } finally {
      release();
      await f.close();
    }
  },
);
test(
  'F-014: valid deferred approval executes once, completes its receipt and releases its resource',
  { timeout: 30000 },
  async () => {
    const f = await fixture(),
      original = f.adapter;
    f.setAdapter({ ...original, run: (o, i, c) => f.rb.runFromPeer(o, i, ['memory.remember', 'reminders.add'], c) });
    try {
      await f.start();
      const request = { ...item(14), tool: 'memory.remember', args: { text: 'Neutral fact' } };
      const card = (await f.main.run('NERV-02', request, 5000)) as { approvalId: string };
      assert.ok(card.approvalId);
      await f.rb.decide(card.approvalId, 'approve', 'api');
      await f.rb.decide(card.approvalId, 'approve', 'telegram');
      assert.equal((await f.rb.lilith.list()).length, 1);
      assert.equal(((await f.main.run('NERV-02', request, 5000)) as { outcome: string }).outcome, 'grant');
      assert.equal(((await f.main.run('NERV-02', item(15), 5000)) as { outcome: string }).outcome, 'grant');
    } finally {
      await f.close();
    }
  },
);
test(
  'F-014: changing the main base enrolled key fences a request already inside planning',
  { timeout: 30000 },
  async () => {
    const f = await fixture(),
      original = f.adapter;
    f.setAdapter({ ...original, close: async () => {} });
    let entered = false,
      finished = false;
    let release!: () => void;
    const gate = new Promise<void>((done) => (release = done)),
      call = f.rb.nervous.call.bind(f.rb.nervous);
    f.rb.nervous.call = async (method, params = {}, timeout) => {
      if (method === 'actions.preview') {
        entered = true;
        await gate;
      }
      try {
        return await call(method, params, timeout);
      } finally {
        if (method === 'actions.act') finished = true;
      }
    };
    try {
      await f.start();
      const request = f.main.run('NERV-02', item(16), 5000).catch((e) => e);
      await until(() => entered);
      const replacement = keys();
      await f.rb.kaji.add([
        f.record({
          kind: 'enrol',
          baseId: 'NERV-01',
          name: 'Aster',
          address: f.address,
          publicKey: replacement.publicKey,
        }),
      ]);
      release();
      await until(() => finished);
      await request;
      assert.equal((await f.rb.list()).length, 0);
    } finally {
      release();
      await f.close();
    }
  },
);
test(
  'F-014 review: expired pending worker approval releases only proven unexecuted work without an owner tap',
  { timeout: 30000 },
  async () => {
    const f = await fixture(),
      original = f.adapter;
    f.setAdapter({ ...original, run: (o, i, c) => f.rb.runFromPeer(o, i, ['memory.remember', 'reminders.add'], c) });
    try {
      await f.start();
      const request = { ...item(17), tool: 'memory.remember', args: { text: 'Neutral fact' } };
      await f.main.run('NERV-02', request, 5000);
      const { Store } = await import('../src/store.ts');
      const store = new Store(join(f.homeB, 'nerv.sqlite'), undefined, { home: f.homeB });
      try {
        store.expire(new Date(Date.now() + 301000));
      } finally {
        store.close();
      }
      assert.equal((await f.rb.approvals()).length, 0, 'lease-expired card is stood down without a tap');
      assert.equal(((await f.main.run('NERV-02', request, 5000)) as { outcome: string }).outcome, 'reject');
      assert.equal(((await f.main.run('NERV-02', item(18), 5000)) as { outcome: string }).outcome, 'grant');
      assert.equal((await f.rb.lilith.list()).length, 0);
    } finally {
      await f.close();
    }
  },
);
test(
  'F-016-T18: once a worker holds a newer main record, its open WebSocket to the old main stops taking work',
  { timeout: 30000 },
  async () => {
    const f = await fixture();
    try {
      await f.start();
      assert.equal(((await f.main.run('NERV-02', item(30), 5000)) as { outcome: string }).outcome, 'grant');
      const c = keys();
      await f.rb.kaji.add([
        f.record({ kind: 'enrol', baseId: 'NERV-03', name: 'Relay', publicKey: c.publicKey, address: '127.0.0.1:1' }),
        f.record({ kind: 'main', baseId: 'NERV-03', coordinatorEpoch: 2 }),
      ]);
      await until(() => !f.link.connected('NERV-01'));
      await assert.rejects(f.main.run('NERV-02', item(31), 2000));
    } finally {
      await f.close();
    }
  },
);
