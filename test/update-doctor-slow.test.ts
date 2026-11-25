/**
 * B-135: on a busy Mac (load 25–40) the dashboard's Update now was refused with "Service or runtime ownership is
 * unknown or belongs elsewhere." although the definition, the registration and the running commit all matched: the
 * observation gave NERV's own doctor 1.5 s once, and an unanswered doctor was reported as an ownership problem.
 * The join under test: the production macOS observation with a slow or failing doctor → the update plan's blockers →
 * the outside updater's result. Neutral fixtures only; no real service, checkout or data home is touched.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planService } from '../src/node-lifecycle-execution.ts';
import { executeManualUpdate } from '../src/manual-update.ts';
import { INSTALLED, movedHost, NEXT, outsideUpdater, supported } from './moved-service-fixture.ts';

const STOP_FIRST = 'Stop the selected service and descendants first.';
const OWNERSHIP = /ownership is unknown/;
const stopped = (calls: string[][]) =>
  calls.some((c) => c[0] === 'launchctl' && (c[1] === 'bootout' || c[1] === 'kickstart'));

test('B-135: a doctor that answers after 2 s on a busy machine is still the owned service', supported, async () => {
  const m = await movedHost();
  try {
    m.state.registered = true;
    await m.serveDoctor(INSTALLED, (_req, _res, answer) => setTimeout(answer, 2000));
    const observed = await m.host.inspect();
    assert.equal(observed.runtime, 'owned', 'a slow answer within the bound is an answer');
    const preview = await planService(m.host, 'update', NEXT);
    assert.deepEqual(preview.blockers, [STOP_FIRST]);
  } finally {
    await m.close();
  }
});

test('B-135: a doctor that misses the first attempt and answers the second is owned', supported, async () => {
  const m = await movedHost({ timeoutMs: 300, attempts: 2 });
  try {
    m.state.registered = true;
    let asked = 0;
    await m.serveDoctor(INSTALLED, (_req, _res, answer) => {
      if (++asked > 1) answer();
    });
    const observed = await m.host.inspect();
    assert.equal(asked, 2);
    assert.equal(observed.runtime, 'owned');
  } finally {
    await m.close();
  }
});

test(
  'B-135: an unanswered doctor is named with its measured time, not as ownership, and nothing is stopped',
  supported,
  async () => {
    const m = await movedHost({ timeoutMs: 300, attempts: 2 });
    try {
      m.state.registered = true;
      await m.serveDoctor(INSTALLED, () => {}); // never answers
      const observed = await m.host.inspect();
      assert.equal(observed.runtime, 'unknown', 'an unanswered runtime is never treated as owned');
      assert.equal(observed.doctor?.outcome, 'timeout');
      assert.ok(observed.doctor!.ms >= 600, 'both attempts were waited for');

      const result = await executeManualUpdate(outsideUpdater(m.host), { revision: NEXT, channel: 'main' });
      assert.equal(result.outcome, 'refused');
      const why = result.reasons.join(' ');
      assert.match(why, /did not answer its health check within 0\.3 s/);
      assert.match(why, /2 attempts, \d+\.\d s in all/, 'the measured time is named');
      assert.match(why, /busy/);
      assert.match(why, /Nothing was stopped; try again/);
      assert.doesNotMatch(why, OWNERSHIP, 'not the generic ownership refusal');
      assert.ok(!stopped(m.state.calls), 'nothing is stopped');
    } finally {
      await m.close();
    }
  },
);

test('B-135: a doctor answering non-OK is named with its status, not as ownership', supported, async () => {
  const m = await movedHost({ timeoutMs: 300, attempts: 2 });
  try {
    m.state.registered = true;
    await m.serveDoctor(INSTALLED, (_req, res) => {
      res.statusCode = 503;
      res.end('busy');
    });
    const preview = await planService(m.host, 'update', NEXT);
    const why = preview.blockers.join(' ');
    assert.match(why, /answered its health check with HTTP 503/);
    assert.doesNotMatch(why, OWNERSHIP);
    assert.equal(preview.before.runtime, 'unknown');
  } finally {
    await m.close();
  }
});

test('B-135: a doctor that answers for another revision is still an ownership refusal', supported, async () => {
  const m = await movedHost({ timeoutMs: 300, attempts: 2 });
  try {
    m.state.registered = true;
    await m.serveDoctor('d'.repeat(40));
    const preview = await planService(m.host, 'update', NEXT);
    assert.equal(preview.before.runtime, 'unknown');
    assert.equal(preview.before.doctor, undefined);
    assert.match(preview.blockers.join(' '), OWNERSHIP);
  } finally {
    await m.close();
  }
});
