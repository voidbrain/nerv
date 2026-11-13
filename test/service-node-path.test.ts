import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { renderService, windowsLauncher } from '../src/service.ts';

test('B-055: renderService and windowsLauncher resolve per-shell fnm symlinks to the stable Node path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-b055-'));
  try {
    const stableDir = join(dir, 'fnm', 'node-versions', 'v24.22.2', 'installation');
    const shellDir = join(dir, 'fnm_multishells', '99999_1700000000');
    mkdirSync(stableDir, { recursive: true });
    mkdirSync(shellDir, { recursive: true });
    const stableNode = join(stableDir, 'node');
    const shellNode = join(shellDir, 'node');
    writeFileSync(stableNode, '#!/bin/sh\n');
    symlinkSync(stableNode, shellNode);

    const plist = renderService('darwin', '/tmp/nerv-home', '/tmp/nerv-root', shellNode);
    assert.ok(!plist.includes('fnm_multishells'), 'launchd plist must not record fnm_multishells');
    assert.ok(plist.includes(stableNode), 'launchd plist should record resolved stable Node path');

    const unit = renderService('linux', '/tmp/nerv-home', '/tmp/nerv-root', shellNode);
    assert.ok(!unit.includes('fnm_multishells'), 'systemd unit must not record fnm_multishells');
    assert.ok(
      unit.includes(stableNode.replaceAll('\\', '\\\\')),
      'systemd unit should record resolved stable Node path',
    );

    const vbs = windowsLauncher('C:\\Users\\alice\\.nerv', 'C:\\Users\\alice\\nerv', shellNode);
    assert.ok(!vbs.includes('fnm_multishells'), 'Windows launcher must not record fnm_multishells');
    assert.ok(vbs.includes(stableNode), 'Windows launcher should record resolved stable Node path');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('B-055: renderService and windowsLauncher refuse unresolved ephemeral fnm_multishells paths', () => {
  const ephemeral = '/tmp/fnm_multishells/12345_shell/node';
  assert.throws(() => renderService('darwin', '/tmp/h', '/tmp/r', ephemeral), /fnm_multishells|stable Node/i);
  assert.throws(() => renderService('linux', '/tmp/h', '/tmp/r', ephemeral), /fnm_multishells|stable Node/i);
  assert.throws(
    () => windowsLauncher('C:\\h', 'C:\\r', 'C:\\Users\\alice\\AppData\\Local\\fnm_multishells\\123\\node.exe'),
    /fnm_multishells|stable Node/i,
  );
});
