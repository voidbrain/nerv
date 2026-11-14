import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { lifecyclePlan, lifecycleRecovery } from '../src/node-lifecycle.ts';
import { inspectLocalNode } from '../src/node-inspection.ts';
import { renderService } from '../src/service.ts';
const now = new Date('2026-11-10T09:00:00Z');
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
async function fixture(platform = 'darwin') {
  const inspection = await inspectLocalNode(
    async () =>
      JSON.stringify({
        version: 1,
        platform,
        arch: 'arm64',
        node: '24.1.0',
        hostname: 'fixture',
        userId: 501,
        userHome: '/Users/fixture',
        git: 'git version 2.47.0',
        npm: '11.1.0',
        base: { id: 'BASE-02', name: 'Harbor' },
        configured: true,
        runtime: 'not-checked',
      }),
    now,
  );
  return {
    inspection,
    action: 'install',
    checkout: '/Users/fixture/source',
    home: '/Users/fixture/data',
    node: '/opt/node/bin/node',
    revision: 'a'.repeat(40),
    additionalProfile: false,
    evidence: {
      current: { state: 'absent' },
      legacy: { state: 'absent' },
      session: 'available',
      registration: 'absent',
      runtime: 'stopped',
      profile: 'matching',
      source: 'clean',
      pending: 'none',
    },
  };
}
test('F-005 lifecycle joins exact service rendering to selected profile ownership on both Unix managers', async () => {
  for (const platform of ['darwin', 'linux']) {
    const input = await fixture(platform);
    const rendered = renderService(platform, input.home, input.checkout, input.node);
    assert.ok(
      rendered.includes('/Users/fixture/source/src/cli.ts'),
      'Unix target paths must remain Unix paths on a Windows controller',
    );
    assert.doesNotMatch(rendered, /\\/);
    const expected = sha(rendered);
    const install = lifecyclePlan(input, now);
    assert.deepEqual(install.blockers, []);
    assert.equal(install.expectedDefinitionDigest, expected);
    assert.equal(install.execution, 'adapter-not-implemented');
    const owned = { state: 'file', digest: expected, uid: 501, mode: 0o600 };
    for (const action of ['update', 'uninstall']) {
      const changed = {
        ...input,
        action,
        ...(action === 'update' ? { nextRevision: 'b'.repeat(40) } : {}),
        evidence: { ...input.evidence, current: owned, registration: 'matching' },
      };
      assert.deepEqual(lifecyclePlan(changed, now).blockers, []);
      for (const current of [
        { ...owned, uid: 502 },
        { ...owned, mode: 0o644 },
        { ...owned, digest: sha(renderService(platform, '/Users/fixture/other', input.checkout, input.node)) },
        { state: 'unknown' },
        { state: 'absent' },
      ]) {
        assert.ok(
          lifecyclePlan({ ...changed, evidence: { ...changed.evidence, current } }, now).blockers.some((x) =>
            x.includes('Existing definition'),
          ),
        );
      }
      assert.ok(lifecyclePlan({ ...changed, node: '/different/node' }, now).blockers.length);
    }
    assert.ok(install.steps.some((x) => x.includes('exclusively')));
    assert.ok(
      lifecyclePlan({ ...input, action: 'uninstall', evidence: { ...input.evidence, current: owned } }, now).steps.some(
        (x) => x.includes('retain checkout, data, keys and logs'),
      ),
    );
  }
});
test('F-005 lifecycle refuses second profiles, legacy replacement, unknown manager and unresolved operations', async () => {
  const input = await fixture();
  const cases = [
    { additionalProfile: true },
    ...[
      { legacy: { state: 'file', digest: 'c'.repeat(64), uid: 501, mode: 0o600 } },
      { legacy: { state: 'unknown' } },
      { current: { state: 'unknown' } },
      { registration: 'matching' },
      { registration: 'other' },
      { session: 'unknown' },
      { runtime: 'running' },
      { runtime: 'unknown' },
      { profile: 'other' },
      { source: 'dirty' },
      { pending: 'unresolved' },
    ].map((evidence) => ({ evidence: { ...input.evidence, ...evidence } })),
  ];
  for (const patch of cases)
    assert.ok(lifecyclePlan({ ...input, ...patch }, now).blockers.length, JSON.stringify(patch));
  const plan = lifecyclePlan(input, now);
  assert.deepEqual(plan, lifecyclePlan(input, now));
  assert.notEqual(plan.digest, lifecyclePlan({ ...input, home: '/Users/fixture/other' }, now).digest);
  assert.notEqual(
    plan.digest,
    lifecyclePlan({ ...input, evidence: { ...input.evidence, runtime: 'unknown' } }, now).digest,
  );
  assert.doesNotMatch(
    JSON.stringify(
      lifecyclePlan(
        { ...input, token: 'NEUTRAL_SECRET', evidence: { ...input.evidence, private: 'NEUTRAL_SECRET' } },
        now,
      ),
    ),
    /NEUTRAL_SECRET/,
  );
});
test('F-005 lifecycle validates source, freshness, canonical separate paths and supported adapter before any effect', async () => {
  const input = await fixture();
  for (const patch of [
    { checkout: '/Users/fixture/source/..' },
    { home: '/Users/fixture/source/data' },
    { home: '/Users/fixture/.nerv-bootstrap' },
    { home: '/etc/nerv' },
    { node: 'node' },
    { node: '/opt/\nnode' },
    { action: 'restart' },
    { action: 'update', nextRevision: 'main' },
    { nextRevision: 'b'.repeat(40) },
    { revision: 'main' },
    { additionalProfile: undefined },
    { evidence: { ...input.evidence, runtime: undefined } },
  ])
    assert.throws(() => lifecyclePlan({ ...input, ...patch }, now));
  assert.throws(() => lifecyclePlan(input, new Date(now.getTime() + 86400001)), /expire/);
  const windows = await inspectLocalNode(
    async () =>
      JSON.stringify({
        version: 1,
        platform: 'win32',
        arch: 'x64',
        node: '24.1.0',
        hostname: 'fixture',
        userId: null,
        userHome: 'C:\\Users\\fixture',
        git: null,
        npm: null,
        base: null,
        configured: false,
        runtime: 'not-checked',
      }),
    now,
  );
  assert.throws(() => lifecyclePlan({ ...input, inspection: windows }, now), /Task Scheduler/);
  const update = lifecyclePlan({ ...input, action: 'update', nextRevision: input.revision }, now);
  assert.ok(update.blockers.some((x) => x.includes('different')));
  assert.ok(update.steps.some((x) => x.includes('backup')));
  assert.ok(update.steps.some((x) => x.includes('never auto-downgraded')));
});
test('F-005 recovery retains uncertainty through timeout/lease expiry/PID-only evidence and fences stale release', () => {
  const receipt = {
    digest: 'a'.repeat(64),
    resource: 'user-service:501:darwin',
    fence: 7,
    nonce: 'b'.repeat(32),
    state: 'uncertain',
  };
  const confirmation = {
    ...receipt,
    handlerStopped: true,
    descendantsStopped: true,
    operatorConfirmed: true,
    reason: 'Observed handler and descendants exited; definition retained for reconciliation.',
  };
  for (const state of ['accepted', 'running', 'uncertain']) {
    const value = { ...receipt, state };
    assert.equal(
      lifecycleRecovery(value, { ...confirmation, handlerStopped: false, leaseExpired: true }).action,
      'retain',
    );
    assert.equal(
      lifecycleRecovery(value, { ...confirmation, descendantsStopped: false, handlerPid: 1234 }).action,
      'retain',
    );
    assert.equal(lifecycleRecovery(value, { ...confirmation, operatorConfirmed: false }).action, 'retain');
    const release = lifecycleRecovery(value, confirmation);
    assert.equal(release.action, 'release');
    assert.deepEqual(release.snapshot, value);
    assert.equal(receipt.state, 'uncertain', 'decision must not silently change a durable receipt');
    for (const patch of [
      { digest: 'c'.repeat(64) },
      { fence: 8 },
      { nonce: 'c'.repeat(32) },
      { resource: 'user-service:502:darwin' },
    ])
      assert.throws(() => lifecycleRecovery(value, { ...confirmation, ...patch }), /ownership changed/);
    for (const reason of ['', 'x'.repeat(501), 'line\nbreak'])
      assert.throws(() => lifecycleRecovery(value, { ...confirmation, reason }), /evidence/);
  }
  for (const state of ['completed', 'released'])
    assert.equal(lifecycleRecovery({ ...receipt, state }, {}).action, 'return-receipt');
  for (const patch of [{ fence: 0 }, { nonce: 'bad' }, { resource: 'user-service:0:darwin' }, { state: 'failed' }])
    assert.throws(() => lifecycleRecovery({ ...receipt, ...patch }, confirmation));
});

