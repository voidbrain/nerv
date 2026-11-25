import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { makeServer } from '../src/server.ts';
import { validateParams } from '../src/rpc.ts';

// F-066-T02: a decision records which client made it, so an API-token decision is told apart from a dashboard one.
const proposal = {
  tool: 'reminders.add',
  args: { title: 'Neutral fixture', due: '2099-01-01T00:00:00Z' },
  stage: 'prototype' as const,
};

test('F-066: ledger events tell an API-token decision from a dashboard-session one', async () => {
  const store = new Store(':memory:');
  const token = 'e'.repeat(32);
  const server = makeServer(store, token, {});
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as { port: number };
  const base = `http://127.0.0.1:${port}`;
  const call = (bearer: string, path: string, body?: unknown) =>
    fetch(base + path, {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  try {
    const { code } = (await (await call(token, '/api/session/codes')).json()) as { code: string };
    const { token: session } = (await (
      await fetch(base + '/api/session/exchange', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      })
    ).json()) as { token: string };
    const sourceOf = async (bearer: string) => {
      const sortie = store.ledger.openSortie('owner', 'Neutral approval', 'trusted');
      const { approvalId } = store.runAction(sortie, proposal);
      assert.equal((await call(bearer, `/api/approvals/${approvalId}`, { decision: 'approve' })).status, 200);
      const event = store.events(sortie).find((e) => e.kind === 'approval.approve');
      return (event?.payload as { source?: string } | undefined)?.source;
    };
    assert.equal(await sourceOf(session), 'dashboard');
    assert.equal(await sourceOf(token), 'api');
    const sortie = store.ledger.openSortie('owner', 'Neutral approval', 'trusted');
    const { approvalId } = store.runAction(sortie, proposal);
    store.decide(approvalId!, 'reject', 'cli');
    assert.equal(
      (store.events(sortie).find((e) => e.kind === 'approval.reject')?.payload as { source?: string }).source,
      'cli',
    );
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    store.close();
  }
});

test('F-066: the nervous-process RPC accepts every decision source the server and channels send', () => {
  for (const source of ['api', 'dashboard', 'cli', 'telegram'])
    assert.doesNotThrow(() => validateParams('approvals.decide', { id: 'A-1', decision: 'approve', source }), source);
  assert.throws(() => validateParams('approvals.decide', { id: 'A-1', decision: 'approve', source: 'browser' }));
});
