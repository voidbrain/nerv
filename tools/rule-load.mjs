#!/usr/bin/env node
// Rule load (F-076): how much instruction text an agent reads, in tokens.
//   - Always loaded: AGENTS.md (rules.agents) and CLAUDE.md, plus any rules.always files.
//   - By trigger: each row of AGENTS' "Before you | Read" table, with the documents (or the sections) its cell links.
//     A link with an anchor (`file.md#section`) or followed by a quoted name (`[guide](file.md), "In short"`) counts
//     that section; otherwise the whole file. The total is always-loaded plus the trigger's reading.
//   - Procedure files: every rules.procedures file (default docs/BACKLOG-RULES.md, docs/agents/*.md), with its `##`
//     sections when --sections is given.
//   - --check (F-076-T05): warns, never fails, when the always-loaded set, a procedure file or a trigger's total passes
//     rules.budgets ({ always, procedure, trigger }; defaults 3500, 2000, 5000).
// Anchors follow GitHub's slugs without the -1, -2 suffixes of repeated headings; links resolve from the repository
// root and never above it.
// Tokens are characters ÷ 4, rounded up, unless --tokenizer="<command>" names a command that reads the text on stdin
// and prints a token count (an exact count for one model). A report, never a check: budgets are a separate step.
// Usage: node tools/rule-load.mjs [--json] [--sections] [--check] [--tokenizer="<command>"]
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

export const estimate = (text) => Math.ceil(text.length / 4);

export function commandCounter(command) {
  const counter = (text) => {
    const r = spawnSync(command, { shell: true, input: text, encoding: 'utf8' });
    const n = Number(String(r.stdout).trim());
    if (r.status !== 0 || !Number.isInteger(n) || n < 0)
      throw Error(`Tokenizer command failed or printed no count: ${command}`);
    return n;
  };
  counter.command = command;
  return counter;
}

const glob = (root, pattern) => {
  if (!pattern.includes('*')) return existsSync(join(root, pattern)) ? [pattern] : [];
  const dir = dirname(pattern),
    re = new RegExp(
      `^${pattern
        .slice(dir.length + 1)
        .split('*')
        .map((part) => part.replace(/[\\^$.|?+()[\]{}]/g, '\\$&'))
        .join('[^/]*')}$`,
    );
  return existsSync(join(root, dir))
    ? readdirSync(join(root, dir))
        .filter((f) => re.test(f))
        .map((f) => `${dir}/${f}`)
        .sort()
    : [];
};

// B-025: tags are removed until none is left (nested input such as "<<b>b>" leaves no fragment), then any stray bracket.
const untag = (text) => {
  let previous;
  do {
    previous = text;
    text = text.replace(/<[^<>]*>/g, '');
  } while (text !== previous);
  return text.replace(/[<>]/g, '');
};
export const slug = (heading) =>
  untag(heading.trim().toLowerCase())
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');

