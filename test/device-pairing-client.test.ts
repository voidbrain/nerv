import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import {
  DEVICE_KEY,
  deviceLabel,
  forgetDevice,
  isInstalled,
  isPairingCode,
  keepDevice,
  keptDevice,
  pairDevice,
} from '../web/src/device-pairing.ts';
import { makeServer } from '../src/server.ts';
import { Store } from '../src/store.ts';

// F-118-T02: the workspace's sign-in box pairs with a typed code; installed, the credential is kept in localStorage.

test('F-118-T02: a typed pairing code is told apart from the admin token', () => {
  for (const code of ['ABCD-EFGH', 'abcd-efgh', 'ABCD EFGH', 'ABCDEFGH', '  ab2d-ef9h  '])
    assert.ok(isPairingCode(code), code);
  for (const other of ['', 'ABC-DEFGH', 'ABCD-EFGHI', 'ABCD--EFGH', 'e'.repeat(24), 'a'.repeat(64), 'ABCD_EFGH'])
    assert.equal(isPairingCode(other), false, other);
});

test('F-118-T02: installed means navigator.standalone (iOS) or the standalone display mode', () => {
  const media = (on: string[]) => (q: string) => ({ matches: on.some((m) => q.includes(m)) });
  assert.equal(isInstalled({ navigator: { standalone: true } }), true);
  assert.equal(isInstalled({ navigator: {}, matchMedia: media(['standalone']) }), true);
  assert.equal(
    isInstalled({ navigator: {}, matchMedia: media(['fullscreen']) }),
    false,
    'a fullscreen (F11) tab is not installed (review of #707)',
  );
  assert.equal(isInstalled({ navigator: {}, matchMedia: media(['browser']) }), false, 'a browser tab');
  assert.equal(isInstalled({ navigator: { standalone: 'yes' } }), false);
  assert.equal(
    isInstalled({
      matchMedia: () => {
        throw new Error('blocked');
      },
    }),
    false,
  );
});

test('F-118-T02: the device name is the kind of device and the app, within the 40-character limit', () => {
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
  assert.equal(deviceLabel(iphone, 'workspace app'), 'iPhone · workspace app');
  assert.equal(deviceLabel('Mozilla/5.0 (Linux; Android 15) Chrome/130', 'dashboard'), 'Android · dashboard');
  assert.equal(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)', 'workspace'), 'Mac · workspace');
  assert.equal(deviceLabel('', 'workspace'), 'Device · workspace');
  assert.ok(deviceLabel('', 'x'.repeat(80)).length <= 40);
});

test('F-118-T02: keeping and forgetting the credential never throws when storage is blocked', () => {
  const map = new Map<string, string>();
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
  assert.equal(keptDevice(storage), '');
  keepDevice(storage, 'credential');
  assert.equal(map.get(DEVICE_KEY), 'credential');
  assert.equal(keptDevice(storage), 'credential');
  forgetDevice(storage);
  assert.equal(keptDevice(storage), '');
  const blocked = {
    getItem: () => {
      throw new Error('SecurityError');
    },
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => {
      throw new Error('SecurityError');
    },
  };
  assert.equal(keptDevice(blocked), '');
  assert.doesNotThrow(() => keepDevice(blocked, 'credential'));
  assert.doesNotThrow(() => forgetDevice(blocked));
  assert.equal(keptDevice(undefined), '');
});

// Across the join: the client helper against the real pairing endpoint.
test('F-118-T02: the client pairs against the real endpoint once; the credential signs in; a reused code is refused', async () => {
  const token = 'c'.repeat(32);
  const store = new Store(':memory:');
  const server = makeServer(store, token, {});
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const fetcher = ((input: string, init?: RequestInit) => fetch(origin + input, init)) as typeof fetch;
  try {
    const minted = (await (
      await fetch(origin + '/api/device/codes', { method: 'POST', headers: { authorization: `Bearer ${token}` } })
    ).json()) as { code: string };
    const typed = minted.code.toLowerCase().replace('-', ' ');
    const outcome = await pairDevice(typed, 'iPhone · workspace app', fetcher, { 'ngsw-bypass': '1' });
    assert.ok('token' in outcome, JSON.stringify(outcome));
    const status = await fetch(origin + '/api/status', { headers: { authorization: `Bearer ${outcome.token}` } });
    assert.equal(status.status, 200, 'the device credential signs in');
    const listed = (await (
      await fetch(origin + '/api/devices', { headers: { authorization: `Bearer ${token}` } })
    ).json()) as { devices: { name: string }[] };
    assert.deepEqual(
      listed.devices.map((d) => d.name),
      ['iPhone · workspace app'],
    );
    const again = await pairDevice(typed, 'iPhone · workspace app', fetcher);
    assert.deepEqual(again, {
      status: 401,
      error: 'Pairing code invalid, used or expired: run open --phone again.',
    });
    const unreachable = await pairDevice(typed, 'x', (() =>
      Promise.reject(new TypeError('Load failed'))) as typeof fetch);
    assert.deepEqual(unreachable, { status: 0, error: 'Service not reached.' });
  } finally {
    await new Promise((done) => {
      server.close(done);
      server.closeAllConnections();
    });
    store.close();
  }
});
