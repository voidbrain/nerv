import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InstrumentalityRuns, RETRY_AFTER_MS, runFailure, runMessage } from '../src/instrumentality-runs.ts';
import { authorize, validateParams } from '../src/rpc.ts';
import { Store } from '../src/store.ts';
import { composeBrief } from '../src/brief.ts';
test('scheduled claims survive restart, bound retries and fence stale completion', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-run-'));
  let db = new DatabaseSync(join(dir, 'runs.sqlite'));
  const start = new Date('2030-01-02T03:00:00.000Z'),
    later = (ms: number) => new Date(start.getTime() + ms).toISOString();
  try {
    let runs = new InstrumentalityRuns(db);
    assert.throws(() => runs.claim('at:2030-02-30', start.toISOString()));
    const first = runs.claim('at:2030-01-02', start.toISOString());
    assert.ok(first);
    assert.equal(first.attempts, 1);
    assert.equal(runs.claim(first.slot, later(1000)), null);
    db.close();
    db = new DatabaseSync(join(dir, 'runs.sqlite'));
    runs = new InstrumentalityRuns(db);
    assert.equal(runs.latest()?.status, 'pending');
    assert.equal(runs.claim(first.slot, later(RETRY_AFTER_MS - 1)), null);
    const second = runs.claim(first.slot, later(RETRY_AFTER_MS));
    assert.ok(second);
    assert.equal(second.attempts, 2);
    assert.equal(second.reason, 'interrupted');
    assert.equal(
      runs.finish(first.id, 'completed', null, later(RETRY_AFTER_MS + 1)),
      false,
      'late first result cannot complete the second claim',
    );
    assert.equal(runs.finish(second.id, 'failed', 'local-unavailable', later(RETRY_AFTER_MS + 2)), true);
    assert.equal(runs.claim(first.slot, later(2 * RETRY_AFTER_MS)), null, 'no third attempt today');
    assert.ok(runs.claim('at:2030-01-03', new Date('2030-01-03T03:00:00.000Z').toISOString()));
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('diagnostics and bilingual briefs use fixed reasons, never raw provider data', () => {
  const db = new DatabaseSync(':memory:');
  const runs = new InstrumentalityRuns(db);
  try {
    const run = runs.claim('at:2030-01-02', '2030-01-02T03:00:00.000Z')!;
    runs.finish(run.id, 'failed', runFailure('Local route (S²) unreachable. PRIVATE'), run.started);
    const latest = runs.latest()!;
    assert.equal(latest.reason, 'local-unavailable');
    assert.doesNotMatch(JSON.stringify(latest), /PRIVATE/);
    assert.match(runMessage(latest), /one retry after an hour/);
    const crowded = composeBrief({
      now: new Date(run.started),
      timeZone: 'Europe/Rome',
      language: 'en',
      approvals: [],
      reminders: Array.from({ length: 8 }, () => ({
        title: 'Neutral reminder '.repeat(35),
        due: '2030-01-02T04:00:00Z',
      })),
      sorties: [],
      health: [],
      instrumentality: latest,
    });
    assert.match(crowded, /the local route was unavailable/);
    assert.ok(crowded.length <= 3500, 'the failure notice survives brief truncation');
    for (const language of ['en', 'it'] as const) {
      const brief = composeBrief({
        now: new Date(run.started),
        timeZone: 'Europe/Rome',
        language,
        approvals: [],
        reminders: [],
        sorties: [],
        health: [],
        instrumentality: latest,
      });
      assert.match(
        brief,
        language === 'en' ? /the local route was unavailable/ : /il percorso locale non era disponibile/,
      );
    }
    assert.throws(() => authorize('interface', 'coordinator', 'instrumentality.claim'));
    assert.throws(() =>
      validateParams('instrumentality.finish', {
        id: run.id,
        status: 'failed',
        reason: 'raw provider error',
        now: run.started,
      }),
    );
  } finally {
    db.close();
  }
});
test('episode cursor and scheduled success are atomic across failure and restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-atomic-digest-'));
  const path = join(dir, 'nerv.sqlite');
  let store = new Store(path);
  try {
    const now = new Date().toISOString(),
      slot = 'at:' + now.slice(0, 10);
    const run = store.instrumentality.claim(slot, now)!;
    const episode = {
      since: new Date(Date.now() - 86400000).toISOString(),
      until: now,
      summary: 'Neutral daily summary',
      exchanges: 1,
      proposed: 0,
      runId: run.id,
    };
    store.db.exec(
      "CREATE TRIGGER block_schedule_finish BEFORE UPDATE ON instrumentality_runs BEGIN SELECT RAISE(ABORT,'simulated failure after episode insert'); END;",
    );
    assert.throws(() => store.saveEpisode(episode), /simulated failure/);
    assert.equal(store.memory.episodes().length, 0, 'a failed outcome write also rolls back the episode cursor');
    assert.equal(store.instrumentality.latest()?.status, 'pending');
    store.db.exec('DROP TRIGGER block_schedule_finish');
    store.saveEpisode(episode);
    store.close();
    store = new Store(path);
    assert.equal(store.memory.episodes().length, 1);
    assert.equal(store.instrumentality.latest()?.status, 'completed');
    assert.equal(store.instrumentality.latest()?.reason, null);
    assert.equal(
      store.instrumentality.claim(slot, new Date(Date.now() + 2 * 3600000).toISOString()),
      null,
      'saved episode cannot leave a retryable pending claim',
    );
    assert.throws(() => store.saveEpisode({ ...episode, summary: 'Stale duplicate' }), /Stale consolidation claim/);
    assert.equal(store.memory.episodes().length, 1, 'a stale result cannot advance the cursor again');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('failed-attempt backoff starts at the recorded failure time', () => {
  const db = new DatabaseSync(':memory:');
  const runs = new InstrumentalityRuns(db);
  try {
    const start = Date.parse('2030-01-02T03:00:00.000Z'),
      at = (ms: number) => new Date(start + ms).toISOString();
    const run = runs.claim('at:2030-01-02', at(0))!;
    runs.finish(run.id, 'failed', 'unavailable', at(60000));
    assert.equal(runs.claim(run.slot, at(RETRY_AFTER_MS)), null);
    assert.equal(runs.claim(run.slot, at(RETRY_AFTER_MS + 60000))?.attempts, 2);
  } finally {
    db.close();
  }
});