test('F-005 lifecycle CLI validates private file inputs without target commands, credentials or journal writes', async () => {
  const { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, statSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { nodesCommand } = await import('../src/nodes-cli.ts');
  const dir = mkdtempSync(join(tmpdir(), 'nerv-lifecycle-'));
  try {
    const input = await fixture();
    input.inspection = await inspectLocalNode(async () => JSON.stringify(input.inspection));
    const source = join(dir, 'input.json'),
      output = join(dir, 'output.json');
    writeFileSync(source, JSON.stringify(input));
    const runner = async () => {
      throw Error('Review commands must not invoke a target or service manager');
    };
    const result = (await nodesCommand(['lifecycle-plan', '--input', source], runner)) as {
      execution: string;
      blockers: string[];
    };
    assert.equal(result.execution, 'adapter-not-implemented');
    assert.deepEqual(result.blockers, []);
    await nodesCommand(['lifecycle-plan', '--input', source, '--out', output], runner);
    assert.equal(JSON.parse(readFileSync(output, 'utf8')).kind, 'review-only');
    if (process.platform !== 'win32') assert.equal(statSync(output).mode & 0o777, 0o600);
    await assert.rejects(nodesCommand(['lifecycle-plan', '--input', source, '--out', output], runner), /EEXIST/);
    await assert.rejects(
      nodesCommand(['lifecycle-plan', '--input', source, '--confirm', 'anything'], runner),
      /Invalid/,
    );
    const receipt = {
      digest: 'a'.repeat(64),
      resource: 'user-service:501:darwin',
      fence: 7,
      nonce: 'b'.repeat(32),
      state: 'uncertain',
    };
    const receiptFile = join(dir, 'receipt.json'),
      confirmation = join(dir, 'confirmation.json');
    writeFileSync(receiptFile, JSON.stringify(receipt));
    writeFileSync(
      confirmation,
      JSON.stringify({
        ...receipt,
        handlerStopped: true,
        descendantsStopped: true,
        operatorConfirmed: true,
        reason: 'Neutral stopped-process observation',
      }),
    );
    const before = readdirSync(dir);
    const check = (await nodesCommand(
      ['lifecycle-recovery-check', '--receipt', receiptFile, '--evidence', confirmation],
      runner,
    )) as { execution: string; decision: { action: string } };
    assert.equal(check.execution, 'none');
    assert.equal(check.decision.action, 'release');
    assert.deepEqual(JSON.parse(readFileSync(receiptFile, 'utf8')), receipt);
    assert.deepEqual(readdirSync(dir), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('F-005: Unix lifecycle ownership bytes remain portable under Windows controller path rules', async () => {
  const { spawnSync } = await import('node:child_process');
  // Isolate the controller path substitution: never patch built-ins in the test worker.
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import assert from 'node:assert/strict';
    import path from 'node:path';
    import {syncBuiltinESMExports} from 'node:module';
    import {renderService} from './src/service.ts';
    path.join=path.win32.join;syncBuiltinESMExports();
    for(const platform of ['darwin','linux']) {
      const rendered=renderService(platform,'/Users/fixture/data','/Users/fixture/source','/opt/node/bin/node');
      assert.ok(rendered.includes('/Users/fixture/source/src/cli.ts'),'target paths must not use controller separators');
      assert.ok(!rendered.includes(String.fromCharCode(92)),'canonical Unix definition must contain no Windows separators');
    }
  `,
    ],
    { encoding: 'utf8', timeout: 5000 },
  );
  assert.equal(result.status, 0, result.stderr);
});

test('B-064: nodes lifecycle-inspect names a missing data home and unsupported platform instead of raw ENOENT', async () => {
  const { nodesCommand } = await import('../src/nodes-cli.ts');
  const dir = mkdtempSync(join(tmpdir(), 'nerv-b064-'));
  const prevHome = process.env.HOME;
  const prevProfile = process.env.USERPROFILE;
  const prevNervHome = process.env.NERV_HOME;
  const expectedHome = join(dir, '.nerv');
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  delete process.env.NERV_HOME;
  try {
    await assert.rejects(nodesCommand(['lifecycle-inspect', '--action', 'install']), (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(!err.message.includes('ENOENT'), `unexpected raw ENOENT: ${err.message}`);
      assert.ok(err.message.includes(expectedHome), `missing data home path in: ${err.message}`);
      assert.match(err.message, /nothing was changed/i);
      return true;
    });

    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'freebsd', configurable: true });
    try {
      await assert.rejects(nodesCommand(['lifecycle-inspect', '--action', 'install']), (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /macOS, Linux, and Windows/i);
        assert.match(err.message, /nothing was changed/i);
        return true;
      });
    } finally {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  } finally {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevProfile;
    if (prevNervHome !== undefined) process.env.NERV_HOME = prevNervHome;
    rmSync(dir, { recursive: true, force: true });
  }
});
