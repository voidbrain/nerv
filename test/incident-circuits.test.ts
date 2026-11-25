import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { readScrolls } from '../src/config.ts';
import { OWNER_SOURCE, Store } from '../src/store.ts';

const dirs: string[] = [];
const makeStore = () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-circuits-'));
  dirs.push(dir);
  return new Store(join(dir, 'nerv.db'), readScrolls(dir), { home: dir });
};

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('F-064-T02 first bounded incident circuit', () => {
  it('trips only the affected channel on repeated tainted Blue attempts, spears its open sorties, deduplicates alerts, and requires owner rearm', () => {
    const store = makeStore();
    try {
      const sortieA1 = store.ledger.openSortie(OWNER_SOURCE, 'Channel A tainted job 1', 'tainted');
      const sortieA2 = store.ledger.openSortie(OWNER_SOURCE, 'Channel A tainted job 2', 'tainted');
      const sortieB = store.ledger.openSortie(OWNER_SOURCE, 'Channel B healthy job', 'trusted');

      const pendingA1 = store.runAction(sortieA1, {
        tool: 'memory.remember',
        args: { text: 'Untrusted fact candidate' },
        stage: 'production',
      });
      assert.equal(pendingA1.outcome, 'approval');

      const pendingB = store.runAction(sortieB, {
        tool: 'memory.remember',
        args: { text: 'Healthy fact candidate' },
        stage: 'production',
      });
      assert.equal(pendingB.outcome, 'approval');

      const benign = store.circuits.recordBlueAttempt({
        channel: 'channel-a',
        sortieId: sortieA1,
        tool: 'memory.remember',
        tainted: false,
      });
      assert.equal(benign.tripped, false);
      assert.equal(benign.alert, false);

      const t1 = store.circuits.recordBlueAttempt({
        channel: 'channel-a',
        sortieId: sortieA1,
        tool: 'memory.remember',
        tainted: true,
        openSortieIdsInChannel: [sortieA1, sortieA2],
      });
      assert.equal(t1.tripped, false);
      assert.equal(t1.alert, false);

      const t2 = store.circuits.recordBlueAttempt({
        channel: 'channel-a',
        sortieId: sortieA2,
        tool: 'memory.remember',
        tainted: true,
        openSortieIdsInChannel: [sortieA1, sortieA2],
      });
      assert.equal(t2.tripped, false);
      assert.equal(t2.alert, false);

      const t3 = store.circuits.recordBlueAttempt({
        channel: 'channel-a',
        sortieId: sortieA2,
        tool: 'memory.remember',
        tainted: true,
        openSortieIdsInChannel: [sortieA1, sortieA2],
      });
      assert.equal(t3.tripped, true);
      assert.equal(t3.alert, true);
      assert.equal(t3.state.state, 'tripped');
      assert.equal(t3.state.evidence.length, 2);
      assert.equal(store.circuits.isBlocked('channel-a'), true);
      assert.equal(store.circuits.isBlocked('channel-b'), false);

      // Deduplicated alert: another attempt while tripped emits alert: false
      const t4 = store.circuits.recordBlueAttempt({
        channel: 'channel-a',
        sortieId: sortieA2,
        tool: 'memory.remember',
        tainted: true,
      });
      assert.equal(t4.tripped, true);
      assert.equal(t4.alert, false);

      // Channel A sorties were speared; Channel B sortie and pending approval remain untouched
      const rowA1 = store.db.prepare('SELECT status FROM sorties WHERE id=?').get(sortieA1) as { status: string };
      const rowA2 = store.db.prepare('SELECT status FROM sorties WHERE id=?').get(sortieA2) as { status: string };
      const rowB = store.db.prepare('SELECT status FROM sorties WHERE id=?').get(sortieB) as { status: string };
      assert.equal(rowA1.status, 'revoked');
      assert.equal(rowA2.status, 'revoked');
      assert.equal(rowB.status, 'open');

      const approvalA1 = store.db.prepare('SELECT decision FROM approvals WHERE id=?').get(pendingA1.approvalId!) as {
        decision: string | null;
      };
      const approvalB = store.db.prepare('SELECT decision FROM approvals WHERE id=?').get(pendingB.approvalId!) as {
        decision: string | null;
      };
      assert.equal(approvalA1.decision, 'revoked');
      assert.equal(approvalB.decision, null);

      assert.throws(() => store.circuits.rearm('channel-a', 'misato'), /Only the owner/);
      const rearmed = store.circuits.rearm('channel-a', 'owner');
      assert.equal(rearmed.state, 'armed');
      assert.equal(rearmed.taintedBlueAttempts, 0);
      assert.equal(store.circuits.isBlocked('channel-a'), false);
    } finally {
      store.close();
    }
  });
});

