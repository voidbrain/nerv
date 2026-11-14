import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runNodeCommand } from '../src/node-inspection.ts';

// B-062: the owner must see which prerequisite failed. ssh exits 255 for its own errors and passes the remote
// command's 127 ("command not found") through, so a target without Node.js is told apart from an unreachable one.
const exit = (code: number) =>
  runNodeCommand({ program: 'sh', args: ['-c', `exit ${code}`], timeoutMs: 5000, maxBytes: 1024 });

test('an unreachable SSH target is named as such', async () => {
  await assert.rejects(exit(255), /could not be reached over SSH.*no installation was requested/);
});
test('a target without Node.js is named as such', async () => {
  await assert.rejects(exit(127), /Node\.js was not found.*no installation was requested/);
});
test('other failures keep the generic read-only message', async () => {
  await assert.rejects(exit(1), /^Error: Read-only command failed/);
});
