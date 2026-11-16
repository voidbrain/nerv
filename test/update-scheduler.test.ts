import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../src/runtime.ts';
import { makeServer } from '../src/server.ts';
import type { UpdateControl } from '../src/server-update.ts';
import type { UpdateAvailability } from '../src/update-availability.ts';
import type { AutoUpdateEvaluation, AutoUpdatePolicy } from '../src/update-policy.ts';
import {
  AutoUpdateScheduler,
  isPostponeCommand,
  localParts,
  nextApplyWindow,
  zonedTime,
} from '../src/update-scheduler.ts';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const TZ = 'Europe/Rome';
const at = (iso: string) => new Date(iso);
const availability = (
  status: UpdateAvailability['status'] = 'update-available',
  availableRevision: string | null = B,
): UpdateAvailability => ({
  version: 1,
  channel: 'main',
  installedRevision: A,
  runningRevision: A,
  availableRevision,
  status,
  updateAvailable: status === 'update-available',
  restartRequired: false,
  checkedAt: '2026-11-16T19:00:00.000Z',
});
const completed = (input: { target: string; channel: string; revision?: string }): AutoUpdateEvaluation => ({
  outcome: 'completed',
  enabled: true,
  target: input.target,
  channel: 'main',
  revision: input.revision ?? null,
  reasons: [],
  recovery: [],
});

/** A scheduler over fakes: every check, evaluation and notice is recorded; the policy can change between ticks. */
function harness(
  policy: () => AutoUpdatePolicy,
  options: {
    check?: () => UpdateAvailability;
    evaluate?: (input: { target: string; channel: string; revision?: string }) => AutoUpdateEvaluation;
  } = {},
) {
  const notices: string[] = [];
  const checks: string[] = [];
  const evaluations: { target: string; channel: string; revision?: string }[] = [];
  const scheduler = new AutoUpdateScheduler({
    readPolicy: policy,
    check: async (channel) => {
      checks.push(channel);
      return options.check ? options.check() : availability();
    },
    evaluate: async (input) => {
      evaluations.push(input);
      return options.evaluate ? options.evaluate(input) : completed(input);
    },
    notify: (message) => {
      notices.push(message);
    },
    settings: () => ({ timeZone: TZ, language: 'en', target: 'NERV-01' }),
  });
  return { scheduler, notices, checks, evaluations };
}
const enabled: AutoUpdatePolicy = { enabled: true, channels: ['main'], targets: ['NERV-01'] };

test('the schedule is read in the configured time zone: 20:00 and 03:00 in Rome, across DST', () => {
  assert.deepEqual(localParts(at('2026-11-16T19:00:00Z'), TZ), { day: '2026-11-16', hour: 20, minute: 0 });
  assert.deepEqual(localParts(at('2026-07-01T18:30:00Z'), TZ), { day: '2026-07-01', hour: 20, minute: 30 });
  assert.equal(zonedTime('2026-11-17', 3, TZ).toISOString(), '2026-11-17T02:00:00.000Z');
  assert.equal(zonedTime('2026-07-02', 3, TZ).toISOString(), '2026-07-02T01:00:00.000Z');
  assert.equal(nextApplyWindow(at('2026-11-16T19:00:00Z'), TZ).toISOString(), '2026-11-17T02:00:00.000Z');
  // Strictly after: at 03:00 exactly the next window is the following night.
  assert.equal(nextApplyWindow(at('2026-11-17T02:00:00Z'), TZ).toISOString(), '2026-11-18T02:00:00.000Z');
  // Before 03:00 the window is the same night.
  assert.equal(nextApplyWindow(at('2026-11-17T00:30:00Z'), TZ).toISOString(), '2026-11-17T02:00:00.000Z');
  // The night the clocks go forward (29 March 2026) 03:00 CEST is 01:00 UTC.
  assert.equal(nextApplyWindow(at('2026-03-28T22:00:00Z'), TZ).toISOString(), '2026-03-29T01:00:00.000Z');
  for (const yes of ['aspetta', 'Wait!', '  wait  ', 'ASPETTA.']) assert.equal(isPostponeCommand(yes), true, yes);
  for (const no of ['wait, what time is it?', 'aspetta un attimo', 'waiting', ''])
    assert.equal(isPostponeCommand(no), false, no);
});

