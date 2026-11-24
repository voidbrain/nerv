// B-118: shared always-teardown for test fixtures that start Runtimes, links, servers or child processes.
// node:test cancels a test at its timeout without stopping its function, so a test's own `finally` may never run; its
// Runtimes (child processes), links and servers then kept the file's process alive for good, and the CI step ran into
// its limit (Windows runs 45307748925 and 45314998906). A fixture therefore opens a scope and registers each resource
// as it creates it; the hooks below close every scope still open after each test (also a timed-out one) and after the
// file. A close is idempotent and bounded, and a fixture whose test already ended stops building: registering a
// resource then closes it at once and throws.
// A scope is per test: create it inside the test (or in a fixture function the test calls), never in a `before` hook.
// A scope still open in the hook was left by a test that did not close it (cancelled at its timeout, most likely): its
// name, the test and its last step are printed, so a CI report names where the test was waiting.
import { after, afterEach } from 'node:test';
import type { Server } from 'node:http';
import { rmSync } from 'node:fs';

export type Scope = ReturnType<typeof scope>;
const open = new Set<Scope>();
const closeOpen = (test?: string) =>
  Promise.all(
    [...open].map((s) => {
      process.stderr.write(`B-118: ${s.name} fixture left open${test ? ` by "${test}"` : ''}; last step ${s.last()}\n`);
      return s.close();
    }),
  );
afterEach((t) => closeOpen(t.name));
after(() => closeOpen());

/** Resolves after `ms` without holding the process open. */
const grace = (ms: number) => new Promise<void>((done) => setTimeout(done, ms).unref());
/** Each closer gets at most this long, so a stuck step never holds the rest. */
const STEP_MS = 10_000;

export function scope(name: string) {
  const closers: (() => unknown)[] = [];
  const born = performance.now();
  let closing: Promise<void> | undefined,
    step = 'creating the fixture',
    stepAt = born;
  const ended = () => Error(`${name} fixture already closed: its test ended.`);
  const self = {
    name,
    /** True once the scope is closing: a fixture checks it before starting anything that outlives a call. */
    get closed() {
      return closing !== undefined;
    },
    /** Names what the fixture is waiting for now, for the report above. */
    step(next: string) {
      step = next;
      stepAt = performance.now();
    },
    last: () => `"${step}", ${Math.round(stepAt - born)} ms after the fixture started`,
    /** Registers a resource's closer; once the scope is closed, closes the resource at once and stops the caller. */
    add<T>(resource: T, close: (resource: T) => unknown): T {
      if (closing) {
        void Promise.resolve()
          .then(() => close(resource))
          .catch(() => {});
        throw ended();
      }
      closers.push(() => close(resource));
      return resource;
    },
    /** Throws once the scope is closed: a fixture calls it before starting what would outlive its test. */
    check() {
      if (closing) throw ended();
    },
    /** Closes in reverse order, each step bounded; idempotent. */
    close() {
      closing ??= (async () => {
        open.delete(self);
        for (const closer of closers.reverse())
          await Promise.race([Promise.resolve().then(closer).catch(() => {}), grace(STEP_MS)]);
      })();
      return closing;
    },
  };
  open.add(self);
  return self;
}

/** Closes a server and every connection it holds (close() alone waits for each upgraded or kept-alive socket). */
export const closeServer = (server: Server) =>
  new Promise<void>((done) => {
    server.close(() => done());
    server.closeAllConnections();
  });

/** Removes a temporary directory; on Windows a child that has just been killed can still hold its database a moment. */
export const removeDir = (dir: string) => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // A leftover temporary directory is not worth failing the run over.
  }
};
