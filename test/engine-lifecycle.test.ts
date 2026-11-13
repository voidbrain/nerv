import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  engineReceiptPath,
  engineServiceIdentity,
  executeEngineLifecycle,
  planEngineLifecycle,
  reconcileEngineState,
  renderEngineService,
  type ManagedEngineSpec,
} from '../src/engine-lifecycle.ts';

function makeOwnedSpec(overrides: Partial<ManagedEngineSpec> = {}): ManagedEngineSpec {
  return {
    id: 'ollama-local',
    provider: 'ollama',
    locality: 'local',
    ownership: 'owned',
    mode: 'on-demand',
    selected: true,
    baseUrl: 'http://127.0.0.1:11435/v1',
    executable: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
    ...overrides,
  };
}

test('planEngineLifecycle refuses unselected, external, remote, and mode=none engines', () => {
  const emptyState = { receipt: null, endpointReachable: false, pidAlive: false, serviceInstalled: false };
  const home = '/tmp/nerv-test-home';

  const unselected = planEngineLifecycle(makeOwnedSpec({ selected: false }), 'start', 'darwin', home, emptyState);
  assert.equal(unselected.ok, false);
  assert.match(unselected.refusals.join(' '), /not explicitly selected/i);

  const external = planEngineLifecycle(makeOwnedSpec({ ownership: 'external' }), 'start', 'darwin', home, emptyState);
  assert.equal(external.ok, false);
  assert.match(external.refusals.join(' '), /not NERV-owned/i);

  const remote = planEngineLifecycle(
    makeOwnedSpec({ locality: 'remote', baseUrl: 'https://api.example.com/v1' }),
    'start',
    'darwin',
    home,
    emptyState,
  );
  assert.equal(remote.ok, false);
  assert.match(remote.refusals.join(' '), /remote/i);

  const modeNone = planEngineLifecycle(makeOwnedSpec({ mode: 'none' }), 'start', 'darwin', home, emptyState);
  assert.equal(modeNone.ok, false);
  assert.match(modeNone.refusals.join(' '), /"none"/i);
});

test('planEngineLifecycle refuses hijacking an unowned listener or stopping without an owned receipt', () => {
  const home = '/tmp/nerv-test-home';
  const unownedRunning = planEngineLifecycle(makeOwnedSpec(), 'start', 'linux', home, {
    receipt: null,
    endpointReachable: true,
    pidAlive: false,
    serviceInstalled: false,
  });
  assert.equal(unownedRunning.ok, false);
  assert.match(unownedRunning.refusals.join(' '), /unowned listener/i);

  const stopWithoutReceipt = planEngineLifecycle(makeOwnedSpec(), 'stop', 'linux', home, {
    receipt: null,
    endpointReachable: true,
    pidAlive: false,
    serviceInstalled: false,
  });
  assert.equal(stopWithoutReceipt.ok, false);
  assert.match(stopWithoutReceipt.refusals.join(' '), /no owned runtime receipt/i);

  const installOnDemand = planEngineLifecycle(makeOwnedSpec({ mode: 'on-demand' }), 'install', 'darwin', home, {
    receipt: null,
    endpointReachable: false,
    pidAlive: false,
    serviceInstalled: false,
  });
  assert.equal(installOnDemand.ok, false);
  assert.match(installOnDemand.refusals.join(' '), /start-at-login/i);
});

