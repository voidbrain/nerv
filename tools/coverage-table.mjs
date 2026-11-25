// The code coverage table: per folder, how much of the code the tests run (lines, statements, branches, functions)
// and the files no test runs, from the standard coverage summary (`coverage-summary.json`, the "json-summary" reporter
// of Istanbul / V8, which most test runners write). Coverage says what the tests ran, not that the behaviour is
// checked: a table to find untested parts, never a number to hit.
//   node tools/coverage-table.mjs --write   writes the page and its baseline (after a coverage run)
//   node tools/coverage-table.mjs --check   prints fresh coverage; warns by default, fails with coverage.enforce when a folder dropped
//                                           more than `drop` points against the committed baseline; --github for CI
// Settings: .harness.json "coverage": { summary, folders: ["src/app/core/", …], page?, baseline?, drop? }. Optional
// browser and combined coverage (tools/browser-coverage.mjs): "browser": { summary? } and "combined": { summary? } add
// their own tables, baselines (keys "browser:<folder>", "combined:<folder>") and checks; without them nothing changes.
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const stampUrl = new URL('../.harness.json', import.meta.url);
const stamp = existsSync(stampUrl) ? JSON.parse(readFileSync(stampUrl, 'utf8')) : {};
const cfg = stamp.coverage ?? {};
const enforce = cfg.enforce === true;
let regressions = 0;
if (enforce && (!Number.isFinite(cfg.drop ?? 2) || (cfg.drop ?? 2) < 0))
  throw Error('Coverage tolerance must be a nonnegative number');
const SUMMARY = new URL(`../${cfg.summary ?? 'coverage/coverage-summary.json'}`, import.meta.url);
const PAGE = new URL(`../${cfg.page ?? 'docs/agents/coverage.md'}`, import.meta.url);
const BASELINE = new URL(`../${cfg.baseline ?? 'docs/agents/coverage.json'}`, import.meta.url);
const DROP = cfg.drop ?? 2;
const METRICS = ['lines', 'statements', 'branches', 'functions'];
const args = process.argv.slice(2),
  github = args.includes('--github');
const say = (text) => {
  regressions++;
  console.log(github ? `::${enforce ? 'error' : 'warning'} title=Coverage::${text}` : `! ${text}`);
};

if (!existsSync(SUMMARY)) {
  say(
    `No coverage summary at ${relative(root, fileURLToPath(SUMMARY))}: run the tests with coverage (json-summary reporter) first.`,
  );
  process.exit(enforce ? 1 : 0);
}
// a path in the summary relative to the repository, whether it was written through a symlinked folder or not
const roots = [root, realpathSync(root)];
const rel = (abs) =>
  (roots.map((r) => relative(r, abs)).find((x) => !x.startsWith('..')) ?? relative(root, abs)).split('\\').join('/');
const filesOf = (summary) =>
  Object.entries(summary)
    .filter(([k]) => k !== 'total')
    .map(([abs, m]) => ({ path: rel(abs), m }));
const files = filesOf(JSON.parse(readFileSync(SUMMARY, 'utf8')));
const folders =
  Array.isArray(cfg.folders) && cfg.folders.length
    ? cfg.folders
    : [...new Set(files.map((f) => f.path.split('/').slice(0, -1).join('/') + '/'))].sort();

/** Covered / total per metric for the files under `prefix` (all files when empty). */
const sum = (list) =>
  Object.fromEntries(
    METRICS.map((k) => {
      const t = list.reduce((n, f) => n + (f.m[k]?.total ?? 0), 0),
        c = list.reduce((n, f) => n + (f.m[k]?.covered ?? 0), 0);
      return [k, t ? Math.round((1000 * c) / t) / 10 : null];
    }),
  );
const measure = (list) => ({
  list,
  rows: folders.map((folder) => {
    const inside = list.filter((f) => f.path.startsWith(folder));
    return {
      folder,
      files: inside.length,
      ...sum(inside),
      untested: inside.filter((f) => (f.m.lines?.total ?? 0) > 0 && (f.m.lines?.covered ?? 0) === 0).map((f) => f.path),
    };
  }),
  total: { folder: 'all', files: list.length, ...sum(list) },
});
const { rows, total } = measure(files);
// optional browser and combined runs, each with its own table and baseline keys; a configured summary that is missing
// is reported (and fails under enforce), never read as zero
const extra = [
  ['browser', 'Browser tests', 'What the browser tests ran (Chromium, mapped to the sources; lines only).'],
  ['combined', 'Combined', 'What unit or browser tests ran, each line counted once (lines only).'],
]
  .filter(([key]) => cfg[key])
  .map(([key, title, about]) => {
    const path = new URL(`../${cfg[key].summary ?? `coverage/${key}-summary.json`}`, import.meta.url);
    if (!existsSync(path)) {
      say(
        `No ${key} coverage summary at ${relative(root, fileURLToPath(path))}: run tools/browser-coverage.mjs after the browser tests.`,
      );
      return { key, title, about, missing: true };
    }
    return { key, title, about, ...measure(filesOf(JSON.parse(readFileSync(path, 'utf8')))) };
  });
const pct = (v) => (v === null ? '–' : `${v.toFixed(1)} %`);

