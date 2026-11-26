import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, globSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { plan } from '../tools/verification.mjs';
import { selectedTests } from '../tools/selected-tests.mjs';
const config = JSON.parse(readFileSync('.harness.json', 'utf8')),
  workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const fresh = {
  now: Date.parse('2026-11-08T12:00:00Z'),
  baseline: { run: 1, commit: 'a'.repeat(40), completed: '2026-11-07T12:00:00Z' },
  merges: 1,
};
test('NERV policy selects doc, affected, risk, stale and explicit full scopes without running models', () => {
  const docs = plan(config.verification, { ...fresh, files: ['docs/BACKLOG.md'] });
  assert.equal(docs.full, false);
  assert.deepEqual(docs.groups, []);
  const brief = plan(config.verification, { ...fresh, files: ['src/brief.ts'] });
  assert.equal(brief.full, false);
  assert.deepEqual(brief.groups, ['brief']);
  assert.deepEqual(selectedTests(config, brief.groups, brief.files), [
    'test/brief-recovery.test.ts',
    'test/brief.test.ts',
    'test/telegram.test.ts',
  ]);
  for (const files of [['src/worker-link.ts'], ['src/store.ts'], ['.github/workflows/ci.yml'], ['src/new-module.ts']])
    assert.equal(plan(config.verification, { ...fresh, files }).full, true, files.join(','));
  for (const data of [
    { merges: 10 },
    { baseline: null },
    { requested: true },
    { baseline: { ...fresh.baseline, completed: '2026-11-01T12:00:00Z' } },
  ])
    assert.equal(plan(config.verification, { ...fresh, ...data }).full, true);
});
test('changed tests join mapped dependencies; missing or empty selections fail rather than claim a check', () => {
  assert.ok(selectedTests(config, ['tests'], ['test/core.test.ts']).includes('test/core.test.ts'));
  assert.throws(() => selectedTests(config, ['unknown'], []), /Unknown/);
  assert.throws(() => selectedTests(config, ['tests'], ['test/deleted.test.ts']), /no runnable/);
  for (const group of config.verification.groups)
    for (const pattern of group.tests) {
      const files = globSync(pattern);
      assert.ok(files.length, group.id + ': ' + pattern);
      assert.ok(files.every(existsSync));
    }
});
test('CI has PR and push-to-main triggers, manual/periodic selection and a full marker gated on every required outcome', () => {
  assert.match(workflow, /on:\n {2}pull_request:/);
  assert.match(workflow, /^ {2}push:\n {4}branches: \[main\]/m);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /cancel-in-progress: true/);
  const marker = workflow.slice(workflow.indexOf('  full-suite:'));
  assert.match(marker, /needs: \[plan, validate, windows, native-macos\]/);
  assert.match(marker, /if: always\(\) && needs.plan.outputs.full == 'true'/);
  for (const name of ['PLAN', 'VALIDATE', 'WINDOWS', 'NATIVE'])
    assert.ok(marker.includes('test "$' + name + '" = success'), name + ' must succeed');
  assert.ok(workflow.includes("if: needs.plan.outputs.full != 'true' && needs.plan.outputs.unit == 'true'"));
  assert.match(workflow, /GH_TOKEN: \$\{\{ github.token \}\}/);
  assert.match(workflow, /actions: read/);
  assert.doesNotMatch(workflow, /pull_request_target|secrets\./);
});

test('B-139: a docs-only PR skips the Windows and macOS jobs at job level; any other path or event runs them', () => {
  const job = (name) =>
    workflow.slice(
      workflow.indexOf('\n  ' + name + ':\n'),
      workflow.indexOf('runs-on:', workflow.indexOf('\n  ' + name + ':\n')),
    );
  // A job-level if leaves a required check "skipped" (passing); workflow-level paths would leave it pending.
  assert.doesNotMatch(workflow.slice(0, workflow.indexOf('jobs:')), /paths(-ignore)?:/);
  assert.match(job('windows'), /if: needs.plan.outputs.docs_only != 'true' \|\| needs.plan.outputs.unit == 'true'/);
  assert.match(
    job('native-macos'),
    /if: needs.plan.outputs.docs_only != 'true' \|\| needs.plan.outputs.native == 'true'/,
  );
  assert.match(workflow, /docs_only: \$\{\{ steps.changes.outputs.docs_only \}\}/);
  const step = workflow.slice(workflow.indexOf('- id: changes'));
  assert.match(step, /if \[ "\$EVENT" = pull_request \]/, 'only a pull request can be docs-only');
  const docsOnly = new RegExp(/grep -vE '([^']+)'/.exec(step)[1]);
  for (const file of [
    'docs/work/records/B-139.md',
    'docs/work/tasks/B-139-T01.json',
    'docs/BACKLOG.md',
    'README.md',
    'LICENSE',
  ])
    assert.ok(docsOnly.test(file), file + ' is docs-only');
  for (const file of [
    'native/README.md',
    'web/src/app/x.md',
    'src/store.ts',
    'test/a.test.ts',
    '.github/workflows/ci.yml',
    'package.json',
    'docs',
  ])
    assert.ok(!docsOnly.test(file), file + ' runs the OS jobs');
});

