import { Store } from './store.ts';

/**
 * Reader entry of the upgrade contract (F-005-T06). An installed revision exports a pinned candidate tree and runs
 * this file from it: `node src/upgrade-reader.ts DATABASE HOME`. It opens DATABASE with this tree's real Store,
 * using HOME for configuration, and closes it. It prints nothing; the installed revision compares the result.
 */
const [database, home] = process.argv.slice(2);
if (!database || !home || process.argv.length !== 4) {
  process.exitCode = 64;
} else new Store(database, undefined, { home }).db.close();
