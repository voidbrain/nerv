// F-105: a pull request names itself in the backlog before it merges, so the ledger never falls behind main.
// Reads the PR number from the GitHub event (or --pr N) and looks for it in the record sources, the task files'
// `prs` entries and the reconciliation log on the branch. Skips runs with no PR and bot-authored PRs.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where a PR may name itself: a record, a task's `prs` entry, or a reconciliation log entry. */
export const PLACES = ['docs/work/records/*.md', 'docs/work/tasks/*.json (prs)', 'docs/archive/reconciliation-<year>.md'];

const files = (dir, pattern) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => pattern.test(name))
        .map((name) => join(dir, name))
    : [];

/** The files on the branch that name PR `pr`: `#N` or `/pull/N` in Markdown, `"pr": N` in a task file. */
export function findPrReferences(root, pr) {
  if (!Number.isInteger(pr) || pr < 1) throw new Error(`Invalid PR number: ${pr}`);
  const inText = new RegExp(`(?:#|/pull/)${pr}(?![0-9])`);
  const found = [];
  for (const path of [
    ...files(join(root, 'docs/work/records'), /\.md$/),
    ...files(join(root, 'docs/archive'), /^reconciliation-\d{4}\.md$/),
  ])
    if (inText.test(readFileSync(path, 'utf8'))) found.push(path.slice(root.length + 1));
  for (const path of files(join(root, 'docs/work/tasks'), /\.json$/)) {
    let task;
    try {
      task = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      continue;
    }
    if (Array.isArray(task.prs) && task.prs.some((entry) => entry?.pr === pr)) found.push(path.slice(root.length + 1));
  }
  return found;
}

/** The PR this run checks, or why it is skipped. */
export function prFromEvent(event) {
  const pull = event?.pull_request;
  if (!pull || !Number.isInteger(pull.number)) return { skip: 'not a pull request run' };
  if (pull.user?.type === 'Bot') return { skip: `opened by ${pull.user.login ?? 'a bot'}` };
  return { pr: pull.number };
}

function main(argv, env) {
  const flag = argv.indexOf('--pr');
  let target;
  if (flag >= 0) target = { pr: Number(argv[flag + 1]) };
  else if (env.GITHUB_EVENT_PATH && existsSync(env.GITHUB_EVENT_PATH))
    target = prFromEvent(JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')));
  else target = { skip: 'no pull request event' };
  if ('skip' in target) {
    console.log(`PR record check skipped: ${target.skip}.`);
    return 0;
  }
  const found = findPrReferences(process.cwd(), target.pr);
  if (found.length) {
    console.log(`PR #${target.pr} is named in ${found.join(', ')}.`);
    return 0;
  }
  console.error(
    `PR #${target.pr} is named in no record. Name it by number in the record it changes (a link to /pull/${target.pr}), ` +
      `in its task file's "prs", or, for a change with no product record, in the reconciliation log entry: ${PLACES.join('; ')}. ` +
      'Push that before the checks finish (AGENTS.md, "What the agent does on its own").',
  );
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2), process.env);