describe('F-064-T03 fault-injection tests', () => {
  it('benign input never trips the circuit even across many attempts', () => {
    const store = makeStore();
    try {
      const sortie = store.ledger.openSortie(OWNER_SOURCE, 'Benign channel job', 'trusted');
      const pending = store.runAction(sortie, {
        tool: 'memory.remember',
        args: { text: 'Trusted note' },
        stage: 'production',
      });
      assert.equal(pending.outcome, 'approval');

      for (let i = 0; i < 20; i += 1) {
        const res = store.circuits.recordBlueAttempt({
          channel: 'channel-benign',
          sortieId: sortie,
          tool: 'memory.remember',
          tainted: false,
          openSortieIdsInChannel: [sortie],
        });
        assert.equal(res.tripped, false);
        assert.equal(res.alert, false);
        assert.equal(res.state.state, 'armed');
        assert.equal(res.state.taintedBlueAttempts, 0);
      }

      assert.equal(store.circuits.isBlocked('channel-benign'), false);
      const sortieRow = store.db.prepare('SELECT status FROM sorties WHERE id=?').get(sortie) as { status: string };
      assert.equal(sortieRow.status, 'open');
      const approvalRow = store.db.prepare('SELECT decision FROM approvals WHERE id=?').get(pending.approvalId!) as {
        decision: string | null;
      };
      assert.equal(approvalRow.decision, null);
    } finally {
      store.close();
    }
  });

  it('injected faults revoke only the affected channel authority and preserve other channels plus owner recovery', () => {
    const store = makeStore();
    try {
      const sortieFault = store.ledger.openSortie(OWNER_SOURCE, 'Faulted channel job 1', 'trusted');
      const sortieFault2 = store.ledger.openSortie(OWNER_SOURCE, 'Faulted channel job 2', 'tainted');
      const sortieHealthy = store.ledger.openSortie(OWNER_SOURCE, 'Healthy channel job', 'trusted');

      // Issue a Green grant on the faulted sortie
      const greenGrant = store.runAction(sortieFault, {
        tool: 'docs.list',
        args: {},
        stage: 'production',
      });
      assert.equal(greenGrant.outcome, 'grant');

      const pendingFault = store.runAction(sortieFault2, {
        tool: 'memory.remember',
        args: { text: 'Tainted candidate' },
        stage: 'production',
      });
      assert.equal(pendingFault.outcome, 'approval');

      const pendingHealthy = store.runAction(sortieHealthy, {
        tool: 'memory.remember',
        args: { text: 'Healthy candidate' },
        stage: 'production',
      });
      assert.equal(pendingHealthy.outcome, 'approval');

      // Inject 3 tainted Blue attempts on channel-fault
      for (let i = 0; i < 3; i += 1) {
        store.circuits.recordBlueAttempt({
          channel: 'channel-fault',
          sortieId: sortieFault2,
          tool: 'memory.remember',
          tainted: true,
          openSortieIdsInChannel: [sortieFault, sortieFault2],
        });
      }

      assert.equal(store.circuits.isBlocked('channel-fault'), true);
      assert.equal(store.circuits.isBlocked('channel-healthy'), false);

      // Healthy channel authority remains intact and can still request/use grants
      const sortieHealthy2 = store.ledger.openSortie(OWNER_SOURCE, 'Healthy channel job 2', 'trusted');
      const healthyGreen = store.runAction(sortieHealthy2, {
        tool: 'docs.list',
        args: {},
        stage: 'production',
      });
      assert.equal(healthyGreen.outcome, 'grant');

      // Pending approval on the speared sortie was revoked in circuit evidence
      const tripped = store.circuits.get('channel-fault')!;
      assert.equal(tripped.state, 'tripped');
      assert.equal(tripped.evidence.length, 1);
      assert.equal(tripped.evidence[0].sortieId, sortieFault2);
      assert.equal(tripped.evidence[0].stoodDown >= 1, true);

      // Non-owner actors cannot rearm; owner recovery access works and restores channel
      for (const actor of ['misato', 'kaji', 'agent', '']) {
        assert.throws(() => store.circuits.rearm('channel-fault', actor), /Only the owner/);
      }
      const recovered = store.circuits.rearm('channel-fault', 'owner');
      assert.equal(recovered.state, 'armed');
      assert.equal(store.circuits.isBlocked('channel-fault'), false);

      // New work on the recovered channel can proceed normally
      const newSortie = store.ledger.openSortie(OWNER_SOURCE, 'Post-recovery job', 'trusted');
      const postRecoveryAction = store.runAction(newSortie, {
        tool: 'docs.list',
        args: {},
        stage: 'production',
      });
      assert.equal(postRecoveryAction.outcome, 'grant');

      // Audit history preserved across trip and rearm
      const history = store.db
        .prepare('SELECT kind, actor FROM incident_circuit_history WHERE scope=? ORDER BY sequence ASC')
        .all('channel:channel-fault') as Array<{ kind: string; actor: string }>;
      assert.deepEqual(
        history.map((h) => h.kind),
        ['attempt', 'attempt', 'attempt', 'trip', 'rearm'],
      );
      assert.equal(history[4].actor, 'owner');
    } finally {
      store.close();
    }
  });
});
