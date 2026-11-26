#!/usr/bin/env node
// Optional browser and combined coverage. Unit coverage says what the unit tests ran; this says what the browser
// tests (Playwright, Chromium) ran, mapped back to the source files, and what either ran, each line counted once.
//
// Contracts (.harness.json "coverage"):
//   browser:  { raw?: "coverage/browser/", summary?: "coverage/browser-summary.json" }
//     raw is a folder of JSON files, each a list of Chromium script coverage entries as Playwright's
//     page.coverage.stopJSCoverage() returns them ({ url, source, functions: [{ ranges: [{ startOffset, endOffset,
//     count }] }] }), each with the script's source map in `sourceMap` (or inline in its source). The collector below
//     writes them. summary is the standard coverage summary of the browser run (lines and statements; branches and
//     functions are not measured: their totals are 0 and the table shows "–").
//   combined: { summary?: "coverage/combined-summary.json" }  needs the unit run's LCOV ("lcov", default
//     coverage/lcov.info, with DA line records): a line counts as covered when unit or browser tests ran it, and once.
//   folders:  the source folders (required here); files outside them are left out.
//   node tools/browser-coverage.mjs    reads the raw files (and the unit LCOV for combined), writes the summaries,
//                                      and lists sources it could not match to a file here. coverage-table.mjs prints
//                                      and checks them next to the unit table when these settings exist.
// Collector, in a Playwright fixture (Chromium only: other browsers have no coverage API, and it says so):
//   import { startBrowserCoverage, stopBrowserCoverage } from '../tools/browser-coverage.mjs';
//   await startBrowserCoverage(page); …test…; await stopBrowserCoverage(page, 'coverage/browser', testInfo.testId);
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ------------------------------------------------------------------------------------------------------- collector

export async function startBrowserCoverage(page) {
  if (!page?.coverage?.startJSCoverage)
    throw Error(
      'Browser coverage needs Chromium: this browser has no coverage API (run the coverage project with Chromium)',
    );
  await page.coverage.startJSCoverage({ resetOnNavigation: false });
}
/** Stops collecting, fetches each script's external source map, writes <dir>/<name>.json; returns its path. */
export async function stopBrowserCoverage(
  page,
  dir,
  name,
  fetchText = async (url) => {
    const r = await page.context().request.get(url);
    return r.ok() ? r.text() : null;
  },
) {
  if (!page?.coverage?.stopJSCoverage) throw Error('Browser coverage needs Chromium: this browser has no coverage API');
  const entries = await page.coverage.stopJSCoverage();
  for (const e of entries) {
    const ref = mapReference(e.source ?? '');
    if (ref && !ref.startsWith('data:')) {
      try {
        const text = await fetchText(new URL(ref, e.url).href);
        if (text) e.sourceMap = JSON.parse(text);
      } catch {
        /* no map: reported later */
      }
    }
    if (e.sourceMap) delete e.sourceMap.sourcesContent; // the files are here: only the mappings are needed
  }
  mkdirSync(dir, { recursive: true });
  // one file per call: retries, repeats, several pages per test and names that clean up alike never overwrite a run
  const path = join(dir, `${String(name).replace(/[^\w.-]+/g, '_')}-${randomBytes(4).toString('hex')}.json`);
  writeFileSync(path, JSON.stringify(entries));
  return path;
}

// ------------------------------------------------------------------------------------------------------ source maps

