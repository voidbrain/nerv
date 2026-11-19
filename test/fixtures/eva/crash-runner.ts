// F-049-T13 test fixture: starts one EVA-03 job durably and hangs, so the test can kill this process mid-job.
// Usage: node test/fixtures/eva/crash-runner.ts <dbPath> <jobId>; prints {"sortieId","jobPid"} once the job runs.
import { Store, OWNER_SOURCE } from '../../../src/store.ts';
import { EvaJobs, runEva03Durably } from '../../../src/eva-jobs.ts';
import { runEva03Job } from '../../../src/eva-runner.ts';

const [dbPath, jobId] = process.argv.slice(2) as [string, string];
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
      args: ['-e', 'console.error(JSON.stringify({ jobPid: process.pid })); setInterval(() => {}, 1000);'],
      timeoutMs: 60_000,
      onLedgerEvent: (e) => {
        onLedgerEvent(e);
        if (e.kind === 'eva03.started') console.log(JSON.stringify({ sortieId }));
      },
    }),
});
