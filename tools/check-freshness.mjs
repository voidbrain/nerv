// Is the backlog behind the default branch, are merged branches left over, does this branch change harness files or files
// the impact map names, do declared evaluation dependencies have pending cases, is the last audit too old, and is the harness template newer? Prints what to do first (AGENTS: session start). Ordinary reminders are warnings; required maintenance and invalid/enforced audit evidence fail.
// --github formats reminders for GitHub Actions.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { couplingsTouched, describe, plan } from './impact-map.mjs';

const github = process.argv.includes('--github');
const git = (...args) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};
const notes = [],
  infos = [];
const warn = (text) => notes.push(text);
let stamp = {};
try {
  if (existsSync(new URL('../.harness.json', import.meta.url)))
    stamp = JSON.parse(readFileSync(new URL('../.harness.json', import.meta.url), 'utf8'));
} catch (e) {
  warn(`.harness.json is not valid JSON (${e.message}): defaults used.`);
}
const MAX_AUDIT_DAYS = stamp.freshness?.auditDays ?? 7;
// Reconciliation is folded into working PRs; one of its own is due only at these limits (AGENTS: session start).
const limit = (value, fallback) => (Number.isFinite(value) && value >= 0 ? value : fallback);
const BACKLOG_PRS = limit(stamp.freshness?.backlogPRs, 10);
const BACKLOG_DAYS = limit(stamp.freshness?.backlogDays, 1);

// Compare with the published default branch, never the local checkout: a local branch that is behind (or a feature
// branch) would hide merged PRs. The branch is .harness.json defaultBranch, else the remote's HEAD, else main.
// A failed fetch (offline, no access) never fails the check, but the cached refs may be old: say so instead of "Fresh".
if (git('remote')?.split('\n').includes('origin') && git('fetch', '--prune', '--quiet', 'origin') === null)
  warn(
    'Could not fetch origin (offline or no access): compared with origin as last fetched, so anything merged since is not seen.',
  );
