// Explicit local measurement only: no source text, prompts, identities, telemetry or network.
import {
  existsSync,
  lstatSync,
  mkdirSync,
  appendFileSync,
  readFileSync,
  realpathSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// Finished samples live in the primary checkout, so every worktree of a repository shares them and removing a
// worktree loses none (B-049). The given root is kept outside git, in a project below its repository's top level,
// in a submodule and in a worktree of a bare repository. No --path-format: git before 2.31 echoes unknown options.
export function samplesRoot(root) {
  try {
    const lines = execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel', '--git-common-dir'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .replace(/\r?\n$/, '')
      .split(/\r?\n/);
    if (lines.length !== 2 || !isAbsolute(lines[0])) return root;
    if (realpathSync(lines[0]) !== realpathSync(root)) return root;
    const common = resolve(root, lines[1]);
    return basename(common) === '.git' ? dirname(common) : root;
  } catch {
    return root;
  }
}
export function friction(root, args, now = () => Date.now()) {
  const [command, ...rest] = args,
    values = {};
  if (!['record', 'report', 'start', 'finish'].includes(command)) throw Error('Use start, finish, record or report');
  const fields = {
    'duration-ms': 'durationMs',
    conflicts: 'conflicts',
    'unnecessary-prompts': 'unnecessaryPrompts',
    'repeated-context-loads': 'repeatedContextLoads',
  };
  for (const arg of rest) {
    const match = arg.match(/^--([a-z-]+)=(.+)$/);
    if (
      !match ||
      match[1] in values ||
      !['operation', ...Object.keys(fields)].includes(match[1]) ||
      command === 'report'
    )
      throw Error(`Invalid or duplicate argument: ${arg}`);
    values[match[1]] = match[2];
  }
  // A running session belongs to its worktree, so parallel tasks never collide; finished samples are shared.
  const sessionDir = resolve(root, '.harness'),
    dir = resolve(samplesRoot(root), '.harness'),
    file = resolve(dir, 'friction.jsonl'),
    session = resolve(sessionDir, 'friction-session.json');
  for (const path of [sessionDir, dir, file, session]) {
    try {
      if (lstatSync(path).isSymbolicLink()) throw Error('Refusing symlink measurement destination');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  const read = () => {
    const rows = existsSync(file)
      ? readFileSync(file, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : [];
    for (const row of rows) {
      if (
        !row ||
        row.schemaVersion !== 1 ||
        !['adoption', 'reconciliation'].includes(row.operation) ||
        typeof row.at !== 'string' ||
        !Number.isFinite(Date.parse(row.at)) ||
        !Number.isSafeInteger(row.durationMs) ||
        row.durationMs < 0
      )
        throw Error('Invalid stored measurement');
      for (const key of Object.values(fields))
        if (row[key] !== null && (!Number.isSafeInteger(row[key]) || row[key] < 0))
          throw Error('Invalid stored measurement');
    }
    return rows;
  };
  if (command === 'start') {
    if (!['adoption', 'reconciliation'].includes(values.operation) || Object.keys(values).length !== 1)
      throw Error('Start needs only --operation=adoption|reconciliation');
    mkdirSync(sessionDir, { recursive: true });
    const row = { operation: values.operation, started: new Date(now()).toISOString() };
    writeFileSync(session, JSON.stringify(row) + '\n', { flag: 'wx' });
    return row;
  }
  if (command === 'finish') {
    if ('operation' in values || 'duration-ms' in values)
      throw Error('Finish derives operation and elapsed time from start');
    if (!existsSync(session)) throw Error('No running session in this checkout: run start here first');
    const row = JSON.parse(readFileSync(session, 'utf8')),
      duration = now() - Date.parse(row.started);
    if (!['adoption', 'reconciliation'].includes(row.operation) || !Number.isSafeInteger(duration) || duration < 0)
      throw Error('Invalid running session');
    const result = friction(
      root,
      ['record', `--operation=${row.operation}`, `--duration-ms=${duration}`, ...rest],
      now,
    );
    unlinkSync(session);
    return { ...result, timing: 'automatic wall-clock since start, including waits' };
  }
  if (command === 'record') {
    if (!['adoption', 'reconciliation'].includes(values.operation))
      throw Error('Operation must be adoption or reconciliation');
    const row = { schemaVersion: 1, at: new Date(now()).toISOString(), operation: values.operation };
    for (const [flag, key] of Object.entries(fields)) {
      if (values[flag] !== undefined && !/^\d+$/.test(values[flag])) throw Error(`Invalid count: ${flag}`);
      const number = values[flag] === undefined ? null : Number(values[flag]);
      if (number !== null && !Number.isSafeInteger(number)) throw Error(`Invalid count: ${flag}`);
      row[key] = number;
    }
    if (row.durationMs === null) throw Error('Provide an observed --duration-ms');
    read(); // malformed existing data is an error, not silently discarded
    mkdirSync(dir, { recursive: true });
    appendFileSync(file, JSON.stringify(row) + '\n');
    return row;
  }
  const rows = read(),
    report = {
      samples: rows.length,
      latestAt:
        rows
          .map((row) => row.at)
          .sort()
          .at(-1) ?? null,
      operations: {},
    };
  for (const operation of ['adoption', 'reconciliation']) {
    const group = rows.filter((row) => row.operation === operation),
      summary = { samples: group.length };
    for (const key of Object.values(fields)) {
      const numbers = group
        .map((row) => row[key])
        .filter((n) => Number.isSafeInteger(n) && n >= 0)
        .sort((a, b) => a - b);
      const middle = Math.floor(numbers.length / 2);
      summary[key] = {
        observed: numbers.length,
        missing: group.length - numbers.length,
        median: numbers.length
          ? numbers.length % 2
            ? numbers[middle]
            : (numbers[middle - 1] + numbers[middle]) / 2
          : null,
      };
    }
    report.operations[operation] = summary;
  }
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(
      JSON.stringify(friction(fileURLToPath(new URL('..', import.meta.url)), process.argv.slice(2)), null, 2),
    );
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
