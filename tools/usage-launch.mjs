// Explicit optional process launcher. Never installs a hook, records a command or collects transcripts.
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { main as usage } from './work-usage.mjs';
export function launch(args = process.argv.slice(2), cwd = process.cwd()) {
  const split = args.indexOf('--');
  if (split < 0 || split === args.length - 1) throw Error('Expected metadata options -- executable [arguments]');
  const options = args.slice(0, split),
    command = args.slice(split + 1),
    allowed = ['repository', 'item', 'task', 'agent', 'model', 'store', 'parent', 'activity'],
    seen = new Set();
  let store = join(homedir(), '.local', 'state', 'project-harness', 'work-usage');
  for (const option of options) {
    const m = /^--([a-z]+)=(.+)$/.exec(option);
    if (!m || !allowed.includes(m[1]) || seen.has(m[1])) throw Error('Unknown or duplicate launcher option');
    seen.add(m[1]);
    if (m[1] === 'store') store = resolve(cwd, m[2]);
  }
  if (!seen.has('activity')) options.push('--activity=coding');
  const job = usage(['start', ...options], cwd).job;
  let result;
  try {
    result = spawnSync(command[0], command.slice(1), {
      cwd,
      stdio: 'inherit',
      env: { ...process.env, HARNESS_USAGE_JOB: job, HARNESS_USAGE_STORE: store },
    });
  } catch {
    usage(['finish', '--store=' + store, '--job=' + job, '--coverage=unavailable', '--outcome=failed'], cwd);
    throw Error('Registered command failed to start');
  }
  const outcome = result.signal ? 'interrupted' : result.status === 0 ? 'done' : 'failed';
  usage(['finish', '--store=' + store, '--job=' + job, '--coverage=unavailable', '--outcome=' + outcome], cwd);
  return { status: result.status ?? 1, job, coverage: 'unavailable', outcome };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = launch().status;
  } catch {
    process.stderr.write('Usage launch failed; inspect private job state before retrying.\n');
    process.exitCode = 1;
  }
}
