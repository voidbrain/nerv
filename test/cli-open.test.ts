import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tryRunCliCommand, type CliCommandContext } from '../src/cli-commands.ts';

// B-184: `nerv open` signs the page in for that tab only, so each layout needs its own landing page.
async function opened(args: string[]) {
  const calls: { page: string; print: boolean }[] = [];
  const ctx: CliCommandContext = {
    readSecret: () => Promise.reject(new Error('not used')),
    openPage: (_home, page, print) => {
      calls.push({ page, print });
      return Promise.resolve();
    },
    reloadIfRunning: () => Promise.reject(new Error('not used')),
    flag: () => undefined,
  };
  assert.equal(await tryRunCliCommand('open', args, '/nonexistent-nerv-home', ctx), true);
  return calls;
}

test('open lands on the simple page, open dashboard on the old dashboard', async () => {
  assert.deepEqual(await opened([]), [{ page: '/', print: false }]);
  assert.deepEqual(await opened(['dashboard', '--print']), [{ page: '/dashboard/', print: true }]);
});

test('open full lands on the full dashboard with the same one-time sign-in (B-184)', async () => {
  assert.deepEqual(await opened(['full']), [{ page: '/full', print: false }]);
  assert.deepEqual(await opened(['full', '--print']), [{ page: '/full', print: true }]);
});
