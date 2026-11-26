// @ts-check
// B-165-T03: a branch that drops Gauntlet ledger entries its base had fails a check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { droppedEntries } from '../tools/check-gauntlet-ledger.mjs';

const tool = fileURLToPath(new URL('../tools/check-gauntlet-ledger.mjs', import.meta.url));
/** @param {string} pack @param {string} kase @param {string | null} [profileHash] */
const entry = (pack, kase, profileHash = null) => ({ pack, case: kase, profileHash });

test('droppedEntries names entries of the base the branch lacks, unless their case left the catalogue', () => {
  const base = { entries: [entry('p', 'a'), entry('p', 'b', 'h1'), entry('p', 'gone'), entry('q', 'c')] };
  const current = { entries: [entry('p', 'a'), entry('q', 'c'), entry('q', 'new')] };
  const catalogue = new Set(['p/a', 'p/b', 'q/c', 'q/new']);
  assert.deepEqual(droppedEntries(base, current, catalogue), ['p/b (profile h1)']);
  assert.deepEqual(droppedEntries(base, base, catalogue), []);
  // A newer run of the same pack, case and profile replaces its entry: not a drop.
  const newer = { entries: base.entries.map((e) => ({ ...e, finished: '2026-11-27T00:00:00.000Z' })) };
  assert.deepEqual(droppedEntries(base, newer, catalogue), []);
});

test('the check fails on a working tree that lost a catalogue entry and passes once it is restored', () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'nerv-ledger-check-'));
  try {
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
    git('init', '-q');
    git('config', 'user.email', 'neutral@example.invalid');
    git('config', 'user.name', 'Neutral');
    git('config', 'commit.gpgsign', 'false');
    mkdirSync(join(dir, 'evals/gauntlet'), { recursive: true });
    const ledger = join(dir, 'evals/gauntlet/ledger.json');
    // neutral-smoke/exact-json is a case the pinned release ships; retired/case is in no pack.
    const full = { schemaVersion: 2, entries: [entry('neutral-smoke', 'exact-json', 'h'), entry('retired', 'case')] };
    writeFileSync(ledger, JSON.stringify(full));
    git('add', '.');
    git('commit', '-qm', 'ledger');
    const check = () => spawnSync(process.execPath, [tool, '--base=HEAD'], { cwd: dir, encoding: 'utf8' });

    writeFileSync(ledger, JSON.stringify({ schemaVersion: 2, entries: [] }));
    const dropped = check();
    assert.equal(dropped.status, 1, dropped.stdout + dropped.stderr);
    assert.match(dropped.stderr, /neutral-smoke\/exact-json \(profile h\)/);
    assert.doesNotMatch(dropped.stderr, /retired/);

    writeFileSync(ledger, JSON.stringify(full));
    const kept = check();
    assert.equal(kept.status, 0, kept.stdout + kept.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
