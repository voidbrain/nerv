// CI evidence for the backlog: each pull request's CI jobs and, for failed or retried jobs, the tests involved.
// Usage: npm run ci:status -- [PR numbers…]   (default: the 8 most recently updated PRs). Needs an authenticated gh.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

// Project settings in .harness.json (ciStatus): the pull-request workflow's `name:`, the jobs whose Playwright log is
// scanned for failed and retried tests, and extra log lines worth printing (regular expressions).
const stamp = new URL('../.harness.json', import.meta.url);
const config = (existsSync(stamp) ? JSON.parse(readFileSync(stamp, 'utf8')).ciStatus : undefined) ?? {};
const WORKFLOW = config.workflow ?? 'CI';
const BROWSER_JOB = new RegExp(config.browserJobs ?? 'e2e|browser');
const LOG_NOTES = (config.logNotes ?? []).map((pattern) => new RegExp(pattern));

const gh = (...args) =>
  execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const json = (...args) => JSON.parse(gh(...args));

const DEFAULT_BRANCH =
  JSON.parse(existsSync(stamp) ? readFileSync(stamp, 'utf8') : '{}').defaultBranch ??
  json('repo', 'view', '--json', 'defaultBranchRef').defaultBranchRef.name;

// Quiet by default: a PR whose every run and job succeeded, with nothing to flag, prints one line; --verbose prints all.
const verbose = process.argv.includes('--verbose');
let numbers = process.argv.slice(2).map(Number).filter(Boolean);
if (!numbers.length)
  numbers = json('pr', 'list', '--state', 'all', '--limit', '8', '--json', 'number').map((p) => p.number);

let green = 0;
for (const n of numbers) {
  const pr = json('pr', 'view', String(n), '--json', 'number,title,state,baseRefName,headRefOid,mergedAt,url');
  const out = [];
  let clean = true;
  const say = (line, ok = false) => {
    out.push(line);
    if (!ok) clean = false;
  };
  say(
    `\n#${pr.number} ${pr.title}\n  ${pr.state.toLowerCase()} into ${pr.baseRefName}${pr.mergedAt ? ` at ${pr.mergedAt}` : ''} · ${pr.url}`,
    true,
  );
  if (pr.baseRefName !== DEFAULT_BRANCH)
    say(`  ! based on ${pr.baseRefName}, not ${DEFAULT_BRANCH}: merging it does not reach the default branch`);
  const runs = json(
    'run',
    'list',
    '--commit',
    pr.headRefOid,
    '--workflow',
    WORKFLOW,
    '--json',
    'databaseId,status,conclusion,url',
  );
  if (!runs.length) {
    say('  no CI run for its head commit');
    console.log(out.join('\n'));
    continue;
  }
  for (const run of runs) {
    say(`  CI ${run.status === 'completed' ? run.conclusion : run.status} · ${run.url}`, run.conclusion === 'success');
    for (const job of json('run', 'view', String(run.databaseId), '--json', 'jobs').jobs) {
      const state = job.status === 'completed' ? job.conclusion : job.status;
      say(`    ${state.padEnd(10)} ${job.name}`, state === 'success');
      if (job.status !== 'completed' || !BROWSER_JOB.test(job.name)) continue;
      // Playwright's list reporter: ✘ failed, retries, flaky summary
      let log;
      try {
        log = gh('run', 'view', '--job', String(job.databaseId), '--log')
          .split('\n')
          .map((l) => l.replace(/^.*?Z /, ''));
      } catch {
        say('               (test details once the whole run has finished)');
        continue;
      } // GitHub serves logs per run

      const tests = log.filter((l) => /^\s+✘ |\(retry #\d\)|^\s+\d+ (flaky|failed)/.test(l)).map((l) => l.trim());
      for (const t of [...new Set(tests)]) say(`               ${t}`);
      for (const note of log.filter((l) => LOG_NOTES.some((p) => p.test(l)))) say(`               ${note.trim()}`);
    }
  }
  if (clean) green++;
  console.log(
    clean && !verbose
      ? `#${pr.number} ${pr.state.toLowerCase()}, CI success: ${pr.title}`
      : out.join('\n').replace(/^\n/, verbose ? '\n' : ''),
  );
}
console.log(
  `${numbers.length} PR(s): ${green} green, ${numbers.length - green} to look at${verbose ? '' : ' (--verbose for every job)'}.`,
);
