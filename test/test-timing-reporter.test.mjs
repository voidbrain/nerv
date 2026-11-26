// @ts-check
// B-118: the timing reporter names the test file a stopped run hung in, and the npm scripts and CI use it.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { summarize } from '../tools/test-timing-reporter.mjs';

const dirs = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

function files() {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'nerv-timing-'));
  dirs.push(dir);
  const write = (name, body) => {
    const path = join(dir, name);
    writeFileSync(path, ["import { test } from 'node:test';", body].join('\n'), 'utf8');
    return path;
  };
  return {
    dir,
    log: join(dir, 'timings.txt'),
    quick: write('quick.test.mjs', "test('quick', () => {});"),
    slow: write('slow.test.mjs', "test('slow', () => new Promise((done) => setTimeout(done, 300)));"),
    // Its test passes, but a leaked timer keeps the file's process alive: the run never ends on its own.
    hung: write('hung.test.mjs', "test('leaks a timer', () => { setInterval(() => {}, 1000); });"),
    // Fails one test (and a subtest) while the hung file, started first, still holds the run.
    failing: write(
      'zfail.test.mjs',
      [
        "test('passes', () => {});",
        "test('fails its check', () => { throw new Error('fixture check failed\\nsecond line'); });",
        "test('times out', { timeout: 50 }, () => new Promise(() => {}));",
      ].join('\n'),
    ),
  };
}

const args = (...paths) => [
  '--test',
  '--test-reporter=./tools/test-timing-reporter.mjs',
  '--test-reporter-destination=stdout',
  ...paths,
];
const env = (log) => {
  /** @type {NodeJS.ProcessEnv} */
  const next = { ...process.env, NERV_TEST_TIMINGS: log };
  delete next.NODE_TEST_CONTEXT;
  return next;
};

describe('B-118 test timing reporter', () => {
  it('lists each finished file with its time, slowest first, and the run end', () => {
    const f = files();
    const res = spawnSync(process.execPath, args(f.quick, f.slow), { encoding: 'utf8', env: env(f.log) });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, '', 'the reporter itself prints nothing');
    const { done, unfinished, end } = summarize(readFileSync(f.log, 'utf8'));
    assert.deepEqual(
      done.map((d) => [d.file.split('/').pop(), d.result]),
      [
        ['slow.test.mjs', 'pass'],
        ['quick.test.mjs', 'pass'],
      ],
    );
    assert.ok(done[0].seconds >= 0.3, `slow file took ${done[0].seconds} s`);
    assert.deepEqual(unfinished, []);
    assert.equal(typeof end, 'number');

    const printed = spawnSync(process.execPath, ['tools/test-timing-reporter.mjs', f.log], { encoding: 'utf8' });
    assert.match(printed.stdout, /^2 files finished; .* wall \d+ s\.\n/);
    assert.match(printed.stdout, /s {2}.*slow\.test\.mjs\n.*quick\.test\.mjs/);
  });

  it('names the file that never finished when the run is stopped from outside', async () => {
    const f = files();
    const child = spawn(process.execPath, args(f.quick, f.hung), { env: env(f.log), stdio: 'ignore' });
    try {
      // Stop the run once the finished file is logged, as the CI step limit would: the hung file stays open.
      const end = Date.now() + 20000;
      while (!(existsSync(f.log) && /^done .*quick\.test\.mjs/m.test(readFileSync(f.log, 'utf8')))) {
        assert.ok(Date.now() < end, 'the quick file is logged as finished');
        await new Promise((done) => setTimeout(done, 50));
      }
      await new Promise((done) => setTimeout(done, 300));
      assert.equal(child.exitCode, null, 'the leaked timer keeps the run alive');
    } finally {
      child.kill('SIGKILL');
    }
    const { done, unfinished, end } = summarize(readFileSync(f.log, 'utf8'));
    assert.deepEqual(
      unfinished.map((u) => u.file.split('/').pop()),
      ['hung.test.mjs'],
    );
    assert.deepEqual(
      done.map((d) => d.file.split('/').pop()),
      ['quick.test.mjs'],
    );
    assert.equal(end, undefined);
    const printed = spawnSync(process.execPath, ['tools/test-timing-reporter.mjs', f.log], { encoding: 'utf8' });
    assert.match(printed.stdout, /the run did not finish/);
    assert.match(printed.stdout, /NOT FINISHED {2}.*hung\.test\.mjs/);
  });

  // B-118-T03: run 45314998906 stopped with worker-link-admission.test.ts failed, but the spec report queues each file's
  // results behind the hung one, so the failing test was never named.
  it('names each failed test and its error as it happens, while another file keeps the run alive', async () => {
    const f = files();
    const child = spawn(process.execPath, args(f.hung, f.failing), { env: env(f.log), stdio: 'ignore' });
    try {
      const end = Date.now() + 20000;
      while (!(existsSync(f.log) && /^done .*zfail\.test\.mjs/m.test(readFileSync(f.log, 'utf8')))) {
        assert.ok(Date.now() < end, 'the failing file is logged as finished');
        await new Promise((done) => setTimeout(done, 50));
      }
      assert.equal(child.exitCode, null, 'the hung file keeps the run alive');
    } finally {
      child.kill('SIGKILL');
    }
    const { failed, unfinished } = summarize(readFileSync(f.log, 'utf8'));
    assert.deepEqual(
      unfinished.map((u) => u.file.split('/').pop()),
      ['hung.test.mjs'],
    );
    assert.deepEqual(
      failed.map((x) => [x.file.split('/').pop(), x.test, x.error]),
      [
        ['zfail.test.mjs', 'fails its check', 'fixture check failed'],
        ['zfail.test.mjs', 'times out', 'test timed out after 50ms'],
      ],
    );
    const printed = spawnSync(process.execPath, ['tools/test-timing-reporter.mjs', f.log], { encoding: 'utf8' });
    assert.match(printed.stdout, /FAILED {2}.*zfail\.test\.mjs > fails its check: fixture check failed\n/);
    assert.match(printed.stdout, /FAILED {2}.*zfail\.test\.mjs > times out: test timed out after 50ms\n/);
  });

  it('npm test and test:coverage use it, its log is ignored, and CI uploads the dot-named reports', () => {
    const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
    for (const name of ['test', 'test:coverage'])
      assert.match(
        scripts[name],
        /--test-reporter=\.\/tools\/test-timing-reporter\.mjs --test-reporter-destination=stdout/,
      );
    assert.match(readFileSync('.gitignore', 'utf8'), /^\.test-timings\.txt$/m);
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    const upload = ci.slice(ci.indexOf('name: windows-test-report'));
    assert.match(upload.slice(0, 400), /include-hidden-files: true/, 'upload-artifact skips dot files by default');
    assert.match(upload.slice(0, 400), /\.test-timings\.txt/);
  });
});
