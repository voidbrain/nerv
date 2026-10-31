// Is this project behind the harness template it was applied from? Compares .harness.json with the template's release
// tags and says, per file, what to reconcile. Never fails: run by check-freshness at session start; --github prints
// GitHub warnings. The template is a local clone (HARNESS_HOME, else template.path in .harness.json; the Angular CI
// workflow clones it); without one the check is skipped. --merge three-way merges every forked file the template
// changed since its base, writes the result (with conflict markers if any) and moves the base of the clean ones forward.
import { existsSync, mkdtempSync, readFileSync, realpathSync, lstatSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const github = process.argv.includes('--github');
const merge = process.argv.includes('--merge');
const root = fileURLToPath(new URL('..', import.meta.url));
const notes = [];
const warn = (text) => notes.push(text);
const done = (ok) => {
  if (!notes.length && ok) console.log(ok);
  for (const n of notes) console.log(github ? `::warning title=Harness template::${n}` : `! ${n}`);
  process.exit(0);
};

const stampFile = join(root, '.harness.json');
if (!existsSync(stampFile)) done('No .harness.json: this project was not applied from the harness template.');
let stamp;
try { stamp = JSON.parse(readFileSync(stampFile, 'utf8')); }
catch (e) { warn(`.harness.json is not valid JSON (${e.message}): fix it; template check skipped.`); done(); }
// Preflight all mapped destinations before reading or merging any of them. Config is data,
// not authorization to touch a sibling checkout or Git metadata.
const safe = (path) => {
  if (typeof path !== 'string' || !path || isAbsolute(path) || path.split(/[\\/]/).some(p => p === '..' || p.toLowerCase() === '.git')) throw Error('Unsafe project path');
  const full = resolve(root, path);
  let ancestor = full;
  while (!existsSync(ancestor) && ancestor !== resolve(root)) {
    try { if (lstatSync(ancestor).isSymbolicLink()) throw Error('Unsafe project path: dangling symlink'); } catch(e) { if (e.code !== 'ENOENT') throw e; }
    ancestor = dirname(ancestor);
  }
  const rel = relative(realpathSync(root), realpathSync(ancestor));
  if (rel === '..' || /^\.\.[/\\]/.test(rel) || isAbsolute(rel) || rel.split(/[\\/]/).some(p => p.toLowerCase() === '.git')) throw Error('Unsafe project path: escapes checkout');
  return full;
};
try {
  for (const path of ['.harness.json', ...Object.keys(stamp.copied ?? {}), ...Object.keys(stamp.forked ?? {}), ...Object.keys(stamp.adapted ?? {})]) safe(path);
} catch(e) { warn(e.message + '; no project files merged.'); done(); }
const home = (process.env.HARNESS_HOME ?? stamp.template?.path ?? '~/Projects/project-harness').replace(/^~(?=\/|$)/, homedir());
if (!existsSync(join(home, 'VERSION'))) {
  // a CI run without a clone (no clone step, or the clone failed) skips quietly; locally a missing clone is something to fix
  const text = `Harness template not found at ${home}${stamp.template?.repo ? `: clone it (git clone ${stamp.template.repo} ${home})` : ''}; template check skipped.`;
  if (process.env.CI) console.log(text); else warn(text);
  done();
}

const git = (...args) => { try { return execFileSync('git', ['-C', home, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; } };
// Online first: compare against the template's published releases, never only a local clone's. A clone that cannot
// reach its remote, is behind it or has local edits is reported, because applying or changing it would use stale files.
if (git('remote', 'get-url', 'origin')) {
  if (git('fetch', '--tags', '--prune', '--quiet', 'origin') === null)
    warn(`Could not reach the template's remote from ${home}: releases below are the local ones and may be stale.`);
  const [ahead, behindBy] = (git('rev-list', '--left-right', '--count', 'HEAD...@{upstream}') ?? '0 0').trim().split(/\s+/).map(Number);
  if (behindBy) warn(`The template clone at ${home} is ${behindBy} commit(s) behind its remote: git -C ${home} pull --ff-only --tags before applying or changing it.`);
  if (ahead) warn(`The template clone at ${home} has ${ahead} unpushed commit(s): push them (or open their PR) before applying them to a project.`);
  if (git('status', '--porcelain')?.trim()) warn(`The template clone at ${home} has uncommitted changes: projects are checked against release tags only.`);
} else warn(`The template clone at ${home} has no remote${stamp.template?.repo ? ` (expected ${stamp.template.repo})` : ''}: releases cannot be checked online.`);
const tags = (git('tag', '--list', 'v*', '--sort=-v:refname') ?? '').split('\n').filter(Boolean).map((t) => t.slice(1));
const latest = tags[0];
const base = stamp.version;
if (!latest) { warn(`The template at ${home} has no release tags (vX.Y.Z): tag a release before checking projects against it.`); done(); }
if (!tags.includes(base)) { warn(`.harness.json names version ${base}, which the template at ${home} has no tag for (latest v${latest}): set it to the release this project was last reconciled with, or tag the release if it is pending.`); done(); }

const at = (version, path) => git('show', `v${version}:${path}`);
const mine = (path) => (existsSync(safe(path)) ? readFileSync(safe(path), 'utf8') : null);
const list = (value) => (Array.isArray(value) ? value : [value]);
const diff = (path) => `git -C ${home} diff v${base} v${latest} -- ${path}`;
const behind = tags.indexOf(base) > 0;

// Copied files are byte-identical to the template; project settings live in .harness.json, not in the files.
for (const [path, source] of Object.entries(stamp.copied ?? {})) {
  const was = at(base, source), now = at(latest, source), here = mine(path);
  if (here === null) warn(`${path} is missing: copy ${source} from template v${latest}.`);
  else if (here === now) continue;
  else if (here === was) warn(`${path}: template v${latest} updated it; copy ${source} from the template (${diff(source)}).`);
  else if (was === now) warn(`${path} differs from template v${base}: keep project settings in .harness.json; a generic improvement goes back into the template; a change only this project needs is a fork (APPLY.md, "Project overrides").`);
  else warn(`${path}: CONFLICT, changed here and in the template since v${base}; merge by hand (${diff(source)}).`);
}

// Forked files are copied files the project changed on purpose. The template's file at the fork's base is the common
// ancestor: a template change since then is merged three-way, so both sides' edits survive and only overlaps conflict.
const threeWay = (here, was, now) => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-merge-'));
  const files = ['here', 'was', 'now'].map((name, i) => (writeFileSync(join(dir, name), [here, was, now][i]), join(dir, name)));
  try { return { text: execFileSync('git', ['merge-file', '-p', '-L', 'project', '-L', 'base', '-L', 'template', ...files], { encoding: 'utf8' }), conflicts: 0 }; }
  catch (e) { return { text: String(e.stdout), conflicts: e.status }; }
  finally { rmSync(dir, { recursive: true, force: true }); }
};
let rebased = false;
for (const [path, fork] of Object.entries(stamp.forked ?? {})) {
  const here = mine(path), was = tags.includes(fork.base) ? at(fork.base, fork.from) : null, now = at(latest, fork.from);
  if (!fork.why) warn(`${path}: forked without a reason; add "why" to its entry in .harness.json.`);
  if (here === null) { warn(`${path} is missing: it is forked from ${fork.from}; restore it or remove the fork.`); continue; }
  if (was === null) { warn(`${path}: forked from ${fork.from} at v${fork.base}, but the template has no such tag or no such file in it; set "base" to the release the fork was made from.`); continue; }
  if (now === null) { warn(`${path}: ${fork.from} was removed from the template in v${latest}; see its CHANGELOG and drop or keep the fork.`); continue; }
  if (was === now) continue;
  if (here === now) { warn(`${path}: now identical to template v${latest}; move it back from "forked" to "copied".`); continue; }
  const result = threeWay(here, was, now);
  const how = `git -C ${home} diff v${fork.base} v${latest} -- ${fork.from}`;
  if (merge) {
    writeFileSync(safe(path), result.text);
    if (result.conflicts) warn(`${path}: merged template v${latest} with ${result.conflicts} conflict(s); resolve the markers, then set its "base" to "${latest}".`);
    else { fork.base = latest; rebased = true; console.log(`${path}: merged template v${latest} cleanly; its fork base is now ${latest}.`); }
  } else if (result.conflicts) warn(`${path}: forked, and template v${latest} changed it: CONFLICT in ${result.conflicts} place(s); run node tools/check-harness.mjs --merge and resolve the markers (${how}).`);
  else warn(`${path}: forked, and template v${latest} changed it; the merge is clean: run node tools/check-harness.mjs --merge (${how}).`);
}
if (rebased) writeFileSync(stampFile, `${JSON.stringify(stamp, null, 2)}\n`);

// Adapted files were rewritten for the project: when their template source changes, reconcile the change by hand.
if (behind) {
  for (const [path, sources] of Object.entries(stamp.adapted ?? {}))
    for (const source of list(sources))
      if (at(base, source) === null && at(latest, source) !== null) warn(`${path}: ${source} is new in the template since v${base}; adopt it if it fits (git -C ${home} show v${latest}:${source}).`);
      else if (at(base, source) !== at(latest, source)) {
        // project overrides of a template rule are marked in the file; a reconcile keeps them
        const overrides = (mine(path) ?? '').split('\n').filter((line) => /^> Project override\b/.test(line)).length;
        warn(`${path}: its template source ${source} changed since v${base}; reconcile by hand${overrides ? `, keeping its ${overrides} project override(s)` : ''} (${diff(source)}).`);
      }
  const log = git('log', '--format=  %s', `v${base}..v${latest}`)?.trim();
  warn(`Harness template v${latest} is out (this project is on v${base}). See CHANGELOG.md in the template${log ? `; changes:\n${log}` : ''}\nReconcile the files above (APPLY.md, "Reconciling"), then set "version" in .harness.json to "${latest}".`);
}
const forks = Object.keys(stamp.forked ?? {}).length;
done(`Harness: on template v${latest}; copied files match it${forks ? `, ${forks} fork(s) merged up to date` : ''}.`);
