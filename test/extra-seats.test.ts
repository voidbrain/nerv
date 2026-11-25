import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ballot, defaultPolicy } from '../src/policy.ts';
import { Runtime } from '../src/runtime.ts';

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function until(check: () => boolean | Promise<boolean>, ms = 5000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out');
    await wait(20);
  }
}

test('ballot enforces veto-only extra seats and ignores shadow rejections', () => {
  const action = {
    tool: 'reminders.add',
    args: { title: 'Test', due: '2030-01-01T09:00:00Z' },
    trust: 'trusted' as const,
    stage: 'production' as const,
    cost: 0,
  };
  const tool = { name: 'reminders.add', effect: 'write-local' as const };
  // Shadow reject is logged in verdicts but never blocks a Green grant.
  const shadow = ballot(action, tool, defaultPolicy, 0, undefined, [
    { seat: 'lint-guard', vote: 'reject', reason: 'shadow caution', shadow: true },
  ]);
  assert.equal(shadow.outcome, 'grant');
  assert.ok(shadow.verdicts.some((v) => v.seat === 'extra:lint-guard' && v.shadow && v.vote === 'reject'));

  // Promoted (non-shadow) reject vetoes even a Green action.
  const veto = ballot(action, tool, defaultPolicy, 0, undefined, [
    { seat: 'lint-guard', vote: 'reject', reason: 'unsafe write', shadow: false },
  ]);
  assert.equal(veto.outcome, 'reject');
  assert.equal(veto.reason, 'extra:lint-guard: unsafe write');

  // An extra seat approve never replaces Casper or overrides Pattern Blue.
  const bluePolicy = { ...defaultPolicy, blue: ['reminders.add'] };
  const approved = ballot(action, tool, bluePolicy, 0, undefined, [
    { seat: 'lint-guard', vote: 'approve', reason: 'looks fine', shadow: false },
  ]);
  assert.equal(approved.outcome, 'approval');
});

test('Runtime.useExtraSeat attaches by action class, starts in shadow, promotes to veto, and abstains on timeout', async () => {
  const home = mkdtempSync(join(tmpdir(), 'nerv-extra-seats-'));
  writeFileSync(join(home, 'config.json'), JSON.stringify({}));
  writeFileSync(join(home, 'scrolls.json'), JSON.stringify(defaultPolicy), { mode: 0o600 });
  const runtime = new Runtime(join(home, 'nerv.sqlite'), undefined, home);
  try {
    await runtime.ready();
    const seenTools: string[] = [];

    // 1. Attach a deterministic seat to write-local only; starts in shadow by default.
    let releaseSlow: (() => void) | undefined;
    runtime.useExtraSeat({
      seat: 'code-guard',
      effects: ['write-local'],
      ask: async (ask) => {
        seenTools.push(ask.tool);
        if (ask.args.title === 'Slow shadow') {
          await new Promise<void>((r) => {
            releaseSlow = r;
          });
        }
        return { vote: 'reject', reason: 'blocked by code-guard' };
      },
    });

    // Read action does not match write-local, so code-guard is not asked.
    const readRes = await runtime.act({ request: 'List reminders', tool: 'reminders.list', args: {} });
    assert.equal(readRes.outcome, 'grant');
    assert.deepEqual(seenTools, []);

    // Fast shadow reject on write-local: logged (on ballot or ballot.shadow), not counted, action still grants.
    const shadowFast = await runtime.act({
      request: 'Add fast reminder',
      tool: 'reminders.add',
      args: { title: 'Fast shadow', due: '2030-01-01T09:00:00Z' },
    });
    assert.equal(shadowFast.outcome, 'grant');
    assert.deepEqual(seenTools, ['reminders.add']);
    await until(async () => {
      const evs = await runtime.events(shadowFast.sortieId);
      const b = evs.find((e) => e.kind === 'ballot');
      const inBallot = b && b.kind === 'ballot' && b.payload.verdicts.some((v) => v.seat === 'extra:code-guard');
      return !!(inBallot || evs.some((e) => e.kind === 'ballot.shadow'));
    });

    // Slow shadow reject: gate does not wait; late vote is logged as ballot.shadow.
    const shadowSlow = await runtime.act({
      request: 'Add slow reminder',
      tool: 'reminders.add',
      args: { title: 'Slow shadow', due: '2030-01-02T09:00:00Z' },
    });
    assert.equal(shadowSlow.outcome, 'grant');
    assert.ok(releaseSlow, 'slow shadow seat should have been invoked');
    releaseSlow!();
    await until(async () => (await runtime.events(shadowSlow.sortieId)).some((e) => e.kind === 'ballot.shadow'));
    const late = (await runtime.events(shadowSlow.sortieId)).find((e) => e.kind === 'ballot.shadow')!;
    assert.deepEqual(late.payload, {
      seat: 'code-guard',
      vote: 'reject',
      reason: 'blocked by code-guard',
    });

    // 2. Promote code-guard to veto (shadow: false): its reject now stops the action.
    const detach = runtime.useExtraSeat({
      seat: 'code-guard',
      effects: ['write-local'],
      shadow: false,
      ask: async () => ({ vote: 'reject', reason: 'vetoed in production' }),
    });
    const vetoed = await runtime.act({
      request: 'Add vetoed reminder',
      tool: 'reminders.add',
      args: { title: 'Vetoed', due: '2030-01-03T09:00:00Z' },
    });
    assert.equal(vetoed.outcome, 'reject');
    assert.equal(vetoed.reason, 'extra:code-guard: vetoed in production');
    detach();

    // 3. Timed-out veto seat abstains and aborts its signal instead of blocking the action.
    let aborted = false;
    runtime.useExtraSeat({
      seat: 'slow-veto',
      effects: ['write-local'],
      shadow: false,
      timeoutMs: 30,
      ask: (_ask, signal) =>
        new Promise((_resolve) => {
          signal.addEventListener('abort', () => {
            aborted = true;
          });
        }),
    });
    const timedOut = await runtime.act({
      request: 'Add reminder with slow veto',
      tool: 'reminders.add',
      args: { title: 'Timeout ok', due: '2030-01-04T09:00:00Z' },
    });
    assert.equal(aborted, true, 'timeout must abort the seat signal');
    assert.equal(timedOut.outcome, 'grant', 'timed-out veto seat abstains');
    const timeoutBallot = (await runtime.events(timedOut.sortieId)).find((e) => e.kind === 'ballot');
    assert.ok(timeoutBallot && timeoutBallot.kind === 'ballot');
    const slowVerdict = timeoutBallot.payload.verdicts.find((v) => v.seat === 'extra:slow-veto');
    assert.ok(slowVerdict);
    assert.equal(typeof slowVerdict.durationMs, 'number');
    const { durationMs: _d, ...slowRest } = slowVerdict;
    assert.deepEqual(slowRest, { seat: 'extra:slow-veto', vote: 'abstain', reason: 'timed out', shadow: false });
  } finally {
    await runtime.close();
    rmSync(home, { recursive: true, force: true });
  }
});
