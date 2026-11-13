#!/usr/bin/env node
// Merge each listed PR as soon as every check on it has passed and GitHub says it can merge; stop on the first
// conflict or failing check, so a person (or the agent) looks before anything else happens. What the agent may merge
// on its own is in AGENTS.md ("What the agent does on its own"). Needs a logged-in `gh`.
//
//   node tools/merge-when-green.mjs 12 13 [--every 60]
//
// Exit 0: every PR merged (or was already closed). 1: GitHub did not answer ten times in a row. 2: one conflicts with
// the default branch. 3: a check failed. 4: a PR left the merge queue without merging.
// With a merge queue on the base branch (8.7.0) a green PR is queued, without a merge strategy, and counts as merged
// only when GitHub says so; the queue tests it with whatever is ahead of it. Branch deletion is then the
// repository's "Automatically delete head branches" setting.
// Every check counts, not only the required ones: a failing optional check (code scanning, say) still stops it.
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const at = args.indexOf('--every'),
  every = at >= 0 && Number.isFinite(Number(args[at + 1])) ? Number(args[at + 1]) : 60;
let prs = args.filter((a, i) => /^\d+$/.test(a) && args[i - 1] !== '--every');
if (!prs.length) {
  console.error('usage: node tools/merge-when-green.mjs <PR number>... [--every seconds]');
  process.exit(64);
}
const gh = (...a) => execFileSync('gh', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** One check's outcome: 'pass', 'fail' or 'wait', from a check run (status, conclusion) or a commit status (state). */
const outcome = (c) => {
  const v = String(c.conclusion || c.state || '').toUpperCase(),
    done = !c.status || c.status === 'COMPLETED';
  if (!done || ['', 'PENDING', 'EXPECTED', 'QUEUED', 'IN_PROGRESS'].includes(v)) return 'wait';
  return ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(v) ? 'pass' : 'fail';
};

// GitHub can time out for a while: a failed `gh` call waits for the next round; ten in a row give up (exit 1)
let failures = 0;
const failedAt = new Map();
const queued = new Set(),
  leftQueue = new Set();
const queueQuery =
  'query($owner:String!,$repo:String!,$n:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$n){isMergeQueueEnabled isInMergeQueue}}}';
/** Whether the PR's base branch has a merge queue and whether the PR is in it; throws when GitHub does not answer. */
const queueOf = (pr) => {
  const q = JSON.parse(
    gh('api', 'graphql', '-f', `query=${queueQuery}`, '-F', 'owner={owner}', '-F', 'repo={repo}', '-F', `n=${pr}`),
  )?.data?.repository?.pullRequest;
  if (typeof q?.isMergeQueueEnabled !== 'boolean') throw Error('no merge queue answer');
  return q;
};
for (;;) {
  const left = [];
  for (const pr of prs) {
    let p, q;
    try {
      p = JSON.parse(gh('pr', 'view', pr, '--json', 'state,mergeable,isDraft,headRefOid,statusCheckRollup'));
      if (p.state === 'OPEN') q = queueOf(pr);
      failures = 0;
    } catch (e) {
      if (++failures >= 10) {
        console.error(`#${pr}: gh failed ${failures} times in a row: ${String(e.stderr || e.message).trim()}`);
        process.exit(1);
      }
      left.push(pr);
      continue;
    }
    if (p.state !== 'OPEN') {
      console.log(`#${pr}: ${p.state.toLowerCase()}`);
      continue;
    }
    // a PR already in the queue (queued by an earlier run or a person) is only watched, never queued again
    if (q.isInMergeQueue) queued.add(pr);
    if (queued.has(pr)) {
      // outside the queue counts when seen twice in a row: just after queuing, GitHub can still report it outside
      if (q.isInMergeQueue) leftQueue.delete(pr);
      else if (leftQueue.has(pr)) {
        console.log(`#${pr}: left the merge queue without merging (its merge-group checks failed, or it was removed)`);
        process.exit(4);
      } else leftQueue.add(pr);
      left.push(pr);
      continue;
    }
    const checks = p.statusCheckRollup ?? [];
    const failed = checks.filter((c) => outcome(c) === 'fail').map((c) => c.name || c.context);
    // a failure counts when seen twice on the same commit: just after a push, GitHub can still report the last run
    if (failed.length && failedAt.get(pr) === p.headRefOid) {
      console.log(`#${pr}: failed: ${failed.join(', ')}`);
      process.exit(3);
    }
    if (failed.length) {
      failedAt.set(pr, p.headRefOid);
      left.push(pr);
      continue;
    }
    failedAt.delete(pr);
    if (p.mergeable === 'CONFLICTING') {
      console.log(`#${pr}: conflicts with the default branch`);
      process.exit(2);
    }
    if (!p.isDraft && p.mergeable === 'MERGEABLE' && checks.length && checks.every((c) => outcome(c) === 'pass')) {
      try {
        if (q.isMergeQueueEnabled) {
          gh('pr', 'merge', pr, '--match-head-commit', p.headRefOid);
          queued.add(pr);
          console.log(`#${pr}: queued`);
          left.push(pr);
          continue;
        }
        gh('pr', 'merge', pr, '--merge', '--delete-branch', '--match-head-commit', p.headRefOid);
        console.log(`#${pr}: merged`);
        continue;
      } catch {
        /* not yet: retry */
      }
    }
    left.push(pr);
  }
  prs = left;
  if (!prs.length) break;
  await new Promise((r) => setTimeout(r, every * 1000));
}
console.log('all done');
