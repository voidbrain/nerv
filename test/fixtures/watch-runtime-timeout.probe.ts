// B-118: a watch-runtime test cancelled at its timeout before its own cleanup runs. Not part of the suite (no .test.
// name); test/runtime-exit.test.ts runs it in its own `node --test` process and requires that process to exit.
// Both tests are written as the watch-runtime tests are: the fixture is closed only in the test's own `finally`.
import { test } from 'node:test';
import { setup } from './watch-runtime.ts';
const never = () => new Promise<never>(() => {});
// The timeout lands while setup() is still starting the Runtime: the test never holds the fixture to close it.
test('times out while the fixture starts', { timeout: 50 }, async () => {
  const t = await setup([]);
  try {
    await never();
  } finally {
    await t.close();
  }
});
// The timeout lands while the watch waits on a model reply that never comes (as run 45314998906's F-026 test waited).
test('times out while a watch waits on the model', { timeout: 8000 }, async () => {
  const t = await setup(['{"reply":"Never sent."}']);
  try {
    t.hold(never);
    await t.runtime.checkWatch();
  } finally {
    await t.close();
  }
});