// Code fences: a fence closes only on the same marker character, at least as long as the one that opened it.
function fenceTracker() {
  let open = null;
  return (line) => {
    const m = /^\s*(`{3,}|~{3,})/.exec(line);
    if (m && !open) open = m[1];
    else if (m && m[1][0] === open[0] && m[1].length >= open.length) open = null;
    else return open !== null;
    return true;
  };
}
// A heading line's level and title; a closing run of # is not part of the title.
const heading = (line) => {
  const m = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(line);
  return m && { level: m[1].length, title: m[2].trim() };
};

// The section a heading opens: its heading line to the next heading of the same or a higher level.
export function section(text, match) {
  const lines = text.split('\n');
  const inFence = fenceTracker(),
    heads = [];
  lines.forEach((line, i) => {
    const h = !inFence(line) && heading(line);
    if (h) heads.push({ i, ...h });
  });
  const h = heads.find((x) => match(x.title));
  if (!h) return null;
  const next = heads.find((x) => x.i > h.i && x.level <= h.level);
  return lines.slice(h.i, next ? next.i : lines.length).join('\n');
}

export function sections(text) {
  const out = [];
  const inFence = fenceTracker();
  let current = { title: '(before the first section)', text: '' };
  for (const line of text.split('\n')) {
    const h = !inFence(line) && heading(line);
    if (h && h.level === 2) {
      out.push(current);
      current = { title: h.title, text: '' };
    }
    current.text += line + '\n';
  }
  out.push(current);
  return out.filter((s) => s.text.trim());
}

// Rows of the routing table: the table whose header starts "| Before you | Read |".
export function routingRows(agents) {
  const lines = agents.split('\n'),
    start = lines.findIndex((l) => /^\|\s*Before you\s*\|\s*Read\s*\|/i.test(l));
  if (start < 0) return [];
  const rows = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break;
    const cells = line
      .split(/(?<!\\)\|/)
      .slice(1, -1)
      .map((c) => c.replace(/\\\|/g, '|').trim());
    if (cells.length < 2) continue;
    rows.push({ trigger: cells[0], cell: cells.slice(1).join(' | ') });
  }
  return rows;
}

// The documents a routing cell links, each with the section it names, if any.
export function reads(cell) {
  const out = [],
    re = /\[[^\]]*\]\(([^)\s]+)\)(\s*,\s*"([^"]+)")?/g;
  let m;
  while ((m = re.exec(cell))) {
    const [target, anchor] = m[1].split('#');
    const path = normalize(target);
    // only documents inside the repository: no URL, no absolute path, nothing above the root
    if (/^[a-z]+:/i.test(target) || !path.endsWith('.md') || path.startsWith('/') || path.split('/').includes('..'))
      continue;
    out.push({ path, anchor: anchor || null, named: m[3] ?? null });
  }
  return out;
}

export function ruleLoad(root, { count = estimate, withSections = false } = {}) {
  let stamp = {};
  try {
    stamp = JSON.parse(readFileSync(join(root, '.harness.json'), 'utf8'));
  } catch {
    /* no stamp: defaults */
  }
  const cfg = stamp.rules ?? {},
    agentsPath = cfg.agents ?? 'AGENTS.md';
  const read = (p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : null);
  const cache = new Map(),
    tokens = (text) => {
      if (!cache.has(text)) cache.set(text, count(text));
      return cache.get(text);
    };

  const alwaysPaths = [...new Set([agentsPath, 'CLAUDE.md', ...(cfg.always ?? [])])].filter((p) => read(p) !== null);
  const always = alwaysPaths.map((path) => ({ path, tokens: tokens(read(path)) }));
  const alwaysTotal = always.reduce((s, f) => s + f.tokens, 0);

  const agents = read(agentsPath) ?? '';
  const triggers = routingRows(agents).map(({ trigger, cell }) => {
    const items = reads(cell).map(({ path, anchor, named }) => {
      const text = read(path);
      if (text === null) return { path, missing: true, tokens: 0 };
      const part = anchor
        ? section(text, (t) => slug(t) === anchor)
        : named
          ? section(text, (t) => t.replace(/[`*_]/g, '').toLowerCase() === named.toLowerCase())
          : text;
      const name = anchor ?? named;
      // a named section that is not there counts nothing, like a missing file, and is reported
      if (name && part === null) return { path, section: name, missing: true, tokens: 0 };
      return { path, ...(name ? { section: name } : {}), tokens: tokens(part) };
    });
    const reading = items.reduce((s, x) => s + x.tokens, 0);
    return { trigger, reads: items, tokens: reading, total: alwaysTotal + reading };
  });

  const procedurePaths = [
    ...new Set(
      (cfg.procedures ?? ['docs/BACKLOG-RULES.md', 'docs/backlog/*.md', 'docs/agents/*.md']).flatMap((p) =>
        glob(root, p),
      ),
    ),
  ];
  const procedures = procedurePaths.map((path) => {
    const text = read(path);
    return {
      path,
      tokens: tokens(text),
      // B-026: a page a tool writes says so on its first line; it is looked up, not read by a route
      ...(/^<!-- (Written|Generated) by /i.test(text) ? { generated: true } : {}),
      ...(withSections
        ? {
            sections: sections(text)
              .map((s) => ({ title: s.title, tokens: tokens(s.text) }))
              .sort((a, b) => b.tokens - a.tokens),
          }
        : {}),
    };
  });

  const budgets = { always: 3500, procedure: 2000, trigger: 5000, ...(cfg.budgets ?? {}) };
  return {
    budgets,
    method: count === estimate ? 'characters ÷ 4' : `tokenizer command: ${count.command ?? 'custom'}`,
    always: { tokens: alwaysTotal, files: always },
    triggers,
    procedures: { tokens: procedures.reduce((s, p) => s + p.tokens, 0), files: procedures },
  };
}

