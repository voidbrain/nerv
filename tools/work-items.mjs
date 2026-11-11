// Optional record sources and bounded executable tasks. No models or commands are executed.
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, lstatSync, realpathSync } from 'node:fs';
import { resolve, join, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
export const RECORD = /^[BF]-\d{3}$/;
export const TASK = /^[BF]-\d{3}-T\d{2}$/;
const recap = /<!-- recap:start[^>]*-->[\s\S]*?<!-- recap:end[^>]*-->/;
// Generated effort totals (F-053): the layout places the markers, renderLedger fills them from task files.
const totalsBlock = /<!-- totals:start -->[\s\S]*?<!-- totals:end -->/;
export const normalizeLedger = (text) => text.replace(recap, '<!-- derived recap -->');
function local(root, path) {
  if (
    typeof path !== 'string' ||
    isAbsolute(path) ||
    path.split(/[\\/]/).some((p) => p === '..' || p === '') ||
    path.includes('\\')
  )
    throw Error('Expected a repository-relative path');
  const full = resolve(root, path);
  let at = full;
  while (!existsSync(at)) at = dirname(at);
  const resolved = realpathSync(at);
  if (relative(realpathSync(root), resolved).startsWith('..') || isAbsolute(relative(realpathSync(root), resolved)))
    throw Error('Path escapes repository');
  if (existsSync(full) && lstatSync(full).isSymbolicLink()) throw Error('Symlink source refused');
  return full;
}
export function settings(root = process.cwd()) {
  const harness = JSON.parse(readFileSync(join(root, '.harness.json'), 'utf8'));
  const config = harness.workItems;
  if (!config?.enabled) return null;
  if (config.order !== undefined && !['id', 'queue'].includes(config.order)) throw Error('Invalid workItems.order');
  if (config.estimation !== undefined) estimationSettings(config.estimation);
  if (config.featurePlans !== undefined && typeof config.featurePlans !== 'boolean')
    throw Error('Invalid featurePlans setting');
  for (const name of ['layout', 'records', 'tasks', 'profiles']) local(root, config[name]);
  // Queue order reads the roadmap the work queue uses, so the ledger and the queue page agree.
  if (config.order === 'queue' && harness.workQueue?.roadmap !== undefined) {
    local(root, harness.workQueue.roadmap);
    return { ...config, queueRoadmap: harness.workQueue.roadmap };
  }
  return config;
}
function readJSON(path) {
  if (lstatSync(path).size > 1024 * 1024) throw Error('Input exceeds 1 MiB');
  return JSON.parse(readFileSync(path, 'utf8'));
}
function relocateLinks(text, fromFile, toFile, referenceIds = new Set()) {
  const change = (url) => {
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url) || url.startsWith('/')) return url;
    if (/[\s<>\\()]/.test(url)) throw Error('Unsupported Markdown link; review relocation before migration');
    const [, path, suffix] = url.match(/^([^?#]*)(.*)$/),
      target = path ? resolve(dirname(fromFile), path) : fromFile;
    return (target === toFile ? '' : relative(dirname(toFile), target).replaceAll('\\', '/')) + suffix;
  };
  const prose = (part) => {
    // Delimiters of any backtick length protect literal inline examples.
    const code = /(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g;
    let out = '',
      cursor = 0;
    const links = (chunk) => {
      if (/^ {0,3}\[[^\]]+\]:\s*(?![a-zA-Z][a-zA-Z0-9+.-]*:|\/)[^\n]+/m.test(chunk))
        throw Error('Unsupported Markdown link reference; review relocation before migration');
      const inline = /\[([^\]]+)\]\(([\s\S]*?)\)/g;
      const remaining = chunk.replace(inline, '');
      if (
        /\[[^\]]*\]\s*\[[^\]]*\]/.test(remaining) ||
        [...remaining.matchAll(/\[([^\]]+)\]/g)].some((m) =>
          referenceIds.has(m[1].trim().replace(/\s+/g, ' ').toLowerCase()),
        )
      )
        throw Error('Unsupported Markdown link/reference notation; review relocation before migration');
      return chunk.replace(inline, (whole, label, url) => '[' + label + '](' + change(url) + ')');
    };
    for (const match of part.matchAll(code)) {
      out += links(part.slice(cursor, match.index)) + match[0];
      cursor = match.index + match[0].length;
    }
    return out + links(part.slice(cursor));
  };
  let out = '',
    pending = '',
    fence = null;
  for (const line of text.match(/[^\n]*\n|[^\n]+$/g) || []) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*?)(?:\n)?$/);
    if (fence) {
      out += line;
      if (marker && marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
    } else if (marker) {
      out += prose(pending) + line;
      pending = '';
      fence = { char: marker[1][0], length: marker[1].length };
    } else pending += line;
  }
  return out + prose(pending);
}
// Optional numbers next to the words: `days` is the remaining focused days, `baselineDays` the estimate accepted when
// the step was planned (set once, kept at close). Quarter days, at most 20.
const quarterDays = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 20 && Number.isInteger(v * 4);
const effortKeys = ['size', 'estimate', 'basis', 'reviewed'],
  numericEffortKeys = ['days', 'baselineDays'],
  // F-054/F-056: effort spent on a step in focused days (final when closed, so far when open), measured or stated.
  actualKeys = ['actualDays', 'actualSource'];
