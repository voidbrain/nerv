// B-152: the Node tests that only run on macOS (the EVA sandbox-exec confinement, the egress proxy, the EVA job user,
// the desktop driver, the moved-service joins) run on the macOS CI runner, and that run fails when one of them skips.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { MACOS_NODE_TESTS, darwinOnlyTests, verdict } from '../tools/macos-node-tests.mjs';

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const job = (name) => {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, name + ' job');
  const next = workflow.slice(start + 1).search(/\n {2}[a-z][\w-]*:\n/);
  return next < 0 ? workflow.slice(start) : workflow.slice(start, start + 1 + next);
};

test('B-152: every test file with a macOS-only skip is in the macOS list, and every listed file exists', () => {
  const files = readdirSync('test').map((f) => `test/${f}`);
  const found = darwinOnlyTests(files, (f) => readFileSync(f, 'utf8'));
  for (const known of [
    'test/eva-classes-runner.test.ts',
    'test/eva-pool.test.ts',
    'test/eva-runner.test.ts',
    'test/eva-jobs.test.ts',
    'test/eva-job-user.test.ts',
    'test/egress-proxy.test.ts',
    'test/desktop-macos-driver.test.ts',
    'test/eva-gate.test.ts',
    'test/update-doctor-slow.test.ts',
    'test/update-foreground-runtime.test.ts',
  ])
    assert.ok(found.includes(known), known + ' is detected as macOS-only');
  assert.deepEqual(
    found.filter((f) => !MACOS_NODE_TESTS.includes(f)),
    [],
    'macOS-only tests missing from the list',
  );
  for (const f of MACOS_NODE_TESTS) assert.ok(files.includes(f), f + ' exists');
  // A test that also runs on Linux (darwin or linux) is not macOS-only.
  assert.deepEqual(
    darwinOnlyTests(['a.test.ts'], () => "{ skip: process.platform !== 'darwin' && process.platform !== 'linux' }"),
    [],
  );
});

test('B-152: a macOS run fails on any skipped, failed or missing test', () => {
  const tap = (tests, fail, skipped) =>
    `# tests ${tests}\n# pass ${tests - fail - skipped}\n# fail ${fail}\n# skipped ${skipped}\n`;
  assert.equal(verdict(tap(45, 0, 0)).ok, true);
  assert.match(verdict(tap(45, 0, 3)).why, /3 skipped/);
  assert.match(verdict(tap(45, 1, 0)).why, /1 failed/);
  assert.match(verdict(tap(0, 0, 0)).why, /no test ran/);
  assert.match(verdict('').why, /no test ran/);
});

test('B-152: the native-macos job runs the macOS Node tests whenever Node work or a full run is selected', () => {
  const mac = job('native-macos');
  const selected = "needs.plan.outputs.full == 'true' || needs.plan.outputs.unit == 'true'";
  assert.ok(mac.includes('node tools/macos-node-tests.mjs'), 'the job runs the list');
  const step = mac.slice(mac.lastIndexOf('- ', mac.indexOf('node tools/macos-node-tests.mjs')));
  assert.ok(step.includes(selected), 'the step runs on full and unit selections');
  // Checkout, Node and npm ci run for that selection too, not only for native work.
  for (const uses of ['actions/checkout@', 'actions/setup-node@', 'run: npm ci']) {
    const at = mac.indexOf(uses);
    const condition = mac.slice(mac.lastIndexOf('- if:', at), at);
    assert.ok(condition.includes("needs.plan.outputs.native == 'true'") && condition.includes(selected), uses);
  }
});