const mapReference = (source) => source.match(/\/\/[#@] sourceMappingURL=(\S+)\s*$/)?.[1] ?? null;
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** Source map "mappings" to segments per generated line: [generatedColumn, sourceIndex, originalLine] (0-based). */
export function decodeMappings(mappings) {
  const lines = [];
  let source = 0,
    origLine = 0,
    // The original column and name index are decoded to keep the running deltas right; nothing reads them.
    _origCol = 0,
    _name = 0;
  for (const line of mappings.split(';')) {
    const segments = [];
    let col = 0;
    for (const seg of line.split(',')) {
      if (!seg) continue;
      const values = [];
      let value = 0,
        shift = 0;
      for (const ch of seg) {
        const digit = B64.indexOf(ch);
        if (digit < 0) throw Error(`Invalid source map character "${ch}"`);
        value += (digit & 31) << shift;
        if (digit & 32) shift += 5;
        else {
          values.push(value & 1 ? -(value >>> 1) : value >>> 1);
          value = 0;
          shift = 0;
        }
      }
      col += values[0];
      if (values.length >= 4) {
        source += values[1];
        origLine += values[2];
        _origCol += values[3];
        segments.push([col, source, origLine]);
      }
      if (values.length === 5) _name += values[4];
    }
    lines.push(segments);
  }
  return lines;
}
function sourceMapOf(entry) {
  if (entry.sourceMap) return entry.sourceMap;
  const ref = mapReference(entry.source ?? '');
  const inline = ref?.match(/^data:application\/json[^,]*?(;base64)?,(.*)$/);
  if (!inline) return null;
  return JSON.parse(inline[1] ? Buffer.from(inline[2], 'base64').toString('utf8') : decodeURIComponent(inline[2]));
}

/** Execution count per generated character, from V8 block coverage (inner ranges override outer ones). */
export function counts(entry) {
  const out = new Int32Array((entry.source ?? '').length);
  const ranges = (entry.functions ?? [])
    .flatMap((f) => f.ranges ?? [])
    .sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
  for (const r of ranges) out.fill(r.count, Math.max(0, r.startOffset), Math.min(out.length, r.endOffset));
  return out;
}

/**
 * Line coverage of the original files from browser coverage entries.
 * Returns { files: Map(repo path -> Map(line (1-based) -> hits)), unmatched: [source names], unmapped: [script urls] }.
 * The same script seen in several entries (several tests or pages) adds up per line, never as a second file.
 */
export function convert(entries, { rootDir, folders = ['src/'] }) {
  const files = new Map(),
    unmatched = new Set(),
    unmapped = new Set();
  const repoFiles = folders.flatMap((f) =>
    existsSync(join(rootDir, f))
      ? readdirSync(join(rootDir, f), { recursive: true }).map((n) => `${f}${String(n).split('\\').join('/')}`)
      : [],
  );
  // vendor code, bundler runtime and virtual modules: not project sources, and not a mismatch either
  const foreign = (clean, raw) =>
    /(^|\/)node_modules\//.test(clean) ||
    /^(?:webpack|\(webpack\))(?:\/|$)/.test(clean) ||
    /^(?:angular|vite|virtual|rollup|esbuild):|^<|^\0|^\x00/.test(raw) ||
    /^(?:webpack:\/\/\/?)?(?:webpack|\(webpack\))(?:\/|$)/.test(raw);
  const clean = (name, root) =>
    `${root ? (root.endsWith('/') ? root : `${root}/`) : ''}${name}`
      .replace(/^[a-z]+:\/\/\/?/i, '')
      .replace(/^(\.\.?\/)+/, '')
      .replace(/^\/+/, '')
      .replace(/\?.*$/, '');
  const match = (path) => {
    if (folders.some((f) => path.startsWith(f)) && existsSync(join(rootDir, path))) return path;
    // a path that names at least one folder may match the end of one file here, never a bare file name
    if (!path.includes('/')) return null;
    const found = repoFiles.filter((p) => p.endsWith(`/${path}`) || path.endsWith(`/${p}`));
    return found.length === 1 ? found[0] : null;
  };
  const decoded = new Map(); // a map decoded once however many runs carry it
  for (const entry of entries) {
    const map = sourceMapOf(entry);
    if (!map) {
      unmapped.add(entry.url);
      continue;
    }
    const hits = counts(entry),
      source = entry.source ?? '';
    const lineStarts = [0];
    for (let i = 0; i < source.length; i++) if (source[i] === '\n') lineStarts.push(i + 1);
    const names = (map.sources ?? []).map((s) => {
      const c = clean(s, map.sourceRoot);
      return foreign(c, s) ? null : match(c);
    });
    (map.sources ?? []).forEach((s, i) => {
      if (!names[i] && !foreign(clean(s, map.sourceRoot), s)) unmatched.add(s);
    });
    const key = createHash('sha1')
      .update(map.mappings ?? '')
      .digest('hex');
    if (!decoded.has(key)) decoded.set(key, decodeMappings(map.mappings ?? ''));
    decoded.get(key).forEach((segments, genLine) => {
      for (const [col, src, origLine] of segments) {
        const file = names[src];
        if (!file) continue;
        const offset = (lineStarts[genLine] ?? source.length) + col;
        const lines = files.get(file) ?? new Map();
        lines.set(origLine + 1, (lines.get(origLine + 1) ?? 0) + (hits[offset] ?? 0));
        files.set(file, lines);
      }
    });
  }
  return { files, unmatched: [...unmatched].sort(), unmapped: [...unmapped].sort() };
}

/** Line hits per repository file from LCOV DA records. */
export function lcovLines(text, rootDir) {
  const files = new Map(),
    roots = [rootDir, realpathSync(rootDir)];
  // the file's real path when it exists here: an LCOV written through a symlinked checkout names the same files
  const rel = (path) => {
    const abs = existsSync(path) ? realpathSync(path) : path;
    return (roots.map((r) => relative(r, abs)).find((x) => !x.startsWith('..')) ?? relative(rootDir, abs))
      .split('\\')
      .join('/');
  };
  let cur = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('SF:')) {
      cur = files.get(rel(resolve(rootDir, line.slice(3)))) ?? new Map();
      files.set(rel(resolve(rootDir, line.slice(3))), cur);
      continue;
    }
    const da = /^DA:(\d+),(\d+)/.exec(line);
    if (da && cur) cur.set(Number(da[1]), (cur.get(Number(da[1])) ?? 0) + Number(da[2]));
    if (line === 'end_of_record') cur = null;
  }
  return files;
}
/**
 * Unit and browser line coverage, each line counted once, covered when either ran it. For a file the unit LCOV has,
 * its executable lines are the lines (a source map also marks imports, decorators and type-only lines, which unit
 * coverage does not count); a file only the browser ran keeps the source map's lines.
 */
