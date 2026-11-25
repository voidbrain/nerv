// Optional coordinator dashboard. Reads component evidence; never changes component repositories or calculates aggregate progress.
import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = process.cwd(),
  args = process.argv.slice(2),
  mode = args.shift() ?? 'check';
const remote = args.includes('--remote'),
  write = args.includes('--write');
const option = (key) => args.find((x) => x.startsWith(`--${key}=`))?.slice(key.length + 3);
const fail = (message) => {
  throw new Error(message);
};
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
const text = (value) =>
  String(value ?? '')
    .replaceAll('|', '\\|')
    .replace(/[\r\n]+/g, ' ')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
// B-059: a repository path as a Markdown link destination: every segment percent-encoded, parentheses included
// (encodeURIComponent keeps them), so a space, `#`, `%`, `&`, `|`, `\` or a parenthesis in a file name cannot end or
// change the link.
const urlPath = (path) =>
  String(path)
    .split('/')
    .map((s) => encodeURIComponent(s).replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
const cells = (line) =>
  line
    .split(/(?<!\\)\|/)
    .slice(1, -1)
    .map((x) => x.trim());
const inside = (base, path) => {
  const rel = relative(base, path);
  return !isAbsolute(rel) && rel !== '..' && !/^\.\.[/\\]/.test(rel);
};
const repositoryPath = (path) => {
  if (typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\\') || path.split('/').includes('..'))
    fail('Use a repository-relative file path without traversal');
};
const safeFile = (base, path) => {
  repositoryPath(path);
  const target = resolve(base, path);
  let ancestor = target;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  if (!inside(realpathSync(base), realpathSync(ancestor))) fail('File path escapes its repository through a symlink');
  return target;
};
const git = (cwd, ...params) => {
  try {
    const value = execFileSync('git', ['-C', cwd, ...params], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return params[0] === 'show' ? value : value.trim();
  } catch {
    return null;
  }
};
// F-063: the generated ledger merges Signal into Status ("🔴 Open"); read such a row in the authored column order.
const unmerge = (c) => {
  const m = /^(🔴|🟠|🟡|🟢|🟣|🔵) (Open|Investigate|Implemented|Verified|Blocked|Closed)$/.exec(c[0] ?? '');
  return m ? [m[1], c[1], m[2], ...c.slice(2)] : c;
};
// F-095-T03: the summary columns the reader knows, by name; any other column is reported, never skipped.
const SUMMARY_COLUMNS = new Set([
  'Signal',
  'ID',
  'Item',
  'Priority',
  'Status',
  'Effort',
  'Complete',
  'Remaining',
  'Depends on',
  'Unlocks',
  'Agent',
  'Human action',
  'Procedures',
  'Decisions',
]);
// Record and step references in a cell, local (F-001-T02) or of another repository (api:F-009-T02), whole IDs only;
// link targets and bare URLs aside. An uppercase repository prefix is reported rather than read as a local ID.
const references = (cell, where) => {
  const text = String(cell ?? '')
    .replace(/\]\([^)]*\)/g, ']')
    .replace(/https?:\/\/\S+/g, '');
  const upper = /(?<![\w-])([A-Za-z][\w-]*[A-Z][\w-]*|[A-Z][\w-]*):([BF]-\d+(?:-T\d{2})?)(?![\w-])/.exec(text);
  if (upper) fail(`${where}: write the repository of "${upper[0]}" in lowercase, as in the manifest`);
  return [...text.matchAll(/(?<![\w-])(?:[a-z][a-z0-9-]*:)?[BF]-\d{3}(?:-T\d{2})?(?![\w-])/g)].map((m) => m[0]);
};
// The step statuses a generated ledger writes (work-items.mjs).
const STEP_STATUSES = new Set(['Planned', 'Ready', 'Implemented; verification pending', 'Verified', 'Completed']);
// The steps table of a generated record (open steps, and the collapsed done steps), read by column name.
function stepRows(lines, where) {
  const steps = [];
  for (let i = 0; i + 2 < lines.length; i++) {
    if (!lines[i].startsWith('|') || !/^\|[-:| ]+\|$/.test(lines[i + 1])) continue;
    const head = cells(lines[i]);
    if (!head.includes('Step') || !head.includes('Status')) continue;
    for (let j = i + 2; j < lines.length && lines[j].startsWith('|'); j++) {
      const row = cells(lines[j]);
      const col = (name) => (head.includes(name) ? row[head.indexOf(name)] : undefined);
      const m = /([BF]-\d{3}-T\d{2}) — (.+)$/.exec(col('Step') ?? '');
      if (!m) continue;
      if (!STEP_STATUSES.has(col('Status'))) fail(`${where}: ${m[1]} has unknown step status "${col('Status')}"`);
      const dependsOn = references(col('Depends on'), where);
      steps.push({
        id: m[1],
        title: m[2].trim(),
        status: col('Status') ?? 'Unknown',
        remaining: col('Remaining') ?? '—',
        // B-057: work-items writes the Who column only for a record with an owner step; without it every step is agent
        // work, waiting (⏳) while its Depends on cell lists a prerequisite, as the writer's own cell would say.
        who: head.includes('Who') ? (col('Who') ?? '—') : dependsOn.length ? '⏳ 🤖' : '🤖',
        dependsOn,
      });
    }
  }
  return steps;
}
function records(markdown, label, file, archived = false) {
  const out = new Map(),
    blocks = [
      ...markdown.matchAll(
        /^### (?:<a id="[fb]-\d+"><\/a>)?(?:\[(?:✨|🐞) )?([BF]-\d+)(?:\]\(#top\))?\n([\s\S]*?)(?=^### (?:<a id="[fb]-\d+"><\/a>)?(?:\[(?:✨|🐞) )?[BF]-\d+(?:\]\(#top\))?\n|^## |$(?![\s\S]))/gm,
      ),
    ];
  for (const b of blocks) {
    const id = b[1],
      block = b[2];
    if (!archived && out.has(id)) fail(`${label}: duplicate record ${id}`);
    const lines = block.split('\n');
    const summaries = lines
      .filter((l) => l.startsWith('|'))
      .map((l) => unmerge(cells(l)))
      .filter((c) => ['🔴', '🟠', '🟡', '🟢', '🟣', '🔵'].includes(c[0]));
    if (summaries.length !== 1) fail(`${label}:${id}: unsupported multiple/missing summary rows`);
    const row = summaries[0];
    // F-095-T03: the summary's header names its columns; a column the reader does not know is reported.
    const rowAt = lines.findIndex(
      (l) => l.startsWith('|') && ['🔴', '🟠', '🟡', '🟢', '🟣', '🔵'].includes(unmerge(cells(l))[0]),
    );
    const head = rowAt >= 2 && /^\|[-:| ]+\|$/.test(lines[rowAt - 1]) ? cells(lines[rowAt - 2]) : [];
    const unknownColumn = head.find((name) => !SUMMARY_COLUMNS.has(name));
    if (unknownColumn !== undefined) fail(`${label}:${id}: unknown summary column "${unknownColumn}"`);
    const named = (name) => (head.includes(name) ? cells(lines[rowAt])[head.indexOf(name)] : undefined);
    // Four (or legacy five) authored columns, or the generated ledger's seven or nine (F-059; Procedures and Decisions
    // cells last since 8.0.0), read in authored order.
    // A component still on a 7.x generated ledger (six or eight cells ending 🧑 Yes / 💻 No) is read too.
    const legacy7 = row && [6, 8].includes(row.length) && /^(?:🧑|💻) (?:Yes|No)$/.test(row.at(-1));
    // F-071 (8.8.0): 🧑‍🔧 and 🤔 read like 🧑.
    const kind =
      row &&
      { '🧑🧑': 'Both', '🧑—': 'Procedure', '—🧑': 'Decision', '——': 'No' }[
        row
          .slice(-2)
          .map((c, i) => (c === ['🧑‍🔧', '🤔'][i] ? '🧑' : c))
          .join('')
      ];
    // F-073 (8.10.0): eight or ten cells with the Agent cell.
    const generated = row && (([7, 8, 9, 10].includes(row.length) && kind !== undefined) || legacy7);
    if (!row || (![4, 5].includes(row.length) && !generated))
      fail(`${label}:${id}: unsupported summary (run the owning repository's backlog check)`);
    const legacy = row[1] === id;
    const status = row[legacy ? 3 : 2];
    if (!['Open', 'Investigate', 'Implemented', 'Verified', 'Blocked', 'Closed'].includes(status))
      fail(`${label}:${id}: unknown status`);
    const title = legacy ? row[4] : lines.find((l) => /^\*\*[^\n]+\*\*$/.test(l))?.slice(2, -2);
    if (!title) fail(`${label}:${id}: missing title`);
    const field = (name) =>
      lines
        .filter((l) => l.startsWith('|'))
        .map(cells)
        .find((c) => c[0] === name)?.[1] ?? '—';
    const components = field('Components');
    const refs = components === '—' ? [] : components.split(',').map((v) => v.trim());
    if (refs.some((v) => !/^[a-z][a-z0-9-]*:[BF]-\d+$/.test(v)) || new Set(refs).size !== refs.length)
      fail(`${label}:${id}: Components must contain unique repository-qualified IDs`);
    out.set(id, {
      id,
      file,
      archived,
      title,
      status,
      human: generated
        ? legacy7
          ? row.at(-1).split(' ')[1]
          : kind
        : (block.match(/Human action required: (Procedure|Decision|Both|No|Yes)\*\*/)?.[1] ?? 'Unknown'),
      effort: legacy ? 'Unknown' : row[3],
      priority: named('Priority') ?? (legacy ? row[2] : '—'),
      remaining: named('Remaining') ?? '—',
      dependsOn: references(named('Depends on'), `${label}:${id}`),
      agent: named('Agent') ?? '—',
      steps: stepRows(lines, `${label}:${id}`),
      reviewed: field('Reviewed'),
      verification: field('Verification'),
      refs,
      // F-097-T03: the record's text and its human/next action line, for the gap review (not printed by --json)
      prose: block,
      action: lines.find((l) => /\*\*→/.test(l)) ?? '',
    });
  }
  // F-095-T03: a heading that names a B-/F- ID but is not a supported record heading is reported, not read as no work;
  // only in the active backlog and outside fenced code.
  for (const [line] of archived ? [] : markdown.replace(/^```[\s\S]*?^```/gm, '').matchAll(/^### .*$/gm))
    if (
      /(?<![\w-])[BF]-\d+/.test(line) &&
      !/^### (?:<a id="[fb]-\d+"><\/a>)?(?:\[(?:✨|🐞) )?[BF]-\d+(?:\]\(#top\))?$/.test(line)
    )
      fail(`${label}: unsupported record heading "${line}"`);
  // An unreadable legacy table must not silently become an empty successful dashboard.
  for (const match of markdown.matchAll(/^\|.*\|\s*[BF]-\d+\s*\|.*$/gm)) {
    if (!blocks.some((b) => match.index >= b.index && match.index < b.index + b[0].length))
      fail(`${label}: unheaded IDs have no supported record headings`);
  }
  return out;
}
// F-096-T05: a component with workItems.views "built" commits no ledger. Its stamp at the resolved commit says so.
const builtViews = (json, where) => {
  if (json === null || json === undefined) return null;
  let stamp;
  try {
    stamp = JSON.parse(json);
  } catch {
    fail(`.harness.json at ${where} is not valid JSON`);
  }
  const items = stamp?.workItems;
  return items?.enabled && items.views === 'built' ? items : null;
};
// A publication is trusted only when its tree is the source tree plus the ledger, as work-items publish writes it; the
// message alone can be written by anyone who can push the branch (review of F-096-T05).
async function sameTreeRemote(api, sourceTree, viewTree, segments) {
  const [a, b] = await Promise.all([
    request(`${api}/git/trees/${sourceTree}`),
    request(`${api}/git/trees/${viewTree}`),
  ]);
  if (a.truncated || b.truncated || !Array.isArray(a.tree) || !Array.isArray(b.tree)) return false;
  const [head, ...rest] = segments;
  const entries = (t) => new Map(t.tree.filter((e) => e.path !== head).map((e) => [e.path, `${e.type}:${e.sha}`]));
  const left = entries(a),
    right = entries(b);
  if (left.size !== right.size || [...left].some(([k, v]) => right.get(k) !== v)) return false;
  if (!rest.length) return b.tree.some((e) => e.path === head && e.type === 'blob');
  const sub = (t) => t.tree.find((e) => e.path === head && e.type === 'tree')?.sha;
  return Boolean(sub(a) && sub(b)) && sameTreeRemote(api, sub(a), sub(b), rest);
}
const VIEWS_BRANCH = 'backlog-views';
const publishedFor = (message, revision) => message.split('\n')[0] === `Backlog views for ${revision}`;
async function optional(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}),
    },
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 404) return null;
  if (!response.ok) fail(`GitHub returned HTTP ${response.status}`);
  return response.json();
}
// F-095-T04: remaining hours, as each project estimates them (uncalibrated; never a percentage). "28 h", "2 h agent +
// 0.5 h owner" or "6 h owner" read as hours; days or anything else is not hours.
const hoursIn = (text) => {
  const m = /^(?:(\d+(?:\.\d+)?) h(?: agent)?)?(?:(?:^| \+ )(\d+(?:\.\d+)?) h owner)?$/.exec(String(text ?? '').trim());
  return m && (m[1] || m[2]) ? { agent: Number(m[1] ?? 0), owner: Number(m[2] ?? 0) } : null;
};
// Priorities by number (P1 first), sizes from Small to Very large; anything else after them.
const rank = (label) => {
  const p = /P(\d+)/.exec(label);
  if (p) return Number(p[1]);
  const i = ['Small', 'Medium', 'Large', 'Very large'].findIndex((x) => label.endsWith(` ${x}`));
  return i < 0 ? 99 : i;
};
function remainingEffort(ledger, loaded) {
  const open = [...loaded.values()].filter((r) => !r.archived && r.status !== 'Closed');
  const count = (key) =>
    Object.entries(open.reduce((acc, r) => ({ ...acc, [r[key]]: (acc[r[key]] ?? 0) + 1 }), {}))
      .filter(([k]) => k && k !== '—' && k !== 'Unknown')
      .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
      .map(([k, n]) => `${k}: ${n}`)
      .join(', ') || '—';
  const counts = { priorities: count('priority'), sizes: count('effort') };
  const line = /\*\*Remaining effort:\*\* ([^\n]*)/.exec(ledger)?.[1];
  if (line !== undefined) {
    if (/^no open steps\b/.test(line)) return { agent: 0, owner: 0, basis: 'totals line', ...counts };
    const amount = line.split(' across ')[0].trim();
    // "X h and Y days" when a backlog mixes units: the hours count, the days do not, so the total is partial.
    const [hoursPart, daysPart] = amount.split(' and ');
    const h = hoursIn(hoursPart);
    if (!h) return { agent: null, owner: null, basis: `totals line not in hours: "${amount}"`, ...counts };
    const unestimated = /without an estimate/.test(line);
    const partial = unestimated || Boolean(daysPart);
    const notes = [
      ...(daysPart ? [`${daysPart.trim()} not counted in hours`] : []),
      ...(unestimated ? ['some steps unestimated'] : []),
    ];
    return { ...h, partial, basis: ['totals line', ...notes].join(', '), ...counts };
  }
  const cells = open.map((r) => r.remaining).filter((c) => c && c !== '—');
  if (!cells.length) return { agent: null, owner: null, basis: 'no totals line or Remaining cells', ...counts };
  const read = cells.map(hoursIn);
  if (read.some((h) => !h)) return { agent: null, owner: null, basis: 'Remaining cells not in hours', ...counts };
  const partial = cells.length < open.length;
  return {
    agent: read.reduce((n, h) => n + h.agent, 0),
    owner: read.reduce((n, h) => n + h.owner, 0),
    partial,
    basis: `Remaining cells of ${cells.length} open record${cells.length === 1 ? '' : 's'}${partial ? `, ${open.length - cells.length} without` : ''}`,
    ...counts,
  };
}
// F-095-T05: the owner view. Every open record and step gets a state: Ready (an agent can start), Owner (waits on the
// owner's procedure or decision), Waiting on <ref> (behind work that can still move), Blocked (a chain that ends at an
// owner step, an unknown or unavailable prerequisite, a cycle, or a record marked Blocked) or Done. Read only.
const DONE_STEPS = new Set(['Verified', 'Completed']);
const OWNER_HUMAN = new Set(['Procedure', 'Decision', 'Both']);
// The keys of a cycle, from the repeated key round to it again, rotated to start at the smallest: one text per cycle.
const ring = (trail, key) => {
  const keys = [...trail].slice([...trail].indexOf(key));
  const start = keys.indexOf([...keys].sort()[0]);
  const turned = [...keys.slice(start), ...keys.slice(0, start)];
  return [...turned, turned[0]];
};
const ownerKind = (who) =>
  /🧑‍🔧/.test(who) ? 'Procedure' : /🤔/.test(who) ? 'Decision' : /🧑/.test(who) ? 'Owner' : null;
