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
