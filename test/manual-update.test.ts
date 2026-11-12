import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { executeManualUpdate } from '../src/manual-update.ts';
import { UPGRADE_CONTRACT } from '../src/upgrade-contract.ts';
import type { ServiceHost, ServicePlan, ServiceReceipt } from '../src/node-lifecycle-execution.ts';
import type { UpdateAvailability } from '../src/update-availability.ts';
import { makeServer } from '../src/server.ts';
import { Store } from '../src/store.ts';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const NOW = '2026-11-12T20:00:00.000Z';

const makeAvailability = (
  status: UpdateAvailability['status'],
  availableRevision: string | null = B,
): UpdateAvailability => ({
  version: 1,
  channel: 'main',
  installedRevision: A,
  runningRevision: A,
  availableRevision,
  status,
  updateAvailable: status === 'update-available',
  restartRequired: false,
  checkedAt: NOW,
  ...(status === 'offline' ? { reason: 'Network unreachable.' } : {}),
});

const stubHost: ServiceHost = {
  context: {
    userHome: '/Users/tester',
    home: '/Users/tester/.nerv',
    source: '/Users/tester/nerv',
    node: '/usr/local/bin/node',
    uid: 501,
  },
  inspect: async () => ({
    revision: A,
    schema: 3,
    profile: 'default',
    definition: 'owned',
    registration: 'owned',
    runtime: 'owned',
    pids: [101],
    session: true,
    clean: true,
    legacy: false,
    pending: false,
    built: true,
  }),
  command: async () => {},
  compatible: async () => true,
  backup: async () => {},
  rehearse: async () => ({
    version: 1,
    execution: 'rehearsal-only',
    contract: UPGRADE_CONTRACT,
    source: { digest: 's'.repeat(64), schema: 3 },
    result: { schema: 3, forwardOnly: false, tables: 1, rows: 0, rowsAfter: 0 },
    blockers: [],
    note: 'stub',
  }),
};

const makePlan = (blockers: string[] = []): ServicePlan => ({
  version: 1,
  kind: 'mac-service',
  action: 'update',
  context: stubHost.context,
  before: {
    revision: A,
    schema: 3,
    profile: 'default',
    definition: 'owned',
    registration: 'owned',
    runtime: 'owned',
    pids: [101],
    session: true,
    clean: true,
    legacy: false,
    pending: false,
    built: true,
  },
  nextRevision: B,
  handler: 'h'.repeat(64),
  nonce: 'n'.repeat(32),
  created: NOW,
  blockers,
  digest: 'd'.repeat(64),
});

const makeReceipt = (state: ServiceReceipt['state'], extra: Partial<ServiceReceipt> = {}): ServiceReceipt => ({
  digest: 'd'.repeat(64),
  resource: 'user-service:501:darwin',
  fence: 1,
  nonce: 'n'.repeat(32),
  pid: 101,
  identity: 'id',
  state,
  steps: ['backup:completed'],
  ...extra,
});

test('F-005-T17: executeManualUpdate refuses when no update is available and never invokes lifecycle host', async () => {
  let hostCalled = false;
  const result = await executeManualUpdate({
    resolveUpdate: async () => makeAvailability('up-to-date', A),
    lifecycleHost: () => {
      hostCalled = true;
      return stubHost;
    },
  });
  assert.equal(hostCalled, false);
  assert.equal(result.outcome, 'refused');
  assert.equal(result.revision, null);
  assert.match(result.reasons[0] ?? '', /Already running the latest revision/);
  assert.ok(result.recovery.length > 0);
});

