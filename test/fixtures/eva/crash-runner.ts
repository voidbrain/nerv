// F-049-T13 test fixture: starts one EVA-03 job durably and hangs, so the test can kill this process mid-job.
// Usage: node test/fixtures/eva/crash-runner.ts <dbPath> <jobId>; prints {"sortieId","jobPid"} once the job's own
// process is running (found by a marker in its command line), so the test kills this runner mid-job.
import { Store, OWNER_SOURCE } from '../../../src/store.ts';
import { EvaJobs, runEva03Durably } from '../../../src/eva-jobs.ts';
import { execFileSync } from 'node:child_process';
import { runEva03Job } from '../../../src/eva-runner.ts';

const [dbPath, jobId] = process.argv.slice(2) as [string, string];
const marker = `nerv-crash-marker-${jobId}`;
/** The job's process: the one whose command line carries the marker (sandbox-exec execs node in place). */
function jobPid(): number {
  for (const line of execFileSync('/bin/ps', ['-A', '-o', 'pid=,command='], { encoding: 'utf8' }).split('\n'))
    if (line.includes(marker) && line.includes('setInterval') && !line.includes('crash-runner')) return Number(line.trim().split(/\s+/)[0]);
  return 0;
}
const store = new Store(dbPath);
const jobs = new EvaJobs(store.db);
const sortieId = store.ledger.openSortie(OWNER_SOURCE, 'crash fixture', 'trusted');
await runEva03Durably({
  jobs,
  ledger: store.ledger,
  sortieId,
  jobId,
  key: 'fixture:resource',
  hash: 'fixture',
  run: (onLedgerEvent) =>
    runEva03Job({
      jobId,
      command: process.execPath,
      args: ['-e', `/* ${marker} */ setInterval(() => {}, 1000);`],
      timeoutMs: 60_000,
      onLedgerEvent: (e) => {
        onLedgerEvent(e);
        if (e.kind !== 'eva03.started') return;
        const poll = setInterval(() => {
          const pid = jobPid();
          if (!pid) return;
          clearInterval(poll);
          console.log(JSON.stringify({ sortieId, jobPid: pid }));
        }, 50);
      },
    }),
});