test('nothing runs while the policy is off, and disabling it clears an announced update', async () => {
  let policy: AutoUpdatePolicy = { enabled: false, channels: [], targets: [] };
  const h = harness(() => policy);
  assert.deepEqual(await h.scheduler.tick(at('2026-11-16T19:00:00Z')), { action: 'disabled' });
  assert.deepEqual(await h.scheduler.tick(at('2026-11-17T02:00:00Z')), { action: 'disabled' });
  assert.equal(h.checks.length, 0);
  assert.equal(h.notices.length, 0);
  assert.equal(h.scheduler.postpone('aspetta')?.postponed, false);
  policy = enabled;
  assert.equal((await h.scheduler.tick(at('2026-11-16T19:00:00Z'))).action, 'announced');
  policy = { enabled: false, channels: [], targets: [] };
  assert.deepEqual(await h.scheduler.tick(at('2026-11-16T19:01:00Z')), { action: 'disabled' });
  assert.equal(h.scheduler.state().scheduled, undefined);
  assert.equal((await h.scheduler.tick(at('2026-11-17T02:00:00Z'))).action, 'disabled');
  assert.equal(h.evaluations.length, 0);
});

test('the 20:00 check announces the revision with its apply time once a day; "aspetta" moves it a night; 03:00 applies it', async () => {
  const h = harness(() => enabled);
  assert.deepEqual(await h.scheduler.tick(at('2026-11-16T18:59:00Z')), { action: 'idle' });
  assert.deepEqual(await h.scheduler.tick(at('2026-11-16T19:00:00Z')), {
    action: 'announced',
    revision: B,
    applyAt: '2026-11-17T02:00:00.000Z',
  });
  assert.equal(h.notices.length, 1);
  assert.match(h.notices[0]!, /Update bbbbbbb available \(main\)/);
  assert.match(h.notices[0]!, /03:00/);
  assert.match(h.notices[0]!, /unless you say "wait"/);
  // One check a day, whatever the minute.
  assert.deepEqual(await h.scheduler.tick(at('2026-11-16T19:01:00Z')), { action: 'idle' });
  assert.deepEqual(await h.scheduler.tick(at('2026-11-16T22:30:00Z')), { action: 'idle' });
  assert.equal(h.checks.length, 1);
  // Not the command: ordinary chat.
  assert.equal(h.scheduler.postpone('wait, what?', at('2026-11-16T19:05:00Z')), undefined);
  const postponed = h.scheduler.postpone('aspetta', at('2026-11-16T19:05:00Z'));
  assert.equal(postponed?.postponed, true);
  assert.match(postponed?.reply ?? '', /postponed to .*03:00/);
  assert.equal(h.scheduler.state().scheduled?.applyAt, '2026-11-18T02:00:00.000Z');
  // The first night passes without an apply.
  assert.deepEqual(await h.scheduler.tick(at('2026-11-17T02:00:00Z')), { action: 'idle' });
  assert.equal(h.evaluations.length, 0);
  // The next night it applies with the announced revision; the notice says so before and after.
  const applied = await h.scheduler.tick(at('2026-11-18T02:00:00Z'));
  assert.equal(applied.action, 'evaluated');
  assert.deepEqual(h.evaluations, [{ target: 'NERV-01', channel: 'main', revision: B }]);
  assert.match(h.notices[1]!, /Applying update bbbbbbb \(main\) now/);
  assert.match(h.notices[2]!, /Update bbbbbbb applied/);
  assert.equal(h.scheduler.state().scheduled, undefined);
});

test('a refusal is reported with the next try; a window missed during the day waits for the next night; a failed check is retried', async () => {
  let fail = true;
  const h = harness(() => enabled, {
    check: () => {
      if (fail) throw new Error('network down');
      return availability();
    },
    evaluate: (input) => ({ ...completed(input), outcome: 'refused', reasons: ['2 active run(s) waiting.'] }),
  });
  await assert.rejects(h.scheduler.tick(at('2026-11-16T19:00:00Z')), /network down/);
  fail = false;
  assert.equal((await h.scheduler.tick(at('2026-11-16T19:01:00Z'))).action, 'announced');
  assert.equal(h.checks.length, 2);
  const refused = await h.scheduler.tick(at('2026-11-17T02:00:00Z'));
  assert.equal(refused.action, 'evaluated');
  assert.equal(refused.action === 'evaluated' && refused.nextApplyAt, '2026-11-18T02:00:00.000Z');
  assert.match(h.notices.at(-1)!, /refused: 2 active run\(s\) waiting\. Next try .*03:00/);
  // The service was down at 03:00: at 10:00 the window has passed, but nothing applies during the day.
  assert.deepEqual(await h.scheduler.tick(at('2026-11-18T09:00:00Z')), {
    action: 'postponed',
    applyAt: '2026-11-19T02:00:00.000Z',
  });
  assert.equal(h.evaluations.length, 1);
});

