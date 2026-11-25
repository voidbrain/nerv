import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { startUpdaterJob, updaterCommand, updaterPlist, UPDATER_LABEL } from '../src/updater-job.ts';

const B = 'b'.repeat(40);
const context = {
  userHome: '/Users/tester',
  home: '/Users/tester/.nerv',
  source: '/Users/tester/.nerv-app',
  node: '/usr/local/bin/node',
  uid: 501,
};

test('B-108: the updater runs nodes self-update from the install folder for one exact revision', () => {
  const cmd = updaterCommand(context, { channel: 'main', revision: B });
  assert.equal(cmd[0], context.node);
  assert.ok(cmd.includes(join(context.source, 'src/cli.ts')));
  assert.deepEqual(cmd.slice(-6), ['nodes', 'self-update', '--revision', B, '--channel', 'main']);
  assert.throws(() => updaterCommand(context, { channel: 'main', revision: 'HEAD' }), /revision/);
  assert.throws(() => updaterCommand(context, { channel: 'main; rm -rf /', revision: B }), /channel/);
});

test('B-108: the macOS updater is a one-shot launchd job of its own, never kept alive', () => {
  const plist = updaterPlist(context, { channel: 'main', revision: B });
  assert.match(plist, new RegExp(`<key>Label</key><string>${UPDATER_LABEL}</string>`));
  assert.match(plist, /<key>KeepAlive<\/key><false\/>/);
  assert.match(plist, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(plist, /<key>NERV_HOME<\/key><string>\/Users\/tester\/\.nerv<\/string>/);
  assert.ok(!plist.includes('io.nerv.agent'), 'not the service job');
});

test('B-108: starting the job replaces a finished earlier run on macOS, uses systemd-run on Linux, refuses elsewhere', async () => {
  const calls: string[] = [];
  const written: string[] = [];
  const run = async (program: string, args: string[]) => {
    calls.push([program, ...args].join(' '));
    return { status: program === 'launchctl' && args[0] === 'bootout' ? 3 : 0 };
  };
  await startUpdaterJob(context, { channel: 'main', revision: B }, run, 'darwin', (path) => written.push(path));
  assert.deepEqual(
    calls.map((c) => c.split(' ').slice(0, 2).join(' ')),
    ['launchctl bootout', 'launchctl bootstrap'],
  );
  assert.ok(written[0]!.endsWith(join('.nerv-lifecycle', 'updater', `${UPDATER_LABEL}.plist`)), written[0]);

  calls.length = 0;
  await startUpdaterJob(context, { channel: 'main', revision: B }, run, 'linux');
  assert.match(
    calls[0]!,
    /^systemd-run --user --unit=nerv-updater --collect --setenv=NERV_HOME=\/Users\/tester\/\.nerv /,
  );
  assert.match(calls[0]!, /nodes self-update --revision b{40} --channel main$/);

  await assert.rejects(startUpdaterJob(context, { channel: 'main', revision: B }, run, 'win32'), /No updater/);
  const failing = async () => ({ status: 5, err: 'Bootstrap failed: 5: Input/output error' });
  await assert.rejects(
    startUpdaterJob(context, { channel: 'main', revision: B }, failing, 'darwin', () => {}),
    /bootstrap of the updater failed/,
  );
});
