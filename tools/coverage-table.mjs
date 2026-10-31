// The code coverage table: per folder, how much of the code the tests run (lines, statements, branches, functions)
// and the files no test runs, from the standard coverage summary (`coverage-summary.json`, the "json-summary" reporter
// of Istanbul / V8, which most test runners write). Coverage says what the tests ran, not that the behaviour is
// checked: a table to find untested parts, never a number to hit.
//   node tools/coverage-table.mjs --write   writes the page and its baseline (after a coverage run)
//   node tools/coverage-table.mjs --check   prints fresh coverage; warns by default, fails with coverage.enforce when a folder dropped
//                                           more than `drop` points against the committed baseline; --github for CI
// Settings: .harness.json "coverage": { summary, folders: ["src/app/core/", …], page?, baseline?, drop? }.
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
if (enforce && (!Number.isFinite(cfg.drop ?? 2) || (cfg.drop ?? 2) < 0)) throw Error('Coverage tolerance must be a nonnegative number');
const SUMMARY = new URL(`../${cfg.summary ?? 'coverage/coverage-summary.json'}`, import.meta.url);
const PAGE = new URL(`../${cfg.page ?? 'docs/agents/coverage.md'}`, import.meta.url);
const BASELINE = new URL(`../${cfg.baseline ?? 'docs/agents/coverage.json'}`, import.meta.url);
const DROP = cfg.drop ?? 2;
const METRICS = ['lines', 'statements', 'branches', 'functions'];
const args = process.argv.slice(2), github = args.includes('--github');
const say = (text) => {regressions++; console.log(github ? `::${enforce ? 'error' : 'warning'} title=Coverage::${text}` : `! ${text}`);};

if (!existsSync(SUMMARY)) {
  say(`No coverage summary at ${relative(root, fileURLToPath(SUMMARY))}: run the tests with coverage (json-summary reporter) first.`);
  process.exit(enforce ? 1 : 0);
}
const summary = JSON.parse(readFileSync(SUMMARY, 'utf8'));
// a path in the summary relative to the repository, whether it was written through a symlinked folder or not
const roots = [root, realpathSync(root)];
const rel = (abs) => (roots.map((r) => relative(r, abs)).find((x) => !x.startsWith('..')) ?? relative(root, abs)).split('\\').join('/');
const files = Object.entries(summary).filter(([k]) => k !== 'total').map(([abs, m]) => ({ path: rel(abs), m }));
const folders = Array.isArray(cfg.folders) && cfg.folders.length ? cfg.folders : [...new Set(files.map((f) => f.path.split('/').slice(0, -1).join('/') + '/'))].sort();

/** Covered / total per metric for the files under `prefix` (all files when empty). */
const sum = (list) => Object.fromEntries(METRICS.map((k) => {
  const t = list.reduce((n, f) => n + (f.m[k]?.total ?? 0), 0), c = list.reduce((n, f) => n + (f.m[k]?.covered ?? 0), 0);
  return [k, t ? Math.round((1000 * c) / t) / 10 : null];
}));
const rows = folders.map((folder) => {
  const list = files.filter((f) => f.path.startsWith(folder));
  return { folder, files: list.length, ...sum(list), untested: list.filter((f) => (f.m.lines?.total ?? 0) > 0 && (f.m.lines?.covered ?? 0) === 0).map((f) => f.path) };
});
const total = { folder: 'all', files: files.length, ...sum(files) };
const pct = (v) => (v === null ? '–' : `${v.toFixed(1)} %`);

const table = (title) => {
  let md = `| ${title} | Files | Lines | Statements | Branches | Functions |\n|---|---|---|---|---|---|\n`;
  for (const r of [...rows, total]) md += `| ${r.folder === 'all' ? '**all**' : `\`${r.folder}\``} | ${r.files} | ${pct(r.lines)} | ${pct(r.statements)} | ${pct(r.branches)} | ${pct(r.functions)} |\n`;
  return md;
};

if (args.includes('--write')) {
  let md = '<!-- Written by tools/coverage-table.mjs from the coverage summary: run the tests with coverage, then the script. -->\n\n';
  md += '# Code coverage\n\nHow much of the code the unit tests run, per folder. It says what ran, not that the behaviour is checked; branches say the most. A table to find untested parts, never a number to hit: CI reports fresh coverage; optional enforcement fails regressions against the main-branch baseline.\n\n';
  md += table('Folder');
  const untested = rows.filter((r) => r.untested.length);
  md += `\n## Files no unit test runs\n\n${untested.length ? untested.map((r) => `- \`${r.folder}\`: ${r.untested.slice(0, 25).map((p) => `\`${p.slice(r.folder.length)}\``).join(', ')}${r.untested.length > 25 ? ` and ${r.untested.length - 25} more` : ''}`).join('\n') : '(none)'}\n`;
  mkdirSync(dirname(fileURLToPath(PAGE)), { recursive: true });
  mkdirSync(dirname(fileURLToPath(BASELINE)), { recursive: true });
  writeFileSync(PAGE, md);
  writeFileSync(BASELINE, `${JSON.stringify(Object.fromEntries([...rows, total].map((r) => [r.folder, Object.fromEntries(METRICS.map((k) => [k, r[k]]))])), null, 1)}\n`);
  console.log(`${relative(root, fileURLToPath(PAGE))}: ${rows.length} folder(s); all: ${METRICS.map((k) => `${k} ${pct(total[k])}`).join(', ')}`);
}

if (args.includes('--check')) {
  let base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : null;
  if (enforce) {
    // The PR's edited baseline must not approve its own regression.
    const path = relative(root, fileURLToPath(BASELINE)).split('\\').join('/');
    if (path.startsWith('..')) throw Error('Enforced baseline must be inside the repository');
    try {base=JSON.parse(execFileSync('git',['-C',root,'show',`origin/${stamp.defaultBranch ?? 'main'}:${path}`],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));}
    catch {base=null;}
  }
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Code coverage\n\n${table('Folder')}\n`);
  else console.log(table('Folder'));
  if (!base) say(`No coverage baseline (${relative(root, fileURLToPath(BASELINE))}): write one with --write.`);
  else {
    // A PR cannot hide a regressed baseline folder by dropping its display row.
    const comparisons = [...rows, total];
    if (enforce) for (const folder of Object.keys(base)) {
      if (folder !== 'all' && !rows.some(r => r.folder === folder)) comparisons.push({folder, ...sum(files.filter(f => f.path.startsWith(folder)))});
    }
    for (const r of comparisons) for (const k of METRICS) {
      const was = base[r.folder]?.[k];
      if (enforce && (typeof was !== 'number' || typeof r[k] !== 'number')) say(`${r.folder}: comparable ${k} coverage missing.`);
      if (typeof was === 'number' && typeof r[k] === 'number' && was - r[k] > DROP) say(`${r.folder === 'all' ? 'All code' : r.folder}: ${k} ${pct(was)} → ${pct(r[k])} (more than ${DROP} points down).`);
    }
  }
}

if (args.includes('--check') && enforce && regressions) process.exitCode = 1;