test('through the server: the switch, the scheduled check, the inbox notice, "aspetta" by chat and the 03:00 evaluation share one state', async () => {
  const runtime = new Runtime(':memory:');
  const token = 'c'.repeat(32);
  let control: UpdateControl | undefined;
  let saved: AutoUpdatePolicy = { enabled: false, channels: [], targets: [] };
  let checks = 0;
  const server = makeServer(runtime, token, {
    base: { id: 'NERV-01', name: 'Test base' },
    updateCheck: async () => {
      checks++;
      return availability();
    },
    readUpdatePolicy: () => saved,
    saveUpdatePolicy: (policy) => {
      saved = policy;
      return policy;
    },
    exposeUpdateControl: (c) => {
      control = c;
    },
  });
  try {
    await runtime.ready();
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const call = (path: string, init?: RequestInit) =>
      fetch(base + path, {
        ...init,
        headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      });
    assert.ok(control, 'the server hands out its update control');
    const scheduler = new AutoUpdateScheduler({
      readPolicy: () => control!.readPolicy(),
      check: (channel) => control!.check(channel),
      evaluate: (input) => control!.evaluate(input),
      notify: (message) => runtime.notice(message),
      settings: () => ({ timeZone: TZ, language: 'it', target: 'NERV-01' }),
    });
    runtime.setUpdatePostpone((text) => scheduler.postpone(text, at('2026-11-16T19:05:00Z')));
    // Off by default: the 20:00 tick checks nothing.
    assert.deepEqual(await scheduler.tick(at('2026-11-16T19:00:00Z')), { action: 'disabled' });
    assert.equal(checks, 0);
    // The dashboard switch: enabling with an empty selection means this base on main.
    const switched = (await (
      await call('/api/update/policy', {
        method: 'POST',
        body: JSON.stringify({ enabled: true, channels: [], targets: [] }),
      })
    ).json()) as { policy: AutoUpdatePolicy };
    assert.deepEqual(
      [switched.policy.enabled, switched.policy.channels, switched.policy.targets],
      [true, ['main'], ['NERV-01']],
    );
    assert.equal((await scheduler.tick(at('2026-11-16T19:00:00Z'))).action, 'announced');
    assert.equal(checks, 1);
    const inbox = async () => JSON.stringify(await (await call('/api/inbox')).json());
    assert.match(await inbox(), /Aggiornamento bbbbbbb disponibile \(main\)\. Lo applico .*03:00 salvo tu dica/);
    // "aspetta" by chat is answered before planning, in the owner's language, and moves the apply by a night.
    const chat = async (message: string) =>
      (await (
        await call('/api/chat', { method: 'POST', body: JSON.stringify({ message, conversation: 'dashboard' }) })
      ).json()) as { command?: boolean; reply: string; sortieId: string };
    const reply = await chat('aspetta');
    assert.equal(reply.command, true);
    assert.match(reply.reply, /Va bene, aspetto: aggiornamento bbbbbbb rimandato a .*03:00/);
    assert.equal(reply.sortieId, '');
    assert.equal(scheduler.state().scheduled?.applyAt, '2026-11-18T02:00:00.000Z');
    assert.deepEqual(await runtime.sorties(), []);
    // Nothing on the first night; the next 03:00 evaluates through the server's own path and reports the outcome.
    assert.deepEqual(await scheduler.tick(at('2026-11-17T02:00:00Z')), { action: 'idle' });
    const evaluated = await scheduler.tick(at('2026-11-18T02:00:00Z'));
    assert.equal(evaluated.action, 'evaluated');
    assert.equal(evaluated.action === 'evaluated' && evaluated.evaluation.target, 'NERV-01');
    const policy = (await (await call('/api/update/policy')).json()) as { lastAttempt?: AutoUpdateEvaluation };
    assert.equal(policy.lastAttempt?.revision, B);
    assert.match(await inbox(), /Applico l'aggiornamento bbbbbbb/);
    // Switching off from the dashboard stops the schedule.
    await call('/api/update/policy', {
      method: 'POST',
      body: JSON.stringify({ enabled: false, channels: ['main'], targets: ['NERV-01'] }),
    });
    assert.deepEqual(await scheduler.tick(at('2026-11-18T19:00:00Z')), { action: 'disabled' });
    // The evaluation re-checked availability once more; switching off adds nothing.
    assert.equal(checks, 2);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    await runtime.close();
  }
});
