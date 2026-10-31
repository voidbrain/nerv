// Read-only reconciliation plan. No fetch, checkout, merge, configuration or project writes.
import {readFileSync, existsSync, realpathSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve, relative, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
export function preview(root, template, to) {
  root = realpathSync(root); template = realpathSync(template);
  const git = (...args) => execFileSync('git', ['--no-optional-locks', '-C', template, ...args], {encoding: 'utf8', stdio: ['ignore','pipe','pipe']}).trimEnd();
  const stamp = JSON.parse(readFileSync(resolve(root, '.harness.json'), 'utf8'));
  const tags = git('tag', '--list', 'v*', '--sort=-v:refname').split('\n').filter(t => /^v\d+\.\d+\.\d+$/.test(t));
  const tag = to ?? tags[0];
  if (!tags.includes(tag)) throw Error('Target must be an existing published-format release tag');
  const at = (ref, path) => { try {return execFileSync('git', ['--no-optional-locks', '-C', template, 'show', `${ref}:${path}`], {encoding:'utf8',stdio:['ignore','pipe','pipe']});} catch {return null;} };
  const safe = path => {
    if (typeof path !== 'string' || !path || isAbsolute(path) || path.split(/[\\/]/).includes('..')) throw Error('Invalid project path');
    const full = resolve(root, path);
    if (existsSync(full)) {
      const rel = relative(root, realpathSync(full));
      if (rel.startsWith('..') || isAbsolute(rel)) throw Error(`Project path escapes checkout: ${path}`);
    }
    return full;
  };
  const rows = [];
  for (const kind of ['copied', 'forked', 'adapted']) for (const [path, mapping] of Object.entries(stamp[kind] ?? {})) {
    const file = safe(path), here = existsSync(file) ? readFileSync(file,'utf8') : null;
    const sources = kind === 'forked' ? [mapping.from] : [mapping].flat();
    const base = `v${kind === 'forked' ? mapping.base : stamp.version}`;
    const comparisons = sources.map(source => {
      if (typeof source !== 'string' || !source || source.startsWith('-') || source.split(/[\\/]/).includes('..')) throw Error('Invalid template source');
      const before = at(base, source), after = at(tag, source);
      let action;
      if (after === null) action = 'source-missing-review';
      else if (here === null) action = 'missing-review';
      else if (kind === 'adapted') action = before === null ? 'base-unknown-review' : before === after ? 'upstream-unchanged' : 'manual-reconcile';
      else if (here === after) action = 'unchanged';
      else if (before === null) action = 'base-unknown-review';
      else if (before === after) action = 'local-change-review';
      else if (here === before) action = 'copy-update';
      else action = 'conflict-review';
      return {source, action};
    });
    rows.push({path, kind, comparisons, protectedRules: here?.split('\n').filter(line => /<!-- project -->|Project override/.test(line)) ?? [],
      preservation: kind === 'adapted' ? 'Keep all project content; markers are review aids, not a complete semantic inventory.' : 'Review local differences before any replacement.'});
  }
  return {schemaVersion:1, templateRelease:tag, releaseCommit:git('rev-parse', `${tag}^{commit}`), base:stamp.version,
    templateDirty:!!git('status','--porcelain'), rows,
    checks:['Verify remote tag/source online under APPLY before applying; this preview never fetches.', 'Resolve every manual/conflict/base-unknown/source-missing review; no automatic semantic rule verification.', 'Run owning project checks, copied-file parity, links and backlog/archive preservation.', 'Record evidence and actual friction; no project is modified by this preview.']};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), values = {};
    for (const arg of args) {
      const m = arg.match(/^--(template|to|json)(?:=(.+))?$/);
      if (!m || m[1] in values || (m[1] !== 'json' && !m[2]) || (m[1] === 'json' && m[2])) throw Error(`Invalid or duplicate argument: ${arg}`);
      values[m[1]] = m[2] ?? true;
    }
    const root = fileURLToPath(new URL('..',import.meta.url));
    const stamp = JSON.parse(readFileSync(resolve(root,'.harness.json'),'utf8'));
    const template = String(values.template ?? process.env.HARNESS_HOME ?? stamp.template?.path ?? '').replace(/^~(?=\/|$)/,homedir());
    if (!template) throw Error('Provide --template=PATH or HARNESS_HOME');
    const result = preview(root, template, values.to);
    if (values.json) console.log(JSON.stringify(result,null,2));
    else {
      console.log(`READ ONLY: ${result.base} → ${result.templateRelease} (${result.releaseCommit}); template dirty: ${result.templateDirty}`);
      for (const row of result.rows) {
        console.log(`${row.path} [${row.kind}]: ${row.comparisons.map(c=>`${c.source}: ${c.action}`).join('; ')}`);
        for (const rule of row.protectedRules) console.log(`  KEEP/REVIEW: ${rule}`);
      }
      for (const check of result.checks) console.log(`Check: ${check}`);
    }
  } catch(e) {console.error(e.message); process.exitCode=1;}
}