const branch =
  stamp.defaultBranch ?? git('symbolic-ref', '--short', 'refs/remotes/origin/HEAD')?.replace(/^origin\//, '') ?? 'main';
const tip = git('rev-parse', '--verify', '--quiet', `origin/${branch}`) ? `origin/${branch}` : branch;
if (tip === branch) warn(`No origin/${branch}: comparing with the local ${branch}, which may be behind GitHub.`);

// 1. the backlog header names the default-branch commit it was last reconciled against
const backlog = new URL('../docs/BACKLOG.md', import.meta.url);
const header = existsSync(backlog)
  ? readFileSync(backlog, 'utf8')
      .split('\n')
      .find((l) => l.startsWith('Current work ledger'))
  : undefined;
const sha = header?.match(/against [^\s`]+ `([0-9a-f]{7,40})`/)?.[1];
if (!sha)
  warn(`The backlog header names no ${branch} commit ("against ${branch} \`<sha>\`"): reconcile it against ${branch}.`);
else if (git('cat-file', '-e', `${sha}^{commit}`) === null)
  warn(
    `The backlog's commit ${sha} is not in this checkout (shallow clone or rewritten history): fetch ${branch} or reconcile by hand.`,
  );
else {
  // a PR that only records evidence (backlog, archive, audits) needs no reconciling of its own: otherwise every
  // reconciliation would leave the backlog one PR behind forever
  const recordsOnly = (merge) =>
    (git('diff', '--name-only', `${merge}^1`, merge)?.split('\n').filter(Boolean) ?? ['?']).every((f) =>
      /^docs\/(BACKLOG\.md|archive\/|audits\/)/.test(f),
    );
  // every commit on the branch's first-parent line changed the default branch, whatever its message says: a merge
  // commit ("Merge pull request #N"), a squash merge ("Title (#N)"), or a rebase merge or direct push with no number,
  // which gh looks up when it can; a commit no PR is found for is listed by its hash
  const gh = (...args) => {
    try {
      return (
        execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15_000 }).trim() ||
        null
      );
    } catch {
      return null;
    }
  };
  const landed =
    git('log', '--first-parent', '--format=%H %ct %s', `${sha}..${tip}`)?.split('\n').filter(Boolean) ?? [];
  const prs = new Set(),
    commits = [];
  let oldest = Infinity;
  for (const line of landed) {
    const [hash, time] = line.split(' ');
    if (recordsOnly(hash)) continue;
    oldest = Math.min(oldest, Number(time) * 1000);
    const pr =
      line.match(/^\S+ \d+ Merge pull request #(\d+)/)?.[1] ??
      line.match(/\(#(\d+)\)$/)?.[1] ??
      gh('api', `repos/{owner}/{repo}/commits/${hash}/pulls`, '--jq', '.[0].number // empty');
    if (pr) prs.add(pr);
    else commits.push(hash.slice(0, 7));
  }
  const n = [...prs];
  if (n.length || commits.length) {
    const behind = `The backlog is behind ${branch} by ${[n.length && `${n.length} merged PR(s) (#${n.join(', #')})`, commits.length && `${commits.length} commit(s) with no PR found (${commits.join(', ')})`].filter(Boolean).join(' and ')}: ${n.length ? `read their CI (npm run ci:status -- ${n.join(' ')}), ` : ''}${commits.length ? 'review the commits without a PR (git show <hash>), ' : ''}update or close the records, archive closed ones, move the header to the current ${branch}.`;
    const now = process.env.FRESHNESS_TODAY ? Date.parse(process.env.FRESHNESS_TODAY) : Date.now();
    const age = Math.floor((now - oldest) / 86_400_000);
    // a commit that reached the default branch without a PR had no review: it is always due
    if (commits.length || n.length >= BACKLOG_PRS || !(age < BACKLOG_DAYS)) warn(behind);
    else
      infos.push(
        `${behind} Not due yet: do it in your next working PR; a reconciliation-only PR is due at ${BACKLOG_PRS} merged PR(s) or ${BACKLOG_DAYS} day(s) behind (freshness.backlogPRs, freshness.backlogDays in .harness.json).`,
      );
  }
}

// 2. branches already merged into the default branch but still on the remote
const merged =
  git('branch', '-r', '--merged', tip)
    ?.split('\n')
    .map((b) => b.trim())
    .filter((b) => b && b !== `origin/${branch}` && !/^origin\/HEAD\b/.test(b)) ?? [];
if (merged.length)
  warn(
    `Merged branches are still on the remote (${merged.join(', ')}): delete them (git push origin --delete <branch>) and their local branches and worktrees.`,
  );

// 3. what this branch changes, against the default branch (committed or not): harness files and the impact map
const base = git('merge-base', tip, 'HEAD');
const changed = base
  ? [git('diff', '--name-only', base), git('ls-files', '--others', '--exclude-standard')]
      .join('\n')
      .split('\n')
      .filter(Boolean)
  : [];
const isTemplate = existsSync(new URL('../core/tools/', import.meta.url));

// 3a. harness files: each change is either this project's (its content, a setting, a line marked <!-- project -->, an
// override) or every project's (the template first). Asking is the rule when that is unclear (AGENTS, "Changing a
// harness file"). Files that hold project content by design are not listed (README, backlog records, area notes); nor
// is anything in the template repository itself, whose tools/ are release copies of core/.
const PROJECT_CONTENT = new Set(['README.md', 'docs/BACKLOG.md', 'docs/agents/areas.md']);
const kind = (f) =>
  stamp.copied?.[f]
    ? 'copied'
    : stamp.forked?.[f]
      ? 'forked'
      : f === '.harness.json'
        ? 'settings'
        : stamp.adapted?.[f] && !PROJECT_CONTENT.has(f)
          ? 'adapted'
          : null;
const touched = isTemplate ? [] : changed.filter((f) => kind(f));
if (touched.length)
  warn(
    `This branch changes harness files: ${touched.map((f) => `${f} (${kind(f)})`).join(', ')}. Decide for each change: this project only (its content, a setting, a line marked <!-- project -->, an override) or every project (the template first). If unsure, ask before going on (AGENTS, "Changing a harness file"). Before it merges, the change gets a review in a fresh context (backlog rules, "Independent review").`,
  );

// 3b. the impact map (tools/impact-map.mjs): the rows this branch sets off, directly or because a row they follow runs
// again, in the order to run them
const steps = plan(stamp.impact, changed);
steps.forEach((s, i) => warn(`Impact ${i + 1}/${steps.length} (${s.id}): ${describe(s)}.`));
for (const { coupling: c, files } of couplingsTouched(stamp.couplings, changed))
  warn(
    `Coupled value "${c.value}": ${files.join(', ')} changed; it also lives in ${(c.places ?? []).map((p) => `${p.file}${p.what ? ` (${p.what})` : ''}`).join(', ')}: keep them equal${c.kept ? ` (kept by ${c.kept})` : ' (nothing keeps them equal)'}.`,
  );

// 3c. evaluation dependencies (.harness.json "evaluations"): each names a project-owned command that exits 0 when every
// case of the dependency's pinned test content has a covering run, and 1 listing the pending cases otherwise. Reported
// only; a failing or slow command is reported, never fatal. The project decides whether CI also fails on it.
if (stamp.evaluations !== undefined && !Array.isArray(stamp.evaluations))
  warn('"evaluations" in .harness.json must be an array of { name, pending, timeoutMs? }; ignored.');
for (const e of Array.isArray(stamp.evaluations) ? stamp.evaluations : []) {
  const name = typeof e?.name === 'string' && e.name ? e.name : 'unnamed';
  if (!Array.isArray(e?.pending) || !e.pending.length || e.pending.some((a) => typeof a !== 'string')) {
    warn(
      `Evaluation ${name}: "pending" must be a command as an array of strings, e.g. ["npm", "run", "-s", "check:runs"].`,
    );
    continue;
  }
  const validTimeout = Number.isSafeInteger(e.timeoutMs) && e.timeoutMs > 0;
  if (e.timeoutMs !== undefined && !validTimeout)
    warn(`Evaluation ${name}: "timeoutMs" must be a whole number of milliseconds above 0; using 60000.`);
  let r;
  try {
    r = spawnSync(e.pending[0], e.pending.slice(1), {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      encoding: 'utf8',
      timeout: validTimeout ? e.timeoutMs : 60000,
      killSignal: 'SIGKILL',
    });
  } catch (error) {
    r = { status: null, stdout: '', stderr: '', error };
  }
  if (r.status === 0) continue;
  const why = (r.stderr ?? '')
    .split('\n')
    .find((l) => l.trim())
    ?.trim();
  const cases = (r.stdout ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (r.status === 1 && cases.length) {
    const shown = cases.slice(0, 10).join(', ') + (cases.length > 10 ? `, and ${cases.length - 10} more` : '');
    warn(
      `Evaluation ${name}: ${cases.length} pending case(s) with no covering run: ${shown}. Keep an open backlog record naming them until a run covers them; running real models needs the owner's approval (BACKLOG-RULES, "Evaluation dependencies").`,
    );
  } else
    warn(
      `Evaluation ${name}: its pending command (${e.pending.join(' ')}) ${r.error ? `could not run: ${r.error.code ?? r.error.message}` : r.status === 1 ? 'exited 1 but listed no cases' : `exited ${r.status ?? r.signal}`}${why ? ` (${why})` : ''}; pending cases unknown.`,
    );
}

// 3d. estimate drift (workItems.estimation, F-054): closed steps whose actual effort keeps differing from their
// baseline ask for a re-estimation of the open steps. Read-only; projects without work items or the helper skip it.
const workItemsHelper = new URL('./work-items.mjs', import.meta.url);
if (
  stamp.workItems?.enabled &&
  stamp.workItems.featurePlans &&
  stamp.workItems.estimation !== false &&
  existsSync(workItemsHelper)
) {
  try {
    const { settings, taskCatalog, calibrate } = await import(workItemsHelper.href);
    if (typeof calibrate === 'function') {
      const root = fileURLToPath(new URL('..', import.meta.url)),
        config = settings(root),
        result = calibrate(taskCatalog(root, config).tasks, config.estimation);
      if (result.due)
        warn(
          `Estimates drift from actual effort: ${result.reasons.join('; ')}. Re-estimate the open steps (effort.agentHours, or days for steps not yet in hours, with a dated basis citing \`node tools/work-items.mjs calibrate\`; keep every baseline; a material increase goes to the owner), then set workItems.estimation.since to today. Open steps: ${result.reestimate.slice(0, 10).join(', ')}${result.reestimate.length > 10 ? ` and ${result.reestimate.length - 10} more` : ''}.`,
        );
    }
  } catch (e) {
    warn(`Estimate calibration could not run: ${e.message}`);
  }
}

// 4. audit coverage per declared area (legacy date-only fallback)
const auditHelper = new URL('./check-audits.mjs', import.meta.url);
let last, days;
if (existsSync(auditHelper)) {
  try {
    const { auditStatus } = await import(auditHelper.href);
    const status = auditStatus(fileURLToPath(new URL('..', import.meta.url)));
    last = status.lastFull?.reviewed.slice(0, 10);
    days = last ? Math.floor((Date.now() - Date.parse(last)) / 86400000) : Infinity;
    if (status.due.length) {
      warn(
        `Audit areas due (${status.days}-day interval): ${status.due.join(', ')}. Last complete full report: ${status.lastFull?.report ?? 'unknown'}; scoped/blocked reviews refresh no unrelated area.`,
      );
      if (stamp.audit?.enforce) process.exitCode = 1;
    }
  } catch (e) {
    warn(`Audit evidence invalid: ${e.message}`);
    process.exitCode = 1;
  }
} else {
  // Legacy adopters without the scope-aware helper retain their existing date-only reminder.
  const auditDir = new URL('../docs/audits/', import.meta.url);
  const audits = (existsSync(auditDir) ? readdirSync(auditDir) : [])
    .map((f) => f.match(/^(\d{4}-\d{2}-\d{2})/)?.[1])
    .filter(Boolean)
    .sort();
  last = audits.at(-1);
  const today = new Date(process.env.FRESHNESS_TODAY ?? Date.now());
  days = last ? Math.floor((today - new Date(`${last}T00:00:00Z`)) / 86400000) : Infinity;
  if (days > MAX_AUDIT_DAYS)
    warn(
      `The last audit (docs/audits/${last ?? 'none'}) is ${Number.isFinite(days) ? `${days} days` : 'missing'} old (limit ${MAX_AUDIT_DAYS}, freshness.auditDays in .harness.json): audit what changed since (docs, tests, style guide, accessibility, privacy) and write docs/audits/<date>.md.`,
    );
}

for (const i of infos) console.log(i);
if (!notes.length && !infos.length)
  console.log(`Fresh: backlog reconciled against current ${branch}; last audit ${last} (${days} day(s) ago).`);
for (const n of notes) console.log(github ? `::warning title=Backlog freshness::${n}` : `! ${n}`);

// 5. the harness template this project was applied from (tools/check-harness.mjs; skipped without a local template)
const harness = fileURLToPath(new URL('./check-harness.mjs', import.meta.url));
if (existsSync(harness))
  execFileSync(process.execPath, [harness, ...(github ? ['--github'] : [])], { stdio: 'inherit' });

// 3.0: ordinary freshness findings remain warnings; required maintenance evidence is a gate.
if (stamp.maintenance?.enabled || Number(String(stamp.version ?? '0').split('.')[0]) >= 3) {
  const maintenance = fileURLToPath(new URL('./maintenance.mjs', import.meta.url));
  if (!existsSync(maintenance)) {
    console.error('Required maintenance helper missing');
    process.exitCode = 1;
  } else
    try {
      execFileSync(process.execPath, [maintenance, 'check'], { stdio: 'inherit' });
    } catch (e) {
      console.error('Required maintenance review failed; resolve its evidence before proceeding.');
      process.exitCode = e.status || 1;
    }
}
