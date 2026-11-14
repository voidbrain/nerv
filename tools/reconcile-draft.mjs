// Backlog reconciliation, scripted (F-077-T03): the PRs merged on the default branch since the commit the backlog
// header names, each PR's CI result and the records that name it. Prints only what needs a decision (failed or
// missing CI, a PR no record names, a commit with no PR), then a draft reconciliation entry to edit, not to paste blind.
// Usage: npm run reconcile:draft   (needs git; gh for CI results; reads, never writes)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const run = (cmd, args) => {
  try {
    return execFileSync(cmd, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 20_000,
      maxBuffer: 16 * 1024 * 1024,
    }).trim();
  } catch {
    return null;
  }
};
const git = (...args) => run('git', args);
const gh = (...args) => run('gh', args);
const read = (path) => (existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : '');
const list = (dir, pattern) =>
  existsSync(join(root, dir))
    ? readdirSync(join(root, dir))
        .filter((f) => pattern.test(f))
        .sort()
    : [];

const stamp = JSON.parse(read('.harness.json') || '{}');
const branch =
  stamp.defaultBranch ?? git('symbolic-ref', '--short', 'refs/remotes/origin/HEAD')?.replace(/^origin\//, '') ?? 'main';
const tip = git('rev-parse', '--verify', '--quiet', `origin/${branch}`) ? `origin/${branch}` : branch;
const header = read('docs/BACKLOG.md')
  .split('\n')
  .find((l) => l.startsWith('Current work ledger'));
const sha = header?.match(/against [^\s`]+ `([0-9a-f]{7,40})`/)?.[1];
if (!sha || git('cat-file', '-e', `${sha}^{commit}`) === null) {
  console.error(`The backlog header names no ${branch} commit in this checkout ("against ${branch} \`<sha>\`").`);
  process.exit(1);
}

// This repository (owner/name from origin), so a link to another repository's PR with the same number never counts.
const own = git('remote', 'get-url', 'origin')
  ?.replace(/^.*github\.com[:/]/, '')
  .replace(/\.git$/, '');
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// What lines name a PR: this repository's PR URL, or a bare "#N" (not "other/repo#N", never a longer number), with the
// record ID that owns the line. Without a known origin any /pull/N counts.
function namers(sources, number) {
  const url = /^[\w.-]+\/[\w.-]+$/.test(own ?? '') ? `github\\.com/${escape(own)}/pull/${number}` : `/pull/${number}`;
  const pattern = new RegExp(`(?:${url}|(?<![\\w/.-])#${number})(?!\\d)`);
  const ids = new Set();
  for (const { text, id } of sources) {
    if (id) {
      if (pattern.test(text)) ids.add(id);
      continue;
    }
    let current = null;
    for (const line of text.split('\n')) {
      current = line.match(/^### (?:<a id="[^"]*"><\/a>)?(?:\[\S+ )?([BF]-\d{3})/)?.[1] ?? current;
      if (current && pattern.test(line)) ids.add(current);
    }
  }
  return [...ids].sort();
}

// The CI verdict from gh's statusCheckRollup: failed beats pending beats skipped beats green; none is "no CI". A
// skipped check is flagged, as ci:status does, since a required job can be skipped by a condition.
function verdict(rollup) {
  if (!Array.isArray(rollup) || !rollup.length) return 'no CI';
  const states = rollup.map((c) => String(c.conclusion || c.state || c.status || '').toUpperCase());
  if (
    states.some((s) => ['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'ERROR', 'STARTUP_FAILURE'].includes(s))
  )
    return 'failed';
  if (states.some((s) => !['SUCCESS', 'SKIPPED', 'NEUTRAL'].includes(s))) return 'pending';
  if (states.includes('SKIPPED')) return 'green with skipped checks';
  return 'green';
}

const sources = [
  ...list('docs/work/records', /^[BF]-\d{3}\.md$/).map((f) => ({
    id: f.slice(0, 5),
    text: read(`docs/work/records/${f}`),
  })),
  ...list('docs/work/tasks', /^[BF]-\d{3}-T\d+\.json$/).map((f) => ({
    id: f.slice(0, 5),
    text: read(`docs/work/tasks/${f}`),
  })),
  ...list('docs/archive', /^backlog-.*\.md$/).map((f) => ({ text: read(`docs/archive/${f}`) })),
];
if (!existsSync(join(root, 'docs/work/records'))) sources.push({ text: read('docs/BACKLOG.md') });

const recordsOnly = (merge) =>
  (git('diff', '--name-only', `${merge}^1`, merge)?.split('\n').filter(Boolean) ?? ['?']).every((f) =>
    /^docs\/(BACKLOG\.md|archive\/|audits\/)/.test(f),
  );
const haveGh = gh('--version') !== null;
const landed = git('log', '--first-parent', '--reverse', '--format=%H %s', `${sha}..${tip}`)?.split('\n') ?? [];
const prs = [],
  flags = [];
for (const line of landed.filter(Boolean)) {
  const hash = line.split(' ')[0];
  if (recordsOnly(hash)) continue;
  const number =
    line.match(/^\S+ Merge pull request #(\d+)/)?.[1] ??
    line.match(/\(#(\d+)\)$/)?.[1] ??
    gh('api', `repos/{owner}/{repo}/commits/${hash}/pulls`, '--jq', '.[0].number // empty');
  if (!number) {
    flags.push(
      haveGh
        ? `! ${hash.slice(0, 7)} reached ${branch} with no PR: review it (git show ${hash.slice(0, 7)}).`
        : `! ${hash.slice(0, 7)}: PR unknown (gh unavailable); review it (git show ${hash.slice(0, 7)}).`,
    );
    continue;
  }
  const view = gh('pr', 'view', number, '--json', 'title,statusCheckRollup');
  const pr = view ? JSON.parse(view) : null;
  const ci = pr ? verdict(pr.statusCheckRollup) : 'unknown (gh unavailable)';
  const ids = namers(sources, number);
  prs.push({ number, ci, ids });
  if (ci !== 'green') flags.push(`! #${number} CI ${ci}${pr ? `: ${pr.title}` : ''} (npm run ci:status -- ${number}).`);
  if (!ids.length) flags.push(`! #${number} is named by no record: add it to the record it changed, or say why none.`);
}

const head = git('rev-parse', '--short=7', tip);
for (const f of flags) console.log(f);
if (!prs.length && !flags.length) {
  console.log(`Nothing merged since \`${sha.slice(0, 7)}\` needs reconciling.`);
  process.exit(0);
}
const green = prs.filter((p) => p.ci === 'green').length;
const range = prs.length ? `PRs ${prs.map((p) => `#${p.number}`).join(', ')}` : 'No PR';
console.log(`${flags.length ? '\n' : ''}Draft entry (edit before use):\n
## ${new Date().toISOString().slice(0, 10)} (${branch} \`${head}\`)

${range} merged${prs.length === green ? ' on green CI' : `; ${green} of ${prs.length} on green CI`}. ${prs
  .map((p) => `#${p.number}: ${p.ids.join(', ') || 'no record'}`)
  .join('; ')}.

Then move the backlog header to ${branch} \`${head}\`.`);