export function combine(unit, browser) {
  const out = new Map();
  for (const [file, lines] of unit) out.set(file, new Map(lines));
  for (const [file, lines] of browser) {
    const into = out.get(file),
      only = !unit.has(file);
    const target = into ?? new Map();
    for (const [line, hits] of lines) if (only || target.has(line)) target.set(line, (target.get(line) ?? 0) + hits);
    out.set(file, target);
  }
  return out;
}
/** Two line maps of the same kind (two browser runs) added up. */
const add = (a, b) => {
  for (const [file, lines] of b) {
    const into = a.get(file) ?? new Map();
    for (const [l, h] of lines) into.set(l, (into.get(l) ?? 0) + h);
    a.set(file, into);
  }
  return a;
};
const metric = (total, covered) => ({
  total,
  covered,
  skipped: 0,
  pct: total ? Math.round((10000 * covered) / total) / 100 : 100,
});
/** The json-summary (keys: absolute paths, as test runners write them) for line coverage per file. */
export function toSummary(files, rootDir, folders) {
  const out = {};
  for (const [file, lines] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    if (!folders.some((f) => file.startsWith(f))) continue;
    const total = lines.size,
      covered = [...lines.values()].filter((h) => h > 0).length;
    out[join(rootDir, file)] = {
      lines: metric(total, covered),
      statements: metric(total, covered),
      branches: metric(0, 0),
      functions: metric(0, 0),
    };
  }
  const sum = (k) =>
    metric(
      Object.values(out).reduce((n, m) => n + m[k].total, 0),
      Object.values(out).reduce((n, m) => n + m[k].covered, 0),
    );
  return {
    total: {
      lines: sum('lines'),
      statements: sum('statements'),
      branches: sum('branches'),
      functions: sum('functions'),
    },
    ...out,
  };
}

