#!/usr/bin/env node
// Merge each listed PR as soon as every check on it has passed and GitHub says it can merge; stop on the first
// conflict or failing check, so a person (or the agent) looks before anything else happens. What the agent may merge
// on its own is in AGENTS.md ("What the agent does on its own"). Needs a logged-in `gh`.
//
//   node tools/merge-when-green.mjs 12 13 [--every 60]
//
// Exit 0: every PR merged (or was already closed). 1: GitHub did not answer ten times in a row. 2: one conflicts with
// the default branch. 3: a check failed.
// Every check counts, not only the required ones: a failing optional check (code scanning, say) still stops it.
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const at = args.indexOf('--every'), every = at >= 0 && Number.isFinite(Number(args[at + 1])) ? Number(args[at + 1]) : 60;
let prs = args.filter((a, i) => /^\d+$/.test(a) && args[i - 1] !== '--every');
if (!prs.length) {
  console.error('usage: node tools/merge-when-green.mjs <PR number>... [--every seconds]');
  process.exit(64);
}
const gh = (...a) => execFileSync('gh', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** One check's outcome: 'pass', 'fail' or 'wait', from a check run (status, conclusion) or a commit status (state). */
const outcome = (c) => {
  const v = String(c.conclusion || c.state || '').toUpperCase(), done = !c.status || c.status === 'COMPLETED';
  if (!done || ['', 'PENDING', 'EXPECTED', 'QUEUED', 'IN_PROGRESS'].includes(v)) return 'wait';
  return ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(v) ? 'pass' : 'fail';
};

// GitHub can time out for a while: a failed `gh` call waits for the next round; ten in a row give up (exit 1)
let failures = 0;
const failedAt = new Map();
for (;;) {
  const left = [];
  for (const pr of prs) {
    let p;
    try { p = JSON.parse(gh('pr', 'view', pr, '--json', 'state,mergeable,isDraft,headRefOid,statusCheckRollup')); failures = 0; } catch (e) {
      if (++failures >= 10) { console.error(`#${pr}: gh failed ${failures} times in a row: ${String(e.stderr || e.message).trim()}`); process.exit(1); }
      left.push(pr);
      continue;
    }
    if (p.state !== 'OPEN') { console.log(`#${pr}: ${p.state.toLowerCase()}`); continue; }
    const checks = p.statusCheckRollup ?? [];
    const failed = checks.filter((c) => outcome(c) === 'fail').map((c) => c.name || c.context);
    // a failure counts when seen twice on the same commit: just after a push, GitHub can still report the last run
    if (failed.length && failedAt.get(pr) === p.headRefOid) { console.log(`#${pr}: failed: ${failed.join(', ')}`); process.exit(3); }
    if (failed.length) { failedAt.set(pr, p.headRefOid); left.push(pr); continue; }
    failedAt.delete(pr);
    if (p.mergeable === 'CONFLICTING') { console.log(`#${pr}: conflicts with the default branch`); process.exit(2); }
    if (!p.isDraft && p.mergeable === 'MERGEABLE' && checks.length && checks.every((c) => outcome(c) === 'pass')) {
      try { gh('pr', 'merge', pr, '--merge', '--delete-branch', '--match-head-commit', p.headRefOid); console.log(`#${pr}: merged`); continue; } catch { /* not yet: retry */ }
    }
    left.push(pr);
  }
  prs = left;
  if (!prs.length) break;
  await new Promise((r) => setTimeout(r, every * 1000));
}
console.log('all done');
