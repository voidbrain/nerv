import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
// The cue kind from the generated Procedures and Decision cells (8.0.0); undefined for any other content.
const kindOf = ([p, d]) =>
  ['🧑', '—'].includes(p) && ['🧑', '—'].includes(d)
    ? { '🧑🧑': 'Both', '🧑—': 'Procedure', '—🧑': 'Decision', '——': 'No' }[p + d]
    : undefined;

const text = readFileSync(new URL('../docs/BACKLOG.md', import.meta.url), 'utf8');
const cells = (line) =>
  line
    .split(/(?<!\\)\|/)
    .slice(1, -1)
    .map((value) => value.trim());
let width;
for (const line of text.split('\n')) {
  if (!line.startsWith('|')) {
    width = undefined;
    continue;
  }
  width ??= cells(line).length;
  assert.equal(cells(line).length, width, `Table width: ${line}`);
}
const root = fileURLToPath(new URL('..', import.meta.url));
const git = (...args) => {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
};
let stamp = {};
try {
  stamp = JSON.parse(readFileSync(new URL('../.harness.json', import.meta.url), 'utf8'));
} catch {
  /* no stamp: defaults */
}
const branch =
  stamp.defaultBranch ??
  git('symbolic-ref', '--short', 'refs/remotes/origin/HEAD')
    ?.trim()
    .replace(/^origin\//, '') ??
  'main';
const mainText = git('show', `origin/${branch}:docs/BACKLOG.md`) ?? '';
// docs/BACKLOG-RULES.md is the procedure this enforces; an empty ledger is valid.
const headings = [...text.matchAll(/^### ([BF]-\d+)$/gm)];
const ids = new Set();
// Evidence the rules ask for once a record is done (BACKLOG-RULES, Record and evidence requirements): warnings, not
// failures, and only for a record this branch makes done (Verified or Closed here, not on the default branch), so records
// finished under older rules are not flagged. The evidence sits in the PR / evidence or Verification cell, with a value,
// not a placeholder ("Test: …", "Test: <file>").
const warnings = [];
const doneOnMain = new Set(
  mainText
    .split(/^(?=### [BF]-\d+$)/m)
    .slice(1)
    .filter((b) => /^\| \S+ \| \S+ P\d \| (?:Verified|Closed) \|/m.test(b))
    .map((b) => b.slice(4, b.indexOf('\n'))),
);
const evidence = (cellsText, labels) =>
  new RegExp(`(?:^|[\\s;(*])(?:${labels})(?:\\*\\*)?:(?:\\*\\*)?\\s*(?![…<\\s])\\S`).test(cellsText);
// F-063: the generated ledger merges Signal into Status ("🔴 Open"); read such a row in the authored column order.
const unmerge = (c) => {
  const m = /^(🔴|🟠|🟡|🟢|🟣|🔵) (Open|Investigate|Implemented|Verified|Blocked|Closed)$/.exec(c[0] ?? '');
  return m ? [m[1], c[1], m[2], ...c.slice(2)] : c;
};
const cues = { Open: '🔴', Investigate: '🟠', Implemented: '🟡', Verified: '🟢', Blocked: '🟣', Closed: '🔵' };
for (let i = 0; i < headings.length; i++) {
  const id = headings[i][1];
  assert(!ids.has(id), `Duplicate ${id}`);
  ids.add(id);
  const block = text.slice(headings[i].index, headings[i + 1]?.index ?? text.length);
  const row = block
    .split('\n')
    .find((line) => line.startsWith('|') && Object.values(cues).includes(unmerge(cells(line))[0]));
  assert(row, `${id}: missing summary`);
  const [signal, priority, status, effort] = unmerge(cells(row));
  // Authored records have four columns; the generated ledger (F-059) adds Remaining, Depends on / Unlocks when the
  // dependency helper is adopted, and the Procedures and Decision cells (8.0.0), which then replace the label of the
  // human-action line; F-063
  // merges its Signal into Status.
  const lines = block.split('\n');
  const header = cells(lines[lines.indexOf(row) - 2] ?? '');
  const generated = header.length > 4;
  assert(
    generated
      ? [
          'Status|Priority|Effort|Remaining|Procedures|Decision',
          'Status|Priority|Effort|Remaining|Depends on|Unlocks|Procedures|Decision',
        ].includes(header.join('|')) &&
          cells(row).length === header.length &&
          cells(row)[0] !== signal
      : cells(row).length === 4,
    `${id}: summary needs four columns, or the generated Status / Priority / Effort / Remaining / Depends on / Unlocks / Procedures / Decision columns (an older generated ledger: run work-items build; remove completion percentages)`,
  );
  assert(/^\*\*[^\n]+\*\*$/m.test(block.slice(0, block.indexOf('|'))), `${id}: missing visible bold title`);
  assert(
    ['🟢 Small', '🟡 Medium', '🔴 Large', '🟣 Very large'].includes(effort),
    `${id}: effort needs colour and word`,
  );
  assert.equal(signal, cues[status], `${id}: status cue mismatch`);
  const level = priority.match(/P([123])$/)?.[1];
  assert(level, `${id}: missing priority`);
  const marker = ['Closed', 'Blocked'].includes(status) ? '◻️' : { 1: '🔺', 2: '🔶', 3: '🔹' }[level];
  assert.equal(priority, `${marker} P${level}`, `${id}: priority cue mismatch`);
  assert.equal(
    (block.match(/^\*\*Next action \/ closure evidence:\*\* .+/gm) ?? []).length,
    1,
    `${id}: next action must occur exactly once`,
  );
  // 8.0.0: the cue names the kind of human action (Procedure, Decision or Both) instead of Yes.
  assert(
    !/^🧑 \*\*→ Human action required: Yes\*\*/m.test(block),
    `${id}: human-action cue Yes is replaced by Procedure, Decision or Both (8.0.0)`,
  );
  const human = generated
    ? [...block.matchAll(/^(🧑|💻) \*\*→\*\* .+/gm)].map((m) => Object.assign(m, { 2: kindOf(cells(row).slice(-2)) }))
    : [...block.matchAll(/^(🧑|💻) \*\*→ Human action required: (Procedure|Decision|Both|No)\*\*<br \/>.+/gm)];
  assert.equal(human.length, 1, `${id}: missing visible human action/cue`);
  if (generated) assert(human[0][2], `${id}: Procedures and Decision cells need 🧑 or —`);
  assert.equal(human[0][1], human[0][2] === 'No' ? '💻' : '🧑', `${id}: human-action cue mismatch`);
  const humanAt = block.indexOf(human[0][0]);
  const after = block
    .slice(block.indexOf(human[0][0]) + human[0][0].length)
    .split('\n')
    .slice(1, 7);
  const rows = after.slice(3).map(cells);
  assert(
    after[0] === '' &&
      after[1] === '| | |' &&
      after[2] === '|---|---|' &&
      ['**Issue**', '**Reproduce**', '**Check**'].every((k, r) => rows[r]?.[0] === k && rows[r]?.[1]),
    `${id}: every record needs the visible Issue / Reproduce / Check table`,
  );
  const detail = block.match(/<details>\s*<summary>[^<]+<\/summary>([\s\S]*?)<\/details>/);
  assert(detail, `${id}: missing/broken metadata details`);
  assert(
    block.indexOf('**Next action') > block.indexOf('<details>') &&
      block.indexOf('**Next action') < block.indexOf('</details>'),
    `${id}: next action must be inside details`,
  );
  assert(/\*\*Estimates:\*\* .+/.test(detail[1]), `${id}: explain remaining effort and its rationale in details`);
  const visible = block.slice(0, block.indexOf('<details>'));
  assert(
    ['**Issue**', '**Reproduce**', '**Check**'].every((k) => visible.includes(k)),
    `${id}: recap must stay visible`,
  );
  assert(humanAt < block.indexOf('<details>'), `${id}: human action hidden in details`);
  assert(humanAt < block.indexOf('**Next action'), `${id}: human action must precede next action`);
  assert(/<\/details>\n\n---\n/.test(block), `${id}: end the record with a --- line after its details`);
  for (const field of ['PR / evidence', 'Opened', 'Verification', 'Reviewed']) {
    const value = detail[1]
      .split('\n')
      .filter((line) => line.startsWith('|'))
      .map(cells)
      .find((row) => row[0] === field)?.[1];
    assert(value, `${id}: missing ${field}`);
    if (['Opened', 'Reviewed'].includes(field)) assert(/^\d{4}-\d{2}-\d{2}$/.test(value), `${id}: invalid ${field}`);
  }
  if (['Verified', 'Closed'].includes(status) && !doneOnMain.has(id)) {
    const cited = detail[1]
      .split('\n')
      .filter((line) => line.startsWith('|'))
      .map(cells)
      .filter((row) => ['PR / evidence', 'Verification'].includes(row[0]))
      .map((row) => row[1])
      .join('\n');
    if (id.startsWith('B-') && !evidence(cited, 'No test|Test'))
      warnings.push(
        `${id}: a done bug names its failing-first test ("Test: …") or why none can show it ("No test: …"); BACKLOG-RULES, "A bug fix starts with a failing test"`,
      );
    if (level === '1' && !evidence(cited, 'No review|Review'))
      warnings.push(
        `${id}: a done P1 record cites its independent review ("Review: …") or why it needs none ("No review: …"); BACKLOG-RULES, "Independent review"`,
      );
  }
}
assert.equal((text.match(/<details>/g) ?? []).length, headings.length, 'Metadata details count');
assert.equal((text.match(/<\/details>/g) ?? []).length, headings.length, 'Unbalanced metadata details');
// Archives only grow: every line the archives have on the published default branch is still in one of them, unchanged,
// so a rewrite that drops or edits history fails here instead of on review. A record may move from one archive file to
// another (a file's own title and section headings may go with it); a correction is a dated note added, never an edit.
// The folder's README describes it and is not evidence. Skipped without git or a published branch.
const archiveDir = new URL('../docs/archive/', import.meta.url);
const localArchives = existsSync(archiveDir)
  ? readdirSync(archiveDir).filter((f) => f.endsWith('.md') && f !== 'README.md')
  : [];
// A generated closure index may change only after exact derivation; record history still never changes.
const recapMarker = '<!-- archive-recap:start -->';
async function history(text, validate) {
  if (!text.includes(recapMarker)) return text;
  const tool = new URL('./archive-recap.mjs', import.meta.url);
  assert(existsSync(tool), 'Archives with recaps require the optional archive-recap.mjs tool');
  const { stripArchiveRecap } = await import(tool.href);
  return stripArchiveRecap(text, validate);
}
const have = new Map(); // line -> how many times the local archives hold it
for (const f of localArchives)
  for (const line of (await history(readFileSync(new URL(f, archiveDir), 'utf8'), true)).split('\n'))
    have.set(line, (have.get(line) ?? 0) + 1);
const published =
  git('ls-tree', '--name-only', `origin/${branch}`, 'docs/archive/')
    ?.split('\n')
    .filter((f) => f.endsWith('.md') && !f.endsWith('/README.md')) ?? [];
for (const file of published) {
  const was = (await history(git('show', `origin/${branch}:${file}`) ?? '', false)).split('\n');
  const left = new Map(have); // counted per published file: two files merged into one may share a line once
  was.forEach((line, i) => {
    if (!line.trim() || /^#{1,2} /.test(line)) return; // blank lines and file/section headings may change with a move
    const n = left.get(line) ?? 0;
    if (n) {
      left.set(line, n - 1);
      return;
    }
    const record = was
      .slice(0, i + 1)
      .findLast((l) => /^### [BF]-\d+$/.test(l))
      ?.slice(4);
    assert.fail(
      `${file}: line ${i + 1} on ${branch}${record ? ` (in ${record})` : ''} is changed or missing from every archive here: "${line.slice(0, 80)}". Archives only grow; add a dated correction instead`,
    );
  });
}
// A year's archive (backlog-<year>.md) holds the records that closed that year: the last "closed <date>" of a record names it.
for (const f of localArchives) {
  const year = f.match(/^backlog-(\d{4})\.md$/)?.[1];
  if (!year) continue;
  const blocks = readFileSync(new URL(f, archiveDir), 'utf8')
    .split(/^(?=### [BF]-\d+$)/m)
    .slice(1);
  for (const block of blocks) {
    const closed = [...block.matchAll(/\bclosed (\d{4})-\d{2}-\d{2}/gi)].at(-1)?.[1];
    assert(
      !closed || closed === year,
      `docs/archive/${f}: ${block.slice(4, block.indexOf('\n'))} closed in ${closed}; it belongs in backlog-${closed}.md`,
    );
  }
}
// "this PR" in a line already on the default branch is a placeholder its PR left behind: once merged, a record names
// the PR (#N) instead, or nobody knows which change it meant and the record waits for a closure no one reconciles.
const mainBacklog = new Set(mainText.split('\n'));
// a quoted mention ("this PR", `this PR`) talks about the placeholder, it is not one
const placeholder = /(?<!["“`'])\bthis PR\b(?!["”`'])/i;
const stale = text.split('\n').filter((line) => placeholder.test(line) && mainBacklog.has(line));
assert(
  !stale.length,
  `docs/BACKLOG.md: ${stale.length} line(s) already on ${branch} still say "this PR": name the merged PR instead (BACKLOG-RULES, Review procedure 7). First: "${stale[0]?.slice(0, 100)}"`,
);
// On a PR's CI run the number is known: a placeholder the branch adds fails there, before it can reach the default
// branch, where it would fail every other PR (openbando, twice). Write the number right after opening the PR.
const prNumber = process.env.PR_NUMBER || process.env.GITHUB_REF?.match(/^refs\/pull\/(\d+)\//)?.[1];
if (prNumber) {
  const added = text.split('\n').filter((line) => placeholder.test(line) && !mainBacklog.has(line));
  assert(
    !added.length,
    `docs/BACKLOG.md: ${added.length} line(s) this branch adds say "this PR": write #${prNumber} instead (BACKLOG-RULES, Review procedure 7). First: "${added[0]?.slice(0, 100)}"`,
  );
}
// a workflow command's message escapes %, CR and LF
const annotate = (text) => text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
for (const w of warnings)
  console.log(process.env.GITHUB_ACTIONS ? `::warning title=Backlog::${annotate(w)}` : `! ${w}`);
console.log(
  `${ids.size} backlog records passed: signal, remaining effort, visible recap, collapsed actions, metadata, dates, cues and table widths${published.length ? `; the archives keep every line their ${published.length} file(s) have on ${branch}` : ''}.`,
);