// B-058 (a coordinator's B-001, ported): where an order item that is not in its repository's ledger closed. Its record
// in a closed-backlog archive (every docs/archive/backlog-*.md and the manifest's archives), its record source marked
// Closed, or its step source marked closed (workItems.records and workItems.tasks at the same commit). A step closes
// with its archived record only when that section names it, so a mistyped step ID stays a gap. Null when it is in none
// of them: a wrong ID still shows "Not in backlog".
const RECORD_HEADING = /^### (?:<a id="[fb]-\d+"><\/a>)?(?:\[(?:✨|🐞) )?([BF]-\d+)(?:\]\(#top\))?$/;
async function closedIn(r, id) {
  if (!r.io) return null;
  // one read per file across all order items: remote reads cost API requests (review of B-058)
  r.reads ??= new Map();
  const read = (path) => {
    if (!r.reads.has(path)) r.reads.set(path, Promise.resolve(r.io.text(path)));
    return r.reads.get(path);
  };
  r.archiveList ??= Promise.resolve(r.io.list('docs/archive'));
  const recordId = id.replace(/-T\d{2}$/, '');
  const archives = (await r.archiveList).filter((p) => /^docs\/archive\/backlog-[^/]+\.md$/.test(p));
  for (const path of [...new Set([...archives, ...(r.archives ?? [])])].sort()) {
    const lines = ((await read(path)) ?? '').split('\n');
    const at = lines.findIndex((l) => RECORD_HEADING.exec(l)?.[1] === recordId);
    if (at < 0) continue;
    const next = lines.findIndex((l, i) => i > at && /^#{2,3} /.test(l));
    const section = lines.slice(at, next < 0 ? undefined : next).join('\n');
    if (id !== recordId && !new RegExp(`(?<![\\w-])${id}(?![\\w-])`).test(section)) break;
    // the archive files records under the day they closed; an older layout names the day in the record
    const day = lines
      .slice(0, at)
      .reverse()
      .map((l) => /^## Closed (\d{4}-\d{2}-\d{2})/.exec(l)?.[1])
      .find(Boolean);
    return {
      path,
      anchor: recordId.toLowerCase(),
      date: day ?? /\bClosed (\d{4}-\d{2}-\d{2})/.exec(section)?.[1] ?? null,
      title: /^\*\*(.+)\*\*$/m.exec(section)?.[1] ?? null,
    };
  }
  let items = null;
  try {
    items = JSON.parse((await read('.harness.json')) ?? 'null')?.workItems;
  } catch {
    // an unreadable stamp says nothing about closure
  }
  if (!items?.enabled) return null;
  const sources = [
    [items.records, `${recordId}.md`, (t, path) => records(t, r.id, path).get(recordId)?.status === 'Closed'],
    ...(id === recordId
      ? []
      : [[items.tasks, `${id}.json`, (t) => ((task) => task?.id === id && task.status === 'closed')(JSON.parse(t))]]),
  ];
  for (const [dir, name, closed] of sources) {
    try {
      const path = `${dir}/${name}`;
      repositoryPath(path); // a stamp's folder never leads outside its repository
      const t = await read(path);
      if (t && closed(t, path)) return { path, anchor: null, date: null, title: null };
    } catch {
      // a malformed source or setting is not evidence of closure
    }
  }
  return null;
}
function ownerView(results) {
  const repos = new Map(results.map((r) => [r.id, r]));
  const lookup = (ref) => {
    const [repo, id] = ref.split(':');
    const r = repos.get(repo);
    if (!r?.available) return { missing: r ? 'unavailable' : 'unknown', repo };
    if (/-T\d{2}$/.test(id)) {
      const parent = r.records.get(id.replace(/-T\d{2}$/, ''));
      const step = parent?.steps.find((x) => x.id === id);
      return step ? { repo, kind: 'step', item: step, parent } : { missing: 'unknown', repo };
    }
    const record = r.records.get(id);
    return record ? { repo, kind: 'record', item: record, parent: record } : { missing: 'unknown', repo };
  };
  const where = (from, ref) => (ref.split(':')[0] === from ? 'in this project' : 'in another project');
  // Every prerequisite counts: one that is blocked or waits on the owner blocks this item, whatever the order of the
  // list; otherwise the first unfinished one is what it waits on; null when all are done (review of F-095-T05).
  // F-097-T01: a Waiting result carries `stop`, the first block its chain will reach (an owner step, or an external
  // wait not yet recorded), so the runway never counts work behind it.
  const prerequisites = (repo, deps, trail) => {
    let blocked = null,
      waiting = null,
      stop = null;
    for (const dep of deps.map((d) => (d.includes(':') ? d : `${repo}:${d}`))) {
      const found = lookup(dep);
      if (found.missing === 'unavailable')
        blocked ??= { state: 'Blocked', cause: { what: 'unavailable source of', ref: dep, where: '' } };
      else if (found.missing)
        blocked ??= { state: 'Blocked', cause: { what: 'unknown prerequisite', ref: dep, where: where(repo, dep) } };
      else {
        const st = itemState(found, trail);
        if (st.state === 'Done') continue;
        if (st.state === 'Owner')
          // a record whose next step is the owner's names that step (B-060 review)
          blocked ??= {
            state: 'Blocked',
            cause: { what: 'owner step', ref: st.at ?? dep, where: where(repo, st.at ?? dep) },
          };
        else if (st.state === 'Blocked') blocked ??= st;
        else {
          waiting ??= { state: 'Waiting', on: dep };
          stop ??= st.stop ?? null;
        }
      }
    }
    return blocked ?? (waiting && stop ? { ...waiting, stop } : waiting);
  };
  const stepState = (repo, step, trail, parent) => {
    const key = `${repo}:${step.id}`;
    if (trail.has(key))
      return { state: 'Blocked', cause: { what: 'cycle through', ref: key, where: '', ring: ring(trail, key) } };
    trail.add(key);
    let result;
    if (DONE_STEPS.has(step.status)) result = { state: 'Done' };
    else if (parent?.status === 'Blocked')
      result = { state: 'Blocked', cause: { what: 'record marked Blocked:', ref: `${repo}:${parent.id}`, where: '' } };
    else if (/⏳/.test(step.who)) {
      result =
        prerequisites(repo, step.dependsOn, trail) ??
        (step.dependsOn.length
          ? // every prerequisite is done here, but the step still waits: its repository has not recorded it yet
            {
              state: 'Waiting',
              on: `${step.dependsOn.join(', ')} (done; record it in externalMet)`,
              stop: { what: 'external wait not recorded:', ref: key },
            }
          : { state: 'Blocked', cause: { what: 'waiting with no prerequisite listed:', ref: key, where: '' } });
      // an owner step behind work that can still move is the block that work reaches
      if (result.state === 'Waiting' && ownerKind(step.who))
        result = { ...result, stop: result.stop ?? { what: 'owner step', ref: key } };
    } else if (ownerKind(step.who)) result = { state: 'Owner', kind: ownerKind(step.who) };
    else if (/🤖/.test(step.who))
      // an implemented step only waits on its own verification: ready, never the next pick
      result = { state: 'Ready', verify: step.status.startsWith('Implemented') };
    else result = { state: 'Blocked', cause: { what: 'no actor in', ref: key, where: '' } };
    trail.delete(key);
    return result;
  };
  const recordState = (repo, record, trail) => {
    if (record.archived || record.status === 'Closed') return { state: 'Done' };
    if (record.status === 'Blocked')
      return { state: 'Blocked', cause: { what: 'record marked Blocked:', ref: `${repo}:${record.id}`, where: '' } };
    const open = record.steps.filter((x) => !DONE_STEPS.has(x.status));
    if (!open.length) {
      // a record without steps honours its own Depends on cell and its ⏳ Agent cell; the trail stops a cycle of them
      const key = `${repo}:${record.id}`;
      if (trail.has(key))
        return { state: 'Blocked', cause: { what: 'cycle through', ref: key, where: '', ring: ring(trail, key) } };
      const waits = record.dependsOn.length || record.agent === '⏳';
      trail.add(key);
      const before = waits ? prerequisites(repo, record.dependsOn, trail) : null;
      trail.delete(key);
      if (before)
        return before.state === 'Waiting' && OWNER_HUMAN.has(record.human)
          ? { ...before, stop: before.stop ?? { what: 'owner step', ref: key } }
          : before;
      if (OWNER_HUMAN.has(record.human)) return { state: 'Owner', kind: record.human };
      // F-099: a record whose steps are all done, or that is Verified, only awaits its closure: never the next pick
      return record.steps.length || record.status === 'Verified' ? { state: 'Ready', close: true } : { state: 'Ready' };
    }
    const states = open.map((x) => stepState(repo, x, trail, record));
    // B-060: the next open step (the first in the ledger's work order) decides first: when it is the owner's, or waits
    // behind an owner step, the record is the owner's turn, never Ready, whatever agent work sits beside it.
    const [head] = states;
    const ownerFirst =
      head.state === 'Owner' ||
      (head.state === 'Blocked' && head.cause.what === 'owner step') ||
      (head.state === 'Waiting' && head.stop?.what === 'owner step');
    const shown =
      (ownerFirst ? (head.state === 'Owner' ? { ...head, at: `${repo}:${open[0].id}` } : head) : null) ??
      states.find((x) => x.state === 'Ready' && !x.verify) ??
      states.find((x) => x.state === 'Ready') ??
      states.find((x) => x.state === 'Owner') ??
      states.find((x) => x.state === 'Waiting') ??
      states[0];
    // work that depends on the whole record also waits for its owner steps and blocks (F-097-T01)
    const stop = states
      .map((x, i) =>
        x.state === 'Owner'
          ? { what: 'owner step', ref: `${repo}:${open[i].id}` }
          : x.state === 'Blocked'
            ? x.cause
            : x.stop,
      )
      .find(Boolean);
    return stop && ['Ready', 'Waiting'].includes(shown.state) ? { ...shown, stop } : shown;
  };
  const itemState = (found, trail = new Set()) =>
    found.kind === 'step'
      ? stepState(found.repo, found.item, trail, found.parent)
      : recordState(found.repo, found.item, trail);
  // Every open unit of work: open steps, and records with no steps.
  const units = results
    .filter((r) => r.available)
    .flatMap((r) =>
      [...r.records.values()]
        .filter((b) => !b.archived && b.status !== 'Closed')
        .flatMap((b) => {
          const open = b.steps.filter((x) => !DONE_STEPS.has(x.status));
          return open.length
            ? open.map((x) => ({
                repo: r.id,
                record: b.id,
                ref: `${r.id}:${x.id}`,
                title: x.title,
                remaining: x.remaining,
                owner: Boolean(ownerKind(x.who)),
                ...stepState(r.id, x, new Set(), b),
              }))
            : [
                {
                  repo: r.id,
                  record: b.id,
                  ref: `${r.id}:${b.id}`,
                  title: b.title,
                  // a record whose steps are all done only awaits its closure: no runway hours
                  remaining: b.steps.length ? '0 h' : b.remaining,
                  owner: OWNER_HUMAN.has(b.human),
                  ...recordState(r.id, b, new Set()),
                },
              ];
        }),
    );
  return { lookup, itemState, units, runway: runway(results, units) };
}
// F-097-T01: the agent runway. Agent work is doable when it is Ready, or Waiting on work whose chain reaches no block
// (owner step, unknown or unavailable prerequisite, cycle, Blocked record, unrecorded external wait). Its hours are
// summed per project; the blocks the rest reaches are named once each, and the owner steps the owner can take once
// the runway is done (the next layer) give the owner hours that unblock it. Hours unreadable are listed, not guessed.
function runway(results, units) {
  const rows = new Map(
    results.map((r) => [r.id, { agent: 0, unestimated: [], blocks: new Set(), owner: 0, ownerUnestimated: [] }]),
  );
  const named = (c) => (c.ring ? `cycle ${c.ring.join(' → ')}` : `${c.what} ${c.ref}`);
  for (const u of units) {
    const row = rows.get(u.repo);
    const h = hoursIn(u.remaining);
    const stop = u.state === 'Blocked' ? u.cause : u.stop;
    if (
      u.owner &&
      (u.state === 'Owner' || (u.state === 'Waiting' && u.stop?.ref === u.ref && u.stop.what === 'owner step'))
    ) {
      row.blocks.add(`owner step ${u.ref}`);
      // owner time is unknown when the cell is unreadable or holds only agent hours
      if (h && (h.owner > 0 || h.agent === 0)) row.owner += h.owner;
      else row.ownerUnestimated.push(u.ref);
    } else if (!u.owner && (u.state === 'Ready' || (u.state === 'Waiting' && !u.stop))) {
      if (h) row.agent += h.agent;
      else row.unestimated.push(u.ref);
    } else if (stop) row.blocks.add(named(stop));
  }
  return rows;
}
// F-097-T02: audits, periodic reviews and the harness release per project, from its own evidence at the resolved commit.
// Missing or unreadable evidence reads as unknown, never as current.
const DAY = 86400000;
const isoDay = (t) => new Date(t).toISOString().slice(0, 10);
// The audit areas and rules of check-audits.mjs (auditStatus): the last audit is the newest full one with no blocked
// area; every area is due when its newest result is blocked or older than the interval, or it has none.
const AUDIT_AREAS = ['code', 'logic', 'tests', 'documentation', 'harness', 'security', 'delivery', 'backlog'];
const dayOf = (date) => (/^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : NaN);
async function projectHealth(io) {
  const notes = [];
  const now = Date.now();
  let stamp = null;
  const raw = await io.text('.harness.json');
  try {
    stamp = raw === null ? null : JSON.parse(raw);
  } catch {
    notes.push('.harness.json is not valid JSON');
  }
  const version = typeof stamp?.version === 'string' ? stamp.version : null;
  const days = stamp?.audit?.days ?? stamp?.freshness?.auditDays ?? 7;
  let audit = null;
  if (!Number.isInteger(days) || days < 1) notes.push('audit days are not a positive whole number');
  else {
    const auditFiles = (await io.list('docs/audits')).filter((f) => /^docs\/audits\/[^/]+$/.test(f));
    const reports = [];
    for (const f of auditFiles.filter((x) => x.endsWith('.audit.json'))) {
      let row = null;
      try {
        row = JSON.parse((await io.text(f)) ?? '');
      } catch {
        /* reported below */
      }
      const time = Date.parse(row?.reviewed);
      if (!row || !Number.isFinite(time) || !row.areas || typeof row.areas !== 'object')
        notes.push(`${f} is not a readable audit manifest`);
      else if (time > now + 60000) notes.push(`${f} is dated in the future; ignored`);
      else reports.push({ ...row, time });
    }
    if (reports.length) {
      reports.sort((a, b) => a.time - b.time);
      // B-060: the newest audit of any kind (scoped to some areas or a part of the project) is shown too
      const newest = reports.at(-1);
      let lastFull = null;
      const areas = {};
      for (const row of reports) {
        if (row.kind === 'full' && Object.values(row.areas).every((a) => a?.result !== 'blocked')) lastFull = row.time;
        for (const [area, value] of Object.entries(row.areas))
          areas[area] = value?.result === 'blocked' ? 'blocked' : (now - row.time) / DAY > days ? 'stale' : row.time;
      }
      const due = AUDIT_AREAS.filter((a) => typeof areas[a] !== 'number');
      const fresh = AUDIT_AREAS.map((a) => areas[a]).filter((t) => typeof t === 'number');
      const blockedArea = Object.values(newest.areas).some((a) => a?.result === 'blocked');
      audit = {
        last: lastFull === null ? null : isoDay(lastFull),
        kind: 'full',
        latest:
          newest.time === lastFull
            ? null
            : { day: isoDay(newest.time), kind: `${newest.kind ?? 'audit'}${blockedArea ? ', an area blocked' : ''}` },
        due,
        next: due.length ? null : isoDay(Math.min(...fresh) + days * DAY),
      };
    } else {
      // no manifests: the newest dated report; its scope is not recorded, so it is shown as such
      const dated = auditFiles
        .map((f) => /^docs\/audits\/(\d{4}-\d{2}-\d{2})[^/]*\.md$/.exec(f)?.[1])
        .filter((d) => d && dayOf(d) <= now)
        .sort()
        .at(-1);
      if (dated)
        audit = {
          last: dated,
          kind: 'report, scope not recorded',
          due: (now - dayOf(dated)) / DAY > days ? ['all'] : [],
          next: isoDay(dayOf(dated) + days * DAY),
        };
    }
  }
  const reviews = [];
  const configured =
    stamp?.reviews && typeof stamp.reviews === 'object' && !Array.isArray(stamp.reviews) ? stamp.reviews : {};
  for (const [name, cfg] of Object.entries(configured)) {
    const dir = (typeof cfg?.dir === 'string' && cfg.dir.trim() ? cfg.dir : 'docs/reviews')
      .replace(/\/+/g, '/')
      .replace(/^\/|\/$/g, '');
    if (!Number.isInteger(cfg?.days) || cfg.days < 1 || dir.split('/').some((x) => x === '..' || x === '.git')) {
      notes.push(`review "${name}" has no valid days or folder`);
      reviews.push({ name, last: null, next: null, overdue: true });
      continue;
    }
    const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const named = new RegExp(
      `^${esc(dir)}/(?:${esc(name)}/(\\d{4}-\\d{2}-\\d{2})\\.md|(\\d{4}-\\d{2}-\\d{2})-${esc(name)}\\.md)$`,
      'i',
    );
    const dates = (await io.list(dir))
      .map((f) => named.exec(f))
      .filter(Boolean)
      .map((m) => m[1] ?? m[2])
      .filter((d) => Number.isFinite(dayOf(d)) && dayOf(d) <= now)
      .sort();
    const at = dates.at(-1);
    // whole days, as check-freshness counts them
    reviews.push({
      name,
      last: at ?? null,
      next: at ? isoDay(dayOf(at) + cfg.days * DAY) : null,
      overdue: !at || Math.floor((now - dayOf(at)) / DAY) > cfg.days,
    });
  }
  return { version, audit, reviews, notes };
}
// Strict X.Y.Z (an optional v); anything else cannot be compared and reads as unknown, never as latest.
const semver = (v) => (/^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? '')) ?? []).slice(1).map(Number);
const newer = (a, b) => {
  const [x, y] = [semver(a), semver(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};
// The newest template release: with --remote its latest published GitHub Release (never a prerelease), otherwise the
// highest vX.Y.Z tag of the coordinator's template clone (HARNESS_HOME, else template.path, a relative one from the
// main checkout as check-harness reads it). Unknown when neither answers.
async function latestTemplate(stamp) {
  if (remote) {
    const repo = /github\.com[/:]([^/]+\/[^/.]+)/.exec(stamp.template?.repo ?? '')?.[1];
    if (!repo) return { version: null, from: 'no template.repo on GitHub in .harness.json' };
    const release = await optional(`https://api.github.com/repos/${repo}/releases/latest`).catch((e) => ({
      error: e.message,
    }));
    if (release?.error) return { version: null, from: `latest release of ${repo} unreadable: ${release.error}` };
    const tag = release?.tag_name;
    return semver(tag).length === 3
      ? { version: tag.replace(/^v/, ''), from: `latest release of ${repo}` }
      : { version: null, from: tag ? `latest release of ${repo} is not vX.Y.Z (${tag})` : `no release of ${repo}` };
  }
  const path = (process.env.HARNESS_HOME ?? stamp.template?.path ?? '~/Projects/project-harness').replace(
    /^~(?=\/|$)/,
    homedir(),
  );
  const common = git(root, 'rev-parse', '--path-format=absolute', '--git-common-dir');
  const main = common && common.endsWith('/.git') ? dirname(common) : root;
  const home = isAbsolute(path) ? path : resolve(main, path);
  const tags = (git(home, 'tag', '--list', 'v*') ?? '').split('\n').filter((t) => semver(t).length === 3);
  const best = tags.reduce((b, t) => (!b || newer(t, b) ? t : b), null);
  return best
    ? { version: best.replace(/^v/, ''), from: 'template clone tags, as last fetched' }
    : { version: null, from: 'no template clone with release tags' };
}
// F-097-T03: the gap review. Proposals only, each naming the repository that would own the fix; the coordinator never
// creates or edits a record in a component. Kind 1 is a text heuristic and says so.
const NEED =
  /\b(?:wait|waits|waiting|request|requests|requested|need|needs|needed|depend|depends|dependency|requires|required|blocked|tracked|recorded in|from that repository)\b/i;
const OPEN_RECORD = (b) => !b.archived && !['Closed', 'Verified'].includes(b.status);
function gapReview(results, view, order, latest) {
  const gaps = [];
  const live = results.filter((r) => r.available);
  // A repository is named by its ID or repository name, as written (case-sensitive). A name of three characters or
  // fewer ("api", "web") reads as ordinary text, so it counts only as `name` in backticks or as name:ID (review).
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const names = (r) =>
    new RegExp(
      [...new Set([r.id, r.repository.split('/')[1]])]
        .map((x) => (x.length > 3 ? `(?<![\\w-])${esc(x)}(?![\\w-])` : `\`${esc(x)}\`|(?<![\\w-])${esc(x)}:[BF]-\\d`))
        .join('|'),
    );
  const plain = (text) =>
    text
      .replace(/\]\([^)]*\)/g, ']')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/<br\s*\/?>/g, '\n')
      .replace(/→ Human action required: \w+/g, '')
      .replace(/\*\*/g, '');
  const clip = (t, n = 140) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
  // 1. a sentence in an open record of A naming B with a dependency word, and no open record in B naming A back
  for (const a of live.filter((x) => x.id !== 'solution'))
    for (const r of [...a.records.values()].filter(OPEN_RECORD))
      for (const b of live.filter((x) => x.id !== a.id && x.id !== 'solution')) {
        const sentence = plain(r.prose)
          .split(/(?<=[.;])\s+|\n+|\s*\|\s*/)
          .find((t) => names(b).test(t) && NEED.test(t));
        if (!sentence) continue;
        // a reference into B that resolves is its counterpart; so is any open record of B that names A
        const resolved = [
          ...sentence.matchAll(new RegExp(`(?<![\\w-])${esc(b.id)}:([BF]-\\d{3}(?:-T\\d{2})?)`, 'g')),
        ].some((m) => !view.lookup(`${b.id}:${m[1]}`).missing);
        const back = [...b.records.values()].some((x) => OPEN_RECORD(x) && names(a).test(plain(x.prose)));
        if (resolved || back) continue;
        gaps.push({
          kind: 'Cross-repository need with no counterpart (text heuristic)',
          where: `${a.id}:${r.id}`,
          evidence: `"${clip(sentence.trim())}"; ${b.id} has no open record that names ${a.id}`,
          proposal: `${b.id}: a record for what ${a.id}:${r.id} needs from it, or ${a.id}: drop the dependency`,
        });
      }
  // 2. a Depends on or repo:STEP-ID naming a missing or unknown item, or a done one the item still waits on
  for (const a of live)
    for (const r of [...a.records.values()].filter(OPEN_RECORD)) {
      const items = [
        ...(r.steps.length ? [] : [{ id: r.id, deps: r.dependsOn, waits: r.agent === '⏳' }]),
        ...r.steps
          .filter((x) => !DONE_STEPS.has(x.status))
          .map((x) => ({ id: x.id, deps: x.dependsOn, waits: /⏳/.test(x.who) })),
      ];
      for (const it of items) {
        const deps = it.deps.map((d) => (d.includes(':') ? d : `${a.id}:${d}`));
        for (const dep of deps) {
          const found = view.lookup(dep);
          const shown = dep.startsWith(`${a.id}:`) ? dep.slice(a.id.length + 1) : dep;
          if (found.missing)
            gaps.push({
              kind: 'Prerequisite missing or unknown',
              where: `${a.id}:${it.id}`,
              evidence: `${it.id} depends on ${shown}, which ${found.missing === 'unavailable' ? 'is in a source the dashboard could not read' : !results.some((x) => x.id === found.repo) ? 'names a repository the manifest does not list' : `is not in ${found.repo === a.id ? 'this' : `${found.repo}'s`} backlog (closed and archived, or a wrong ID)`}`,
              proposal: `${a.id}: correct the prerequisites of ${it.id}`,
            });
        }
        if (
          it.waits &&
          deps.length &&
          deps.every((d) => {
            const found = view.lookup(d);
            return !found.missing && view.itemState(found).state === 'Done';
          })
        )
          gaps.push({
            kind: 'Waits on work that is done',
            where: `${a.id}:${it.id}`,
            evidence: `every prerequisite of ${it.id} is done, but it still waits`,
            // externalMet holds prerequisites in other repositories only (ordering.md); a local one needs no record
            proposal: deps.some((d) => !d.startsWith(`${a.id}:`))
              ? `${a.id}: record the met prerequisites of other repositories (externalMet) so ${it.id} can start`
              : `${a.id}: ${it.id} waits on nothing: regenerate the views (or drop its ⏳)`,
          });
      }
    }
  // 3. the owner's turn with no page: an owner step whose Who links nothing, or a record without steps that waits on the
  // owner and whose action line links no page and gives no command
  for (const a of live)
    for (const r of [...a.records.values()].filter(OPEN_RECORD)) {
      for (const x of r.steps.filter((st) => !DONE_STEPS.has(st.status)))
        if (ownerKind(x.who) && !/⏳/.test(x.who) && !/\]\(/.test(x.who))
          gaps.push({
            kind: "Owner's turn without a page",
            where: `${a.id}:${x.id}`,
            evidence: `${x.id} is the owner's turn and links no procedure or decision page`,
            proposal: `${a.id}: write the page for ${x.id} (the commands or text to paste and the expected result) and link it`,
          });
      if (!r.steps.length && OWNER_HUMAN.has(r.human) && !/\]\(|`/.test(r.action))
        gaps.push({
          kind: "Owner's turn without a page",
          where: `${a.id}:${r.id}`,
          evidence: `${r.id} waits on the owner and its action line links no page and gives no command`,
          proposal: `${a.id}: add the exact commands or text to paste, and the expected result, to ${r.id}`,
        });
    }
  // 4. an open record with no next step or no estimate
  for (const a of live)
    for (const r of [...a.records.values()].filter((b) => !b.archived && ['Open', 'Investigate'].includes(b.status))) {
      const open = r.steps.filter((x) => !DONE_STEPS.has(x.status));
      const next = r.action
        .replace(/^.*?\*\*→[^*]*\*\*/, '')
        .replace(/<br\s*\/?>/g, '')
        .trim();
      if ((r.steps.length && !open.length) || (!r.steps.length && !next))
        gaps.push({
          kind: 'No next step',
          where: `${a.id}:${r.id}`,
          evidence: `${r.id} is ${r.status} with no ${r.steps.length ? 'open step' : 'next action'}`,
          proposal: `${a.id}: add the next step to ${r.id}, or verify and close it`,
        });
      const unestimated = open.filter((x) => !x.remaining || x.remaining === '—').map((x) => x.id);
      if (unestimated.length || (!r.steps.length && r.remaining === '—' && r.effort === 'Unknown'))
        gaps.push({
          kind: 'No estimate',
          where: `${a.id}:${r.id}`,
          evidence: unestimated.length
            ? `steps without an estimate: ${unestimated.join(', ')}`
            : `${r.id} has no estimate`,
          proposal: `${a.id}: estimate ${unestimated.length ? unestimated.join(', ') : r.id}`,
        });
    }
  // 5. an order item not in its backlog
  for (const o of order) {
    const found = view.lookup(o.ref);
    if (found.missing === 'unknown' && !o.closure && !o.unreadable)
      gaps.push({
        kind: 'Order item not in its backlog',
        where: 'solution order',
        evidence: `${o.ref} is not in ${o.repo}'s backlog or its configured archives`,
        proposal: `${results[0].label ?? 'solution'}: remove ${o.ref} from the order, or ${o.repo}: create the record the owner meant`,
      });
  }
  // 6. a project behind the harness: a reconcile record there
  for (const a of live)
    if (
      a.health?.version &&
      latest.version &&
      semver(a.health.version).length === 3 &&
      newer(latest.version, a.health.version)
    )
      gaps.push({
        kind: 'Behind the harness',
        where: `${a.id} .harness.json`,
        evidence: `${a.id} is on v${a.health.version}; the latest template release is v${latest.version}`,
        proposal: `${a.id}: a record "Reconcile to harness v${latest.version}", done in a session of that repository`,
      });
  return gaps;
}
async function request(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}),
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) fail(`GitHub returned HTTP ${response.status}`);
  return response.json();
}
try {
  if (!['check', 'dashboard'].includes(mode) || (write && mode !== 'dashboard'))
    fail('Usage: solution.mjs check|dashboard [--write [--prune-order]] [--remote] [--json] [--manifest=PATH]');
  if (args.includes('--json') && mode !== 'check') fail('--json goes with check');
  if (args.includes('--prune-order') && !write) fail('--prune-order goes with dashboard --write');
  const flags = new Set();
  for (const arg of args) {
    const match = arg.match(/^--(remote|offline|write|manifest|json|prune-order)(?:=(.+))?$/),
      key = match?.[1];
    if (!match || flags.has(key) || (key === 'manifest' ? match[2] === undefined : match[2] !== undefined))
      fail(`Unknown, duplicate or malformed option: ${arg}`);
    flags.add(key);
  }
  if (remote && args.includes('--offline')) fail('--remote cannot be used offline');
  const stamp = existsSync(resolve(root, '.harness.json')) ? read(resolve(root, '.harness.json')) : {};
  const setting = stamp.solution;
  if (
    setting !== undefined &&
    (!setting ||
      typeof setting !== 'object' ||
      !['coordinator', 'component'].includes(setting.role) ||
      typeof setting.manifest !== 'string')
  )
    fail('solution needs a coordinator/component role and manifest path');
  const manifest = option('manifest') ?? setting?.manifest;
  if (stamp.stacks?.includes('solution') && !manifest) fail('Solution profile requires a manifest');
  if (!manifest) {
    console.log('No solution profile configured; ordinary repository behaviour is unchanged.');
    process.exit(0);
  }
  const manifestPath = resolve(root, manifest);
  if (!existsSync(manifestPath))
    fail(
      'Solution manifest unavailable. Component work remains independent; run coordinator checks where the manifest is available.',
    );
  const home = dirname(manifestPath),
    s = read(manifestPath);
  if (s.schemaVersion !== 1 || typeof s.name !== 'string' || !s.name.trim())
    fail('Solution needs schemaVersion 1 and a name');
  if (!Array.isArray(s.repositories)) fail('Solution repositories must be an array');
  safeFile(home, s.dashboard ?? 'docs/SOLUTION-DASHBOARD.md');
  const all = [
    {
      id: 'solution',
      repository: s.repository,
      path: '.',
      backlog: s.backlog ?? 'docs/BACKLOG.md',
      ref: 'working checkout',
      // F-099: the coordinator's own emoji, from the manifest's top level; B-060: its label too
      ...(s.emoji === undefined ? {} : { emoji: s.emoji }),
      ...(s.label === undefined ? {} : { label: s.label }),
    },
    ...s.repositories,
  ];
  const seen = new Set();
  for (const repo of all) {
    if (!repo || !/^[a-z][a-z0-9-]*$/.test(repo.id) || seen.has(repo.id))
      fail(`Invalid/duplicate repository ID: ${repo?.id}`);
    seen.add(repo.id);
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo.repository ?? ''))
      fail(`${repo.id}: repository must be owner/name`);
    if (typeof repo.path !== 'string' || !repo.path.trim()) fail(`${repo.id}: explicit local checkout path required`);
    if (typeof repo.ref !== 'string' || !repo.ref.trim()) fail(`${repo.id}: explicit branch/tag/commit ref required`);
    if (repo.emoji !== undefined && (typeof repo.emoji !== 'string' || !repo.emoji.trim() || repo.emoji.length > 16))
      fail(`${repo.id}: emoji must be a short string`);
    // B-060: the name shown for a repository's rows; its references keep the ID
    if (
      repo.label !== undefined &&
      (typeof repo.label !== 'string' ||
        !repo.label.trim() ||
        repo.label.length > 40 ||
        /[\r\n|[\]()*`\\<>]/.test(repo.label))
    )
      fail(`${repo.id}: label must be a short string`);
    if (
      repo.archives !== undefined &&
      (!Array.isArray(repo.archives) || repo.archives.some((p) => typeof p !== 'string'))
    )
      fail(`${repo.id}: archives must be a list of file paths`);
    for (const path of [repo.backlog ?? 'docs/BACKLOG.md', ...(repo.archives ?? [])]) repositoryPath(path); // validate shape, then resolve filesystem paths in the actual owning checkout
  }
  if (new Set(all.map((r) => r.repository.toLowerCase())).size !== all.length)
    fail('Each repository has one unique ID; do not alias the same repository twice');
  const results = [],
    problems = [];
  // F-095-T02: the owner's order across the solution, in the coordinator: a numbered `repo:ID` list (a record or a step,
  // with an optional note after " — ") between order markers. Checked here, offline: references only, never status.
  const order = [];
  if (s.order !== undefined) {
    if (typeof s.order !== 'string') fail('order must be a file path in the coordinator');
    const file = safeFile(home, s.order);
    // A missing or unreadable file is a problem like any other: the component checks still run and report.
    let content = '';
    if (!existsSync(file) || !statSync(file).isFile()) problems.push(`order: ${s.order} is missing or not a file`);
    else content = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const pairs = [...content.matchAll(/<!-- order:start -->([\s\S]*?)<!-- order:end -->/g)];
    const list = pairs[0]?.[1];
    if (content && list === undefined)
      problems.push(`order: ${s.order} has no <!-- order:start --> … <!-- order:end --> list`);
    if (pairs.length > 1) problems.push(`order: ${s.order} has ${pairs.length} order lists; keep one`);
    const listed = new Set();
    for (const line of (list ?? '').split('\n').map((l) => l.trim())) {
      if (!line) continue;
      const m = /^(\d+)\. ([a-z][a-z0-9-]*):(\S+?)(?: — (.+))?$/.exec(line);
      if (!m) {
        problems.push(`order: ${line}: write a numbered item, "1. <repo>:<ID> — optional note"`);
        continue;
      }
      const [, number, repo, id, note] = m,
        ref = `${repo}:${id}`;
      if (Number(number) !== order.length + 1) problems.push(`order: ${line}: number it ${order.length + 1}`);
      if (!/^[BF]-\d{3}(?:-T\d{2})?$/.test(id))
        problems.push(`order: ${line}: write <repo>:<B-/F-ID> or <repo>:<STEP-ID>`);
      else if (!seen.has(repo)) problems.push(`order: ${line}: unknown repository ${repo}`);
      else if (listed.has(ref)) problems.push(`order: ${line}: listed twice`);
      listed.add(ref);
      order.push({ ref, repo, id, note: note ?? '' });
    }
  }
  for (const repo of all) {
    const base = resolve(home, repo.path),
      backlog = repo.backlog ?? 'docs/BACKLOG.md';
    try {
      let revision,
        dirty = false,
        built = null,
        view = null,
        viewCommit = null,
        io = null,
        ledger = '';
      const loaded = new Map();
      const paths = [...(repo.archives ?? []), backlog];
      if (remote && repo.id !== 'solution') {
        // Resolve the requested ref once, then read every file at that immutable commit.
        const commit = await request(
          `https://api.github.com/repos/${repo.repository}/commits/${encodeURIComponent(repo.ref)}`,
        );
        if (!/^[a-f0-9]{40}$/.test(commit.sha ?? '')) fail('Unsupported commit response');
        revision = commit.sha;
        const api = `https://api.github.com/repos/${repo.repository}`;
        const stampFile = await optional(`${api}/contents/.harness.json?ref=${revision}`);
        built = builtViews(
          stampFile?.encoding === 'base64' ? Buffer.from(stampFile.content, 'base64').toString('utf8') : null,
          revision,
        );
        let tree = null;
        const contents = (p) =>
          optional(`${api}/contents/${p.split('/').map(encodeURIComponent).join('/')}?ref=${revision}`);
        io = {
          text: async (p) => {
            if (p === '.harness.json')
              return stampFile?.encoding === 'base64'
                ? Buffer.from(stampFile.content, 'base64').toString('utf8')
                : null;
            const f = await contents(p);
            return f?.encoding === 'base64' ? Buffer.from(f.content, 'base64').toString('utf8') : null;
          },
          // every file at the commit from one recursive tree request, kept for the other folders (F-097-T02 review)
          list: async (dir) => {
            tree ??= await optional(`${api}/git/trees/${revision}?recursive=1`);
            if (tree?.truncated) throw Error('the repository tree is too large to list');
            return (Array.isArray(tree?.tree) ? tree.tree : [])
              .filter((e) => e.type === 'blob' && e.path.startsWith(`${dir}/`))
              .map((e) => e.path);
          },
        };
        let at = revision;
        if (built) {
          // The publication of exactly this commit; remotely there is no checkout to rebuild from.
          // Up to the 1,000 newest publications; an older commit is read from a local checkout instead.
          let found;
          for (let page = 1; page <= 10 && !found; page++) {
            const history = (await optional(`${api}/commits?sha=${VIEWS_BRANCH}&per_page=100&page=${page}`)) ?? [];
            if (!Array.isArray(history) || !history.length) break;
            const candidate = history.find(
              (c) => publishedFor(c?.commit?.message ?? '', revision) && /^[a-f0-9]{40}$/.test(c.sha),
            );
            if (candidate) {
              const [source, published] = await Promise.all([
                request(`${api}/git/commits/${revision}`),
                request(`${api}/git/commits/${candidate.sha}`),
              ]);
              if (await sameTreeRemote(api, source.tree?.sha, published.tree?.sha, backlog.split('/')))
                found = candidate;
              else break;
            }
          }
          if (!found)
            fail(`built views: no publication of ${revision} on ${VIEWS_BRANCH} (rebuild it from a local checkout)`);
          at = viewCommit = found.sha;
          view = `view published on ${VIEWS_BRANCH} at ${found.sha.slice(0, 12)}`;
        }
        for (const path of paths) {
          const file = await request(
            `https://api.github.com/repos/${repo.repository}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${built && path === backlog ? at : revision}`,
          );
          // F-095-T03: the contents API leaves a file over 1 MB out (encoding "none"); read its blob at the same commit.
          const body =
            file.encoding === 'none' && /^[a-f0-9]{40}$/.test(file.sha ?? '')
              ? await request(`https://api.github.com/repos/${repo.repository}/git/blobs/${file.sha}`)
              : file;
          if (body.encoding !== 'base64' || typeof body.content !== 'string') fail('Unsupported backlog response');
          const text = Buffer.from(body.content, 'base64').toString('utf8');
          if (path === backlog) ledger = text;
          for (const [id, record] of records(text, repo.id, path, path !== backlog)) loaded.set(id, record);
        }
      } else {
        if (!existsSync(base)) fail('checkout unavailable');
        const origin = git(base, 'remote', 'get-url', 'origin');
        const canonical = origin
          ?.replace(/\.git$/, '')
          .match(/^(?:https?:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+\/[^/]+)$/)?.[1];
        if (!canonical || canonical.toLowerCase() !== repo.repository.toLowerCase())
          fail('checkout origin does not match the declared repository');
        if (resolve(git(base, 'rev-parse', '--show-toplevel') ?? '') !== base)
          fail('path must name the repository root');
        revision = git(base, 'rev-parse', 'HEAD');
        dirty = Boolean(git(base, 'status', '--porcelain'));
        const expected = repo.id === 'solution' ? revision : git(base, 'rev-parse', repo.ref);
        if (!expected || expected !== revision)
          fail('checkout HEAD differs from the declared ref; refresh/check out the requested ref explicitly');
        built = builtViews(
          dirty && existsSync(resolve(base, '.harness.json'))
            ? readFileSync(resolve(base, '.harness.json'), 'utf8')
            : git(base, 'show', `${revision}:.harness.json`),
          revision,
        );
        // F-097-T02: the project's own evidence at the same commit (the working tree when it has local changes)
        io = {
          text: (p) =>
            dirty
              ? existsSync(resolve(base, p))
                ? readFileSync(resolve(base, p), 'utf8')
                : null
              : git(base, 'show', `${revision}:${p}`),
          list: (dir) =>
            (
              (dirty
                ? git(base, 'ls-files', '--cached', '--others', '--exclude-standard', '--', dir)
                : git(base, 'ls-tree', '-r', '--name-only', revision, '--', dir)) ?? ''
            )
              .split('\n')
              .filter(Boolean),
        };
        let builtView = null;
        if (built) {
          // The publication of exactly this commit, as last fetched; else a rebuild from the sources at this commit
          // with this coordinator's own copied tool, in memory: the component checkout is never written.
          const found = dirty
            ? null
            : git(
                base,
                'log',
                '--format=%H',
                '-1',
                '--fixed-strings',
                `--grep=Backlog views for ${revision}`,
                `refs/remotes/origin/${VIEWS_BRANCH}`,
              );
          if (
            found &&
            publishedFor(git(base, 'log', '-1', '--format=%B', found) ?? '', revision) &&
            git(base, 'diff', '--quiet', revision, found, '--', '.', `:!${backlog}`) !== null &&
            git(base, 'cat-file', '-e', `${found}:${backlog}`) !== null
          ) {
            builtView = git(base, 'show', `${found}:${backlog}`);
            viewCommit = found;
            view = `view published on ${VIEWS_BRANCH} at ${found.slice(0, 12)}`;
          } else {
            const tool = resolve(dirname(fileURLToPath(import.meta.url)), 'work-items.mjs');
            if (!existsSync(tool))
              fail(
                `built views: no publication of ${revision} on ${VIEWS_BRANCH} and no tools/work-items.mjs in the coordinator to rebuild it`,
              );
            builtView = (await import(pathToFileURL(tool).href)).builtLedger(base);
            view = `view rebuilt from sources at ${revision.slice(0, 12)}${dirty ? ' (local changes)' : ''}`;
          }
          if (typeof builtView !== 'string') fail('built views: the view could not be obtained');
        }
        for (const path of paths) {
          const file = safeFile(base, path);
          const content =
            built && path === backlog
              ? builtView
              : dirty
                ? readFileSync(file, 'utf8')
                : git(base, 'show', `${revision}:${path}`);
          if (content === null) fail(`Committed source unavailable: ${path}`);
          if (path === backlog) ledger = content;
          for (const [id, record] of records(content, repo.id, path, path !== backlog)) loaded.set(id, record);
        }
      }
      results.push({
        ...repo,
        records: loaded,
        revision,
        dirty,
        available: true,
        built,
        view,
        viewCommit,
        io,
        effort: remainingEffort(ledger, loaded),
        // evidence the reader cannot get leaves the backlog readable and the project's health unknown
        health: await projectHealth(io).catch((e) => ({
          version: null,
          audit: null,
          reviews: [],
          notes: [`evidence unreadable: ${e.message}`],
        })),
      });
    } catch (e) {
      problems.push(`${repo.id}: ${e.message}`);
      results.push({ ...repo, records: new Map(), available: false });
    }
  }
  const coordinator = results[0];
  for (const record of coordinator.records.values())
    for (const ref of record.refs) {
      const [owner, id] = ref.split(':');
      const repo = results.find((r) => r.id === owner);
      if (!repo || owner === 'solution') problems.push(`solution:${record.id}: unknown component ${owner}`);
      else if (repo.available && !repo.records.has(id))
        problems.push(
          `solution:${record.id}: missing ${ref} (closed/archived? reconcile the link with the owning repository)`,
        );
    }
  const linked = new Set([...coordinator.records.values()].flatMap((r) => r.refs));
  const fileLink = (r, path, anchor) =>
    (r.dirty
      ? urlPath(
          relative(dirname(resolve(home, s.dashboard ?? 'docs/SOLUTION-DASHBOARD.md')), resolve(home, r.path, path)),
        )
      : `https://github.com/${r.repository}/blob/${r.revision}/${urlPath(path)}`) + (anchor ? `#${anchor}` : '');
  const recordLink = (r, b) =>
    r.dirty
      ? urlPath(
          relative(dirname(resolve(home, s.dashboard ?? 'docs/SOLUTION-DASHBOARD.md')), resolve(home, r.path, b.file)),
        ) + `#${b.id.toLowerCase()}`
      : r.built && !b.archived
        ? r.viewCommit
          ? `https://github.com/${r.repository}/blob/${r.viewCommit}/${urlPath(b.file)}#${b.id.toLowerCase()}`
          : `https://github.com/${r.repository}/blob/${r.revision}/${urlPath(r.built.records)}/${b.id}.md`
        : `https://github.com/${r.repository}/blob/${r.revision}/${urlPath(b.file)}#${b.id.toLowerCase()}`;
  const snapshot = new Date().toISOString();
  const output = [
    '<!-- generated: project-harness solution dashboard; edit owning backlogs, not this file -->',
    `# ${text(s.name)} dashboard`,
    '',
    `Snapshot: ${snapshot}. Read-only aggregation; no combined completion percentage. Solution integration status is independent of component status.`,
    '',
    '| Source | Revision | Snapshot state |',
    '|---|---|---|',
  ];
  for (const r of results)
    output.push(
      `| ${text(r.label ?? r.id)} | ${r.available ? `[${r.revision.slice(0, 12)}](https://github.com/${r.repository}/commit/${r.revision})` : 'Unknown'} | ${r.available ? `${r.dirty ? 'Local changes — not a committed snapshot' : 'Committed snapshot'}; requested ${text(r.ref)}; ${remote && r.id !== 'solution' ? 'GitHub' : 'local checkout, not fetched'}${r.view ? `; ${r.view}` : ''}` : 'Unavailable — status unknown'} |`,
    );
  // F-095-T05: the owner view, ahead of the detail. F-099: in the layout of a coordinator's own overview, so it can
  // retire its tool: emoji and links per row, agent and owner hours apart, open prerequisites, harness and next audit.
  const view = ownerView(results);
  const label = (r) => `${r.emoji ? `${text(r.emoji)} ` : ''}${text(r.label ?? r.id)}`;
  const short = (value, n) => (value.length > n ? `${value.slice(0, n - 1)}…` : value);
  const num = (n) => String(Number(n.toFixed(2)));
  // Owner hours a Remaining cell states: "x h owner", or none at all ("0 h"); a cell with agent hours only says nothing
  // about owner time, so owner work with such a cell reads as unknown, as the runway counts it (review of F-099).
  const ownerHoursIn = (cell) => {
    const h = hoursIn(cell);
    return h && (/ h owner/.test(String(cell)) || h.agent === 0) ? h.owner : null;
  };
  // A reference linked to its row in the owning ledger at the resolved commit; one the reader cannot find stays text.
  const refLink = (ref) => {
    const found = view.lookup(ref);
    const r = results.find((x) => x.id === ref.split(':')[0]);
    if (found.missing || !r?.available) return text(ref);
    const href = recordLink(r, found.parent);
    const anchored =
      found.kind === 'step' && href.includes('#') ? href.replace(/#[^#]*$/, `#${found.item.id.toLowerCase()}`) : href;
    return `[${text(ref)}](${anchored})`;
  };
  const isDone = (ref) => {
    const found = view.lookup(ref);
    return !found.missing && view.itemState(found).state === 'Done';
  };
  // Each open step of an item (the step itself, or a record's open steps; a record without steps itself) with each
  // prerequisite not yet done.
  const openPrerequisites = (found) => {
    const repo = found.repo;
    const items =
      found.kind === 'step'
        ? [found.item]
        : found.item.steps.length
          ? found.item.steps.filter((x) => !DONE_STEPS.has(x.status))
          : [found.item];
    const pairs = items.flatMap((x) =>
      x.dependsOn
        .map((d) => (d.includes(':') ? d : `${repo}:${d}`))
        .filter((d) => !isDone(d))
        .map((d) => `${refLink(`${repo}:${x.id}`)} waits on ${refLink(d)}`),
    );
    return pairs.length
      ? pairs.slice(0, 3).join('; ') + (pairs.length > 3 ? `; and ${pairs.length - 3} more` : '')
      : '—';
  };
  const stateText = (st, first) =>
    st.state === 'Ready'
      ? first
        ? '▶ Ready'
        : st.close
          ? 'Ready (to close)'
          : st.verify
            ? 'Ready (verification)'
            : 'Ready'
      : st.state === 'Owner'
        ? `Owner: ${st.kind}`
        : st.state === 'Waiting'
          ? `Waiting on ${st.on}`
          : st.state === 'Blocked'
            ? `Blocked: ${st.cause.what} ${st.cause.ref}`
            : st.state;
  const latest = await latestTemplate(stamp);
  const harnessText = (h) =>
    !h.version
      ? 'no version stamp (unknown)'
      : semver(h.version).length !== 3
        ? `v${h.version} (not vX.Y.Z: unknown)`
        : !latest.version
          ? `v${h.version} (latest unknown)`
          : newer(latest.version, h.version)
            ? `**v${h.version}, behind v${latest.version}**`
            : `v${h.version} (latest)`;
  const openRecords = (r) => [...r.records.values()].filter((b) => !b.archived && b.status !== 'Closed').length;
  // Agent work that cannot start: blocked, or waiting on a chain that reaches a block. Owner steps are the owner's
  // (Waiting for the owner, the runway's blocks), not counted here.
  const blocked = view.units.filter((u) => !u.owner && (u.state === 'Blocked' || (u.state === 'Waiting' && u.stop)));
  const blockedOf = (r) => blocked.filter((u) => u.repo === r.id).length;
  const nextAudit = (h) =>
    !h.audit
      ? 'no audit found'
      : h.audit.due.length
        ? `due: ${h.audit.due.length >= AUDIT_AREAS.length || h.audit.due[0] === 'all' ? 'all areas' : h.audit.due.join(', ')}`
        : h.audit.next;
  const hoursText = (n) => (n === null ? 'Unknown' : `${Number(n.toFixed(2))} h`);
  const knownEffort = results.filter((r) => r.available && r.effort.agent !== null);
  const partialEffort = knownEffort.length < results.length || knownEffort.some((r) => r.effort.partial);
  const effortTotal = (key) =>
    `${partialEffort ? 'at least ' : ''}${hoursText(knownEffort.reduce((n, r) => n + r.effort[key], 0))}`;
  const runwayTotal = results.reduce((n, r) => n + (r.available ? view.runway.get(r.id).agent : 0), 0);
  const runwayPartial =
    results.some((r) => !r.available) || results.some((r) => r.available && view.runway.get(r.id).unestimated.length);
  output.push(
    '',
    '## Summary',
    '',
    "Open work per project. Doable agent h is the agent runway (below): agent work whose prerequisites are done or doable, across projects. Owner h is the owner time the backlog still holds. Hours are each project's own estimates, not cross-calibrated; no completion percentage.",
    '',
    '| Project | Open records | Doable agent h | Owner h | Blocked | Harness | Next audit |',
    '|---|---:|---:|---:|---:|---|---|',
    ...results.map((r) => {
      if (!r.available) return `| ${label(r)} | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown |`;
      const w = view.runway.get(r.id);
      return `| ${label(r)} | ${openRecords(r)} | ${num(w.agent)}${w.unestimated.length ? ` + ${w.unestimated.length} without hours` : ''} | ${r.effort.owner === null ? 'Unknown' : num(r.effort.owner)} | ${blockedOf(r)} | ${text(harnessText(r.health).replaceAll('**', ''))} | ${text(nextAudit(r.health))} |`;
    }),
    `| **Solution** | ${results.reduce((n, r) => n + (r.available ? openRecords(r) : 0), 0)} | **${runwayPartial ? 'at least ' : ''}${num(runwayTotal)}** | **${effortTotal('owner').replace(/ h$/, '')}** | ${results.reduce((n, r) => n + (r.available ? blockedOf(r) : 0), 0)} | ${latest.version ? `latest v${text(latest.version)}` : 'latest unknown'} | |`,
    '',
    `Remaining in all backlogs: ${effortTotal('agent')} agent + ${effortTotal('owner')} owner.`,
  );
  // B-058: an order item missing from its repository's ledger may have closed there; look it up at the same commit.
  for (const o of order) {
    const r = results.find((x) => x.id === o.repo);
    if (view.lookup(o.ref).missing === 'unknown' && r?.available && /^[BF]-\d{3}(?:-T\d{2})?$/.test(o.id ?? ''))
      // a lookup that fails is a source problem, never "Not in backlog" (review of B-058)
      o.closure =
        (await closedIn(r, o.id).catch((e) => {
          o.unreadable = true;
          problems.push(`${o.ref}: could not look for its closure in ${o.repo}: ${e.message}`);
          return null;
        })) ?? undefined;
  }
  const done = [];
  if (order.length) {
    let marked = false;
    output.push(
      '',
      '## Solution order',
      '',
      `The owner's order (${text(s.order)}): take the first ready item; it never skips a prerequisite or an owner decision. ▶ = the next item to do: the first item an agent can start now, not one that only awaits its verification or closure. Read the record before starting.`,
      '',
      '| # | | Item | Title | Status / state | Agent h | Owner h | Open prerequisites | Note |',
      '|---:|---|---|---|---|---:|---:|---|---|',
    );
    // B-058: a Done item says where it closed, linked; `dashboard --write --prune-order` drops it from the order.
    // B-059: the label escapes the backslash before the brackets, so a trailing `\` cannot escape the closing one;
    // fileLink percent-encodes the URL (urlPath).
    const closedText = (where, date, href) =>
      `✅ Done: closed${date ? ` ${date}` : ''} in [${text(String(where).replace(/[\\[\]]/g, '\\$&'))}](${href})`;
    order.forEach((o, i) => {
      const found = view.lookup(o.ref);
      const r = results.find((x) => x.id === o.repo);
      const emoji = r?.emoji ? ` ${text(r.emoji)} ` : ' ';
      if (o.closure) {
        done.push(o.ref);
        return output.push(
          `| ${i + 1} |${emoji}| ${text(o.ref)} | ${text(short(o.closure.title ?? '—', 80))} | Closed: ${closedText(o.closure.path, o.closure.date, fileLink(r, o.closure.path, o.closure.anchor))} | — | — | — | ${text(o.note)} |`,
        );
      }
      if (found.missing)
        return output.push(
          `| ${i + 1} |${emoji}| ${text(o.ref)} | — | ${found.missing === 'unavailable' || o.unreadable ? 'Source unavailable' : 'Not in backlog'} | — | — | — | ${text(o.note)} |`,
        );
      const st = view.itemState(found);
      const first = st.state === 'Ready' && !st.verify && !st.close && !marked;
      if (first) marked = true;
      if (st.state === 'Done') done.push(o.ref);
      const stated = hoursIn(found.item.remaining);
      const ownerWork = found.kind === 'step' ? Boolean(ownerKind(found.item.who)) : st.state === 'Owner';
      const unknownOwner = ownerWork && stated && ownerHoursIn(found.item.remaining) === null;
      const h = stated && {
        agent: unknownOwner ? '—' : num(stated.agent),
        owner: unknownOwner ? 'unknown' : num(stated.owner),
      };
      output.push(
        `| ${i + 1} |${emoji}| ${refLink(o.ref)} | ${text(short(found.item.title, 80))} | ${text(found.item.status)}: ${st.state === 'Done' ? closedText(found.parent.file, null, recordLink(r, found.parent)) : text(stateText(st, first))} | ${h ? h.agent : '—'} | ${h ? h.owner : '—'} | ${st.state === 'Done' ? '—' : openPrerequisites(found)} | ${text(o.note)} |`,
      );
    });
  }
  const causeOf = (u) => (u.state === 'Blocked' ? u.cause : u.stop);
  const causeKind = (c) => {
    if (c.ring) return `cycle ${c.ring.join(' → ')}`;
    if (c.what === 'owner step') {
      const found = view.lookup(c.ref);
      const kind = found.missing ? null : found.kind === 'step' ? ownerKind(found.item.who) : found.item.human;
      if (kind) return `owner ${kind.toLowerCase()}`;
    }
    return `${c.what.replace(/:$/, '')}${c.where ? `, ${c.where}` : ''}`;
  };
  // Owner work per record, in ledger order: a record with an owner step or unit, or whose own Procedures or Decisions
  // cell names the owner (an implemented step awaiting the owner's check, for example).
  const ownerRecords = results
    .filter((r) => r.available)
    .flatMap((r) =>
      [...r.records.values()]
        .filter((b) => !b.archived && b.status !== 'Closed')
        .map((b) => [r, b, view.units.filter((u) => u.repo === r.id && u.record === b.id && u.state === 'Owner')])
        .filter(([, b, units]) => units.length || OWNER_HUMAN.has(b.human)),
    );
  const actionText = (b) =>
    b.action
      .replace(/^.*?(?:<br\s*\/?>|\*\*→\*\*)/, '')
      .replace(/\*\*/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .trim();
  const ownerRow = ([r, b, units]) => {
    const kinds = new Set(
      [b.human, ...units.map((u) => u.kind)].flatMap((k) =>
        k === 'Both' ? ['Procedure', 'Decision'] : OWNER_HUMAN.has(k) || k === 'Owner' ? [k] : [],
      ),
    );
    const kind = ['Procedure', 'Decision', 'Owner'].filter((k) => kinds.has(k)).join(' + ') || '—';
    const owner = ownerHoursIn(b.remaining);
    const steps = units.filter((u) => u.ref !== `${r.id}:${b.id}`);
    const next = steps.length
      ? steps.map((u) => `${u.ref.split(':')[1]}: ${u.title}`).join('; ')
      : actionText(b) || '—';
    return `| ${refLink(`${r.id}:${b.id}`)} | ${text(short(b.title, 80))} | ${text(kind)} | ${text(b.priority)} | ${owner === null ? '—' : `${num(owner)} h`} | ${text(short(next, 140))} |`;
  };
  // F-099: a project is idle when its agent runway is empty, with the reason.
  const why = (r) => {
    if (!r.available) return 'backlog unreadable';
    const w = view.runway.get(r.id);
    if (w.agent > 0 || w.unestimated.length) return null;
    if (!openRecords(r)) return 'no open records';
    const mine = view.units.filter((u) => u.repo === r.id);
    const kindOf = (u) => {
      if (u.state === 'Owner') return 'owner';
      // ready work with no runway hours only awaits its verification or closure
      if (u.state === 'Ready') return 'ready';
      const c = u.state === 'Blocked' ? u.cause : u.stop;
      if (!c) return 'other';
      if (!c.ring && c.ref && c.ref.split(':')[0] !== r.id) return 'project';
      if (c.what === 'owner step') return 'owner';
      if (c.what.startsWith('record marked Blocked')) return 'external';
      return 'other';
    };
    const kinds = mine.map(kindOf);
    if (kinds.includes('project')) return 'waiting on another project';
    if (kinds.length && kinds.every((k) => k === 'owner')) return 'all waiting on the owner';
    if (kinds.length && kinds.every((k) => k === 'external')) return 'waiting on an external event (Blocked)';
    if (kinds.includes('ready') && kinds.every((k) => k === 'ready' || k === 'owner'))
      return 'only verification, closure or owner work left';
    return 'everything blocked (see Blocked)';
  };
  const idle = results.map((r) => [r, why(r)]).filter(([, reason]) => reason);
  output.push(
    '',
    '## Blocked',
    '',
    'Agent work that cannot start, per project, with the first block its chain reaches: an owner step, a prerequisite (in this or another project), an unknown prerequisite, a cycle, a record marked Blocked or an external wait not yet recorded.',
    '',
    '| Project | Blocked item | Title | Waits on | Kind |',
    '|---|---|---|---|---|',
    ...(blocked.length
      ? blocked.map(
          (u) =>
            `| ${label(results.find((r) => r.id === u.repo))} | ${refLink(u.ref)} | ${text(short(u.title, 70))} | ${refLink(causeOf(u).ref)} | ${text(causeKind(causeOf(u)))} |`,
        )
      : ['| — | Nothing blocked | | | |']),
    '',
    '## Nothing to do',
    '',
    'Projects with no doable agent work, and why.',
    '',
    '| Project | Why |',
    '|---|---|',
    ...(idle.length
      ? idle.map(([r, reason]) => `| ${label(r)} | ${reason} |`)
      : ['| — | Every project has doable agent work |']),
    '',
    '## Waiting for the owner',
    '',
    "Records and steps whose next move is an owner procedure (🧑‍🔧) or decision (🤔). Owner time is the record's own. Open the link for the exact instructions.",
    '',
    '| Item | Title | Kind | Priority | Owner time | Next |',
    '|---|---|---|---|---|---|',
    ...(ownerRecords.length ? ownerRecords.map(ownerRow) : ['| — | Nothing waits for the owner | | | | |']),
  );
  // F-097-T01: the agent runway, per project and for the solution.
  const fixed = (n) => `${Number(n.toFixed(2))} h`;
  const runwayRows = results.map((r) => [r, view.runway.get(r.id)]);
  const sum = (key) => runwayRows.reduce((n, [r, w]) => n + (r.available ? w[key] : 0), 0);
  const unreadable = results.some((r) => !r.available);
  const notes = (list) => (list.length ? `; not estimated: ${list.join(', ')}` : '');
  output.push(
    '',
    '## Agent runway',
    '',
    "Agent hours that can run before work reaches a block: open agent work that is ready, or waits only on work that can itself run, across repositories. Hours are each project's own estimate; a prerequisite the reader cannot resolve is a block, never assumed done.",
    '',
    '| Project | Runway | First blocks reached | Owner hours for the next layer |',
    '|---|---|---|---|',
    ...runwayRows.map(([r, w]) =>
      r.available
        ? `| ${label(r)} | ${text(fixed(w.agent) + notes(w.unestimated))} | ${text([...w.blocks].join('; ') || '—')} | ${text(fixed(w.owner) + notes(w.ownerUnestimated))} |`
        : `| ${label(r)} | Unknown | source unavailable | Unknown |`,
    ),
    `| **Solution** | ${unreadable || runwayRows.some(([, w]) => w.unestimated.length) ? 'at least ' : ''}${fixed(sum('agent'))} | ${new Set(runwayRows.flatMap(([, w]) => [...w.blocks])).size} | ${unreadable || runwayRows.some(([, w]) => w.ownerUnestimated.length) ? 'at least ' : ''}${fixed(sum('owner'))} |`,
  );
  // F-097-T02: audits, reviews and harness release per project.
  const auditText = (h) =>
    !h.audit
      ? 'none found (unknown)'
      : `${h.audit.latest ? `${h.audit.latest.day} (${h.audit.latest.kind}), ` : ''}${h.audit.last ? `${h.audit.last} (${h.audit.kind})` : 'no complete full audit'}; ${
          h.audit.due.length ? `**due: ${h.audit.due.join(', ')}**` : `next ${h.audit.next}`
        }`;
  const reviewText = (h) =>
    h.reviews.length
      ? h.reviews
          .map((v) =>
            v.overdue
              ? `**${v.name}: ${v.last ? `due since ${v.next ?? 'unknown'}` : 'none found'}**`
              : `${v.name}: next ${v.next}`,
          )
          .join('; ')
      : '—';
  output.push(
    '',
    '## Audits, reviews and harness',
    '',
    `Each project's own evidence at its resolved commit: the newest audit against its interval (\`audit.days\`), each periodic review (\`reviews.<name>.days\`) and its harness release against the latest template release (${text(latest.from)}). Missing evidence reads as unknown, never as current.`,
    '',
    '| Project | Harness | Last audit | Reviews | Notes |',
    '|---|---|---|---|---|',
    ...results.map((r) =>
      r.available
        ? `| ${label(r)} | ${text(harnessText(r.health))} | ${text(auditText(r.health))} | ${text(reviewText(r.health))} | ${text(r.health.notes.join('; ') || '—')} |`
        : `| ${label(r)} | Unknown | Unknown | Unknown | source unavailable |`,
    ),
  );
  // F-097-T03: proposals for missing cross-repository work.
  const gaps = gapReview(results, view, order, latest);
  output.push(
    '',
    '## Gap review',
    '',
    'Proposals only, each naming the repository that would own the fix: the coordinator never creates or edits a record in a component; an accepted proposal is created by its owning repository (`docs/agents/solution-gaps.md`). The cross-repository kind is a text heuristic.',
    '',
    ...(gaps.length
      ? [
          // B-060: numbered, so the owner can answer "accept 2, drop 3"
          '| # | Kind | Where | Evidence | Proposal |',
          '|---:|---|---|---|---|',
          ...gaps.map(
            (g, i) => `| ${i + 1} | ${text(g.kind)} | ${text(g.where)} | ${text(g.evidence)} | ${text(g.proposal)} |`,
          ),
        ]
      : ['No gaps found. This does not prove that every cross-repository need is recorded.']),
  );
  // B-060: the open work per record, as a coordinator's retired overview had it: each open record in its backlog's order
  // with its open steps, agent and owner hours and state, then its open steps with theirs, collapsed.
  output.push(
    '',
    '## Open work by repository',
    '',
    "Each open record in its backlog's order. State: Ready = an agent can start its next open step now; the owner's turn, waiting and blocked work as in the solution order. Owner h reads unknown where the record owes owner work its Remaining cell does not state.",
  );
  for (const r of results.filter((x) => x.available)) {
    const recs = [...r.records.values()].filter((b) => !b.archived && b.status !== 'Closed');
    if (!recs.length) continue;
    const openOf = (b) => b.steps.filter((x) => !DONE_STEPS.has(x.status));
    const ownerHours = (b) => {
      const owner = ownerHoursIn(b.remaining);
      if (owner !== null) return num(owner);
      if (!hoursIn(b.remaining)) return '—';
      return OWNER_HUMAN.has(b.human) || openOf(b).some((x) => ownerKind(x.who)) ? 'unknown' : '0';
    };
    const steps = recs.flatMap((b) => openOf(b).map((x) => [b, x]));
    output.push(
      '',
      `### ${label(r)}`,
      '',
      '| Item | Title | Status | Priority | Open steps | Agent h | Owner h | State |',
      '|---|---|---|---|---:|---:|---:|---|',
      ...recs.map((b) => {
        const h = hoursIn(b.remaining);
        const st = view.itemState({ repo: r.id, kind: 'record', item: b, parent: b });
        return `| ${refLink(`${r.id}:${b.id}`)} | ${text(short(b.title, 80))} | ${text(b.status)} | ${text(b.priority)} | ${openOf(b).length} | ${h ? num(h.agent) : '—'} | ${ownerHours(b)} | ${text(stateText(st, false))} |`;
      }),
    );
    if (steps.length)
      output.push(
        '',
        `<details><summary>${label(r)}: ${steps.length} open step${steps.length === 1 ? '' : 's'}</summary>`,
        '',
        '| Step | Title | Status | Remaining | Who | Depends on | State |',
        '|---|---|---|---|---|---|---|',
        ...steps.map(
          ([b, x]) =>
            `| ${text(`${r.id}:${x.id}`)} | ${text(x.title)} | ${text(x.status)} | ${text(x.remaining)} | ${text(x.who.replace(/\]\([^)]*\)/g, ']').replace(/[[\]]/g, ''))} | ${text(x.dependsOn.join(', ') || '—')} | ${text(stateText(view.itemState({ repo: r.id, kind: 'step', item: x, parent: b }), false))} |`,
        ),
        '',
        '</details>',
      );
  }
  // F-095-T04: remaining hours per backlog and a solution total that never hides an unknown backlog.
  const hours = (n) => (n === null ? 'Unknown' : `${Number(n.toFixed(2))} h`);
  const known = results.filter((r) => r.available && r.effort.agent !== null);
  const partialTotal = known.length < results.length || known.some((r) => r.effort.partial);
  const total = (key) => `${partialTotal ? 'at least ' : ''}${hours(known.reduce((n, r) => n + r.effort[key], 0))}`;
  output.push(
    '',
    '## Remaining effort',
    '',
    "Hours each backlog still holds, as each project's own, uncalibrated estimate. The solution line adds them; it is no completion measure.",
    '',
    '| Source | Agent | Owner | From | Open records by priority | Open records by size |',
    '|---|---|---|---|---|---|',
    ...results.map((r) =>
      r.available
        ? `| ${label(r)} | ${hours(r.effort.agent)} | ${hours(r.effort.owner)} | ${text(r.effort.basis)} | ${text(r.effort.priorities)} | ${text(r.effort.sizes)} |`
        : `| ${label(r)} | Unknown | Unknown | source unavailable | Unknown | Unknown |`,
    ),
    `| **Solution** | ${total('agent')} | ${total('owner')} | ${known.length} of ${results.length} backlogs | | |`,
  );
  output.push(
    '',
    '## Integration outcomes',
    '',
    '| Record | Outcome | Status | Human action | Effort | Component links |',
    '|---|---|---|---|---|---|',
  );
  for (const b of coordinator.records.values())
    output.push(
      `| [solution:${b.id}](${recordLink(coordinator, b)}) | ${text(b.title)} | ${text(b.status)} | ${text(b.human)} | ${text(b.effort)} | ${text(b.refs.join(', ') || '—')} |`,
    );
  output.push(
    '',
    '## Component work',
    '',
    '| Record | Item | Status | Human action | Effort | Reviewed |',
    '|---|---|---|---|---|---|',
  );
  for (const r of results.slice(1)) {
    if (!r.available) output.push(`| ${text(r.id)} | Source unavailable | Unknown | Unknown | Unknown | Unknown |`);
    for (const b of r.records.values())
      if (!b.archived || linked.has(`${r.id}:${b.id}`))
        output.push(
          `| [${r.id}:${b.id}](${recordLink(r, b)}) | ${text(b.title)} | ${text(b.status)} | ${text(b.human)} | ${text(b.effort)} | ${text(b.reviewed)} |`,
        );
  }
  output.push(
    '',
    '## Source and link problems',
    '',
    ...(problems.length
      ? problems.map((p) => `- ${text(p)}`)
      : ['None detected. This does not verify semantic ownership, integration behaviour or real-device acceptance.']),
    '',
  );
  if (mode === 'dashboard') {
    const content = output.join('\n');
    if (write) {
      if (setting?.role === 'component' || resolve(root) !== resolve(home))
        fail('Only the coordinator may write its generated dashboard');
      const dest = safeFile(home, s.dashboard ?? 'docs/SOLUTION-DASHBOARD.md');
      const protectedSource = all.some((r) =>
        [r.backlog ?? 'docs/BACKLOG.md', ...(r.archives ?? [])].some((p) => resolve(home, r.path, p) === dest),
      );
      const componentRoot = all.slice(1).some((r) => {
        const base = resolve(home, r.path);
        return (
          inside(base, dest) ||
          (existsSync(base) &&
            inside(
              realpathSync(base),
              realpathSync(
                (() => {
                  let p = dest;
                  while (!existsSync(p)) p = dirname(p);
                  return p;
                })(),
              ),
            ))
        );
      });
      if (inside(resolve(home, '.git'), dest) || dest === resolve(manifestPath) || protectedSource || componentRoot)
        fail('Dashboard must not overwrite configuration, an owning backlog/archive or any component checkout');
      if (
        existsSync(dest) &&
        !readFileSync(dest, 'utf8').startsWith('<!-- generated: project-harness solution dashboard;')
      )
        fail('Refusing to replace a non-generated file');
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, content);
      console.log(`Wrote ${relative(home, dest)} (${snapshot}); ${problems.length} source/link problem(s).`);
      // B-058: a closed item leaves the order at the next refresh; only the numbered lines inside the markers change.
      if (args.includes('--prune-order') && s.order !== undefined && done.length) {
        const file = safeFile(home, s.order);
        const drop = new Set(done);
        let n = 0;
        const pruned = readFileSync(file, 'utf8').replace(
          /(<!-- order:start -->)([\s\S]*?)(<!-- order:end -->)/,
          (_, start, list, end) =>
            start +
            list
              .split('\n')
              .flatMap((line) => {
                const m = /^\d+\. (\S+)(.*)$/.exec(line.trim());
                if (!m) return [line];
                return drop.has(m[1]) ? [] : [`${++n}. ${m[1]}${m[2]}`];
              })
              .join('\n') +
            end,
        );
        writeFileSync(file, pruned);
        console.log(`Dropped ${done.length} done item(s) from ${s.order}: ${done.join(', ')}`);
      }
    } else console.log(content);
  } else if (args.includes('--json'))
    // F-095-T03: what the reader keeps, per repository, for the owner view and for tests.
    console.log(
      JSON.stringify(
        {
          name: s.name,
          order,
          repositories: results.map((r) => ({
            id: r.id,
            repository: r.repository,
            available: r.available,
            revision: r.revision ?? null,
            dirty: r.dirty ?? false,
            view: r.view ?? null,
            effort: r.effort ?? null,
            // eslint-disable-next-line no-unused-vars -- the gap review's text fields stay out of the JSON
            records: [...r.records.values()].map(({ prose, action, ...kept }) => kept),
          })),
          problems,
        },
        null,
        2,
      ),
    );
  else console.log(`Solution ${s.name}: ${all.length} repository sources; ${problems.length} source/link problem(s).`);
  if (problems.length) {
    problems.forEach((p) => console.error(p));
    process.exitCode = 1;
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
