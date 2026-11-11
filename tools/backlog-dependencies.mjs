// Optional backlog graph. Only Depends on is authored; reverse links are derived and shown in each record by
// work-items.mjs. This tool validates the graph; it writes nothing.
import assert from 'node:assert/strict';
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
const ID = '[FB]-\\d{3,}';
const present = (path) => {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
};
function safe(root, path) {
  const base = realpathSync(root),
    full = resolve(root, path);
  assert(full.startsWith(base + sep), 'Path must stay inside the repository');
  let current = base;
  for (const part of relative(base, full).split(sep)) {
    current = join(current, part);
    assert(present(current), `Missing path: ${path}`);
    assert(!lstatSync(current).isSymbolicLink(), `Symlink path rejected: ${path}`);
  }
  return full;
}
function records(text, file) {
  // Fenced examples are not records or metadata.
  let fence = null;
  const lines = text.split('\n').map((line) => {
    const match = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (match) {
      if (!fence) fence = match[1];
      else if (match[1][0] === fence[0] && match[1].length >= fence.length) fence = null;
      return '';
    }
    return fence ? '' : line;
  });
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const match = new RegExp(`^### (${ID})\\s*$`).exec(lines[i]);
    if (!match) continue;
    let end = i + 1;
    while (end < lines.length && !/^#{1,3} /.test(lines[end])) end++;
    out.push({ id: match[1], file, body: lines.slice(i, end).join('\n') });
    i = end - 1;
  }
  if (file === 'docs/BACKLOG.md')
    assert(new Set(out.map((r) => r.id)).size === out.length, `Duplicate record in ${file}`);
  return out;
}
function dependencies(record) {
  const rows = record.body.split('\n').filter((line) => /^\|\s*(?:\*\*)?Depends on(?:\*\*)?\s*\|/.test(line));
  assert(rows.length <= 1, `${record.id}: duplicate Depends on field`);
  if (!rows.length) return [];
  const row = /^\|\s*(?:\*\*)?Depends on(?:\*\*)?\s*\|\s*([^|]*)\|\s*$/.exec(rows[0]);
  assert(row, `${record.id}: malformed Depends on row`);
  const value = row[1].trim();
  if (value === '—') return [];
  assert(value, `${record.id}: empty Depends on field; use —`);
  const seen = new Set();
  return value.split(/<br\s*\/?\s*>/).map((part) => {
    const m = new RegExp(`^\\s*\\[((?:[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+:)?${ID})\\]\\(([^\\s)]+)\\) — (\\S.*)\\s*$`).exec(
      part,
    );
    assert(m, `${record.id}: expected [ID](link) — required outcome`);
    const [, id, url, outcome] = m;
    assert(!seen.has(id), `${record.id}: duplicate dependency ${id}`);
    seen.add(id);
    assert(id !== record.id, `${record.id}: self dependency`);
    if (id.includes(':')) {
      const [repository, foreignId] = id.split(':');
      const prefix = `https://github.com/${repository}/blob/`;
      assert(
        url.startsWith(prefix) && url.endsWith(`#${foreignId.toLowerCase()}`),
        `${record.id}: external link must identify its qualified repository and record`,
      );
      const parsed = new URL(url);
      assert(
        !parsed.username && !parsed.password && !parsed.search,
        `${record.id}: credential-free external link required`,
      );
    } else
      assert(
        url === `#${id.toLowerCase()}` ||
          url === `BACKLOG.md#${id.toLowerCase()}` ||
          (/^archive\/backlog-\d{4}\.md#[fb]-\d{3,}$/.test(url) && url.endsWith(`#${id.toLowerCase()}`)),
        `${record.id}: invalid local record link`,
      );
    return { id, url, outcome: outcome.trim(), external: id.includes(':') };
  });
}
export function graph(sources) {
  const all = new Map();
  // Archives first; the active record is the authoritative reopened version.
  for (const source of [
    ...sources.filter((s) => s.file !== 'docs/BACKLOG.md'),
    ...sources.filter((s) => s.file === 'docs/BACKLOG.md'),
  ]) {
    for (const record of records(source.text, source.file)) all.set(record.id, record);
  }
  for (const record of all.values()) record.dependencies = dependencies(record);
  for (const record of all.values())
    for (const dep of record.dependencies) {
      if (dep.external) continue;
      const target = all.get(dep.id);
      assert(target, `${record.id}: missing dependency ${dep.id}`);
      const linkedFile = dep.url.startsWith('#')
        ? record.file
        : dep.url.startsWith('BACKLOG.md#')
          ? 'docs/BACKLOG.md'
          : `docs/${dep.url.split('#')[0]}`;
      // A local link must resolve to a real heading, including a preserved archived version.
      assert(
        record.file !== 'docs/BACKLOG.md' ||
          sources.some((s) => s.file === linkedFile && records(s.text, s.file).some((r) => r.id === dep.id)),
        `${record.id}: broken dependency link ${dep.url}`,
      );
    }
  const done = new Set(),
    visiting = new Set();
  function visit(id, path) {
    assert(!visiting.has(id), `Dependency cycle: ${[...path, id].join(' → ')}`);
    if (done.has(id)) return;
    visiting.add(id);
    for (const dep of all.get(id).dependencies) if (!dep.external) visit(dep.id, [...path, id]);
    visiting.delete(id);
    done.add(id);
  }
  for (const id of all.keys()) visit(id, []);
  return all;
}
// The page this tool used to write (until 5.4.0). Depends on and Unlocks now appear in each record of the generated
// ledger (work-items.mjs), so a leftover page would go stale: the check asks for its removal.
const RETIRED = 'docs/agents/backlog-dependencies.md';
export function run(root, args) {
  assert(args.length <= 1 && args.every((a) => a === '--check'), 'Use backlog-dependencies.mjs [--check]');
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
  const all = graph(sources);
  // Links to the retired page from the ledger (its layout header) must go too.
  const ledger = sources.find((x) => x.file === 'docs/BACKLOG.md')?.text ?? '';
  const target = RETIRED.slice('docs/'.length).replaceAll('.', '\\.');
  assert(
    !new RegExp(`\\]\\([^)]*${target}`).test(ledger),
    `docs/BACKLOG.md still links ${RETIRED}, retired in 5.5.0: remove the link`,
  );
  assert(
    !present(join(root, RETIRED)),
    `${RETIRED} is retired (5.5.0): Depends on and Unlocks now show in each record; delete the page and its links`,
  );
  return all;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    run(process.cwd(), process.argv.slice(2));
    console.log('Backlog dependencies: valid.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
