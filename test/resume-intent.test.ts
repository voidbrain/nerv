import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { readScrolls } from '../src/config.ts';
import { Store } from '../src/store.ts';
import { runResumeEngineTick } from '../src/resume-intent.ts';

function openTempStore(dir: string): Store {
  return new Store(join(dir, 'nerv.db'), readScrolls(dir), { home: dir });
}

describe('F-012-T01: durable resume intent and policy', () => {
  it('persists target, permission scope, reset time, expiry, and attempts across restarts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nerv-resume-intent-'));
    try {
      const base = 1_760_000_000_000;
      const store1 = openTempStore(dir);
      const created = store1.resumeIntents.create({
        id: 'ri-persist-1',
        targetKind: 'vscode-claude',
        targetId: 'job-alpha-01',
        targetWorker: 'NERV-01',
        targetFingerprint: 'sha256:abc123',
        permissionScope: {
          allowedAction: 'resume-named-job',
          targetId: 'job-alpha-01',
          allowSecurityPrompts: false,
          allowLimitBypass: false,
          modelOverrideBlocked: true,
          grantedBy: 'owner',
        },
        resetAt: base + 10_000,
        expiresAt: base + 120_000,
        maxAttempts: 3,
        backoffMs: 5_000,
        now: base,
      });
      assert.equal(created.status, 'pending');
      assert.equal(created.attempts, 0);
      assert.deepEqual(store1.resumeIntents.due(base + 5_000), []);

      const leased = store1.resumeIntents.claimLease('ri-persist-1', 'NERV-01', 15_000, base + 10_000);
      assert.ok(leased);
      assert.equal(leased.status, 'leased');
      assert.equal(leased.attempts, 1);
      assert.equal(store1.resumeIntents.claimLease('ri-persist-1', 'NERV-02', 15_000, base + 11_000), null);

      const deferred = store1.resumeIntents.recordAttemptOutcome(
        'ri-persist-1',
        { kind: 'deferred', reason: 'provider limit extended', nextResetAt: base + 30_000 },
        base + 12_000,
      );
      assert.equal(deferred.status, 'pending');
      assert.equal(deferred.nextAttemptAt, base + 30_000);
      store1.close();

      // Reopen store to verify durability across restart
      const store2 = openTempStore(dir);
      const reloaded = store2.resumeIntents.get('ri-persist-1');
      assert.ok(reloaded);
      assert.equal(reloaded.targetKind, 'vscode-claude');
      assert.equal(reloaded.targetId, 'job-alpha-01');
      assert.equal(reloaded.targetWorker, 'NERV-01');
      assert.equal(reloaded.targetFingerprint, 'sha256:abc123');
      assert.equal(reloaded.permissionScope.grantedBy, 'owner');
      assert.equal(reloaded.permissionScope.modelOverrideBlocked, true);
      assert.equal(reloaded.resetAt, base + 10_000);
      assert.equal(reloaded.expiresAt, base + 120_000);
      assert.equal(reloaded.attempts, 1);
      assert.equal(reloaded.nextAttemptAt, base + 30_000);

      assert.equal(store2.resumeIntents.due(base + 30_000).length, 1);
      const leased2 = store2.resumeIntents.claimLease('ri-persist-1', 'NERV-01', 15_000, base + 30_000);
      assert.ok(leased2);
      assert.equal(leased2.attempts, 2);
      const resumed = store2.resumeIntents.recordAttemptOutcome(
        'ri-persist-1',
        { kind: 'resumed', detail: { ack: 'ok' } },
        base + 31_000,
      );
      assert.equal(resumed.status, 'resumed');
      assert.throws(() => store2.resumeIntents.cancel('ri-persist-1', 'too late', base + 32_000));
      store2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('enforces permission scope boundaries, bounded retries, expiry, and cancellation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nerv-resume-policy-'));
    try {
      const base = 1_760_000_000_000;
      const store = openTempStore(dir);

      assert.throws(() =>
        store.resumeIntents.create({
          targetKind: 'web-chat',
          targetId: 'chat-1',
          targetFingerprint: 'fp-1',
          permissionScope: {
            allowedAction: 'resume-named-job',
            targetId: 'chat-1',
            allowSecurityPrompts: false,
            allowLimitBypass: false,
            modelOverrideBlocked: true,
            grantedBy: 'model' as unknown as 'owner',
          },
          resetAt: base + 1_000,
          expiresAt: base + 10_000,
          now: base,
        }),
      );

      assert.throws(() =>
        store.resumeIntents.create({
          targetKind: 'web-chat',
          targetId: 'chat-1',
          targetFingerprint: 'fp-1',
          permissionScope: {
            allowedAction: 'resume-named-job',
            targetId: 'chat-1',
            allowSecurityPrompts: true as unknown as false,
            allowLimitBypass: false,
            modelOverrideBlocked: true,
            grantedBy: 'owner',
          },
          resetAt: base + 1_000,
          expiresAt: base + 10_000,
          now: base,
        }),
      );

      assert.throws(() =>
        store.resumeIntents.create({
          targetKind: 'cli-job',
          targetId: 'cli-1',
          targetFingerprint: 'fp-2',
          permissionScope: {
            allowedAction: 'resume-named-job',
            targetId: 'cli-1',
            allowSecurityPrompts: false,
            allowLimitBypass: false,
            modelOverrideBlocked: true,
            grantedBy: 'policy',
          },
          resetAt: base + 10_000,
          expiresAt: base + 5_000,
          now: base,
        }),
      );

      const toCancel = store.resumeIntents.create({
        id: 'ri-cancel-1',
        targetKind: 'web-chat',
        targetId: 'chat-2',
        targetFingerprint: 'fp-cancel',
        permissionScope: {
          allowedAction: 'resume-named-job',
          targetId: 'chat-2',
          allowSecurityPrompts: false,
          allowLimitBypass: false,
          modelOverrideBlocked: true,
          grantedBy: 'owner',
        },
        resetAt: base + 5_000,
        expiresAt: base + 50_000,
        now: base,
      });
      const cancelled = store.resumeIntents.cancel(toCancel.id, 'owner aborted', base + 1_000);
      assert.equal(cancelled.status, 'cancelled');
      assert.equal(cancelled.cancelReason, 'owner aborted');
      assert.equal(store.resumeIntents.claimLease(toCancel.id, 'NERV-01', 10_000, base + 6_000), null);

      const toExpire = store.resumeIntents.create({
        id: 'ri-expire-1',
        targetKind: 'worker-job',
        targetId: 'job-99',
        targetFingerprint: 'fp-expire',
        permissionScope: {
          allowedAction: 'resume-named-job',
          targetId: 'job-99',
          allowSecurityPrompts: false,
          allowLimitBypass: false,
          modelOverrideBlocked: true,
          grantedBy: 'policy',
        },
        resetAt: base + 5_000,
        expiresAt: base + 20_000,
        now: base,
      });
      assert.equal(store.resumeIntents.expireStale(base + 20_000), 1);
      assert.equal(store.resumeIntents.get(toExpire.id)?.status, 'expired');
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('F-012-T02: inspects availability, rechecks identity, resumes once under lease, and notifies outcome', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nerv-resume-engine-'));
    try {
      const store = new Store(join(dir, 'nerv.sqlite'));
      const base = 1_800_000_000_000;
      const scope = (targetId: string) => ({
        allowedAction: 'resume-named-job' as const,
        targetId,
        allowSecurityPrompts: false as const,
        allowLimitBypass: false as const,
        modelOverrideBlocked: true as const,
        grantedBy: 'owner' as const,
      });

      const deferredIntent = store.resumeIntents.create({
        id: 'ri-defer',
        targetKind: 'cli-job',
        targetId: 'job-defer',
        targetFingerprint: 'fp-defer',
        permissionScope: scope('job-defer'),
        resetAt: base + 1_000,
        expiresAt: base + 100_000,
        backoffMs: 5_000,
        now: base,
      });

      const mismatchIntent = store.resumeIntents.create({
        id: 'ri-mismatch',
        targetKind: 'web-chat',
        targetId: 'chat-mismatch',
        targetFingerprint: 'fp-expected',
        permissionScope: scope('chat-mismatch'),
        resetAt: base + 1_000,
        expiresAt: base + 100_000,
        now: base,
      });

      const okIntent = store.resumeIntents.create({
        id: 'ri-ok',
        targetKind: 'vscode-claude',
        targetId: 'claude-42',
        targetFingerprint: 'fp-42',
        permissionScope: scope('claude-42'),
        resetAt: base + 1_000,
        expiresAt: base + 100_000,
        now: base,
      });

      const executed: string[] = [];
      const notices: string[] = [];
      const result = await runResumeEngineTick(store.resumeIntents, {
        owner: 'worker-1',
        now: base + 2_000,
        checkAvailability: (intent) =>
          intent.id === deferredIntent.id
            ? { available: false, reason: 'Provider still rate-limited' }
            : { available: true },
        verifyIdentity: (intent) =>
          intent.id === mismatchIntent.id
            ? { targetId: 'chat-mismatch', targetFingerprint: 'fp-changed', stillActive: true }
            : { targetId: intent.targetId, targetFingerprint: intent.targetFingerprint, stillActive: true },
        executeResume: (intent) => {
          executed.push(intent.id);
          return { kind: 'resumed', detail: { resumedBy: 'worker-1' } };
        },
        notifyOutcome: (_intent, message) => {
          notices.push(message);
        },
      });

      assert.equal(result.processed.length, 3);
      assert.deepEqual(executed, [okIntent.id]);
      assert.equal(store.resumeIntents.get(deferredIntent.id)?.status, 'pending');
      assert.equal(store.resumeIntents.get(mismatchIntent.id)?.status, 'failed');
      assert.equal(store.resumeIntents.get(okIntent.id)?.status, 'resumed');
      assert.equal(notices.length, 3);
      assert.match(notices[2]!, /Resumed vscode-claude claude-42/);

      // Second tick at the same deadline must not re-run okIntent (once-only under lease/status).
      const second = await runResumeEngineTick(store.resumeIntents, {
        owner: 'worker-2',
        now: base + 2_500,
        checkAvailability: () => ({ available: true }),
        verifyIdentity: (intent) => ({ targetId: intent.targetId, targetFingerprint: intent.targetFingerprint }),
        executeResume: (intent) => {
          executed.push(intent.id);
          return { kind: 'resumed' };
        },
      });
      assert.equal(second.processed.length, 0);
      assert.deepEqual(executed, [okIntent.id]);

      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