const n = (x) => x.toLocaleString('en-US');
// Budget findings (warnings only): a file or a reading over its budget, largest first.
export function overBudget(report) {
  const b = report.budgets,
    out = [];
  if (report.always.tokens > b.always)
    out.push(
      `always-loaded rules are ${n(report.always.tokens)} tokens, over the ${n(b.always)} budget: move procedure detail out of AGENTS.md, never a rule`,
    );
  for (const p of report.procedures.files)
    if (p.tokens > b.procedure && !p.generated)
      out.push(
        `${p.path} is ${n(p.tokens)} tokens, over the ${n(b.procedure)} budget for one procedure file: split it by trigger`,
      );
  for (const t of report.triggers)
    if (t.total > b.trigger)
      out.push(
        `"${t.trigger}" reads ${n(t.total)} tokens in all, over the ${n(b.trigger)} budget: route it to a smaller file or section`,
      );
  return out;
}
export function format(report) {
  const out = [`Rule load in tokens (${report.method}).`, '', `Always loaded: ${n(report.always.tokens)}`];
  for (const f of report.always.files) out.push(`  ${n(f.tokens).padStart(7)}  ${f.path}`);
  out.push('', 'By trigger (reading added to the always-loaded set):');
  for (const t of report.triggers) {
    const what = t.reads
      .map((r) => `${r.path}${r.section ? ` "${r.section}"` : ''}${r.missing ? ' (not found)' : ''}`)
      .join(', ');
    out.push(`  +${n(t.tokens).padStart(7)} = ${n(t.total).padStart(7)}  ${t.trigger}: ${what || 'no document'}`);
  }
  out.push('', `Procedure files: ${n(report.procedures.tokens)} in all`);
  for (const p of [...report.procedures.files].sort((a, b) => b.tokens - a.tokens)) {
    out.push(`  ${n(p.tokens).padStart(7)}  ${p.path}`);
    for (const s of p.sections ?? []) out.push(`  ${''.padStart(7)}    ${n(s.tokens).padStart(6)}  ${s.title}`);
  }
  return out.join('\n');
}

const isMain = () => {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};
if (process.argv[1] && isMain()) {
  try {
    const args = process.argv.slice(2),
      tok = args.find((a) => a.startsWith('--tokenizer='));
    const report = ruleLoad(process.cwd(), {
      count: tok ? commandCounter(tok.slice('--tokenizer='.length)) : estimate,
      withSections: args.includes('--sections'),
    });
    if (args.includes('--check')) {
      const found = overBudget(report);
      for (const w of found) console.log(process.env.GITHUB_ACTIONS ? `::warning title=Rule load::${w}` : `! ${w}`);
      console.log(
        found.length
          ? `Rule load: ${found.length} over budget (a warning, not a failure).`
          : 'Rule load: within budgets.',
      );
    } else console.log(args.includes('--json') ? JSON.stringify(report, null, 2) : format(report));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
