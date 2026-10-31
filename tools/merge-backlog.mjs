#!/usr/bin/env node
// Resolve a merge conflict in docs/BACKLOG.md record by record, three ways, while git holds the conflict (after
// `git merge origin/main` stopped on it). Run: node tools/merge-backlog.mjs, then check the result and `git add` it.
//
// It starts from the default branch's file ("theirs": its header, its records, its order), then for each record:
// - only the branch changed it (or added it): the branch's version;
// - only the default branch changed it, or archived it: the default branch's;
// - the branch archived it and the default branch left it alone: gone;
// - both changed it differently: the default branch's version stays and the record is named, to merge by hand (exit 1).
// Paragraphs under "## Other changes" that only the branch has are added. Never keep one side's record wholesale: that
// silently drops the other side's edits to records both have.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const FILE = 'docs/BACKLOG.md';
const stage = (n) => {
  try { return execFileSync('git', ['show', `:${n}:${FILE}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; }
};
const base = stage(1) ?? '', ours = stage(2), theirs = stage(3);
if (ours === null || theirs === null) {
  console.error(`${FILE} is not in conflict: run this while a merge stopped on it.`);
  process.exit(2);
}

/** Every record (`### B-001` up to and including its `---` line) by ID. */
const records = (text) => {
  const out = new Map();
  for (const m of text.matchAll(/^### ([BF]-\d+)\n[\s\S]*?^---\n/gm)) out.set(m[1], m[0]);
  return out;
};
/** The `## ` section heading a record sits under. */
const sectionOf = (text, id) => {
  const at = text.indexOf(`### ${id}\n`);
  return [...text.matchAll(/^## .*$/gm)].filter((h) => h.index < at).at(-1)?.[0];
};

const B = records(base), O = records(ours), T = records(theirs);
let out = theirs;
const byHand = [];
for (const [id, rec] of O) {
  const was = B.get(id), main = T.get(id);
  if (main !== undefined) {
    if (rec === main || rec === was) continue; // the same, or only the default branch changed it
    if (main === was) out = out.replace(main, () => rec); // only the branch changed it
    else byHand.push(id);
    continue;
  }
  if (was !== undefined) continue; // the default branch archived (or removed) it
  // a record only the branch has: under the same section, at its end
  const heads = [...out.matchAll(/^## .*$/gm)].map((h) => h[0]);
  const next = heads[heads.indexOf(sectionOf(ours, id)) + 1];
  out = next ? out.replace(`${next}\n`, () => `${rec}\n${next}\n`) : `${out.trimEnd()}\n\n${rec}`;
}
// records the branch removed (archived): gone, unless the default branch changed them meanwhile
for (const [id, was] of B) {
  if (O.has(id) || !T.has(id)) continue;
  if (T.get(id) === was) out = out.replace(was, () => '');
  else byHand.push(id);
}
// "## Other changes": paragraphs only the branch wrote
const other = (text) => (text.split(/^## Other changes\n/m)[1] ?? '').split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
const have = new Set(other(out));
const added = other(ours).filter((p) => !have.has(p) && !other(base).includes(p));
if (added.length) out = out.replace(/^## Other changes\n\n?/m, (h) => `${h.trimEnd()}\n\n${added.join('\n\n')}\n\n`);

writeFileSync(FILE, out);
console.log(`${FILE}: ${records(out).size} records merged three ways${added.length ? `, ${added.length} paragraph(s) of Other changes added` : ''}. Check it, then git add it.`);
if (byHand.length) {
  console.error(`Both sides changed ${byHand.join(', ')}: the default branch's version is in the file; merge the branch's edits by hand.`);
  process.exit(1);
}
