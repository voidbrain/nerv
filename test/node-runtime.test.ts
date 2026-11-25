import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  activateManagedNodeRuntime,
  classifyNodeOwnership,
  managedNodeRoot,
  planNodeRuntime,
  readManagedNodeState,
  recoverManagedNodeRuntime,
} from '../src/node-runtime.ts';
import { nodesCommand } from '../src/nodes-cli.ts';

function makeEnv() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'nerv-node-runtime-')));
  const home = join(dir, 'home');
  const source = join(dir, 'source');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  mkdirSync(source, { recursive: true, mode: 0o700 });
  writeFileSync(join(source, 'package.json'), JSON.stringify({ name: 'nerv-agency', engines: { node: '>=24.0.0' } }));
  return { dir, home, source, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('F-005-T19: classifyNodeOwnership distinguishes nerv-managed, user-managed, missing and unknown', () => {
  const env = makeEnv();
  try {
    const userNode = join(env.dir, 'user-node');
    writeFileSync(userNode, 'user', { mode: 0o700 });
    assert.equal(classifyNodeOwnership(userNode, env.home), 'user-managed');

    const managedNode = join(managedNodeRoot(env.home), 'v24.0.0', 'bin', 'node');
    mkdirSync(join(managedNodeRoot(env.home), 'v24.0.0', 'bin'), { recursive: true, mode: 0o700 });
    writeFileSync(managedNode, 'managed', { mode: 0o700 });
    assert.equal(classifyNodeOwnership(managedNode, env.home), 'nerv-managed');

    assert.equal(classifyNodeOwnership(join(env.dir, 'absent-node'), env.home), 'missing');
    assert.equal(classifyNodeOwnership(null, env.home), 'missing');

    if (process.platform !== 'win32') {
      const linked = join(env.dir, 'linked-node');
      symlinkSync(userNode, linked);
      assert.equal(classifyNodeOwnership(linked, env.home), 'unknown');

      chmodSync(userNode, 0o600);
      assert.equal(classifyNodeOwnership(userNode, env.home), 'unknown');
    }
  } finally {
    env.cleanup();
  }
});

test('F-005-T19: planNodeRuntime presents explicit choices and never replaces a user-managed runtime silently', async () => {
  const env = makeEnv();
  try {
    const userNode = join(env.dir, 'user-node');
    writeFileSync(userNode, 'user', { mode: 0o700 });

    const outdatedUser = await planNodeRuntime(
      { home: env.home, source: env.source, nodePath: userNode },
      async () => ({ status: 0, out: 'v22.11.0\n', err: '' }),
    );
    assert.equal(outdatedUser.ownership, 'user-managed');
    assert.equal(outdatedUser.satisfied, false);
    assert.equal(outdatedUser.recommendedChoice, 'user-upgrade-required');
    assert.deepEqual(
      outdatedUser.choices.map((c) => c.choice),
      ['user-upgrade-required', 'install-nerv-managed'],
    );
    assert.ok(outdatedUser.choices.every((c) => c.replacesUserManaged === false));
    assert.ok(outdatedUser.blockers.some((b) => b.includes('never replaces a user-managed runtime silently')));

    const goodUser = await planNodeRuntime({ home: env.home, source: env.source, nodePath: userNode }, async () => ({
      status: 0,
      out: 'v24.1.0\n',
      err: '',
    }));
    assert.equal(goodUser.satisfied, true);
    assert.equal(goodUser.recommendedChoice, 'use-existing');

    const missing = await planNodeRuntime({ home: env.home, source: env.source, nodePath: null }, async () => ({
      status: 1,
      out: '',
      err: '',
    }));
    assert.equal(missing.ownership, 'missing');
    assert.equal(missing.recommendedChoice, 'install-nerv-managed');
  } finally {
    env.cleanup();
  }
});

test('F-005-T19: managed Node activation refuses external paths and recovers to previous version on failed upgrade', async () => {
  const env = makeEnv();
  try {
    const userNode = join(env.dir, 'user-node');
    writeFileSync(userNode, 'user', { mode: 0o700 });

    await assert.rejects(
      activateManagedNodeRuntime(
        {
          home: env.home,
          source: env.source,
          candidateBinary: userNode,
          version: '24.0.0',
          confirmChoice: 'install-nerv-managed',
        },
        async () => ({ status: 0, out: 'v24.0.0\n', err: '' }),
      ),
      /outside NERV managed runtime directory/,
    );

    const v1Bin = join(managedNodeRoot(env.home), 'v24.0.0', 'bin', 'node');
    mkdirSync(join(managedNodeRoot(env.home), 'v24.0.0', 'bin'), { recursive: true, mode: 0o700 });
    writeFileSync(v1Bin, 'v24.0.0', { mode: 0o700 });

    const first = await activateManagedNodeRuntime(
      {
        home: env.home,
        source: env.source,
        candidateBinary: v1Bin,
        version: '24.0.0',
        confirmChoice: 'install-nerv-managed',
      },
      async () => ({ status: 0, out: 'v24.0.0\n', err: '' }),
    );
    assert.equal(first.status, 'completed');
    assert.equal(first.activeVersion, '24.0.0');

    const v2Bin = join(managedNodeRoot(env.home), 'v24.2.0', 'bin', 'node');
    mkdirSync(join(managedNodeRoot(env.home), 'v24.2.0', 'bin'), { recursive: true, mode: 0o700 });
    writeFileSync(v2Bin, 'v24.2.0', { mode: 0o700 });

    const uncertain = await activateManagedNodeRuntime(
      {
        home: env.home,
        source: env.source,
        candidateBinary: v2Bin,
        version: '24.2.0',
        confirmChoice: 'upgrade-nerv-managed',
      },
      async () => ({ status: 1, out: '', err: 'broken binary' }),
    );
    assert.equal(uncertain.status, 'uncertain');
    assert.equal(readManagedNodeState(env.home)?.activeVersion, '24.0.0');

    // Simulate a partial state where previousPath points to v1Bin
    const rolledBack = recoverManagedNodeRuntime(env.home);
    assert.equal(rolledBack.status, 'rolled-back');
  } finally {
    env.cleanup();
  }
});

test('F-005-T19: nodes node-runtime-plan CLI returns ownership and choices', async () => {
  const env = makeEnv();
  try {
    const userNode = join(env.dir, 'user-node');
    if (process.platform !== 'win32') {
      writeFileSync(userNode, '#!/bin/sh\necho v24.0.0\n', { mode: 0o755 });
    }
    const nodeTarget = process.platform === 'win32' ? realpathSync(process.execPath) : userNode;
    const plan = (await nodesCommand([
      'node-runtime-plan',
      '--home',
      env.home,
      '--source',
      env.source,
      '--node',
      nodeTarget,
    ])) as { ownership: string; satisfied: boolean; recommendedChoice: string };
    assert.equal(plan.ownership, 'user-managed');
    assert.equal(plan.satisfied, true);
    assert.equal(plan.recommendedChoice, 'use-existing');
  } finally {
    env.cleanup();
  }
});
