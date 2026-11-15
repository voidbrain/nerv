import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { checkThreatMap } from '../tools/check-threat-map.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..');

test('repo threat map passes checkThreatMap', () => {
  const result = checkThreatMap({ rootDir: REPO_ROOT });
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.checkedRows, 30);
});

test('fails when a cited test file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-threat-map-'));
  try {
    mkdirSync(join(dir, 'docs/security'), { recursive: true });
    writeFileSync(
      join(dir, 'docs/security/agentic-threats.md'),
      [
        '| Risk | Title | AISVS v1.01 | NERV Control (Source) | Test or Gap |',
        '|---|---|---|---|---|',
        '| ASI01 | Goal Hijack | `v1.01-C1.1.1` | `src/foo.ts` | `test/does-not-exist.test.ts` |',
      ].join('\n'),
    );

    const result = checkThreatMap({ rootDir: dir });
    assert.equal(result.ok, false);
    assert.match(result.errors[0], /does not exist: test\/does-not-exist\.test\.ts/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fails when a row has neither a cited test nor a named gap', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-threat-map-'));
  try {
    mkdirSync(join(dir, 'docs/security'), { recursive: true });
    writeFileSync(
      join(dir, 'docs/security/agentic-threats.md'),
      [
        '| Risk | Title | AISVS v1.01 | NERV Control (Source) | Test or Gap |',
        '|---|---|---|---|---|',
        '| LLM01 | Prompt Injection | `v1.01-C1.1.1` | `src/foo.ts` | TODO |',
      ].join('\n'),
    );

    const result = checkThreatMap({ rootDir: dir });
    assert.equal(result.ok, false);
    assert.match(result.errors[0], /neither a cited test nor a named gap/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