test('B-139: the changed-paths diffs list both sides of a rename, so moving code into docs/ is not docs-only', () => {
  const codeql = readFileSync('.github/workflows/codeql.yml', 'utf8');
  assert.match(workflow, /files=\$\(git diff --no-renames --name-only "\$BASE\.\.\.\$HEAD"\)/);
  assert.match(codeql, /git diff --no-renames --name-only "\$range"/);
  const dir = mkdtempSync(join(tmpdir(), 'b139-'));
  try {
    const git = (...args) =>
      execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], {
        cwd: dir,
        encoding: 'utf8',
      });
    git('init', '-q');
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src/a.ts'), 'export const a = 1;\n');
    git('add', '.');
    git('commit', '-qm', 'base');
    mkdirSync(join(dir, 'docs'));
    git('mv', 'src/a.ts', 'docs/a.ts');
    git('commit', '-qm', 'move');
    assert.deepEqual(git('diff', '--name-only', 'HEAD~1...HEAD').trim().split('\n'), ['docs/a.ts'], 'without the flag');
    assert.deepEqual(git('diff', '--no-renames', '--name-only', 'HEAD~1...HEAD').trim().split('\n').sort(), [
      'docs/a.ts',
      'src/a.ts',
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('shared event persistence/privacy requires full verification and route recovery selects its integration case', () => {
  assert.equal(
    plan(config.verification, { ...fresh, files: ['src/events.ts'] }).full,
    true,
    'event schema and legacy grant redaction are shared persistence/privacy contracts',
  );
  const route = plan(config.verification, { ...fresh, files: ['src/route-health.ts'] });
  assert.ok(
    selectedTests(config, route.groups, route.files).includes('test/dummy-plug.test.ts'),
    'route outage/recovery must include its direct brain/runtime integration regression',
  );
});

test('Windows glob separators normalize to repository paths before validating selected regressions', () => {
  const paths = selectedTests(config, ['brief'], [], {
    expand: (pattern) => [pattern.replaceAll('/', '\\')],
    exists: () => true,
  });
  assert.deepEqual(paths, ['test/brief-recovery.test.ts', 'test/brief.test.ts', 'test/telegram.test.ts']);
});

test('retired-reference metadata selects documentation checks without hiding unknown executables or source risks', () => {
  const metadata = plan(config.verification, { ...fresh, files: ['remove/README.md', 'remove/manifest.json'] });
  assert.equal(metadata.full, false);
  assert.deepEqual(metadata.groups, []);
  assert.equal(plan(config.verification, { ...fresh, files: ['remove/new-runner.mjs'] }).full, true);
  assert.equal(plan(config.verification, { ...fresh, files: ['src/worker-link.ts'] }).full, true);
});

// B-156: the weekly scheduled full run (cron in ci.yml) used to share the per-ref group with pushes to main.
test('B-156: a scheduled run has its own concurrency group, so a push to main does not cancel it', () => {
  const group = /concurrency:\n\s+group: (.+)\n/.exec(workflow)?.[1] ?? '';
  // GitHub expressions' && and || behave as in JavaScript: evaluate the group for a push and a schedule on main.
  const resolve = (event) =>
    group.replace(/\$\{\{ (.+?) \}\}/g, (_, expression) =>
      new Function('github', `return ${expression}`)({
        workflow: 'CI',
        event_name: event,
        event: { pull_request: {} }, // GitHub reads a missing property as null
        ref: 'refs/heads/main',
      }),
    );
  assert.equal(resolve('push'), 'CI-refs/heads/main');
  assert.notEqual(resolve('schedule'), resolve('push'));
  assert.match(workflow, /cancel-in-progress: true/);
});
