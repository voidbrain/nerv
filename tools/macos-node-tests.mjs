// B-157: the Node tests that skip on every runner but macOS (sandbox-exec, launchctl, the macOS desktop driver). The
// live service runs on macOS, so CI runs them on the native-macos job, and a skip there is a failure: a skipped
// confinement test proves nothing. test/macos-node-tests.test.mjs keeps this list complete.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MACOS_NODE_TESTS = [
  'test/desktop-macos-driver.test.ts',
  'test/egress-proxy.test.ts',
  'test/eva-classes-runner.test.ts',
  'test/eva-gate.test.ts',
  'test/eva-job-user.test.ts',
  'test/eva-jobs.test.ts',
  'test/eva-pool.test.ts',
  'test/eva-runner.test.ts',
  'test/update-doctor-slow.test.ts',
  'test/update-foreground-runtime.test.ts',
];

/** Test files with a skip that only macOS satisfies: a darwin or sandbox-exec condition, or the moved-service fixture. */
export function darwinOnlyTests(files, read) {
  const gate = /skip\b.*(platform [!=]== 'darwin'|isDarwinWithSandbox|hasHostSandbox)/;
  return files
    .filter((file) => /\.test\.(ts|mjs)$/.test(file))
    .filter((file) => {
      const text = read(file);
      return (
        text.includes('./moved-service-fixture.ts') ||
        text.split('\n').some((line) => gate.test(line) && !line.includes("'linux'"))
      );
    })
    .sort();
}

/** The run passes only when tests ran and none failed or skipped (node --test TAP summary). */
export function verdict(tap) {
  const count = (name) => Number(new RegExp(`^# ${name} (\\d+)$`, 'm').exec(tap)?.[1] ?? 0);
  const tests = count('tests'),
    fail = count('fail'),
    skipped = count('skipped'),
    cancelled = count('cancelled');
  if (!tests) return { ok: false, why: 'no test ran' };
  if (fail || cancelled) return { ok: false, why: `${fail + cancelled} failed` };
  if (skipped) return { ok: false, why: `${skipped} skipped on macOS` };
  return { ok: true, why: `${tests} passed` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.platform !== 'darwin') {
    console.error('macos-node-tests: run on macOS; these tests skip elsewhere');
    process.exit(1);
  }
  const run = spawnSync(
    process.execPath,
    [
      '--test',
      '--import',
      './test/fixtures/exit-guard.ts',
      '--import',
      './test/fixtures/sqlite-no-fsync.ts',
      '--test-timeout=120000',
      '--test-reporter=tap',
      ...MACOS_NODE_TESTS,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const tap = run.stdout + run.stderr;
  // Failures, skips and the summary only: the full TAP stream is long and says nothing on a pass.
  console.log(
    tap
      .split('\n')
      .filter((line) => /^(\s*not ok|.*# SKIP|# (tests|pass|fail|skipped|cancelled|duration_ms))/.test(line))
      .join('\n'),
  );
  const result = verdict(tap);
  if (!result.ok || run.status !== 0) {
    // The whole stream on a failure: the YAML block under each `not ok` says what failed and where.
    console.error(tap);
    console.error('macos-node-tests: ' + (result.ok ? 'node --test exited ' + run.status : result.why));
    process.exit(1);
  }
  console.log('macos-node-tests: ' + result.why);
}