test('F-005-T17: executeManualUpdate surfaces plan blockers, rehearsal refusals, uncertain recovery and completion', async () => {
  const blocked = await executeManualUpdate({
    resolveUpdate: async () => makeAvailability('update-available', B),
    lifecycleHost: () => stubHost,
    plan: async () => makePlan(['Service prerequisites are not satisfied.']),
    applyPlan: async () => {
      throw new Error('should not apply blocked plan');
    },
  });
  assert.equal(blocked.outcome, 'refused');
  assert.equal(blocked.planDigest, 'd'.repeat(64));
  assert.deepEqual(blocked.reasons, ['Service prerequisites are not satisfied.']);
  assert.ok(blocked.recovery.length > 0);

  const rehearsedRefusal = await executeManualUpdate({
    resolveUpdate: async () => makeAvailability('update-available', B),
    lifecycleHost: () => stubHost,
    plan: async () => makePlan([]),
    applyPlan: async () =>
      makeReceipt('refused', {
        rehearsal: {
          source: { digest: 's'.repeat(64), schema: 3 },
          result: { schema: 4, forwardOnly: true, tables: 1, rows: 0, rowsAfter: 0 },
          blockers: ['Forward migrations are not admitted until their recovery exists.'],
        },
      }),
  });
  assert.equal(rehearsedRefusal.outcome, 'refused');
  assert.deepEqual(rehearsedRefusal.reasons, ['Forward migrations are not admitted until their recovery exists.']);
  assert.ok(rehearsedRefusal.recovery[0]?.includes('unchanged'));

  const uncertain = await executeManualUpdate({
    resolveUpdate: async () => makeAvailability('update-available', B),
    lifecycleHost: () => stubHost,
    plan: async () => makePlan([]),
    applyPlan: async () => {
      throw new Error('Post-start health check failed.');
    },
    readReceipt: () =>
      makeReceipt('uncertain', {
        recovery: ['1. Stop candidate service.', '2. Release lock and restore previous revision.'],
      }),
  });
  assert.equal(uncertain.outcome, 'uncertain');
  assert.deepEqual(uncertain.reasons, ['Post-start health check failed.']);
  assert.deepEqual(uncertain.recovery, [
    '1. Stop candidate service.',
    '2. Release lock and restore previous revision.',
  ]);

  const completed = await executeManualUpdate({
    resolveUpdate: async () => makeAvailability('update-available', B),
    lifecycleHost: () => stubHost,
    plan: async () => makePlan([]),
    applyPlan: async () => makeReceipt('completed'),
  });
  assert.equal(completed.outcome, 'completed');
  assert.equal(completed.revision, B);
  assert.deepEqual(completed.reasons, []);
  assert.deepEqual(completed.recovery, []);
  assert.equal(completed.receipt?.state, 'completed');
});

test('F-005-T17: POST /api/update/apply enforces admin auth and returns manual update outcome', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-manual-update-api-'));
  const db = new DatabaseSync(join(dir, 'nerv.sqlite'));
  db.close();
  const store = new Store(join(dir, 'nerv.sqlite'));
  const token = 't'.repeat(32);
  const server = makeServer(store, token, {
    updateCheck: async () => makeAvailability('offline', null),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const unauth = await fetch(`${baseUrl}/api/update/apply`, { method: 'POST', body: '{}' });
    assert.equal(unauth.status, 401);

    const badParam = await fetch(`${baseUrl}/api/update/apply`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ unknown: true }),
    });
    assert.equal(badParam.status, 400);

    const offlineRefusal = await fetch(`${baseUrl}/api/update/apply`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ channel: 'main' }),
    });
    assert.equal(offlineRefusal.status, 200);
    const body = (await offlineRefusal.json()) as {
      outcome: string;
      reasons: string[];
      recovery: string[];
    };
    assert.equal(body.outcome, 'refused');
    assert.match(body.reasons[0] ?? '', /Update check offline/);
    assert.ok(body.recovery.length > 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('F-005-T17: dashboard live.js exposes manual update action with refusals and recovery', () => {
  const live = readFileSync(new URL('../web/public/dashboard/live.js', import.meta.url), 'utf8');
  assert.match(live, /btn-apply-update/);
  assert.match(live, /update\/apply/);
  assert.match(live, /mu\.reasons/);
  assert.match(live, /mu\.recovery/);
});
