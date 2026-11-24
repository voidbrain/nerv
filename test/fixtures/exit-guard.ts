// B-118: preloaded into every test file's process by `npm test` (`--import ./test/fixtures/exit-guard.ts`). A file whose
// process is still running some time after its last test and its `after` hooks ended has leaked something (a Runtime's
// child processes, a server, a socket or a timer, typically from a test cancelled at its timeout before its own
// cleanup); such a file used to hold the Windows CI step to its 18-minute limit (runs 45307748925, 45314998906).
// The guard then prints which file and what still holds it, and ends the process as failed: a leak is named and fixed,
// never waited on. The timer is unref'd, so a file that exits on its own is never affected.
// Child processes of a Runtime exit on their own when their parent's IPC channel closes.
import { after } from 'node:test';
import { relative } from 'node:path';

const GRACE_MS = Number(process.env.NERV_EXIT_GUARD_MS) || 30_000;
const file = relative(process.cwd(), process.argv[1] ?? 'unknown file').replaceAll('\\', '/');
// The process's own standard streams and the guard's timer are always there.
const own = new Set(['TTYWrap', 'PipeWrap', 'FSReqCallback']);

after(() => {
  setTimeout(() => {
    const held = new Map<string, number>();
    for (const kind of process.getActiveResourcesInfo()) held.set(kind, (held.get(kind) ?? 0) + 1);
    held.set('Timeout', (held.get('Timeout') ?? 1) - 1); // this timer
    const named = [...held].filter(([kind, n]) => n > 0 && !own.has(kind)).map(([kind, n]) => `${kind} x${n}`);
    process.stderr.write(
      `B-118: ${file} still running ${Math.round(GRACE_MS / 1000)} s after its tests ended; held by ` +
        `${named.join(', ') || 'standard streams only'}. Ending the file as failed.\n`,
    );
    process.exitCode = 1;
    process.exit();
  }, GRACE_MS).unref();
});