const actualDays = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;
function validateEffort(e, status) {
  if (
    !e ||
    typeof e !== 'object' ||
    Array.isArray(e) ||
    !effortKeys.every((k) => k in e) ||
    Object.keys(e).some((k) => ![...effortKeys, ...numericEffortKeys, ...actualKeys].includes(k)) ||
    actualKeys.filter((k) => k in e).length === 1 ||
    ('actualDays' in e &&
      (status === 'planned' || !actualDays(e.actualDays) || !['measured', 'stated'].includes(e.actualSource))) ||
    numericEffortKeys.some((k) => k in e && !quarterDays(e[k])) ||
    (status === 'closed' && 'days' in e && e.days !== 0) ||
    !['small', 'medium', 'large'].includes(e.size) ||
    !['estimate', 'basis'].every((k) => typeof e[k] === 'string' && e[k].trim() && e[k].length <= 2000) ||
    typeof e.reviewed !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(e.reviewed) ||
    !Number.isFinite(Date.parse(e.reviewed)) ||
    new Date(e.reviewed).toISOString().slice(0, 10) !== e.reviewed
  )
    throw Error('Invalid task effort');
}
// Re-estimation trigger settings (F-054). false turns the trigger off; missing fields take the defaults.
export const estimationDefaults = { minSamples: 5, ratio: 1.5, outlier: 3, hoursPerDay: 6 };
function estimationSettings(e) {
  if (e === false) return null;
  if (!e || typeof e !== 'object' || Array.isArray(e))
    throw Error('Invalid workItems.estimation: use an object or false');
  const unknown = Object.keys(e).find((k) => !['minSamples', 'ratio', 'outlier', 'hoursPerDay', 'since'].includes(k));
  if (unknown) throw Error(`Invalid workItems.estimation: unknown field ${unknown}`);
  const out = { ...estimationDefaults, ...e };
  const problem = !(Number.isInteger(out.minSamples) && out.minSamples >= 1)
    ? 'minSamples must be a positive integer'
    : !(typeof out.ratio === 'number' && out.ratio > 1)
      ? 'ratio must be a number above 1'
      : !(typeof out.outlier === 'number' && out.outlier >= out.ratio)
        ? `outlier ${out.outlier} must be at least ratio ${out.ratio}`
        : !(typeof out.hoursPerDay === 'number' && out.hoursPerDay > 0 && out.hoursPerDay <= 24)
          ? 'hoursPerDay must be above 0 and at most 24'
          : out.since !== undefined &&
              (!/^\d{4}-\d{2}-\d{2}$/.test(out.since) ||
                !Number.isFinite(Date.parse(out.since)) ||
                new Date(out.since).toISOString().slice(0, 10) !== out.since)
            ? 'since must be a YYYY-MM-DD date'
            : null;
  if (problem) throw Error('Invalid workItems.estimation: ' + problem);
  return out;
}
const round = (n) => Math.round(n * 100) / 100;
const stats = (list) => {
  const r = list.map((x) => x.ratio).sort((a, b) => a - b);
  if (!r.length) return { n: 0 };
  const mid = Math.floor(r.length / 2);
  return {
    n: r.length,
    median: round(r.length % 2 ? r[mid] : (r[mid - 1] + r[mid]) / 2),
    min: round(r[0]),
    max: round(r.at(-1)),
    ...(r.length < 3 ? { note: 'too few samples' } : {}),
  };
};
// Read-only comparison of actual with baseline effort for closed steps (closed on or after `since`, by their
// reviewed date). Never rewrites an estimate; `due` says whether open steps should be re-estimated, and why.
export function calibrate(tasks, estimation = estimationDefaults) {
  const e = estimationSettings(estimation) ?? null;
  const samples = tasks
    .filter(
      (t) =>
        t.status === 'closed' &&
        typeof t.effort?.actualDays === 'number' &&
        t.effort.actualDays > 0 &&
        t.effort.baselineDays > 0 &&
        // `reviewed` is set to the close date when the actual is recorded; `since` is the last re-estimation day.
        (!e?.since || t.effort.reviewed > e.since),
    )
    .map((t) => ({
      id: t.id,
      size: t.effort.size,
      source: t.effort.actualSource,
      ratio: t.effort.actualDays / t.effort.baselineDays,
    }));
  const by = (key) =>
    Object.fromEntries(
      [...new Set(samples.map((x) => x[key]))].sort().map((v) => [v, stats(samples.filter((x) => x[key] === v))]),
    );
  const all = stats(samples);
  const reasons = [];
  if (e) {
    if (all.n >= e.minSamples && (all.median > e.ratio || all.median < 1 / e.ratio))
      reasons.push(
        `median actual/baseline ${all.median} over ${all.n} closed steps is outside ${round(1 / e.ratio)}–${e.ratio}`,
      );
    for (const x of samples)
      if (x.ratio >= e.outlier || x.ratio <= 1 / e.outlier)
        reasons.push(`${x.id} took ${round(x.ratio)}x its baseline (outlier threshold ${e.outlier}x)`);
  }
  const open = tasks.filter((t) => t.status !== 'closed').map((t) => t.id);
  return {
    since: e?.since ?? null,
    all,
    bySize: by('size'),
    bySource: by('source'),
    due: reasons.length > 0,
    reasons,
    reestimate: reasons.length ? open : [],
  };
}
const dayText = (n) => `${Number(n.toFixed(2))} ${n === 1 ? 'day' : 'days'}`;
// Remaining, baseline and actual totals over a set of steps. Steps without a number are counted (remainingUnknown,
// baselineKnown, actualKnown); the renderers name those counts instead of passing an unknown off as 0.
export function effortTotals(steps) {
  const open = steps.filter((t) => t.status !== 'closed');
  const sum = (list, k) => list.reduce((n, t) => n + (typeof t.effort?.[k] === 'number' ? t.effort[k] : 0), 0);
  return {
    steps: steps.length,
    open: open.length,
    remainingDays: sum(open, 'days'),
    remainingUnknown: open.filter((t) => typeof t.effort?.days !== 'number').length,
    baselineDays: sum(steps, 'baselineDays'),
    baselineKnown: steps.filter((t) => typeof t.effort?.baselineDays === 'number').length,
    actualDays: sum(steps, 'actualDays'),
    actualKnown: steps.filter((t) => typeof t.effort?.actualDays === 'number').length,
  };
}
const unknownText = (n) => (n ? ` (${n} open ${n === 1 ? 'step' : 'steps'} without days)` : '');
const cell = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('|', '&#124;')
    .replaceAll('\n', ' ')
    .replaceAll('\r', ' ')
    .replaceAll('`', '&#96;')
    .replaceAll('[', '&#91;')
    .replaceAll(']', '&#93;')
    .replaceAll('*', '&#42;')
    .replaceAll('_', '&#95;')
    .replaceAll('\\', '&#92;');
