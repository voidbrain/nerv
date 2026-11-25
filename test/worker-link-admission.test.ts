// Worker link admission (F-014, B-045, F-006-T11): hostile frames, connection bounds, signed cancellation, burst.
// The fixture is test/fixtures/worker-link.ts; B-118 split the file so its tests run in parallel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { signedHeaders } from '../src/kaji-auth.ts';
import { fixture, item, keys, rawReady, until } from './fixtures/worker-link.ts';
test(
  'F-014: invalid version and forbidden worker RPC never reach the destination gate',
  { timeout: 30000 },
  async () => {
    const f = await fixture(10000);
    try {
      f.main.start();
      const raw = await rawReady(f);
      const response = new Promise<{ error: { code: number } }>((done) =>
        raw.socket.once('message', (data) => done(JSON.parse(JSON.parse(data.toString()).body).rpc)),
      );
      raw.socket.send(raw.frame(2, 'approvals.decide', { id: item(1).id, decision: 'approve' }));
      assert.equal((await response).error.code, -32003);
      assert.equal((await f.rb.list()).length, 0);
      raw.socket.terminate();
      await until(() => !f.main.connected('NERV-02'));
      const socket = await f.raw(signedHeaders('NERV-02', f.b.privateKey, 'req', 'GET', '/kaji/worker', ''));
      await new Promise<void>((done) => socket.once('open', done));
      const session = randomUUID(),
        body = JSON.stringify({
          sequence: 1,
          rpc: {
            jsonrpc: '2.0',
            id: randomUUID(),
            method: 'worker.hello',
            params: { version: 99, epoch: 1, cursor: 0, offers: [] },
          },
        });
      const refused = new Promise<{ error: { code: number } }>((done) =>
        socket.once('message', (data) => done(JSON.parse(JSON.parse(data.toString()).body).rpc)),
      );
      socket.send(
        JSON.stringify({
          session,
          body,
          headers: signedHeaders('NERV-02', f.b.privateKey, 'req', 'FRAME', '/kaji/worker/' + session, body),
        }),
      );
      assert.equal((await refused).error.code, -32003);
      assert.equal(f.main.connected('NERV-02'), false);
    } finally {
      await f.close();
    }
  },
);
for (const attack of ['replay', 'gap', 'tamper', 'other-session', 'binary', 'oversized'] as const)
  test(`F-014: ${attack} frame closes the channel without execution`, { timeout: 30000 }, async () => {
    const f = await fixture(10000);
    try {
      f.main.start();
      const raw = await rawReady(f),
        closed = new Promise<void>((done) => raw.socket.once('close', () => done()));
      if (attack === 'replay') raw.socket.send(raw.hello);
      if (attack === 'gap') raw.socket.send(raw.frame(3, 'worker.ping', { offers: [] }));
      if (attack === 'tamper') {
        const encoded = JSON.parse(raw.frame(2, 'worker.ping', { offers: [] }));
        encoded.body = encoded.body.replace('worker.ping', 'worker.run');
        raw.socket.send(JSON.stringify(encoded));
      }
      if (attack === 'other-session') {
        const encoded = JSON.parse(raw.frame(2, 'worker.ping', { offers: [] }));
        encoded.session = randomUUID();
        raw.socket.send(JSON.stringify(encoded));
      }
      if (attack === 'binary')
        raw.socket.send(Buffer.from(raw.frame(2, 'worker.ping', { offers: [] })), { binary: true });
      if (attack === 'oversized') raw.socket.send('x'.repeat(65537));
      await closed;
      await until(() => !f.main.connected('NERV-02'));
      assert.equal((await f.rb.list()).length, 0);
    } finally {
      await f.close();
    }
  });
