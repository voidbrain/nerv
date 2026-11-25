/**
 * B-122: after `nerv service move` the definition is owned by the install folder; when NERV then runs as a foreground
 * `nerv launch` (the global `nerv` command, here from another checkout) instead of the launchd service, the dashboard's
 * Update now was refused with "Service or runtime ownership is unknown or belongs elsewhere." and no way forward.
 * The join under test: the production macOS observation (launchctl, ps, authenticated doctor) → the update plan → the
 * outside updater's result. Neutral fixtures only; no real service, checkout or data home is touched.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planService } from '../src/node-lifecycle-execution.ts';
import { executeManualUpdate } from '../src/manual-update.ts';
import { INSTALLED, movedHost, NEXT, outsideUpdater, supported } from './moved-service-fixture.ts';

test('B-122: a moved, registered service is owned, so Update now only has to stop it first', supported, async () => {
  const m = await movedHost();
  try {
    m.state.registered = true;
    await m.serveDoctor(INSTALLED);
    const observed = await m.host.inspect();
    assert.equal(observed.definition, 'owned');
    assert.equal(observed.registration, 'owned');
    assert.equal(observed.runtime, 'owned');
    const preview = await planService(m.host, 'update', NEXT);
    assert.deepEqual(preview.blockers, ['Stop the selected service and descendants first.']);
  } finally {
    await m.close();
  }
});

test(
  'B-122: a foreground `nerv launch` serving the base is found and named, and nothing is stopped',
  supported,
  async () => {
    const m = await movedHost();
    try {
      // The service is not registered (stopped with `nerv service stop`); the owner runs `nerv launch` from a terminal
      // through the global `nerv` link, from another checkout. Its children run that checkout's processes.
      m.state.foreground = [
        `7100001 7099999 node node --use-system-ca /neutral/node/bin/nerv launch`,
        `7100002 7100001 /neutral/node/bin/node /neutral/node/bin/node --use-system-ca /neutral/dev/src/nervous-process.ts`,
        `7100003 7100001 /neutral/node/bin/node /neutral/node/bin/node --use-system-ca /neutral/dev/src/brain-process.ts`,
      ].join('\n');
      await m.serveDoctor('d'.repeat(40));
      const observed = await m.host.inspect();
      assert.equal(observed.definition, 'owned', 'the moved definition is still the one the install folder expects');
      assert.equal(observed.registration, 'absent');
      assert.equal(observed.runtime, 'unknown');
      assert.deepEqual(observed.pids, [7100001, 7100002, 7100003], 'the foreground launch and its children are found');

      const result = await executeManualUpdate(outsideUpdater(m.host), { revision: NEXT, channel: 'main' });
      assert.equal(result.outcome, 'refused');
      const why = result.reasons.join(' ');
      assert.match(why, /foreground/i, 'the reason says NERV runs in the foreground, outside the service');
      assert.match(why, /nerv launch/);
      assert.match(why, /7100001/, 'the reason names the process to stop');
      assert.doesNotMatch(why, /ownership is unknown/, 'not the generic ownership refusal');
      assert.ok(
        !m.state.calls.some((c) => c[0] === 'launchctl' && (c[1] === 'bootout' || c[1] === 'kickstart')),
        'nothing is stopped',
      );

      // Once the foreground NERV is stopped, the same update plan on the same host has nothing in its way.
      m.state.foreground = '';
      await m.stopDoctor();
      const ready = await planService(m.host, 'update', NEXT);
      assert.deepEqual(ready.blockers, []);
    } finally {
      await m.close();
    }
  },
);
