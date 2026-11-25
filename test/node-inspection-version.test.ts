import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { nodesCommand } from '../src/nodes-cli.ts';

// B-063: an inspection reports a Node.js older than package.json engines.node instead of passing silently.
const report = (node: string) =>
  JSON.stringify({
    version: 1,
    platform: 'linux',
    arch: 'arm64',
    node,
    hostname: 'aster',
    userId: 1000,
    userHome: '/home/fixture',
    git: null,
    npm: null,
    base: null,
    configured: false,
    runtime: 'not-checked',
  });

test('an old Node.js on the target fails the inspection with the required version, after saving the evidence', async () => {
  const home = mkdtempSync(join(tmpdir(), 'nerv-old-node-'));
  try {
    const out = join(home, 'inspection.json');
    await assert.rejects(
      nodesCommand(['inspect', '--ssh', 'aster', '--out', out], async () => report('18.19.1')),
      /Node\.js 18\.19\.1 on the target is below the version NERV requires \(>=24\.0\.0\).*no installation was requested/,
    );
    assert.equal(JSON.parse(readFileSync(out, 'utf8')).node, '18.19.1'); // unchanged format, kept as evidence
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('a supported Node.js passes as before', async () => {
  const value = (await nodesCommand(['inspect', '--ssh', 'aster'], async () => report('24.12.0'))) as { node: string };
  assert.equal(value.node, '24.12.0');
});

test('an old Node.js fails without --out too', async () => {
  await assert.rejects(
    nodesCommand(['inspect', '--ssh', 'aster'], async () => report('23.11.0')),
    /below the version/,
  );
});
