import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  checkUpdateAvailability,
  validateUpdateAvailability,
  type UpdateGitRunner,
} from '../src/update-availability.ts';
import { makeServer } from '../src/server.ts';
import { Store } from '../src/store.ts';
import { nodesCommand } from '../src/nodes-cli.ts';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const NOW = new Date('2026-11-12T20:00:00.000Z');

test('F-005-T07: checkUpdateAvailability reports up-to-date, update-available, ahead, offline, unknown and restartRequired', async () => {
  const upToDate = await checkUpdateAvailability({
    runningRevision: A,
    now: NOW,
    git: async (args) =>
      args[0] === 'rev-parse'
        ? { status: 0, out: A, err: '' }
        : args[0] === 'ls-remote'
          ? { status: 0, out: `${A}\trefs/heads/main`, err: '' }
          : { status: 1, out: '', err: '' },
  });
  assert.deepEqual(validateUpdateAvailability(upToDate), {
    version: 1,
    channel: 'main',
    installedRevision: A,
    runningRevision: A,
    availableRevision: A,
    status: 'up-to-date',
    updateAvailable: false,
    restartRequired: false,
    checkedAt: NOW.toISOString(),
  });

  const available = await checkUpdateAvailability({
    runningRevision: A,
    now: NOW,
    git: async (args) =>
      args[0] === 'rev-parse'
        ? { status: 0, out: B, err: '' }
        : args[0] === 'ls-remote'
          ? { status: 0, out: `${A}\trefs/heads/main`, err: '' }
          : { status: 1, out: '', err: '' },
  });
  assert.equal(available.status, 'update-available');
  assert.equal(available.updateAvailable, true);
  assert.equal(available.restartRequired, true);
  assert.equal(available.installedRevision, B);
  assert.equal(available.runningRevision, A);
  assert.equal(available.availableRevision, A);

  const ahead = await checkUpdateAvailability({
    runningRevision: B,
    now: NOW,
    git: async (args) => {
      if (args[0] === 'rev-parse') return { status: 0, out: B, err: '' };
      if (args[0] === 'ls-remote') return { status: 0, out: `${A}\trefs/heads/main`, err: '' };
      if (args[0] === 'cat-file' || args[0] === 'merge-base') return { status: 0, out: '', err: '' };
      return { status: 1, out: '', err: '' };
    },
  });
  assert.equal(ahead.status, 'ahead');
  assert.equal(ahead.updateAvailable, false);
  assert.equal(ahead.restartRequired, false);

  const offline: UpdateGitRunner = async (args) =>
    args[0] === 'rev-parse'
      ? { status: 0, out: A, err: '' }
      : { status: 128, out: '', err: 'fatal: could not read from https://secret-token@github.com/voidbrain/nerv.git' };
  const offlineResult = await checkUpdateAvailability({ runningRevision: null, now: NOW, git: offline });
  assert.equal(offlineResult.status, 'offline');
  assert.equal(offlineResult.availableRevision, null);
  assert.equal(offlineResult.updateAvailable, false);
  assert.ok(!offlineResult.reason?.includes('secret-token'));

  const unknown = await checkUpdateAvailability({
    now: NOW,
    git: async () => ({ status: 128, out: '', err: 'not a git repository' }),
  });
  assert.equal(unknown.status, 'unknown');
  assert.equal(unknown.installedRevision, null);
  assert.equal(unknown.availableRevision, null);

  await assert.rejects(checkUpdateAvailability({ channel: 'nightly' }), /Unsupported update channel/);
});

test('F-005-T07: GET /api/update enforces auth, caches, refreshes and rejects invalid channels', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-update-api-'));
  const db = new DatabaseSync(join(dir, 'nerv.sqlite'));
  db.close();
  const store = new Store(join(dir, 'nerv.sqlite'));
  let calls = 0;
  const token = 'admin-token-0123456789abcdef';
  const server = makeServer(store, token, {
    updateCheck: async ({ channel }) => {
      calls++;
      return {
        version: 1,
        channel: channel as 'main',
        installedRevision: A,
        runningRevision: A,
        availableRevision: B,
        status: 'update-available',
        updateAvailable: true,
        restartRequired: false,
        checkedAt: NOW.toISOString(),
      };
    },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  try {
    const unauth = await fetch(`http://127.0.0.1:${port}/api/update`);
    assert.equal(unauth.status, 401);

    const first = await fetch(`http://127.0.0.1:${port}/api/update`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(first.status, 200);
    assert.equal(validateUpdateAvailability(await first.json()).status, 'update-available');
    assert.equal(calls, 1);

    const cached = await fetch(`http://127.0.0.1:${port}/api/update`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(cached.status, 200);
    assert.equal(calls, 1);

    const refreshed = await fetch(`http://127.0.0.1:${port}/api/update?refresh=1`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(refreshed.status, 200);
    assert.equal(calls, 2);

    const badChannel = await fetch(`http://127.0.0.1:${port}/api/update?channel=nightly`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(badChannel.status, 400);

    const doctorRes = await fetch(`http://127.0.0.1:${port}/api/doctor`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(doctorRes.status, 200);
    const doctorBody = (await doctorRes.json()) as { update?: unknown };
    assert.equal(validateUpdateAvailability(doctorBody.update).status, 'update-available');

    const statusRes = await fetch(`http://127.0.0.1:${port}/api/status`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(statusRes.status, 200);
    const statusBody = (await statusRes.json()) as { update?: unknown };
    assert.equal(validateUpdateAvailability(statusBody.update).status, 'update-available');
    assert.equal(calls, 2);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('F-005-T07: nodes update-check --offline returns a valid contract for the current checkout', async () => {
  const result = validateUpdateAvailability(await nodesCommand(['update-check', '--offline']));
  assert.equal(result.status, 'offline');
  assert.equal(result.channel, 'main');
  assert.match(result.installedRevision ?? '', /^[0-9a-f]{40}$/);
  assert.equal(result.availableRevision, null);
});

test('F-005-T16: dashboard, companion and doctor surfaces include update availability', () => {
  const live = readFileSync(join(process.cwd(), 'web/public/dashboard/live.js'), 'utf8');
  assert.match(live, /api\("update"\)/);
  assert.match(live, /Update availability/);

  const doctorView = readFileSync(join(process.cwd(), 'web/src/doctor-view.ts'), 'utf8');
  assert.match(doctorView, /id: 'update'/);
  assert.match(doctorView, /t\.checkUpdate/);

  const companion = readFileSync(
    join(process.cwd(), 'native/NervMenuBar/Sources/NervMenuBar/NervMenuBar.swift'),
    'utf8',
  );
  assert.match(companion, /struct UpdateAvailability: Decodable/);
  assert.match(companion, /\/api\/update/);
  assert.match(companion, /updateStatus\.label\(language: model\.language\)/);
});
