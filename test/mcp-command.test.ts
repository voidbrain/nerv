// B-148: how a bare MCP stdio command becomes an absolute file (the node folder, then the service PATH).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { resolveCommand } from '../src/mcp.ts';

const posix = process.platform !== 'win32';
function folders() {
  const root = mkdtempSync(join(tmpdir(), 'nerv-cmd-'));
  const make = (name: string, files: string[]) => {
    const dir = join(root, name);
    mkdirSync(dir);
    for (const f of files) {
      writeFileSync(join(dir, f), '#!/bin/sh\n');
      chmodSync(join(dir, f), 0o755);
    }
    return dir;
  };
  return { root, make };
}

test('B-148: node, npx and npm come from the running node folder before the service PATH', { skip: !posix }, () => {
  const { root, make } = folders();
  try {
    const nodeDir = make('node-bin', ['node', 'npx', 'npm']);
    const sys = make('usr-bin', ['node', 'npx', 'npm', 'uvx']);
    for (const c of ['node', 'npx', 'npm'])
      assert.deepEqual(resolveCommand(c, { nodeDir, path: sys }), { file: join(nodeDir, c), nodeDir });
    // Another command is never looked for in the node folder and gets no PATH change.
    assert.deepEqual(resolveCommand('uvx', { nodeDir, path: sys }), { file: join(sys, 'uvx') });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('B-148: the service PATH is searched next, absolute executable files only', { skip: !posix }, () => {
  const { root, make } = folders();
  try {
    const nodeDir = make('empty', []);
    const sys = make('usr-bin', ['npx']);
    const plain = make('plain', []);
    writeFileSync(join(plain, 'tool'), 'not executable');
    assert.deepEqual(resolveCommand('npx', { nodeDir, path: sys }), { file: join(sys, 'npx') });
    // A relative or empty PATH entry is skipped, and a file that cannot run does not count.
    assert.throws(
      () => resolveCommand('tool', { nodeDir, path: ['', '.', 'rel/bin', plain].join(delimiter) }),
      (e: Error) => {
        assert.match(e.message, /^tool not found \(searched /);
        assert.ok(e.message.includes(plain));
        assert.ok(!e.message.includes('rel/bin'));
        return true;
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('B-148: a command found nowhere names itself and every folder searched', () => {
  const nodeDir = join(tmpdir(), 'nerv-missing-node');
  const sys = join(tmpdir(), 'nerv-missing-bin');
  assert.throws(
    () => resolveCommand('npx', { nodeDir, path: sys }),
    (e: Error) => e.message.startsWith(`npx not found (searched ${nodeDir}, ${sys})`),
  );
});

test('B-148: a command with a folder is used as written', () => {
  assert.deepEqual(resolveCommand('/opt/tools/server', { nodeDir: '/x', path: '' }), { file: '/opt/tools/server' });
});

test('B-148: with the real node, a bare npx resolves next to it even when PATH holds no node', { skip: !posix }, () => {
  const empty = mkdtempSync(join(tmpdir(), 'nerv-path-'));
  try {
    const r = resolveCommand('npx', { path: empty });
    assert.equal(r.file, join(dirname(process.execPath), 'npx'));
    assert.equal(r.nodeDir, dirname(process.execPath));
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});
