// Optional work queue: the order work-items.mjs gives the ledger (workItems.order queue) and its validation. Source
// records own priorities, estimates, decisions and acceptance. Writes nothing.
import assert from 'node:assert/strict';
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve, relative, sep, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { graph } from './backlog-dependencies.mjs';
// The page this tool used to write (until 5.4.0); the ledger now carries the order (work-items.mjs).
const RETIRED = 'docs/agents/backlog-queue.md';
const cues = ['🔴', '🟠', '🟡', '🟢', '🟣', '🔵'];
const cells = (line) =>
  line
    .split(/(?<!\\)\|/)
    .slice(1, -1)
    .map((v) => v.trim());
const present = (path) => {
  try {
    lstatSync(path);
    return true;
  } catch (e) {
    if (e.code === 'ENOENT') return false;
    throw e;
  }
};
function safe(root, path) {
  assert(
    typeof path === 'string' && !isAbsolute(path) && !path.split(/[\\/]/).includes('..'),
    'Use a repository-relative path without traversal',
  );
  const full = resolve(root, path);
  assert(full.startsWith(root + sep), 'Path must stay inside the repository');
  let current = root;
  for (const part of relative(root, full).split(sep)) {
    current = join(current, part);
    assert(present(current), `Missing path: ${path}`);
    assert(!lstatSync(current).isSymbolicLink(), `Symlink path rejected: ${path}`);
  }
  return full;
}
function field(record, name) {
  const rows = record.body
    .split('\n')
    .filter((l) => l.startsWith('|'))
    .map(cells)
    .filter((c) => c[0].replaceAll('**', '') === name);
  assert(rows.length <= 1, `${record.id}: duplicate ${name}`);
  assert(!rows.length || rows[0].length === 2, `${record.id}: malformed ${name}`);
  return rows[0]?.[1];
}
// F-063: the generated ledger merges Signal into Status ("🔴 Open"); read such a row in the authored column order.
const unmerge = (c) => {
  const m = /^(🔴|🟠|🟡|🟢|🟣|🔵) (Open|Investigate|Implemented|Verified|Blocked|Closed)$/.exec(c[0] ?? '');
  return m ? [m[1], c[1], m[2], ...c.slice(2)] : c;
};
function summary(record) {
  const rows = record.body
    .split('\n')
    .filter((l) => l.startsWith('|'))
    .map((l) => unmerge(cells(l)))
    .filter((c) => cues.includes(c[0]));
  if (record.file !== 'docs/BACKLOG.md' && rows.length !== 1)
    return { status: 'Unknown', priority: 'Unknown', effort: 'Unknown' };
  assert(rows.length === 1, `${record.id}: missing or ambiguous summary`);
  const row = rows[0];
  const legacy = row[1] === record.id;
  // The generated ledger (F-059) adds Remaining, optional Depends on / Unlocks, and Human action as the last cell.
  const generated = [6, 8].includes(row.length) && /^(?:🧑|💻) (?:Yes|No)$/.test(row.at(-1));
  if (record.file !== 'docs/BACKLOG.md' && ![4, 5].includes(row.length) && !generated)
    return { status: 'Unknown', priority: 'Unknown', effort: 'Unknown' };
  assert([4, 5].includes(row.length) || generated, `${record.id}: unsupported summary`);
  if (record.file === 'docs/BACKLOG.md')
    assert((row.length === 4 || generated) && !legacy, `${record.id}: migrate the active summary to four columns`);
  const status = row[legacy ? 3 : 2];
  if (
    record.file !== 'docs/BACKLOG.md' &&
    !['Open', 'Investigate', 'Implemented', 'Verified', 'Blocked', 'Closed'].includes(status)
  )
    return { status: 'Unknown', priority: 'Unknown', effort: 'Unknown' };
  assert(
    ['Open', 'Investigate', 'Implemented', 'Verified', 'Blocked', 'Closed'].includes(status),
    `${record.id}: unknown status`,
  );
  const priority = legacy ? row[2] : row[1],
    effort = legacy ? 'Unknown' : row[3];
  return { status, priority, effort, ...(generated ? { human: row.at(-1).split(' ')[1] } : {}) };
}
function placements(markdown) {
  const map = new Map();
  let columns = null,
    rank = 0;
  // Only the owning roadmap placement table, not a generated status summary. Fenced examples are ignored.
  let fence = null;
  for (const line of markdown.split('\n')) {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1];
      else if (f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      columns = null;
      continue;
    }
    if (fence) continue;
    if (!line.startsWith('|')) {
      columns = null;
      continue;
    }
    const row = cells(line);
    if (row.includes('Records') && (row.includes('Scope') || row.includes('Acceptance'))) {
      columns = { records: row.indexOf('Records'), name: 0 };
      continue;
    }
    if (!columns || row.every((c) => /^:?-+:?$/.test(c))) continue;
    rank++;
    for (const id of (row[columns.records] ?? '').match(/(?<![A-Za-z0-9_/:.-])[FB]-\d{3,}\b/g) ?? []) {
      const previous = map.get(id);
      assert(!previous || previous.name === row[columns.name], `${id}: multiple roadmap placements`);
      map.set(id, { rank, name: row[columns.name] });
    }
  }
  return map;
}
export function queue(sources, roadmap = '') {
  const all = graph(sources),
    milestones = placements(roadmap),
    orders = new Set();
  const summaries = new Map([...all.values()].map((r) => [r.id, summary(r)]));
  const records = [...all.values()]
    .filter((r) => r.file === 'docs/BACKLOG.md' && summaries.get(r.id).status !== 'Closed')
    .map((record) => {
      const s = summaries.get(record.id);
      assert(/^\S+ P[123]$/.test(s.priority), `${record.id}: unknown priority`);
      assert(['🟢 Small', '🟡 Medium', '🔴 Large', '🟣 Very large'].includes(s.effort), `${record.id}: unknown effort`);
      const humans = s.human ? [[null, s.human]] : [...record.body.matchAll(/Human action required: (Yes|No)/g)];
      assert(
        humans.length === 1 && ['Yes', 'No'].includes(humans[0][1]),
        `${record.id}: missing or ambiguous human cue`,
      );
      const human = humans[0][1];
      const explicit = field(record, 'Queue order');
      let order = Infinity,
        orderReason = '';
      if (explicit !== undefined) {
        const match = /^([1-9]\d{0,5}) — (\S.*)$/.exec(explicit);
        assert(match, `${record.id}: Queue order needs a positive integer — reason`);
        order = Number(match[1]);
        orderReason = match[2];
        assert(!orders.has(order), `${record.id}: duplicate Queue order ${order}`);
        orders.add(order);
      }
      const unresolved = record.dependencies
        .filter((d) => d.external || summaries.get(d.id).status !== 'Closed')
        .map((d) => ({ ...d, state: d.external ? 'Unverified' : summaries.get(d.id).status }));
      const lane =
        s.status === 'Blocked'
          ? 'Blocked'
          : human === 'Yes'
            ? 'Human action'
            : unresolved.length
              ? 'Prerequisite review'
              : 'Agent candidates';
      const unlocks = [...all.values()]
        .filter(
          (r) =>
            r.file === 'docs/BACKLOG.md' &&
            summaries.get(r.id).status !== 'Closed' &&
            r.dependencies.some((d) => !d.external && d.id === record.id),
        )
        .map((r) => r.id)
        .sort();
      const milestone = milestones.get(record.id);
      const next =
        record.body.match(/(?:Human action required: (?:Yes|No)\*\*<br \/>|^(?:🧑|💻) \*\*→\*\* )([^\n]+)/m)?.[1] ??
        'Read the owning record.';
      const title = record.body.match(/^\*\*([^\n]+)\*\*$/m)?.[1];
      assert(title, `${record.id}: missing title`);
      return {
        ...record,
        ...s,
        human,
        lane,
        order,
        orderReason,
        unresolved,
        unlocks,
        milestone,
        next,
        title,
        impact: field(record, 'Impact'),
      };
    });
  const effort = { '🟢 Small': 0, '🟡 Medium': 1, '🔴 Large': 2, '🟣 Very large': 3 };
  records.sort(
    (a, b) =>
      a.order - b.order ||
      Number(a.priority.at(-1)) - Number(b.priority.at(-1)) ||
      (a.milestone?.rank ?? Infinity) - (b.milestone?.rank ?? Infinity) ||
      b.unlocks.length - a.unlocks.length ||
      effort[a.effort] - effort[b.effort] ||
      a.id.localeCompare(b.id),
  );
  return records;
}
export function run(root, args) {
  assert(args.length <= 1 && args.every((a) => a === '--check'), 'Use backlog-queue.mjs [--check]');
  root = realpathSync(root);
  const sources = [];
  if (present(join(root, 'docs/BACKLOG.md')))
    sources.push({ file: 'docs/BACKLOG.md', text: readFileSync(safe(root, 'docs/BACKLOG.md'), 'utf8') });
  if (present(join(root, 'docs/archive'))) {
    safe(root, 'docs/archive');
    for (const name of readdirSync(join(root, 'docs/archive'))
      .filter((n) => /^backlog-\d{4}\.md$/.test(n))
      .sort()) {
      const file = `docs/archive/${name}`;
      sources.push({ file, text: readFileSync(safe(root, file), 'utf8') });
    }
  }
  let config = {};
  if (present(join(root, '.harness.json'))) config = JSON.parse(readFileSync(safe(root, '.harness.json'), 'utf8'));
  const settings = config.workQueue ?? {};
  assert(
    settings &&
      typeof settings === 'object' &&
      !Array.isArray(settings) &&
      Object.keys(settings).every((k) => k === 'roadmap'),
    'Unknown workQueue setting',
  );
  let roadmap = '';
  if (settings.roadmap !== undefined) {
    assert(typeof settings.roadmap === 'string' && settings.roadmap, 'workQueue.roadmap must name a repository file');
    roadmap = readFileSync(safe(root, settings.roadmap), 'utf8');
  }
  const records = queue(sources, roadmap);
  // Links to the retired page from the ledger (its layout header) must go too.
  const ledger = sources.find((x) => x.file === 'docs/BACKLOG.md')?.text ?? '';
  const target = RETIRED.slice('docs/'.length).replaceAll('.', '\\.');
  assert(
    !new RegExp(`\\]\\([^)]*${target}`).test(ledger),
    `docs/BACKLOG.md still links ${RETIRED}, retired in 5.5.0: remove the link`,
  );
  assert(
    !present(join(root, RETIRED)),
    `${RETIRED} is retired (5.5.0): the generated ledger lists records in this order (workItems.order queue); delete the page and its links`,
  );
  return records;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    run(process.cwd(), process.argv.slice(2));
    console.log('Backlog work queue: valid.');
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
