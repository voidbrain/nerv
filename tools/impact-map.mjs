// The impact map (.harness.json "impact"): what must follow a change, and what must run again after that. A row:
//   { id, when: [file globs], inputs?: [file globs], then: "what must follow", run?: "command", checked?: "what verifies
//     it", after?: [ids] }
// `inputs` is the content the output is made of (an example it records, a demo file it loads): it sets the row off like
// `when`, and the page lists it as a content dependency. Next to the rows, .harness.json may list
//   "couplings": [{ value, places: [{ file, what }], kept }]   a value that lives in two places and what keeps them equal
//   "outside":   [{ what, affects, noticed }]                   what can change an output with no commit here
//   "pages":     [{ title, path, about? }]                      the project's own detailed maps, linked at the top of the page
// A row fires when a changed file matches one of its globs (`*` within a path segment, `**` across segments), or when a
// row it names in `after` fires: re-running that one makes this one stale too (a catalogue rebuilt → the examples that
// use it). `plan()` returns the fired rows in the order to run them. Run directly, it writes the map as a page
// (`.harness.json` "impactPage", default docs/agents/impact-map.md) so people read the same rows the checks use.
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const glob = (g) => new RegExp(`^${g.split('**').map((p) => p.split('*').map((q) => q.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*')}$`);

/** The rows `changed` files set off, directly or through `after`, in run order: [{ row, files, after }]. */
export function plan(rows, changed) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && r.then);
  const key = (r, i) => r.id ?? `#${i + 1}`;
  const fired = new Map();
  list.forEach((r, i) => {
    const res = [...(Array.isArray(r.when) ? r.when : []), ...(Array.isArray(r.inputs) ? r.inputs : [])].map(glob);
    const files = changed.filter((f) => res.some((re) => re.test(f)));
    if (files.length) fired.set(key(r, i), { row: r, files, after: [] });
  });
  // downstream: a row that runs after a fired one fires too (until nothing new; a cycle stops there)
  for (let grew = true; grew; ) {
    grew = false;
    list.forEach((r, i) => {
      const k = key(r, i), by = (r.after ?? []).filter((a) => fired.has(a));
      if (!by.length) return;
      if (!fired.has(k)) { fired.set(k, { row: r, files: [], after: by }); grew = true; }
      else for (const a of by) if (!fired.get(k).after.includes(a)) fired.get(k).after.push(a);
    });
  }
  // run order: a row after the rows it follows; otherwise the map's own order
  const order = [], seen = new Set();
  const visit = (k, path = new Set()) => {
    if (seen.has(k) || path.has(k)) return;
    path.add(k);
    for (const a of fired.get(k).row.after ?? []) if (fired.has(a)) visit(a, path);
    seen.add(k);
    order.push({ id: k, ...fired.get(k) });
  };
  list.forEach((r, i) => fired.has(key(r, i)) && visit(key(r, i)));
  return order;
}

/** The couplings a set of changed files touches: [{ coupling, files }]. */
export function couplingsTouched(couplings, changed) {
  return (Array.isArray(couplings) ? couplings : []).map((c) => {
    const res = (c.places ?? []).map((p) => glob(p.file));
    return { coupling: c, files: changed.filter((f) => res.some((re) => re.test(f))) };
  }).filter((x) => x.files.length);
}

/** One line for a planned step. */
export const describe = (s) => `${s.row.then}${s.row.run ? ` (${s.row.run})` : ''}${s.files.length ? ` — ${s.files.slice(0, 3).join(', ')}${s.files.length > 3 ? ` (+${s.files.length - 3})` : ''} changed` : ''}${s.after.length ? ` — after ${s.after.join(', ')}` : ''}; ${s.row.checked ? `checked by ${s.row.checked}` : 'nothing checks it'}`;

// run directly (not imported by check-freshness): real paths, since a temp folder can be reached through a symlink
if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  const stampUrl = new URL('../.harness.json', import.meta.url);
  const stamp = existsSync(stampUrl) ? JSON.parse(readFileSync(stampUrl, 'utf8')) : {};
  const rows = Array.isArray(stamp.impact) ? stamp.impact : [];
  const page = new URL(`../${stamp.impactPage ?? 'docs/agents/impact-map.md'}`, import.meta.url);
  const cell = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' '); // backslashes first, then pipes
  let md = '<!-- Written by tools/impact-map.mjs from the "impact" rows of .harness.json: change the rows, then run it. -->\n\n';
  md += '# Impact map\n\nWhat must follow a change, and what must run again after it (AGENTS, "What follows a change"). `npm run check:freshness` lists, on every PR, the rows a branch sets off and the order to run them.\n\n';
  const pages = Array.isArray(stamp.pages) ? stamp.pages : [];
  if (pages.length) {
    // links are relative to this page's folder
    const from = dirname(stamp.impactPage ?? 'docs/agents/impact-map.md');
    md += '**More detail:** ' + pages.map((p) => `[${p.title}](${relative(from, p.path).split('\\').join('/')})${p.about ? ` (${p.about})` : ''}`).join(' · ') + '\n\n';
  }
  md += '| Id | When these change | Made of (content) | This must follow | Command | Runs again after | Checked by |\n|---|---|---|---|---|---|---|\n';
  rows.forEach((r, i) => { md += `| ${cell(r.id ?? `#${i + 1}`)} | ${cell((r.when ?? []).map((w) => `\`${w}\``).join(', '))} | ${cell((r.inputs ?? []).map((w) => `\`${w}\``).join(', '))} | ${cell(r.then)} | ${r.run ? `\`${cell(r.run)}\`` : ''} | ${cell((r.after ?? []).join(', '))} | ${cell(r.checked ?? 'nothing')} |\n`; });
  if (!rows.length) md += '| | (no rows yet) | | | | | |\n';
  const made = rows.filter((r) => (r.inputs ?? []).length);
  md += '\n## Content dependencies\n\nWhat each output is made of, besides code: change one of these and the output is out of date.\n\n| Output | Made of | Redo with |\n|---|---|---|\n';
  for (const r of made) md += `| ${cell(r.then)} | ${cell(r.inputs.map((w) => `\`${w}\``).join(', '))} | ${r.run ? `\`${cell(r.run)}\`` : ''} |\n`;
  if (!made.length) md += '| (none listed) | | |\n';
  const couplings = Array.isArray(stamp.couplings) ? stamp.couplings : [];
  md += '\n## Value couplings\n\nA value that lives in more than one place: change it in one, change it in all. Best kept by one shared source, else by a test.\n\n| Value | Where | Kept equal by |\n|---|---|---|\n';
  for (const c of couplings) md += `| ${cell(c.value)} | ${cell((c.places ?? []).map((p) => `\`${p.file}\`${p.what ? ` (${p.what})` : ''}`).join('<br>'))} | ${cell(c.kept ?? 'nothing')} |\n`;
  if (!couplings.length) md += '| (none listed) | | |\n';
  const outside = Array.isArray(stamp.outside) ? stamp.outside : [];
  md += '\n## Outside the repository\n\nWhat can change an output with no commit here, and how we would notice.\n\n| What | Affects | Noticed by |\n|---|---|---|\n';
  for (const o of outside) md += `| ${cell(o.what)} | ${cell(o.affects)} | ${cell(o.noticed ?? 'nothing')} |\n`;
  if (!outside.length) md += '| (none listed) | | |\n';
  mkdirSync(dirname(fileURLToPath(page)), { recursive: true });
  writeFileSync(page, md);
  console.log(`${fileURLToPath(page)}: ${rows.length} row(s), ${couplings.length} coupling(s), ${outside.length} outside`);
}