const table = (title, data = { rows, total }) => {
  let md = `| ${title} | Files | Lines | Statements | Branches | Functions |\n|---|---|---|---|---|---|\n`;
  for (const r of [...data.rows, data.total])
    md += `| ${r.folder === 'all' ? '**all**' : `\`${r.folder}\``} | ${r.files} | ${pct(r.lines)} | ${pct(r.statements)} | ${pct(r.branches)} | ${pct(r.functions)} |\n`;
  return md;
};

if (args.includes('--write')) {
  let md =
    '<!-- Written by tools/coverage-table.mjs from the coverage summary: run the tests with coverage, then the script. -->\n\n';
  md +=
    '# Code coverage\n\nHow much of the code the unit tests run, per folder. It says what ran, not that the behaviour is checked; branches say the most. A table to find untested parts, never a number to hit: CI reports fresh coverage; optional enforcement fails regressions against the main-branch baseline.\n\n';
  md += table('Folder');
  const untested = rows.filter((r) => r.untested.length);
  for (const x of extra.filter((x) => !x.missing)) md += `\n## ${x.title}\n\n${x.about}\n\n${table('Folder', x)}`;
  md += `\n## Files no unit test runs\n\n${
    untested.length
      ? untested
          .map(
            (r) =>
              `- \`${r.folder}\`: ${r.untested
                .slice(0, 25)
                .map((p) => `\`${p.slice(r.folder.length)}\``)
                .join(', ')}${r.untested.length > 25 ? ` and ${r.untested.length - 25} more` : ''}`,
          )
          .join('\n')
      : '(none)'
  }\n`;
  mkdirSync(dirname(fileURLToPath(PAGE)), { recursive: true });
  mkdirSync(dirname(fileURLToPath(BASELINE)), { recursive: true });
  writeFileSync(PAGE, md);
  const entries = (prefix, data) =>
    [...data.rows, data.total].map((r) => [`${prefix}${r.folder}`, Object.fromEntries(METRICS.map((k) => [k, r[k]]))]);
  writeFileSync(
    BASELINE,
    `${JSON.stringify(Object.fromEntries([...entries('', { rows, total }), ...extra.filter((x) => !x.missing).flatMap((x) => entries(`${x.key}:`, x))]), null, 1)}\n`,
  );
  console.log(
    `${relative(root, fileURLToPath(PAGE))}: ${rows.length} folder(s); all: ${METRICS.map((k) => `${k} ${pct(total[k])}`).join(', ')}`,
  );
}

if (args.includes('--check')) {
  let base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : null;
  if (enforce) {
    // The PR's edited baseline must not approve its own regression.
    const path = relative(root, fileURLToPath(BASELINE)).split('\\').join('/');
    if (path.startsWith('..')) throw Error('Enforced baseline must be inside the repository');
    try {
      base = JSON.parse(
        execFileSync('git', ['-C', root, 'show', `origin/${stamp.defaultBranch ?? 'main'}:${path}`], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
      );
    } catch {
      base = null;
    }
  }
  const tables = [
    `## Code coverage\n\n${table('Folder')}`,
    ...extra.filter((x) => !x.missing).map((x) => `### ${x.title}\n\n${table('Folder', x)}`),
  ].join('\n');
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${tables}\n`);
  else console.log(tables);
  if (!base) say(`No coverage baseline (${relative(root, fileURLToPath(BASELINE))}): write one with --write.`);
  else {
    // A PR cannot hide a regressed baseline folder by dropping its display row.
    // a baseline run whose setting was removed would go unchecked: say so
    for (const key of ['browser', 'combined'])
      if (!cfg[key] && Object.keys(base).some((k) => k.startsWith(`${key}:`)))
        say(
          `The baseline has ${key} coverage but coverage.${key} is not configured: restore it, or remove those baseline rows in a PR that says why.`,
        );
    // each run against its own baseline keys: unit "<folder>", browser "browser:<folder>", combined "combined:<folder>"
    for (const run of [
      { key: '', label: '', rows, total, list: files },
      ...extra.filter((x) => !x.missing).map((x) => ({ ...x, key: `${x.key}:`, label: `${x.key} ` })),
    ]) {
      const comparisons = [...run.rows, run.total];
      if (enforce)
        for (const k of Object.keys(base)) {
          if (!k.startsWith(run.key) || (run.key === '' && /^(browser|combined):/.test(k))) continue;
          const folder = k.slice(run.key.length);
          if (folder !== 'all' && !run.rows.some((r) => r.folder === folder))
            comparisons.push({ folder, ...sum(run.list.filter((f) => f.path.startsWith(folder))) });
        }
      // lines-only runs measure no branches or functions: compare what they measure
      const metrics = run.key ? ['lines', 'statements'] : METRICS;
      // the PR that adopts a browser or combined run has no main baseline for it yet: it starts one, nothing to compare
      if (run.key && !Object.keys(base).some((k) => k.startsWith(run.key))) {
        console.log(`${run.label.trim()} coverage has no baseline on the default branch yet: this run starts it.`);
        continue;
      }
      for (const r of comparisons)
        for (const k of metrics) {
          const was = base[`${run.key}${r.folder}`]?.[k];
          if (enforce && (typeof was !== 'number' || typeof r[k] !== 'number'))
            say(`${run.label}${r.folder}: comparable ${k} coverage missing.`);
          if (typeof was === 'number' && typeof r[k] === 'number' && was - r[k] > DROP)
            say(
              `${run.label}${r.folder === 'all' ? 'all code' : r.folder}: ${k} ${pct(was)} → ${pct(r[k])} (more than ${DROP} points down).`.replace(
                /^all code/,
                'All code',
              ),
            );
        }
    }
  }
}

if (args.includes('--check') && enforce && regressions) process.exitCode = 1;
