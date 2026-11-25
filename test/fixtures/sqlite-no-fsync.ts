// B-118-T04: preloaded into every test file's process by `npm test` (`--import ./test/fixtures/sqlite-no-fsync.ts`).
// Every SQLite connection the test process opens starts with `PRAGMA synchronous=OFF`: SQLite hands each write to the
// operating system without waiting for it to reach the disk. A Windows CI runner pays tens of milliseconds for each
// flush, and the coordinator tests commit, checkpoint and swap stores thousands of times, so those files ran 10-30
// times slower there than on Linux (coordinator-partition 147 s against 26 s, runs of 2026-11-24/25).
// What the tests prove does not change: a test "crash" is an exception or a killed process, never a lost power
// supply, and the operating system keeps every handed-over write either way. A connection that sets its own
// `synchronous` (the lifecycle receipts set FULL) still gets what it asks for. Child processes (a Runtime's) are not
// affected: they start with their own flags.
import { createRequire, syncBuiltinESMExports } from 'node:module';
import type * as Sqlite from 'node:sqlite';

const require = createRequire(import.meta.url);
const sqlite = require('node:sqlite') as typeof Sqlite;
const Original = sqlite.DatabaseSync;

class TestDatabaseSync extends Original {
  constructor(...args: ConstructorParameters<typeof Original>) {
    super(...args);
    // A connection opened later (`open: false`) keeps the default. A file that is not a readable database fails
    // here; the connection then stays as the code opened it, so the code's own first read reports it and closes it
    // (throwing here would leak the open handle, and Windows cannot remove a file that is still open).
    if (this.isOpen)
      try {
        this.exec('PRAGMA synchronous=OFF');
      } catch {
        // left to the code under test
      }
  }
}

(sqlite as { DatabaseSync: typeof Original }).DatabaseSync = TestDatabaseSync;
// `import { DatabaseSync } from 'node:sqlite'` reads the replaced class from here on.
syncBuiltinESMExports();
