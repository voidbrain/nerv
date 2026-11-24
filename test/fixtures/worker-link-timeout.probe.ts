// B-118: a worker-link test cancelled at its timeout before its own cleanup runs. Not part of the suite (no .test.
// name); test/worker-link-exit.test.ts runs it in its own `node --test` process and requires that process to exit.
// Both tests are written as the worker-link tests are: the fixture is closed only in the test's own `finally`.
import { test } from 'node:test';
import { fixture } from './worker-link.ts';
const never = () => new Promise<never>(() => {});
// The timeout lands while fixture() is still starting the two bases: the test never holds the fixture to close it.
test('times out while the fixture starts', { timeout: 50 }, async () => {
  const f = await fixture();
  try {
    await never();
  } finally {
    await f.close();
  }
});
// The timeout lands mid-test with both links connected: the `finally` waits on an await that never settles.
test('times out with both links connected', { timeout: 8000 }, async () => {
  const f = await fixture();
  try {
    await f.start();
    await never();
  } finally {
    await f.close();
  }
});
