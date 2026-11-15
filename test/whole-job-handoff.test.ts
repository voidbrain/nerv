import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { WholeJobHandoffStore } from '../src/whole-job-handoff.ts';

describe('whole-job handoff receipt-bound reconciliation (F-050-T02)', () => {
  const baseInput = {
    jobId: 'job-001',
    targetBase: 'TABGHA',
    selectionReason: 'capability' as const,
    args: { task: 'render-3d', asset: 'fixture-a' },
    mainScrollFloorDigest: 'scroll-digest-v1',
    targetScrollFloorDigest: 'scroll-digest-v1',
    resourceLock: 'gpu:tabgha-0',
  };

  it('refuses retry or reassignment on lost reply, restart, or sleeping base until receipt reconciles', () => {
    const db = new DatabaseSync(':memory:');
    let store = new WholeJobHandoffStore(db);

    const first = store.dispatch(baseInput);
    assert.equal(first.allowed, true);
    assert.equal(first.record.state, 'accepted');
    assert.equal(store.isResourceLocked('gpu:tabgha-0'), true);

    // Lost reply marks the handoff uncertain and preserves the resource lock.
    const uncertain = store.markUncertain('job-001', 'lost-reply');
    assert.equal(uncertain.state, 'uncertain');
    assert.equal(store.isResourceLocked('gpu:tabgha-0'), true);

    // Simulate main-base restart: new store instance on the same SQLite DB.
    store = new WholeJobHandoffStore(db);
    const retrySame = store.dispatch(baseInput);
    assert.equal(retrySame.allowed, false);
    assert.equal(retrySame.record.attempts, 1);

    const reassignOther = store.dispatch({ ...baseInput, targetBase: 'MATSUSHIRO' });
    assert.equal(reassignOther.allowed, false);
    assert.equal(reassignOther.record.targetBase, 'TABGHA');

    // Sleeping base / still running receipt keeps the job uncertain and locked.
    const stillRunning = store.reconcileReceipt('job-001', {
      base: 'TABGHA',
      status: 'running',
      receiptDigest: 'rcpt-1',
    });
    assert.equal(stillRunning.state, 'uncertain');
    assert.equal(store.isResourceLocked('gpu:tabgha-0'), true);
    assert.equal(store.dispatch({ ...baseInput, targetBase: 'MATSUSHIRO' }).allowed, false);

    // Completing via receipt from the assigned base releases the lock and prevents duplicate replay.
    const done = store.reconcileReceipt('job-001', {
      base: 'TABGHA',
      status: 'completed',
      receiptDigest: 'rcpt-2',
      result: { ok: true },
    });
    assert.equal(done.state, 'completed');
    assert.equal(store.isResourceLocked('gpu:tabgha-0'), false);
    assert.equal(store.dispatch(baseInput).allowed, false);
  });

  it('allows retry or reassignment only after a reconciled not-started receipt', () => {
    const db = new DatabaseSync(':memory:');
    const store = new WholeJobHandoffStore(db);

    store.dispatch(baseInput);
    store.markUncertain('job-001', 'sleeping-base');

    // Another base cannot spoof reconciliation.
    assert.throws(
      () =>
        store.reconcileReceipt('job-001', {
          base: 'MATSUSHIRO',
          status: 'not-started',
          receiptDigest: 'rcpt-spoof',
        }),
      /cannot reconcile/,
    );

    const notStarted = store.reconcileReceipt('job-001', {
      base: 'TABGHA',
      status: 'not-started',
      receiptDigest: 'rcpt-never-ran',
    });
    assert.equal(notStarted.state, 'not-started');
    assert.equal(store.isResourceLocked('gpu:tabgha-0'), false);

    const reassigned = store.dispatch({ ...baseInput, targetBase: 'MATSUSHIRO' });
    assert.equal(reassigned.allowed, true);
    assert.equal(reassigned.record.targetBase, 'MATSUSHIRO');
    assert.equal(reassigned.record.attempts, 2);
  });

  it('enforces Scroll privacy/floor and F-048 load-based forwarding acceptance', () => {
    const db = new DatabaseSync(':memory:');
    const store = new WholeJobHandoffStore(db);

    assert.throws(() => store.dispatch({ ...baseInput, containsLocalOnlyOrTainted: true }), /local-only or tainted/);
    assert.throws(() => store.dispatch({ ...baseInput, targetScrollFloorDigest: 'looser-scroll' }), /looser/);
    assert.throws(() => store.dispatch({ ...baseInput, selectionReason: 'load' }), /F-048 acceptance/);

    const loadOk = store.dispatch({
      ...baseInput,
      jobId: 'job-load-1',
      selectionReason: 'load',
      loadForwardingAccepted: true,
    });
    assert.equal(loadOk.allowed, true);
    assert.equal(loadOk.record.selectionReason, 'load');
  });
});