function totalRow(steps) {
  const t = effortTotals(steps);
  const baseline = t.baselineKnown
    ? `${dayText(t.baselineDays)}${t.baselineKnown < t.steps ? ` (${t.baselineKnown} of ${t.steps} steps)` : ''}`
    : '—';
  // A step row without a recorded actual shows 0 (owner choice, 2026-11-11); the total names how many steps
  // recorded one, so an unrecorded 0 never reads as measured.
  const actual = `${dayText(t.actualDays)}${t.actualKnown < t.steps ? ` (${t.actualKnown} of ${t.steps} steps recorded)` : ''}`;
  return `| **Total** | ${baseline} | ${actual} | ${dayText(t.remainingDays)}${unknownText(t.remainingUnknown)} | ${t.steps - t.open} of ${t.steps} completed |`;
}
// The one-line backlog total placed between the totals markers of the layout.
function ledgerTotals(tasks, active) {
  const steps = tasks.filter((t) => active.has(t.parent));
  const t = effortTotals(steps);
  const records = new Set(steps.filter((s) => s.status !== 'closed').map((s) => s.parent));
  const features = [...records].filter((id) => id.startsWith('F-')).length,
    others = records.size - features;
  const spent = t.actualKnown
    ? ` ${dayText(t.actualDays)} of actual effort recorded on ${t.actualKnown} ${t.actualKnown === 1 ? 'step' : 'steps'}.`
    : '';
  const line = t.open
    ? `**Remaining effort:** ${dayText(t.remainingDays)} across ${t.open} open ${t.open === 1 ? 'step' : 'steps'} of ${features} ${features === 1 ? 'feature' : 'features'}${others ? ` and ${others} other ${others === 1 ? 'record' : 'records'}` : ''}${unknownText(t.remainingUnknown)}.`
    : '**Remaining effort:** no open steps.';
  return `<!-- totals:start -->\n${line}${spent} Generated from the task files.\n<!-- totals:end -->`;
}
function featurePlan(text, id, tasks) {
  const steps = tasks.filter((t) => t.parent === id);
  if (!steps.length) throw Error('Feature needs an upfront task plan: ' + id);
  const sizes = { small: '🟢 Small', medium: '🟡 Medium', large: '🔴 Large' },
    states = {
      planned: 'Planned',
      ready: 'Ready',
      implemented: 'Implemented; verification pending',
      verified: 'Verified',
      closed: 'Completed',
    };
  for (const t of steps) validateEffort(t.effort, t.status);
  // Compact table (F-055): one line per step; the dated basis of each estimate goes into the record details.
  const table =
    '**Feature steps** (baseline: accepted estimate; actual: effort spent, so far while open; status is not parent acceptance)\n\n| Step | Baseline | Actual | Remaining | Status |\n|---|---|---|---|---|\n' +
    steps
      .map(
        (t) =>
          `| ${t.id} — ${cell(t.title)} | ${typeof t.effort.baselineDays === 'number' ? dayText(t.effort.baselineDays) : '—'} | ${
            typeof t.effort.actualDays === 'number'
              ? `${dayText(t.effort.actualDays)}${t.status === 'closed' ? '' : ' so far'} (${t.effort.actualSource})`
              : dayText(0)
          } | ${sizes[t.effort.size]} — ${
            typeof t.effort.days === 'number' ? dayText(t.effort.days) : cell(t.effort.estimate)
          } | ${states[t.status]} |`,
      )
      .join('\n') +
    '\n' +
    totalRow(steps) +
    '\n\n';
  const basis =
    '**Step estimates** (dated basis; generated from the task files)\n\n' +
    steps
      .map((t) => `- ${t.id}: ${cell(t.effort.estimate)} (${cell(t.effort.reviewed)}). ${cell(t.effort.basis)}`)
      .join('\n') +
    '\n\n';
  // The record's own details block is a line holding only <details>; a mention of the tag inside a cell is not.
  // The basis list goes after the summary line, with or without a blank line after it.
  const details = /^<details>\n(?:<summary>[^\n]*<\/summary>\n)?/m.exec(text);
  if (!details) throw Error('Feature plan requires record details: ' + id);
  return (
    text.slice(0, details.index) +
    table +
    details[0] +
    '\n' +
    basis +
    text.slice(details.index + details[0].length).replace(/^\n/, '')
  );
}
// Work-queue order (F-055): rank each active record by tools/backlog-queue.mjs over the ID-ordered ledger, its
// archives and the configured roadmap, lanes first (agent candidates, prerequisite review, human action, blocked).
// Records the queue leaves out (closed) follow, by ID. Content does not depend on order, so the ranking is stable.
function queueRank(root, config) {
  const sources = [{ file: 'docs/BACKLOG.md', text: renderLedger(root, { ...config, order: 'id' }) }];
  const archive = join(root, 'docs/archive');
  if (existsSync(archive))
    for (const name of readdirSync(archive)
      .filter((n) => /^backlog-\d{4}\.md$/.test(n))
      .sort())
      sources.push({ file: `docs/archive/${name}`, text: readFileSync(local(root, `docs/archive/${name}`), 'utf8') });
  const roadmap = config.queueRoadmap ? readFileSync(local(root, config.queueRoadmap), 'utf8') : '';
  const lanes = ['Agent candidates', 'Prerequisite review', 'Human action', 'Blocked'];
  // Loaded only for queue order: the work queue is an optional adoption (APPLY, work queue).
  // require() of an ES module needs Node 22.12 or newer.
  let queue;
  try {
    ({ queue } = createRequire(import.meta.url)('./backlog-queue.mjs'));
  } catch (e) {
    throw Error(
      e.code === 'MODULE_NOT_FOUND'
        ? 'workItems.order queue needs tools/backlog-queue.mjs (adopt the work queue)'
        : `workItems.order queue could not load backlog-queue.mjs (Node 22.12 or newer is required): ${e.message}`,
    );
  }
  const records = queue(sources, roadmap);
  const sorted = lanes.flatMap((lane) => records.filter((r) => r.lane === lane));
  return new Map(sorted.map((r, i) => [r.id + '.md', i]));
}
export function renderLedger(root, config, withPlans = true) {
  const layout = readJSON(local(root, config.layout));
  if (layout.version !== 1 || !Array.isArray(layout.segments)) throw Error('Invalid ledger layout');
  const dir = local(root, config.records),
    files = existsSync(dir) ? readdirSync(dir).sort() : [],
    seen = new Set();
  for (const file of files) if (!/^[BF]-\d{3}\.md$/.test(file)) throw Error('Unknown record source: ' + file);
  const referenceText =
    layout.segments
      .filter((s) => typeof s.text === 'string')
      .map((s) => s.text)
      .join('\n') +
    '\n' +
    files.map((f) => readFileSync(local(root, config.records + '/' + f), 'utf8')).join('\n');
  const referenceIds = new Set(
    [...referenceText.matchAll(/\[([^\]]+)\]:/g)].map((m) => m[1].trim().replace(/\s+/g, ' ').toLowerCase()),
  );
  const current = existsSync(join(root, 'docs/BACKLOG.md')) ? readFileSync(join(root, 'docs/BACKLOG.md'), 'utf8') : '';
  const derived = current.match(recap)?.[0];
  const plannedTasks = withPlans && config.featurePlans ? taskCatalog(root, config).tasks : null;
  const wantsTotals = withPlans && layout.segments.some((s) => typeof s.text === 'string' && totalsBlock.test(s.text));
  const totals = wantsTotals
    ? ledgerTotals(plannedTasks ?? taskCatalog(root, config).tasks, new Set(files.map((f) => f.slice(0, -3))))
    : null;
  const rank = withPlans && config.order === 'queue' ? queueRank(root, config) : null;
  const ordered = rank
    ? [...files].sort((a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) || a.localeCompare(b))
    : files;
  let output = '';
  for (const segment of layout.segments) {
    if (Object.keys(segment).length !== 1) throw Error('Invalid layout segment');
    if (typeof segment.text === 'string') {
      const text = derived ? segment.text.replace(recap, derived) : segment.text;
      output += totals ? text.replace(totalsBlock, totals) : text;
    } else if (['B', 'F'].includes(segment.records)) {
      if (seen.has(segment.records)) throw Error('Duplicate record group');
      seen.add(segment.records);
      for (const file of ordered.filter((f) => f.startsWith(segment.records + '-'))) {
        const text = readFileSync(local(root, config.records + '/' + file), 'utf8');
        if (
          !text.startsWith('### ' + file.slice(0, -3) + '\n') ||
          /^### [BF]-\d{3}$/m.test(text.slice(text.indexOf('\n') + 1))
        )
          throw Error('Record identity mismatch: ' + file);
        output += relocateLinks(
          plannedTasks && file.startsWith('F-') ? featurePlan(text, file.slice(0, -3), plannedTasks) : text,
          local(root, config.records + '/' + file),
          join(root, 'docs/BACKLOG.md'),
          referenceIds,
        );
      }
    } else throw Error('Invalid layout segment');
  }
  for (const file of files) if (!seen.has(file[0])) throw Error('Unreferenced record group');
  return output;
}
export function migrateLedger(root, config) {
  const path = join(root, 'docs/BACKLOG.md'),
    text = readFileSync(path, 'utf8');
  for (const name of ['layout', 'records'])
    if (existsSync(local(root, config[name]))) throw Error('Migration destination already exists');
  const matches = [...text.matchAll(/^### ([BF]-\d{3})\n[\s\S]*?(?=^### [BF]-\d{3}\n|^## [^\n]+\n|$(?![\s\S]))/gm)];
  if (!matches.length || new Set(matches.map((m) => m[1])).size !== matches.length)
    throw Error('Missing or duplicate records');
  const segments = [],
    groups = new Set();
  let cursor = 0,
    previous = null;
  for (const match of matches) {
    const gap = text.slice(cursor, match.index);
    if (gap) segments.push({ text: gap });
    const group = match[1][0];
    if (group !== previous) {
      if (groups.has(group)) throw Error('Interleaved record groups need explicit layout review');
      groups.add(group);
      segments.push({ records: group });
    } else if (gap) throw Error('Separated groups need explicit layout review');
    previous = group;
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  // Preserve the derived block as a marker; its actual values remain owned by the recap tool.
  for (const s of segments) if (s.text) s.text = s.text.replace(recap, '<!-- recap:start -->\n<!-- recap:end -->');
  const referenceIds = new Set(
    [...text.matchAll(/\[([^\]]+)\]:/g)].map((m) => m[1].trim().replace(/\s+/g, ' ').toLowerCase()),
  );
  const sources = matches.map((match) => {
    const file = local(root, config.records + '/' + match[1] + '.md'),
      source = relocateLinks(match[0], path, file, referenceIds);
    if (relocateLinks(source, file, path) !== match[0])
      throw Error('Unsupported link formatting needs explicit migration review');
    return { file, source };
  });
  mkdirSync(local(root, config.records), { recursive: true });
  mkdirSync(dirname(local(root, config.layout)), { recursive: true });
  for (const { file, source } of sources) writeFileSync(file, source, { flag: 'wx' });
  writeFileSync(local(root, config.layout), JSON.stringify({ version: 1, segments }, null, 2) + '\n', { flag: 'wx' });
  if (renderLedger(root, config) !== text)
    throw Error('Migration did not preserve the exact ledger; inspect generated sources before continuing');
  return matches.length;
}
export function resource(value) {
  if (
    typeof value !== 'string' ||
    value.length > 200 ||
    !(
      /^(?:contract|generated):[a-z0-9][a-z0-9.-]*$/.test(value) ||
      /^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*(?:\/\*\*)?$/.test(value)
    )
  )
    throw Error('Invalid resource');
  if (value.split('/').some((part) => part === '..' || part === '.')) throw Error('Invalid resource');
  return value;
}
export function overlaps(a, b) {
  resource(a);
  resource(b);
  return (
    a === b ||
    (a.endsWith('/**') && (b === a.slice(0, -3) || b.startsWith(a.slice(0, -2)))) ||
    (b.endsWith('/**') && (a === b.slice(0, -3) || a.startsWith(b.slice(0, -2))))
  );
}
export function taskCatalog(root, config) {
  const ledger = renderLedger(root, config, false),
    parents = new Set([...ledger.matchAll(/^### ([BF]-\d{3})$/gm)].map((m) => m[1]));
  const archive = join(root, 'docs/archive');
  if (existsSync(archive))
    for (const f of readdirSync(archive).filter((f) => /^backlog-.*\.md$/.test(f)))
      for (const m of readFileSync(join(archive, f), 'utf8').matchAll(/^### ([BF]-\d{3})$/gm)) parents.add(m[1]);
  const profiles = readJSON(local(root, config.profiles));
  if (profiles.version !== 1 || !Array.isArray(profiles.profiles)) throw Error('Invalid model profiles');
  const profileIds = new Set();
  for (const p of profiles.profiles) {
    if (
      !p ||
      !/^[a-z0-9-]{1,60}$/.test(p.id) ||
      profileIds.has(p.id) ||
      !['candidate', 'qualified'].includes(p.status) ||
      typeof p.model !== 'string' ||
      !p.model ||
      !Array.isArray(p.capabilities) ||
      !p.capabilities.length ||
      p.capabilities.some((c) => typeof c !== 'string' || !c) ||
      !Array.isArray(p.evidence) ||
      p.evidence.some((e) => typeof e !== 'string' || !e) ||
      (p.status === 'qualified' && !p.evidence.length)
    )
      throw Error('Invalid or unevidenced model profile');
    profileIds.add(p.id);
  }
  const dir = local(root, config.tasks),
    tasks = [];
  if (!existsSync(dir)) return { version: 1, tasks, profiles: profiles.profiles };
  for (const file of readdirSync(dir).sort()) {
    if (!/^[BF]-\d{3}-T\d{2}\.json$/.test(file)) throw Error('Invalid task filename');
    const t = readJSON(local(root, config.tasks + '/' + file));
    const allowed = [
      'version',
      'id',
      'parent',
      'title',
      'goal',
      'status',
      'acceptance',
      'dependsOn',
      'resources',
      'capabilities',
      'privacy',
      'validation',
      'escalation',
      'suggestedProfile',
      'effort',
    ];
    if (
      Object.keys(t).some((k) => !allowed.includes(k)) ||
      t.version !== 1 ||
      t.id !== file.slice(0, -5) ||
      !TASK.test(t.id) ||
      t.parent !== t.id.slice(0, 5) ||
      !parents.has(t.parent) ||
      !['planned', 'ready', 'implemented', 'verified', 'closed'].includes(t.status)
    )
      throw Error('Invalid task identity/status: ' + file);
    for (const k of ['title', 'goal', 'privacy'])
      if (typeof t[k] !== 'string' || !t[k].trim() || t[k].length > 2000) throw Error('Invalid ' + k);
    for (const k of ['acceptance', 'resources', 'capabilities', 'validation', 'escalation', 'dependsOn'])
      if (
        !Array.isArray(t[k]) ||
        (k !== 'dependsOn' && !t[k].length) ||
        t[k].length > 32 ||
        t[k].some((v) => typeof v !== 'string' || !v || v.length > 2000) ||
        new Set(t[k]).size !== t[k].length
      )
        throw Error('Invalid ' + k);
    if (t.effort !== undefined) validateEffort(t.effort, t.status);
    t.resources.forEach(resource);
    if (t.suggestedProfile && !profileIds.has(t.suggestedProfile)) throw Error('Unknown suggested profile');
    tasks.push(t);
  }
  const byId = new Map(tasks.map((t) => [t.id, t])),
    done = new Set(),
    visiting = new Set();
  function visit(id) {
    if (done.has(id)) return;
    if (visiting.has(id)) throw Error('Task dependency cycle');
    visiting.add(id);
    for (const dep of byId.get(id).dependsOn) {
      if (!byId.has(dep)) throw Error('Unknown task prerequisite');
      visit(dep);
    }
    visiting.delete(id);
    done.add(id);
  }
  for (const t of tasks) visit(t.id);
  return { version: 1, tasks, profiles: profiles.profiles };
}
export function checkWorkItems(root = process.cwd()) {
  const config = settings(root);
  if (!config) return { enabled: false };
  const expected = renderLedger(root, config),
    actual = readFileSync(join(root, 'docs/BACKLOG.md'), 'utf8');
  if (normalizeLedger(expected) !== normalizeLedger(actual))
    throw Error('Backlog differs from record sources; run work-items build');
  const catalog = taskCatalog(root, config);
  // Open steps without a day estimate leave the totals incomplete: reported, not an error.
  const withoutDays = config.featurePlans
    ? catalog.tasks.filter((t) => t.status !== 'closed' && typeof t.effort?.days !== 'number').map((t) => t.id)
    : [];
  return {
    enabled: true,
    records: (actual.match(/^### [BF]-\d{3}$/gm) || []).length,
    tasks: catalog.tasks.length,
    ...(withoutDays.length ? { withoutDays } : {}),
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...extra] = process.argv.slice(2);
    if (extra.length || !['migrate', 'build', 'check', 'tasks', 'calibrate'].includes(command))
      throw Error('Use work-items.mjs migrate|build|check|tasks|calibrate');
    const root = process.cwd(),
      config = settings(root);
    if (!config) {
      console.log('Work items not adopted');
    } else if (command === 'migrate')
      console.log('Migrated ' + migrateLedger(root, config) + ' records without changing the ledger');
    else if (command === 'build') writeFileSync(join(root, 'docs/BACKLOG.md'), renderLedger(root, config));
    else if (command === 'calibrate')
      console.log(JSON.stringify(calibrate(taskCatalog(root, config).tasks, config.estimation), null, 2));
    else {
      const result = command === 'check' ? checkWorkItems(root) : taskCatalog(root, config);
      console.log(JSON.stringify(result, null, 2));
      if (result.withoutDays)
        console.warn(
          `! ${result.withoutDays.length} open step(s) have no effort.days, so totals count them as unknown: ${result.withoutDays.slice(0, 10).join(', ')}${result.withoutDays.length > 10 ? ` and ${result.withoutDays.length - 10} more` : ''}`,
        );
    }
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
