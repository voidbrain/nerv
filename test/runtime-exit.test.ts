// B-118: a test file that starts Runtimes always exits, even when a test is cancelled at its timeout before its own
// cleanup. Windows CI run 45314998906 stopped at its 18-minute limit with test/watch-runtime.test.ts started and never
// finished after "F-026: stopping a watch while it waits for approval…" failed at 30 s: the same mechanism as the
// worker-link files (test/worker-link-exit.test.ts), in another file. Two layers: the shared teardown
// (test/fixtures/teardown.ts) closes what a cancelled test's fixture left open, and the exit guard
// (test/fixtures/exit-guard.ts, preloaded by `npm test`) ends any file still running after its tests and names what
// held it, so no file can hold the CI step to its limit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runProbe } from './fixtures/probe.ts';

const fixtures = join(import.meta.dirname, 'fixtures');
// Generous for a slow Windows runner: the probes' own tests end within about 10 s; a leaked fixture never ends.
const EXIT_MS = 45_000;

for (const name of ['times out while the fixture starts', 'times out while a watch waits on the model']) {
  test(
    `B-118: a watch-runtime test file exits when a test ${name.replace('times out', 'is cancelled')}`,
    { timeout: EXIT_MS + 15_000 },
    async () => {
      const run = await runProbe(join(fixtures, 'watch-runtime-timeout.probe.ts'), name, EXIT_MS);
      assert.notEqual(run.code, 'hung', `the probe file was still running after ${EXIT_MS} ms:\n${run.output}`);
      // The probe's test itself failed on its timeout: the cancellation this test is about really happened.
      assert.match(run.output, /failureType: 'testTimeoutFailure'/, run.output);
      assert.match(run.output, /# cancelled 1\b/, run.output);
    },
  );
}

test(
  'B-118: the exit guard ends a file that leaked a Runtime and names what held it',
  { timeout: EXIT_MS + 15_000 },
  async () => {
    const run = await runProbe(join(fixtures, 'leaky-runtime.probe.ts'), 'leaks a Runtime', EXIT_MS, {
      args: ['--import', './test/fixtures/exit-guard.ts'],
      env: { NERV_EXIT_GUARD_MS: '1000' },
    });
    assert.notEqual(run.code, 'hung', `the probe file was still running after ${EXIT_MS} ms:\n${run.output}`);
    assert.match(run.output, /# pass 1\b/, run.output);
    assert.match(run.output, /B-118: .*leaky-runtime\.probe\.ts still running \d+ s after its tests ended; held by /);
    // A leak is a failure of its file even when every test passed: the next run names it instead of hanging.
    assert.notEqual(run.code, 0, run.output);
  },
);

test('B-118: npm test, test:coverage and the selected regressions preload the exit guard', () => {
  const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
  for (const name of ['test', 'test:coverage'])
    assert.match(scripts[name], /node --test --import \.\/test\/fixtures\/exit-guard\.ts /, name);
  assert.match(readFileSync('tools/selected-tests.mjs', 'utf8'), /'--import','\.\/test\/fixtures\/exit-guard\.ts'/);
});