/** Reads the raw browser coverage (and unit LCOV), writes the configured summaries; returns what it did. */
export function build(rootDir, cfg) {
  const folders = cfg.folders;
  if (!Array.isArray(folders) || !folders.length)
    throw Error('Set coverage.folders (the source folders) for browser coverage');
  const raw = resolve(rootDir, cfg.browser?.raw ?? 'coverage/browser/');
  const rawFiles = existsSync(raw)
    ? readdirSync(raw)
        .filter((f) => f.endsWith('.json'))
        .sort()
    : [];
  if (!rawFiles.length)
    throw Error(
      `No browser coverage in ${relative(rootDir, raw) || '.'}: run the browser tests with the collector (stopBrowserCoverage) first`,
    );
  // one run file at a time, so memory holds one run, not the whole suite
  const browser = { files: new Map(), unmatched: new Set(), unmapped: new Set() };
  let scripts = 0;
  for (const f of rawFiles) {
    const data = JSON.parse(readFileSync(join(raw, f), 'utf8'));
    if (!Array.isArray(data)) throw Error(`${f}: expected a list of script coverage entries`);
    const r = convert(data, { rootDir, folders });
    add(browser.files, r.files);
    r.unmatched.forEach((s) => browser.unmatched.add(s));
    r.unmapped.forEach((s) => browser.unmapped.add(s));
    scripts += data.length;
  }
  const written = [];
  const out = (path, data) => {
    const p = resolve(rootDir, path);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, `${JSON.stringify(data, null, 1)}\n`);
    written.push(relative(rootDir, p));
    return data;
  };
  const browserSummary = out(
    cfg.browser?.summary ?? 'coverage/browser-summary.json',
    toSummary(browser.files, rootDir, folders),
  );
  let combinedSummary = null;
  if (cfg.combined) {
    const lcov = resolve(rootDir, cfg.lcov ?? 'coverage/lcov.info');
    if (!existsSync(lcov))
      throw Error(
        `Combined coverage needs the unit run's LCOV at ${relative(rootDir, lcov)} (DA line records): run the unit tests with the lcov reporter first`,
      );
    combinedSummary = out(
      cfg.combined.summary ?? 'coverage/combined-summary.json',
      toSummary(combine(lcovLines(readFileSync(lcov, 'utf8'), rootDir), browser.files), rootDir, folders),
    );
  }
  return {
    written,
    unmatched: [...browser.unmatched].sort(),
    unmapped: [...browser.unmapped].sort(),
    scripts,
    browser: browserSummary.total.lines,
    combined: combinedSummary?.total.lines,
  };
}

const direct = (() => {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1] ?? '');
  } catch {
    return false;
  }
})();
if (direct) {
  const root = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
  let stamp = {};
  try {
    stamp = JSON.parse(readFileSync(join(root, '.harness.json'), 'utf8'));
  } catch {
    /* defaults */
  }
  try {
    const r = build(root, stamp.coverage ?? {});
    console.log(
      `${r.written.join(', ')}: ${r.scripts} script entr${r.scripts === 1 ? 'y' : 'ies'}; browser lines ${r.browser.pct} %${r.combined ? `, combined lines ${r.combined.pct} %` : ''}.`,
    );
    if (r.unmatched.length)
      console.log(
        `! ${r.unmatched.length} source(s) in the source maps match no file under the coverage folders (left out): ${r.unmatched.slice(0, 10).join(', ')}`,
      );
    if (r.unmapped.length)
      console.log(
        `! ${r.unmapped.length} script(s) without a source map (left out): ${r.unmapped.slice(0, 10).join(', ')}`,
      );
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
