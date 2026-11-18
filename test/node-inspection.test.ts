import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NODE_PROBE } from '../src/node-inspection.ts';

test('B-083: the read-only probe runs on an old Node, so it can report the version as too old', () => {
  // Node 12 (Calvary, 2026-11-18) has no `node:` require prefix, `??` or `?.`: the probe crashed before reporting.
  assert.doesNotMatch(NODE_PROBE, /require\('node:/);
  assert.doesNotMatch(NODE_PROBE, /\?\?|\?\./);
});