test(
  'F-014: pending admission remains occupied after timeout until response or disconnect',
  { timeout: 30000 },
  async () => {
    const f = await fixture(10000);
    try {
      f.main.start();
      const raw = await rawReady(f);
      const results = await Promise.allSettled(
        Array.from({ length: 4 }, (_, i) => f.main.run('NERV-02', item(100 + i), 80)),
      );
      assert.ok(results.every((r) => r.status === 'rejected'));
      await assert.rejects(f.main.run('NERV-02', item(104), 80), /pending request bound/);
      assert.equal(f.main.connected('NERV-02'), true);
      raw.socket.terminate();
      await until(() => !f.main.connected('NERV-02'));
      assert.equal((await f.rb.list()).length, 0);
    } finally {
      await f.close();
    }
  },
);
test(
  'F-014: global worker connection bound rejects excess upgrades and returns capacity after close',
  { timeout: 30000 },
  async () => {
    const f = await fixture(10000);
    try {
      const identities = [{ id: 'NERV-02', key: f.b.privateKey }];
      const records = [];
      for (let i = 3; i <= 17; i++) {
        const key = keys(),
          id = 'NERV-' + String(i).padStart(2, '0');
        identities.push({ id, key: key.privateKey });
        records.push(
          f.record({
            kind: 'enrol',
            baseId: id,
            name: 'Neutral ' + i,
            address: '127.0.0.1:1',
            publicKey: key.publicKey,
          }),
        );
      }
      await f.ra.kaji.add(records);
      f.main.start();
      const peers = await Promise.all(identities.map((identity) => rawReady(f, identity.id, identity.key)));
      const excess = await f.raw(signedHeaders('NERV-02', f.b.privateKey, 'req', 'GET', '/kaji/worker', ''));
      await new Promise<void>((done, fail) => {
        excess.once('open', () => fail(Error('Excess connection admitted')));
        excess.on('error', () => {});
        excess.once('unexpected-response', (_req, res) => {
          assert.equal(res.statusCode, 503);
          res.resume();
          excess.terminate();
          done();
        });
      });
      peers[0]!.socket.terminate();
      await until(() => !f.main.connected('NERV-02'));
      await rawReady(f);
      assert.equal(f.main.connected('NERV-02'), true);
    } finally {
      await f.close();
    }
  },
);
test(
  'F-014: signed cancellation before acceptance creates a durable rejection, and completion is never undone',
  { timeout: 30000 },
  async () => {
    const f = await fixture();
    try {
      await f.start();
      assert.equal((await f.main.cancel('NERV-02', item(200).id, 'Cancel before delivery')).status, 'cancelled');
      assert.equal(((await f.main.run('NERV-02', item(200), 5000)) as { outcome: string }).outcome, 'reject');
      assert.equal((await f.rb.list()).length, 0);
      await f.main.run('NERV-02', item(201), 5000);
      const completed = await f.main.cancel('NERV-02', item(201).id, 'Owner requested cancellation');
      assert.equal(completed.status, 'completed');
      assert.equal((completed.result as { outcome: string }).outcome, 'grant');
      assert.equal((await f.rb.list()).length, 1);
    } finally {
      await f.close();
    }
  },
);
test(
  'F-014: cancellation during planning fences execution but retains the resource until the handler terminates',
  { timeout: 30000 },
  async () => {
    const f = await fixture();
    let entered = false;
    let release!: () => void;
    const gate = new Promise<void>((done) => (release = done)),
      call = f.rb.nervous.call.bind(f.rb.nervous);
    f.rb.nervous.call = async (method, params = {}, timeout) => {
      if (method === 'actions.preview') {
        entered = true;
        await gate;
      }
      return call(method, params, timeout);
    };
    try {
      await f.start();
      const running = f.main.run('NERV-02', item(202), 5000);
      await until(() => entered);
      assert.equal((await f.main.cancel('NERV-02', item(202).id, 'Owner stood down request')).status, 'requested');
      assert.equal(((await f.main.run('NERV-02', item(203), 5000)) as { retry: boolean }).retry, true);
      release();
      await running;
      assert.equal((await f.rb.list()).length, 0);
      assert.equal(((await f.main.run('NERV-02', item(203), 5000)) as { outcome: string }).outcome, 'grant');
    } finally {
      release();
      await f.close();
    }
  },
);
test(
  'F-014: cancellation of a deferred approval stands down its card and makes the terminal result replayable',
  { timeout: 30000 },
  async () => {
    const f = await fixture(),
      original = f.adapter;
    f.setAdapter({ ...original, run: (o, i, c) => f.rb.runFromPeer(o, i, ['memory.remember', 'reminders.add'], c) });
    try {
      await f.start();
      const request = { ...item(204), tool: 'memory.remember', args: { text: 'Neutral fact' } };
      await f.main.run('NERV-02', request, 5000);
      assert.equal((await f.main.cancel('NERV-02', request.id, 'Owner cancelled pending fact')).status, 'completed');
      assert.equal((await f.rb.approvals()).length, 0);
      assert.equal((await f.rb.lilith.list()).length, 0);
      assert.equal(((await f.main.run('NERV-02', request, 5000)) as { outcome: string }).outcome, 'reject');
      assert.equal(((await f.main.run('NERV-02', item(205), 5000)) as { outcome: string }).outcome, 'grant');
    } finally {
      await f.close();
    }
  },
);
test(
  'F-014: source Spear sends signed cancellation while delivery is in flight and later records the terminal observation',
  { timeout: 30000 },
  async () => {
    const f = await fixture();
    let entered = false;
    let release!: () => void;
    const gate = new Promise<void>((done) => (release = done)),
      call = f.rb.nervous.call.bind(f.rb.nervous);
    f.rb.nervous.call = async (method, params = {}, timeout) => {
      if (method === 'actions.preview') {
        entered = true;
        await gate;
      }
      return call(method, params, timeout);
    };
    try {
      await f.start();
      const proposal = await f.ra.act({
        request: 'Neutral delegated reminder',
        tool: 'kaji.run',
        args: {
          base: 'NERV-02',
          tool: 'reminders.add',
          args: { title: 'Cancelled delegated reminder', due: '2031-01-01T09:00:00Z' },
        },
      });
      assert.ok(proposal.approvalId);
      await f.ra.decide(proposal.approvalId!, 'approve', 'api');
      f.ra.startOutbox(
        async (base, i, dispatching) => {
          await dispatching();
          return { reached: true, result: await f.main.run(base, i, 5000) };
        },
        30,
        (base, id, reason) => f.main.cancel(base, id, reason),
      );
      await until(() => entered);
      const stoodDown = await f.ra.spear(proposal.sortieId, 'Owner stood down delegated work');
      assert.equal(stoodDown!.remotePending, 1);
      await until(async () =>
        (await f.ra.events(proposal.sortieId)).some(
          (e) => e.kind === 'kaji.result' && e.payload.outcome === 'uncertain',
        ),
      );
      release();
      await until(
        async () => (await f.ra.events(proposal.sortieId)).filter((e) => e.kind === 'kaji.result').length >= 2,
      );
      assert.equal((await f.rb.list()).length, 0);
    } finally {
      release();
      await f.close();
    }
  },
);
test(
  'B-045: publishing a negotiated worker accepts an immediate admitted burst after its hello acknowledgement',
  { timeout: 30000 },
  async () => {
    const f = await fixture(10000);
    let burst: Promise<PromiseSettledResult<unknown>[]> | undefined;
    f.main.settings.log = () => {
      burst ??= Promise.allSettled(Array.from({ length: 4 }, () => f.main.run('NERV-02', item(108), 5000)));
    };
    try {
      await f.start();
      await until(() => !!burst);
      const results = await burst!;
      assert.ok(
        results.some((result) => result.status === 'fulfilled'),
        'the accepted session must not lose every admitted request behind its own hello acknowledgement',
      );
      assert.equal((await f.rb.list()).length, 1, 'the burst executes one durable effect');
    } finally {
      await f.close();
    }
  },
);
test('F-006-T11: worker link reports connected(coordinator) true for its outbound client session', async () => {
  const f = await fixture();
  try {
    await f.start();
    assert.equal(f.main.connected('NERV-02'), true);
    assert.equal(f.link.connected('NERV-01'), true);
  } finally {
    await f.close();
  }
});
