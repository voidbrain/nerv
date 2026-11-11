// Does this project format and lint its source, locally and in CI? Fails when it does not (AGENTS: checks before you
// finish). A formatter and a linter are part of the harness for every stack: without them nothing keeps code readable
// between reviews. Settings live under `tooling` in .harness.json:
//   format   the npm script that checks formatting without writing (default "format:check")
//   lint     the npm script that lints (default "lint")
//   exempt   a recorded reason why the repository has no source code to format or lint (replaces both)
// Known limits: it reads npm scripts and workflow text, not what they do. A script that does nothing, a step that
// cannot fail (`|| true`, `if: false`), a workflow that never runs on pull requests and checks run only inside a
// composite action or with `--prefix` are not detected. Review covers those.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
let stamp = {};
const problems = [];
if (existsSync(join(root, '.harness.json')))
  try {
    stamp = read('.harness.json');
  } catch {
    problems.push('.harness.json is not valid JSON: the tooling settings cannot be read.');
  }
const settings = stamp.tooling ?? {};

if (settings.exempt !== undefined) {
  if (typeof settings.exempt !== 'string' || settings.exempt.trim().length < 20)
    problems.push('tooling.exempt needs a recorded reason (20 characters or more) in .harness.json.');
  else console.log(`Tooling: exempt from formatter and linter (${settings.exempt.trim()}).`);
} else {
  const names = { format: settings.format ?? 'format:check', lint: settings.lint ?? 'lint' };
  let scripts = {};
  if (!existsSync(join(root, 'package.json')))
    problems.push('No package.json: add format and lint scripts, or record tooling.exempt with its reason.');
  else scripts = read('package.json').scripts ?? {};
  const workflows = existsSync(join(root, '.github/workflows'))
    ? readdirSync(join(root, '.github/workflows'))
        .filter((file) => /\.ya?ml$/.test(file))
        .map((file) => readFileSync(join(root, '.github/workflows', file), 'utf8'))
    : [];
  // a commented-out step does not count
  const steps = workflows.flatMap((text) => text.split('\n').filter((line) => !/^\s*#/.test(line)));
  // `npm run x`, `npm run-script x`, `pnpm x`, `pnpm run x`, `yarn x`, `yarn run x`, with an optional silent flag
  const invokes = (text, name) =>
    new RegExp(
      `(?:npm run(?:-script)?|pnpm(?: run)?|yarn(?: run)?) (?:-s |--silent )?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$|["'&;|)])`,
    ).test(text);
  // scripts CI reaches: the ones a workflow names, and the ones those run in turn (`npm run check` running lint)
  const reached = new Set(Object.keys(scripts).filter((name) => steps.some((line) => invokes(line, name))));
  for (const name of reached)
    for (const other of Object.keys(scripts))
      if (typeof scripts[name] === 'string' && invokes(scripts[name], other)) reached.add(other);
  for (const [kind, name] of Object.entries(names)) {
    if (typeof scripts[name] !== 'string' || !scripts[name].trim())
      problems.push(`No "${name}" npm script: the project has no ${kind === 'format' ? 'formatter check' : 'linter'}.`);
    else if (!reached.has(name))
      problems.push(`No CI workflow runs "npm run ${name}": a check nobody runs is not enforced.`);
  }
  if (names.format === names.lint)
    problems.push('tooling.format and tooling.lint name the same script: both are required.');
  if (!problems.length) console.log(`Tooling: "${names.format}" and "${names.lint}" exist and run in CI.`);
}

if (problems.length) {
  for (const problem of problems) console.error(`✗ ${problem}`);
  console.error('See APPLY.md, "Lint and format config". The harness requires both for every stack.');
  process.exitCode = 1;
}
