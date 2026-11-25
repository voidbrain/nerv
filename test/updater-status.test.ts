import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/store.ts';
import { makeServer } from '../src/server.ts';
import { reportUpdaterResult, writeUpdaterResult } from '../src/updater-result.ts';
import {
  UPDATER_STATUS,
  markUpdaterFailed,
  markUpdaterRunning,
  readUpdaterStatus,
  trackUpdaterStart,
  withUpdaterSteps,
} from '../src/updater-status.ts';
import type { ManualUpdateDeps } from '../src/manual-update.ts';

const B = 'b'.repeat(40);
const OWNERSHIP = 'Service or runtime ownership is unknown or belongs elsewhere.';
const NOTHING_STOPPED = 'Nothing was stopped; NERV keeps running the current revision.';

async function withServer(home: string | undefined, work: (url: string, token: string) => Promise<void>) {
  const store = new Store(':memory:');
  const token = 't'.repeat(32);
  const server = makeServer(store, token, { ...(home ? { updaterHome: home } : {}) });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    await work(url, token);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    store.close();
  }
}

// B-123 (owner 2026-11-24): after Update now the dashboard showed only "Manual update started · fd0f2a0". The updater
// wrote its refusal to updater-result.json and the inbox, but nothing the dashboard reads. The join: the updater writes
// a result -> the server's read-only status route returns it, with reasons and recovery, and the inbox report still
// happens exactly once without taking the status away.
test('B-123: the updater result reaches GET /api/update/status and survives the one-time inbox report', async () => {
  const home = mkdtempSync(join(tmpdir(), 'nerv-b123-'));
  try {
    await withServer(home, async (url, token) => {
      const auth = { authorization: `Bearer ${token}` };
      assert.equal((await fetch(`${url}/api/update/status`)).status, 401, 'authenticated');
      assert.deepEqual(await (await fetch(`${url}/api/update/status`, { headers: auth })).json(), { updater: null });

      writeUpdaterResult(home, {
        outcome: 'refused',
        channel: 'main',
        revision: B,
        reasons: [OWNERSHIP],
        recovery: [NOTHING_STOPPED],
      });
      const sent: string[] = [];
      assert.equal(await reportUpdaterResult(home, async (m) => void sent.push(m), 'en', 'UTC'), true);
      assert.equal(await reportUpdaterResult(home, async (m) => void sent.push(m), 'en', 'UTC'), false);
      assert.equal(sent.length, 1, 'the inbox still hears it exactly once');

      const body = (await (await fetch(`${url}/api/update/status`, { headers: auth })).json()) as {
        updater: { state: string; revision: string; reasons: string[]; recovery: string[]; at: string };
      };
      assert.equal(body.updater.state, 'refused');
      assert.equal(body.updater.revision, B);
      assert.deepEqual(body.updater.reasons, [OWNERSHIP]);
      assert.deepEqual(body.updater.recovery, [NOTHING_STOPPED]);
      assert.ok(Date.parse(body.updater.at) > 0);

      // Dismissed: gone for every later read, until a new run supersedes it.
      const dismissed = await fetch(`${url}/api/update/status/dismiss`, { method: 'POST', headers: auth });
      assert.equal(dismissed.status, 200);
      assert.deepEqual(await (await fetch(`${url}/api/update/status`, { headers: auth })).json(), { updater: null });
      markUpdaterRunning(home, { channel: 'main', revision: B });
      const running = (await (await fetch(`${url}/api/update/status`, { headers: auth })).json()) as {
        updater: { state: string };
      };
      assert.equal(running.updater.state, 'running', 'a new run supersedes the dismissed result');
      const busy = await fetch(`${url}/api/update/status/dismiss`, { method: 'POST', headers: auth });
      assert.equal(busy.status, 409, 'a running update cannot be dismissed');
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('B-123: without an updater home the route answers null and reads nothing', async () => {
  await withServer(undefined, async (url, token) => {
    const body = await (
      await fetch(`${url}/api/update/status`, { headers: { authorization: `Bearer ${token}` } })
    ).json();
    assert.deepEqual(body, { updater: null });
  });
});

test('B-123: the hand-off marks the run started, and a hand-off that fails is a refusal, never left running', async () => {
  const home = mkdtempSync(join(tmpdir(), 'nerv-b123-'));
  try {
    const seen: string[] = [];
    const start = trackUpdaterStart(home, async () => {
      // The updater can finish before the service hears back: the status already says running when it starts.
      seen.push(readUpdaterStatus(home)?.state ?? 'none');
    });
    await start({ channel: 'main', revision: B });
    assert.deepEqual(seen, ['running']);
    const started = readUpdaterStatus(home)!;
    assert.equal(started.state, 'running');
    assert.equal(started.revision, B);

    const failing = trackUpdaterStart(home, async () => {
      throw Error('launchctl bootstrap of the updater failed: 5');
    });
    await assert.rejects(failing({ channel: 'main', revision: B }), /bootstrap/);
    const refused = readUpdaterStatus(home)!;
    assert.equal(refused.state, 'refused');
    assert.match(refused.reasons.join(' '), /The updater did not start: launchctl bootstrap/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('B-123: steps are recorded while running; a completed result keeps the start time and names the revision', async () => {
  const home = mkdtempSync(join(tmpdir(), 'nerv-b123-'));
  try {
    markUpdaterRunning(home, { channel: 'main', revision: B });
    const startedAt = readUpdaterStatus(home)!.startedAt;
    const steps: (string | undefined)[] = [];
    const deps = withUpdaterSteps(home, {
      resolveUpdate: async () => {
        throw Error('unused');
      },
      fetchRevision: async () => void steps.push(readUpdaterStatus(home)?.step),
      plan: async (_h, action) => {
        steps.push(readUpdaterStatus(home)?.step);
        return { action } as never;
      },
      applyPlan: async (_h, plan) => {
        steps.push(readUpdaterStatus(home)?.step);
        return { state: (plan as { action: string }).action } as never;
      },
    } satisfies ManualUpdateDeps);
    await deps.fetchRevision!(B);
    await deps.plan!({} as never, 'update', B);
    await deps.applyPlan!({} as never, { action: 'stop' } as never, 'd');
    await deps.applyPlan!({} as never, { action: 'update' } as never, 'd');
    assert.deepEqual(steps, [
      'Fetching bbbbbbb into the install folder',
      'Checking the update plan',
      'Stopping the service',
      'Installing bbbbbbb and starting it',
    ]);

    writeUpdaterResult(home, { outcome: 'completed', channel: 'main', revision: B, reasons: [], recovery: [] });
    const done = readUpdaterStatus(home)!;
    assert.equal(done.state, 'completed');
    assert.equal(done.startedAt, startedAt, 'the same run');
    assert.equal(done.step, undefined, 'no step once finished');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('B-123: an updater that throws is failed; one silent for 15 minutes is uncertain; a damaged file is nothing', () => {
  const home = mkdtempSync(join(tmpdir(), 'nerv-b123-'));
  try {
    markUpdaterFailed(home, { channel: 'main', revision: B }, Error('git: not a repository'));
    const failed = readUpdaterStatus(home)!;
    assert.equal(failed.state, 'failed');
    assert.match(failed.reasons[0]!, /git: not a repository/);
    assert.match(failed.recovery.join(' '), /updater\.log/);

    markUpdaterRunning(home, { channel: 'main', revision: B });
    const later = Date.now() + 16 * 60_000;
    const stale = readUpdaterStatus(home, later)!;
    assert.equal(stale.state, 'uncertain');
    assert.match(stale.recovery.join(' '), /updater\.log/);
    assert.equal(readUpdaterStatus(home)!.state, 'running', 'only the reading is derived; the file is unchanged');

    writeFileSync(join(home, UPDATER_STATUS), '{not json');
    assert.equal(readUpdaterStatus(home), null);
    assert.ok(existsSync(join(home, UPDATER_STATUS)));
    assert.ok(readFileSync(join(home, UPDATER_STATUS), 'utf8').length > 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
