import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readConfig, setUpdatePolicy } from '../src/config.ts';
import { UPGRADE_CONTRACT } from '../src/upgrade-contract.ts';
import type { ServiceHost, ServicePlan, ServiceReceipt } from '../src/node-lifecycle-execution.ts';
import type { UpdateAvailability } from '../src/update-availability.ts';
import {
  defaultAutoUpdatePolicy,
  evaluateAutoUpdate,
  validateAutoUpdatePolicy,
  type AutoUpdatePolicy,
} from '../src/update-policy.ts';
import { makeServer } from '../src/server.ts';
import { Store } from '../src/store.ts';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const NOW = '2026-11-12T20:00:00.000Z';

const makeAvailability = (
  status: UpdateAvailability['status'] = 'update-available',
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

const makeReceipt = (state: ServiceReceipt['state'] = 'completed'): ServiceReceipt => ({
  digest: 'd'.repeat(64),
  resource: 'user-service:501:darwin',
  fence: 1,
  nonce: 'n'.repeat(32),
  pid: 101,
  identity: 'id',
  state,
  steps: ['backup:completed'],
  ...(state === 'completed' ? {} : { recovery: ['Run `nerv doctor` before retrying.'] }),
});

test('auto-update policy defaults to off and skips evaluation when disabled', async () => {
  const policy = defaultAutoUpdatePolicy();
  assert.deepEqual(policy, { enabled: false, channels: [], targets: [] });

  let checked = false;
  const result = await evaluateAutoUpdate(
    {
      resolveUpdate: async () => {
        checked = true;
        return makeAvailability();
      },
    },
    { policy, target: 'NERV-01', channel: 'main' },
  );
  assert.equal(checked, false);
  assert.equal(result.outcome, 'skipped');
  assert.equal(result.enabled, false);
  assert.match(result.reasons[0] ?? '', /off by default|disabled/i);
  assert.ok(result.recovery.length > 0);
});

test('validateAutoUpdatePolicy and setUpdatePolicy enforce opt-in selections and persist to config.json', () => {
  assert.throws(
    () => validateAutoUpdatePolicy({ enabled: true, channels: [], targets: ['NERV-01'] }),
    /opted-in channel/i,
  );
  assert.throws(() => validateAutoUpdatePolicy({ enabled: true, channels: ['main'], targets: [] }), /opted-in target/i);
  assert.throws(
    () => validateAutoUpdatePolicy({ enabled: false, channels: [], targets: [], extra: 1 }),
    /Unsupported updatePolicy field/i,
  );

  const dir = mkdtempSync(join(tmpdir(), 'nerv-update-policy-'));
  try {
    const saved = setUpdatePolicy(dir, {
      enabled: true,
      channels: ['main', 'main'],
      targets: ['NERV-01', 'NERV-01'],
      acceptedAt: NOW,
    });
    assert.deepEqual(saved, {
      enabled: true,
      channels: ['main'],
      targets: ['NERV-01'],
      acceptedAt: NOW,
    });
    assert.deepEqual(readConfig(dir).updatePolicy, saved);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('evaluateAutoUpdate refuses unopted channels/targets, active runs, pending approvals, and schema downgrades', async () => {
  const policy: AutoUpdatePolicy = {
    enabled: true,
    channels: ['main'],
    targets: ['NERV-01'],
    acceptedAt: NOW,
  };

  const wrongChannel = await evaluateAutoUpdate(
    { resolveUpdate: async () => makeAvailability() },
    { policy: { ...policy, channels: [] }, target: 'NERV-01', channel: 'main' },
  );
  assert.equal(wrongChannel.outcome, 'refused');
  assert.match(wrongChannel.reasons[0] ?? '', /not opted in/i);

  const wrongTarget = await evaluateAutoUpdate(
    { resolveUpdate: async () => makeAvailability() },
    { policy, target: 'NERV-02', channel: 'main' },
  );
  assert.equal(wrongTarget.outcome, 'refused');
  assert.match(wrongTarget.reasons[0] ?? '', /not opted in/i);

  const activeRun = await evaluateAutoUpdate(
    {
      resolveUpdate: async () => makeAvailability(),
      countActiveRuns: () => 2,
    },
    { policy, target: 'NERV-01', channel: 'main' },
  );
  assert.equal(activeRun.outcome, 'refused');
  assert.match(activeRun.reasons[0] ?? '', /active run/i);

  const pendingApproval = await evaluateAutoUpdate(
    {
      resolveUpdate: async () => makeAvailability(),
      countActiveRuns: () => 0,
      countPendingApprovals: () => 1,
    },
    { policy, target: 'NERV-01', channel: 'main' },
  );
  assert.equal(pendingApproval.outcome, 'refused');
  assert.match(pendingApproval.reasons[0] ?? '', /pending approval/i);

  const schemaUnsafe = await evaluateAutoUpdate(
    {
      resolveUpdate: async () => makeAvailability(),
      checkSchemaSafety: () => ({
        safe: false,
        reason: 'Refused: target schema 2 would downgrade current schema 3.',
        recovery: ['Keep schema >= 3 or update manually.'],
      }),
    },
    { policy, target: 'NERV-01', channel: 'main' },
  );
  assert.equal(schemaUnsafe.outcome, 'refused');
  assert.match(schemaUnsafe.reasons[0] ?? '', /downgrade/i);
  assert.deepEqual(schemaUnsafe.recovery, ['Keep schema >= 3 or update manually.']);
});

test('evaluateAutoUpdate delegates opted-in idle target through fenced lifecycle update and surfaces uncertain recovery', async () => {
  const policy: AutoUpdatePolicy = {
    enabled: true,
    channels: ['main'],
    targets: ['NERV-01'],
    acceptedAt: NOW,
  };
  let appliedConfirm = '';
  const completed = await evaluateAutoUpdate(
    {
      resolveUpdate: async () => makeAvailability(),
      lifecycleHost: () => stubHost,
      plan: async () => makePlan(),
      applyPlan: async (_host, plan, confirm) => {
        appliedConfirm = confirm;
        assert.equal(plan.digest, 'd'.repeat(64));
        return makeReceipt('completed');
      },
      countActiveRuns: () => 0,
      countPendingApprovals: () => 0,
    },
    { policy, target: 'NERV-01', channel: 'main' },
  );
  assert.equal(completed.outcome, 'completed');
  assert.equal(appliedConfirm, 'd'.repeat(64));
  assert.equal(completed.planDigest, 'd'.repeat(64));
  assert.equal(completed.receipt?.state, 'completed');

  const uncertain = await evaluateAutoUpdate(
    {
      resolveUpdate: async () => makeAvailability(),
      lifecycleHost: () => stubHost,
      plan: async () => makePlan(),
      applyPlan: async () => {
        throw new Error('launchctl kickstart failed');
      },
      readReceipt: () => ({ state: 'absent' }),
    },
    { policy, target: 'NERV-01', channel: 'main' },
  );
  assert.equal(uncertain.outcome, 'uncertain');
  assert.match(uncertain.reasons[0] ?? '', /launchctl kickstart failed/);
  assert.ok(uncertain.recovery.length > 0);
});

test('server /api/update/policy and /api/update/auto enforce auth, opt-in policy, and active-run protection', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-srv-update-policy-'));
  const dbPath = join(dir, 'nerv.db');
  const store = new Store(dbPath);
  const token = 't'.repeat(24);
  let policyState: AutoUpdatePolicy = defaultAutoUpdatePolicy();

  const server = makeServer(store, token, {
    base: { id: 'NERV-01', name: 'Neo Tokyo-3' },
    updatePolicy: policyState,
    saveUpdatePolicy: (next) => {
      policyState = next;
      return policyState;
    },
    updateCheck: async () => makeAvailability('update-available', B),
    lifecycleHost: () => stubHost,
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  try {
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Expected TCP server address.');
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    // Unconfigured / off-by-default check
    const initial = await fetch(`${baseUrl}/api/update/policy`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(initial.status, 200);
    const initialJson = (await initial.json()) as { policy: AutoUpdatePolicy };
    assert.equal(initialJson.policy.enabled, false);

    // Mint a login code -> read-only session cookie? Let's test client read-only via POST /api/update/policy rejection if no admin, or 401 without token
    const unauth = await fetch(`${baseUrl}/api/update/policy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, channels: ['main'], targets: ['NERV-01'] }),
    });
    assert.equal(unauth.status, 401);

    // Enable policy as admin
    const enabledRes = await fetch(`${baseUrl}/api/update/policy`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, channels: ['main'], targets: ['NERV-01'] }),
    });
    assert.equal(enabledRes.status, 200);
    const enabledJson = (await enabledRes.json()) as { policy: AutoUpdatePolicy };
    assert.equal(enabledJson.policy.enabled, true);
    assert.ok(enabledJson.policy.acceptedAt);

    // Insert an active sortie in SQLite -> auto-update must refuse without interrupting it
    const db = new DatabaseSync(dbPath);
    try {
      db.prepare(
        "INSERT INTO sorties(id,source,title,trust,status,created,closed) VALUES('s-active','chat','running task','owner','running',?,NULL)",
      ).run(NOW);
    } finally {
      db.close();
    }

    const blockedRes = await fetch(`${baseUrl}/api/update/auto`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'NERV-01', channel: 'main' }),
    });
    assert.equal(blockedRes.status, 200);
    const blockedJson = (await blockedRes.json()) as { outcome: string; reasons: string[] };
    assert.equal(blockedJson.outcome, 'refused');
    assert.match(blockedJson.reasons[0] ?? '', /active run/i);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