test('renderEngineService produces distinct per-user service definitions on macOS, Linux, and Windows', () => {
  const spec = makeOwnedSpec({
    id: 'llama-cpp',
    mode: 'start-at-login',
    executable: '/usr/local/bin/llama-server',
    args: ['--port', '11435'],
    workingDirectory: '/var/tmp/llama',
    env: { LLAMA_HOST: '127.0.0.1' },
  });

  const macId = engineServiceIdentity('darwin', '/Users/alice', spec.id);
  assert.equal(macId.label, 'io.nerv.engine.llama-cpp');
  assert.notEqual(macId.label, 'io.nerv.agent');
  const macPlist = renderEngineService('darwin', '/Users/alice/.nerv', spec);
  assert.match(macPlist, /<string>io\.nerv\.engine\.llama-cpp<\/string>/);
  assert.match(macPlist, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(macPlist, /<key>Umask<\/key><integer>63<\/integer>/);
  assert.match(macPlist, /<string>\/usr\/local\/bin\/llama-server<\/string>/);

  const linuxId = engineServiceIdentity('linux', '/home/alice', spec.id);
  assert.equal(linuxId.label, 'nerv-engine-llama-cpp.service');
  assert.notEqual(linuxId.label, 'nerv.service');
  const linuxUnit = renderEngineService('linux', '/home/alice/.nerv', spec);
  assert.match(linuxUnit, /UMask=0077/);
  assert.match(linuxUnit, /NoNewPrivileges=true/);
  assert.match(linuxUnit, /WantedBy=default\.target/);
  assert.match(linuxUnit, /ExecStart="\/usr\/local\/bin\/llama-server" "--port" "11435"/);

  const winSpec = makeOwnedSpec({
    id: 'llama-cpp',
    mode: 'start-at-login',
    executable: 'C:\\Program Files\\Llama\\llama-server.exe',
    args: ['--port', '11435'],
    workingDirectory: 'C:\\Users\\alice\\llama',
  });
  const winId = engineServiceIdentity('win32', 'C:\\Users\\alice\\.nerv', winSpec.id);
  assert.equal(winId.label, 'NERV Engine (llama-cpp)');
  assert.notEqual(winId.label, 'NERV Agency');
  const winXml = renderEngineService('win32', 'C:\\Users\\alice\\.nerv', winSpec);
  assert.match(winXml, /<LogonTrigger><Enabled>true<\/Enabled><\/LogonTrigger>/);
  assert.match(winXml, /<Command>C:\\Program Files\\Llama\\llama-server\.exe<\/Command>/);
});

test('start-at-login install, failed-registration uncertainty, reconciliation, and uninstall', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-engine-svc-'));
  try {
    const nervHome = join(dir, 'nerv-home');
    const userHome = join(dir, 'user-home');
    const spec = makeOwnedSpec({ id: 'owned-ollama', mode: 'start-at-login' });
    const receiptPath = engineReceiptPath('linux', nervHome, spec.id);

    const failPlan = planEngineLifecycle(
      spec,
      'install',
      'linux',
      nervHome,
      { receipt: null, endpointReachable: false, pidAlive: false, serviceInstalled: false },
      userHome,
    );
    assert.equal(failPlan.ok, true);

    const failedOutcome = await executeEngineLifecycle(failPlan, spec, {
      runServiceCommand: async () => ({ ok: false, output: 'systemctl user bus unavailable' }),
    });
    assert.equal(failedOutcome.ok, false);
    assert.equal(failedOutcome.status, 'uncertain');
    assert.equal(existsSync(receiptPath), true);

    const blockedPlan = planEngineLifecycle(
      spec,
      'uninstall',
      'linux',
      nervHome,
      {
        receipt: failedOutcome.receipt,
        endpointReachable: false,
        pidAlive: false,
        serviceInstalled: true,
      },
      userHome,
    );
    assert.equal(blockedPlan.ok, false);
    assert.match(blockedPlan.refusals.join(' '), /uncertain/i);

    const cleared = reconcileEngineState(receiptPath, true);
    assert.equal(cleared, null);
    assert.equal(existsSync(receiptPath), false);

    const installPlan = planEngineLifecycle(
      spec,
      'install',
      'linux',
      nervHome,
      { receipt: null, endpointReachable: false, pidAlive: false, serviceInstalled: false },
      userHome,
    );
    const calls: string[] = [];
    const installOutcome = await executeEngineLifecycle(installPlan, spec, {
      runServiceCommand: async (cmd, args) => {
        calls.push(`${cmd} ${args.join(' ')}`);
        return { ok: true, output: 'ok' };
      },
    });
    assert.equal(installOutcome.ok, true);
    assert.equal(installOutcome.status, 'applied');
    assert.equal(calls.length, 1);
    assert.match(calls[0], /systemctl --user enable --now nerv-engine-owned-ollama\.service/);
    assert.equal(existsSync(installPlan.servicePath!), true);

    const uninstallPlan = planEngineLifecycle(
      spec,
      'uninstall',
      'linux',
      nervHome,
      {
        receipt: installOutcome.receipt,
        endpointReachable: false,
        pidAlive: false,
        serviceInstalled: true,
      },
      userHome,
    );
    const uninstallOutcome = await executeEngineLifecycle(uninstallPlan, spec, {
      runServiceCommand: async (cmd, args) => {
        calls.push(`${cmd} ${args.join(' ')}`);
        return { ok: true, output: 'ok' };
      },
    });
    assert.equal(uninstallOutcome.ok, true);
    assert.equal(existsSync(installPlan.servicePath!), false);
    assert.equal(existsSync(receiptPath), false);
    assert.match(calls[1], /systemctl --user disable --now nerv-engine-owned-ollama\.service/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('on-demand start, status, and stop manage a real owned child process with receipt persistence', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-engine-proc-'));
  let spawnedPid: number | undefined;
  try {
    const platform = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';
    const spec = makeOwnedSpec({ id: 'proc-stub', mode: 'on-demand' });
    const receiptPath = engineReceiptPath(platform, dir, spec.id);

    const startPlan = planEngineLifecycle(spec, 'start', platform, dir, {
      receipt: null,
      endpointReachable: false,
      pidAlive: false,
      serviceInstalled: false,
    });
    assert.equal(startPlan.ok, true);

    const started = await executeEngineLifecycle(startPlan, spec);
    assert.equal(started.ok, true);
    assert.equal(started.running, true);
    assert.ok(started.pid && started.pid > 0);
    spawnedPid = started.pid;

    const savedReceipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    assert.equal(savedReceipt.pid, spawnedPid);
    assert.equal(savedReceipt.ownership, 'owned');

    const statusPlan = planEngineLifecycle(spec, 'status', platform, dir, {
      receipt: savedReceipt,
      endpointReachable: false,
      pidAlive: true,
      serviceInstalled: false,
    });
    const status = await executeEngineLifecycle(statusPlan, spec);
    assert.equal(status.ok, true);
    assert.equal(status.running, true);
    assert.equal(status.pid, spawnedPid);

    const stopPlan = planEngineLifecycle(spec, 'stop', platform, dir, {
      receipt: savedReceipt,
      endpointReachable: false,
      pidAlive: true,
      serviceInstalled: false,
    });
    assert.equal(stopPlan.ok, true);
    const stopped = await executeEngineLifecycle(stopPlan, spec);
    assert.equal(stopped.ok, true);
    assert.equal(stopped.running, false);
    assert.equal(existsSync(receiptPath), false);
    spawnedPid = undefined;
  } finally {
    if (spawnedPid) {
      try {
        process.kill(spawnedPid, 'SIGKILL');
      } catch {
        // already exited
      }
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
