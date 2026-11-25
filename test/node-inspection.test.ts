import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NODE_PROBE } from '../src/node-inspection.ts';

test('B-083: the read-only probe runs on an old Node, so it can report the version as too old', () => {
  // Node 12 (Calvary, 2026-11-18) has no `node:` require prefix, `??` or `?.`: the probe crashed before reporting.
  assert.doesNotMatch(NODE_PROBE, /require\('node:/);
  assert.doesNotMatch(NODE_PROBE, /\?\?|\?\./);
});

test('B-082: the Windows task user keeps Entra and domain accounts but repairs workgroup users', async () => {
  const { windowsServiceUser } = await import('../src/service.ts');
  // An SSH session on a workgroup machine reports USERDOMAIN=WORKGROUP, which names no account.
  assert.equal(
    windowsServiceUser({ USERDOMAIN: 'WORKGROUP', COMPUTERNAME: 'KITCHEN', USERNAME: 'tester' }),
    'KITCHEN\\tester',
  );
  assert.equal(
    windowsServiceUser({ USERDOMAIN: 'KITCHEN', COMPUTERNAME: 'KITCHEN', USERNAME: 'tester' }),
    'KITCHEN\\tester',
  );
  assert.equal(
    windowsServiceUser({ USERDOMAIN: 'AzureAD', COMPUTERNAME: 'PC1', USERNAME: 'tester' }),
    'AzureAD\\tester',
  );
  assert.equal(windowsServiceUser({ USERDOMAIN: 'CORP', COMPUTERNAME: 'PC1', USERNAME: 'tester' }), 'CORP\\tester');
  assert.equal(
    windowsServiceUser({
      USERDOMAIN: 'CORP',
      USERDNSDOMAIN: 'corp.example.test',
      COMPUTERNAME: 'PC1',
      USERNAME: 'tester',
    }),
    'CORP\\tester',
  );
  assert.equal(windowsServiceUser({ USERDOMAIN: '', COMPUTERNAME: 'KITCHEN', USERNAME: 'tester' }), 'KITCHEN\\tester');
  assert.equal(windowsServiceUser({ USERNAME: 'tester' }), 'tester');
});
