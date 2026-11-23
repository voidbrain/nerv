import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { nervUpdate } from '../src/nerv-update.ts';
import type { ManualUpdateResult } from '../src/manual-update.ts';
import type { ServiceHost, ServicePlan, ServiceReceipt } from '../src/node-lifecycle-execution.ts';

// F-117-T02: `nerv update [--check]` targets the install folder the lifecycle host resolved, never the checkout it
// runs from, and takes the same path as `nodes self-update`. Git and the lifecycle are fakes; nothing real runs.
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const INSTALL = join('/', 'home', 'tester', '.nerv-app');
const STOP_FIRST = 'Stop the selected service and descendants first.';

const host = {
  context: { userHome: join('/', 'home', 'tester'), home: join('/', 'home', 'tester', '.nerv'), source: INSTALL },
  inspect: async () => ({ registration: 'owned', runtime: 'owned' }),
} as unknown as ServiceHost;

/** A fake git: `remote` is origin/main; `local` lists the commits the install folder holds. */
function fakeGit(remote: string, opts: { behind?: number; fetchFails?: boolean } = {}) {
  const calls: { args: string[]; cwd: string }[] = [];
  const local = new Set([A]);
  const git = async (args: string[], cwd: string) => {
    calls.push({ args, cwd });
    const ok = (out = '') => ({ status: 0, out, err: '' });
    const no = (err = 'no') => ({ status: 1, out: '', err });
    if (args[0] === 'rev-parse') return ok(A);
    if (args[0] === 'ls-remote') return ok(`${remote}\trefs/heads/main`);
    if (args[0] === 'cat-file') return local.has(args[2]!.slice(0, 40)) ? ok() : no();
    if (args[0] === 'merge-base') return no();
    if (args[0] === 'fetch') {
      if (opts.fetchFails) return no('could not resolve host');
      local.add(args[args.length - 1]!);
      return ok();
    }
    if (args[0] === 'rev-list') return ok(String(opts.behind ?? 0));
    throw Error('unexpected git ' + args.join(' '));
  };
  return { git, calls };
}

const plan = (action: ServicePlan['action'], blockers: string[] = []) =>
  ({ action, blockers, digest: 'd'.repeat(64) }) as unknown as ServicePlan;
const receipt = (state: ServiceReceipt['state']) => ({ state, digest: 'd'.repeat(64) }) as unknown as ServiceReceipt;

/** Lifecycle fakes that follow planService/applyService: update is blocked while the service runs. */
function fakeLifecycle(updateBlockers: string[] = []) {
  const order: string[] = [];
  return {
    order,
    plan: async (_h: ServiceHost, action: 'update' | 'stop' | 'start') => {
      order.push('plan ' + action);
      const running = !order.includes('apply stop') || order.includes('apply start');
      if (action !== 'update') return plan(action);
      return plan(action, [...(running ? [STOP_FIRST] : []), ...updateBlockers]);
    },
    applyPlan: async (_h: ServiceHost, p: ServicePlan) => {
      order.push('apply ' + p.action);
      return receipt('completed');
    },
  };
}

test('F-117-T02: update --check on an up-to-date base says so and changes nothing', async () => {
  const { git, calls } = fakeGit(A);
  const life = fakeLifecycle();
  const report = await nervUpdate({ host, git, ...life }, { check: true });
  assert.equal(report.ok, true);
  assert.match(report.lines.join('\n'), /up to date/i);
  assert.match(report.lines.join('\n'), new RegExp(INSTALL.replace(/[\\.]/g, '\\$&')));
  assert.deepEqual(life.order, []);
  assert.ok(
    calls.every((c) => c.cwd === INSTALL),
    'git runs in the install folder only',
  );
  assert.ok(!calls.some((c) => c.args[0] === 'fetch'));
});

test('F-117-T02: update --check on a behind base reports N commits and never starts the lifecycle', async () => {
  const { git, calls } = fakeGit(B, { behind: 3 });
  const life = fakeLifecycle();
  const report = await nervUpdate({ host, git, ...life }, { check: true });
  assert.equal(report.ok, true);
  assert.match(report.lines.join('\n'), /behind origin\/main by 3 commits/);
  assert.deepEqual(life.order, []);
  const fetch = calls.find((c) => c.args[0] === 'fetch');
  assert.ok(fetch?.args.includes('--no-write-fetch-head'), 'the check downloads commits but moves no ref');
  assert.ok(calls.some((c) => c.args[0] === 'rev-list' && c.args.includes(`${A}..${B}`)));
  assert.ok(calls.every((c) => c.cwd === INSTALL));
});

test('F-117-T02: update --check offline says the count is unknown and fails', async () => {
  const { git } = fakeGit(B, { fetchFails: true });
  const report = await nervUpdate({ host, git, ...fakeLifecycle() }, { check: true });
  assert.match(report.lines.join('\n'), /behind origin\/main/);
  assert.match(report.lines.join('\n'), /could not resolve host/);
});

test('F-117-T02: update on a behind base fetches, stops, updates through the lifecycle and leaves the result', async () => {
  const { git, calls } = fakeGit(B, { behind: 2 });
  const life = fakeLifecycle();
  const written: ManualUpdateResult[] = [];
  const report = await nervUpdate({ host, git, ...life, writeResult: (r) => written.push(r) }, { check: false });
  assert.equal(report.ok, true, report.lines.join('\n'));
  assert.deepEqual(life.order, ['plan update', 'plan stop', 'apply stop', 'plan update', 'apply update']);
  assert.ok(calls.some((c) => c.args[0] === 'fetch' && c.args.includes(B) && c.cwd === INSTALL));
  const text = report.lines.join('\n');
  assert.match(text, /behind origin\/main by 2 commits/);
  assert.match(text, /completed/);
  assert.match(text, new RegExp(B.slice(0, 7)));
  assert.equal(written.length, 1);
  assert.equal(written[0]!.outcome, 'completed');
  assert.equal(written[0]!.revision, B);
});

test('F-117-T02: update refused before the stop prints the blockers and the recovery, stops nothing', async () => {
  const { git } = fakeGit(B, { behind: 1 });
  const life = fakeLifecycle(['This revision is not admitted.']);
  const written: ManualUpdateResult[] = [];
  const report = await nervUpdate({ host, git, ...life, writeResult: (r) => written.push(r) }, { check: false });
  assert.equal(report.ok, false);
  const text = report.lines.join('\n');
  assert.match(text, /refused/);
  assert.match(text, /This revision is not admitted\./);
  assert.match(text, /Nothing was stopped/);
  assert.ok(!life.order.includes('apply stop'));
  assert.equal(written[0]?.outcome, 'refused');
});

test('F-117-T02: update on an up-to-date base plans nothing and leaves no result', async () => {
  const { git } = fakeGit(A);
  const life = fakeLifecycle();
  const written: ManualUpdateResult[] = [];
  const report = await nervUpdate({ host, git, ...life, writeResult: (r) => written.push(r) }, { check: false });
  assert.equal(report.ok, true);
  assert.match(report.lines.join('\n'), /up to date/i);
  assert.deepEqual(life.order, []);
  assert.deepEqual(written, []);
});
