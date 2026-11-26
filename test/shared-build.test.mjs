import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, watch } from 'node:fs';
import { resolve } from 'node:path';

// B-127: the browser tests serve the checkout's production build (dist/web/browser). The gauntlet tests that need the
// build missing, present or ignored used to rename or create that folder in place, so a browser test running in the
// same `node --test` got the server's 404 {"error":"Not found."} page and timed out. They must leave it untouched.
test(
  'B-127: the gauntlet build-requirement tests never move, create or remove the shared browser build',
  {
    timeout: 120000,
  },
  async () => {
    const root = resolve('.');
    const levels = [
      [root, 'dist'],
      [resolve('dist'), 'web'],
      [resolve('dist/web'), 'browser'],
    ];
    const touched = [];
    const watchers = levels
      .filter(([dir]) => existsSync(dir))
      .map(([dir, name]) =>
        watch(dir, (_event, file) => {
          if (file === name) touched.push(dir + '/' + name);
        }),
      );
    const present = existsSync(resolve('dist/web/browser'));
    let changed = 0;
    const poll = setInterval(() => {
      if (existsSync(resolve('dist/web/browser')) !== present) changed++;
    }, 2);
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    try {
      const child = spawn(
        process.execPath,
        [
          '--test',
          '--test-reporter=tap',
          '--test-name-pattern=B-059|F-074-T10: identity-bound ledger coverage',
          'test/gauntlet.test.mjs',
        ],
        // A nested `node --test` inherits NODE_TEST_CONTEXT and would skip its files.
        { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let output = '';
      child.stdout.on('data', (chunk) => (output += chunk));
      child.stderr.on('data', (chunk) => (output += chunk));
      const code = await new Promise((done) => child.on('close', done));
      assert.equal(code, 0, 'the selected gauntlet tests pass:\n' + output.slice(-2000));
      assert.match(output, /# pass [1-9]/, 'the name pattern selected the build-requirement tests');
    } finally {
      clearInterval(poll);
      for (const watcher of watchers) watcher.close();
    }
    assert.equal(changed, 0, 'polls that saw dist/web/browser ' + (present ? 'missing' : 'appear'));
    assert.deepEqual(touched, [], 'nothing renamed, created or removed the shared build folder');
  },
);
