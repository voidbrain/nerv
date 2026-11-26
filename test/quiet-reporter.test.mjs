// @ts-check
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

const dirs = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

describe('F-096-T01 quiet test reporter and npm config', () => {
  it('keeps failing test details and logs on stdout while writing full spec report to file', () => {
    const dir = mkdtempSync(join(realpathSync(tmpdir()), 'nerv-quiet-'));
    dirs.push(dir);
    const passTest = join(dir, 'passing.test.mjs');
    const failTest = join(dir, 'failing.test.mjs');
    const specReport = join(dir, 'report.txt');
    writeFileSync(
      passTest,
      [
        "import assert from 'node:assert/strict';",
        "import { test } from 'node:test';",
        "test('passing case', () => { console.log('passing-log-hidden'); assert.equal(1, 1); });",
      ].join('\n'),
      'utf8',
    );
    writeFileSync(
      failTest,
      [
        "import assert from 'node:assert/strict';",
        "import { test } from 'node:test';",
        "test('failing case', () => { console.log('failing-diagnostic-log'); assert.equal(1, 2, 'boom-mismatch'); });",
      ].join('\n'),
      'utf8',
    );

    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const res = spawnSync(
      process.execPath,
      [
        '--test',
        '--test-reporter=./tools/quiet-reporter.mjs',
        '--test-reporter-destination=stdout',
        '--test-reporter=spec',
        `--test-reporter-destination=${specReport}`,
        passTest,
        failTest,
      ],
      { cwd: process.cwd(), encoding: 'utf8', env },
    );

    assert.notEqual(res.status, 0);
    assert.match(res.stdout, /failing case/);
    assert.match(res.stdout, /boom-mismatch/);
    assert.match(res.stdout, /failing-diagnostic-log/);
    assert.match(res.stdout, /fail 1/);
    assert.doesNotMatch(res.stdout, /passing-log-hidden/);

    const fullSpec = readFileSync(specReport, 'utf8');
    assert.match(fullSpec, /passing case/);
    assert.match(fullSpec, /failing case/);
  });

  it('sets npm loglevel=warn and ignores .test-report.txt', () => {
    assert.match(readFileSync('.npmrc', 'utf8'), /^loglevel=warn$/m);
    assert.match(readFileSync('.gitignore', 'utf8'), /^\.test-report\.txt$/m);
  });
});
