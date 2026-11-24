import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { MISATO_SOURCE, OWNER_SOURCE, Store } from '../src/store.ts';

// B-132: an executor that answers later (a promise) used to reach the ledger and the caller as `{}`; a rejection was
// never caught. Invented addresses and ids only; no network.

/** Folds a later answer into the reply, without relying on the store's own helper. */
async function settle(value: unknown): Promise<Record<string, unknown>> {
  const r = value as Record<string, unknown> & { pending?: Promise<Record<string, unknown>> };
  if (!r.pending) return r;
  const { pending, ...rest } = r;
  return { ...rest, ...(await pending) };
}

function withStore(work: (store: Store) => Promise<void>) {
  const home = mkdtempSync(join(tmpdir(), 'nerv-async-exec-'));
  const store = new Store(join(home, 'nerv.sqlite'), undefined, { home });
  return work(store).finally(() => {
    store.close();
    rmSync(home, { recursive: true, force: true });
  });
}

const kinds = (store: Store, sortieId: string) => store.events(sortieId).map((e) => e.kind);
const status = (store: Store, sortieId: string) =>
  (store.db.prepare('SELECT status FROM sorties WHERE id=?').get(sortieId) as { status: string }).status;
const finishedPayload = (store: Store, sortieId: string) =>
  store.events(sortieId).find((e) => e.kind === 'action.done')?.payload as { result?: unknown } | undefined;

function fakeGmail(send: () => Promise<unknown>) {
  return {
    search: async () => ({ tainted: true, query: 'invoice', messages: [{ id: 'm-1', subject: 'Invoice 7' }] }),
    read: async () => ({ tainted: true, id: 'm-1', subject: 'Invoice 7', body: 'Neutral body.' }),
    draft: async () => ({ id: 'd-1' }),
    send,
  };
}

describe('B-132: executors that answer later', () => {
  it('a rejection after the owner approves is recorded as action.failed and the reply carries the error', async () => {
    await withStore(async (store) => {
      Object.assign(store, { gmail: fakeGmail(() => Promise.reject(new Error('SMTP refused the message.'))) });
      const sortie = store.ledger.openSortie(OWNER_SOURCE, 'send the invoice mail', 'trusted');
      const card = store.runAction(sortie, {
        tool: 'gmail.send',
        stage: 'production',
        args: { to: 'someone@example.test', subject: 'Invoice', body: 'Neutral.' },
      });
      assert.equal(card.outcome, 'approval');
      const decided = await settle(store.decide(card.approvalId!, 'approve', 'owner'));
      assert.equal(decided.error, 'SMTP refused the message.');
      assert.ok(kinds(store, sortie).includes('action.failed'));
      assert.ok(!kinds(store, sortie).includes('action.done'));
      assert.equal(status(store, sortie), 'failed');
    });
  });

  it('a granted executor through the gate records and returns its real result, not {}', async () => {
    await withStore(async (store) => {
      Object.assign(store, { gmail: fakeGmail(() => Promise.resolve({ id: 'sent-1' })) });
      const sortie = store.ledger.openSortie(MISATO_SOURCE, 'find the invoice mail', 'trusted');
      const acted = await settle(
        store.runAction(sortie, { tool: 'gmail.search', stage: 'production', args: { query: 'invoice' } }),
      );
      assert.equal(acted.outcome, 'grant');
      assert.deepEqual((acted.result as { messages: unknown[] }).messages, [{ id: 'm-1', subject: 'Invoice 7' }]);
      assert.deepEqual((finishedPayload(store, sortie)?.result as { query?: string })?.query, 'invoice');
    });
  });

  it('an executor that never answers ends as action.failed after its bound, and the sortie settles', async () => {
    await withStore(async (store) => {
      store.executorTimeoutMs = 50;
      Object.assign(store, { gmail: fakeGmail(() => new Promise(() => {})) });
      const sortie = store.ledger.openSortie(OWNER_SOURCE, 'send the invoice mail', 'trusted');
      const card = store.runAction(sortie, {
        tool: 'gmail.send',
        stage: 'production',
        args: { to: 'someone@example.test', subject: 'Invoice', body: 'Neutral.' },
      });
      const decided = await settle(store.decide(card.approvalId!, 'approve', 'owner'));
      assert.match(String(decided.error), /did not answer within/);
      assert.ok(kinds(store, sortie).includes('action.failed'));
      assert.equal(status(store, sortie), 'failed');
    });
  });

  it('a worker-bound card finishes its worker job with the settled outcome; a job released meanwhile is no error', async () => {
    for (const released of [false, true]) {
      await withStore(async (store) => {
        let send: (v: unknown) => void = () => {};
        Object.assign(store, { gmail: fakeGmail(() => new Promise((done) => (send = done))) });
        // The authority check reads enrolled bases from the Kaji registry; this test is about the job, not enrollment.
        const sorties = (store as unknown as { sortiesController: { assertWorkerAuthority: () => void } })
          .sortiesController;
        sorties.assertWorkerAuthority = () => {};
        const session = randomUUID();
        const { epoch } = store.workerJobs.open('NERV-01', session);
        const claim = store.workerJobs.claim(
          'NERV-01',
          { id: randomUUID(), request: 'send it', tool: 'gmail.send', args: {} },
          { session, epoch, expires: Date.now() + 60_000 },
        );
        assert.equal(claim.state, 'claimed');
        const lease = (claim as { lease: Parameters<Store['workerJobs']['finish']>[0] }).lease;
        const sortie = store.ledger.openSortie(OWNER_SOURCE, 'send the invoice mail', 'trusted');
        const card = store.runAction(sortie, {
          tool: 'gmail.send',
          stage: 'production',
          args: { to: 'someone@example.test', subject: 'Invoice', body: 'Neutral.' },
        });
        store.workerJobs.bindApproval(lease, card.approvalId!, card);
        const decided = settle(store.decide(card.approvalId!, 'approve', 'owner'));
        if (released) store.db.prepare("UPDATE worker_jobs SET state='cancelled' WHERE id=?").run(lease.id);
        send({ id: 'sent-1' });
        const out = await decided;
        assert.deepEqual(out.result, { id: 'sent-1' });
        assert.equal(out.error, undefined);
        const job = store.db.prepare('SELECT state,result FROM worker_jobs WHERE id=?').get(lease.id) as {
          state: string;
          result: string;
        };
        if (!released) {
          assert.equal(job.state, 'completed');
          assert.deepEqual(JSON.parse(job.result), { outcome: 'grant', decision: 'approve', result: { id: 'sent-1' } });
        }
      });
    }
  });
});
