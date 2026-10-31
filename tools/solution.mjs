// Optional coordinator dashboard. Reads component evidence; never changes component repositories or calculates aggregate progress.
import {existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync} from 'node:fs';
import {dirname, resolve, relative, isAbsolute} from 'node:path';
import {execFileSync} from 'node:child_process';

const root = process.cwd(), args = process.argv.slice(2), mode = args.shift() ?? 'check';
const remote = args.includes('--remote'), write = args.includes('--write');
const option = key => args.find(x => x.startsWith(`--${key}=`))?.slice(key.length + 3);
const fail = message => { throw new Error(message); };
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const text = value => String(value ?? '').replaceAll('|', '\\|').replace(/[\r\n]+/g, ' ').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const cells = line => line.split(/(?<!\\)\|/).slice(1, -1).map(x => x.trim());
const inside = (base, path) => { const rel = relative(base, path); return !isAbsolute(rel) && rel !== '..' && !/^\.\.[/\\]/.test(rel); };
const repositoryPath = path => {
  if (typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\\') || path.split('/').includes('..')) fail('Use a repository-relative file path without traversal');
};
const safeFile = (base, path) => {
  repositoryPath(path);
  const target = resolve(base, path);
  let ancestor = target;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  if (!inside(realpathSync(base), realpathSync(ancestor))) fail('File path escapes its repository through a symlink');
  return target;
};
const git = (cwd, ...params) => { try { const value = execFileSync('git', ['-C', cwd, ...params], {encoding:'utf8', stdio:['ignore','pipe','ignore']}); return params[0] === 'show' ? value : value.trim(); } catch { return null; } };
function records(markdown, label, file, archived = false) {
  const out = new Map(), blocks = [...markdown.matchAll(/^### ([BF]-\d+)\n([\s\S]*?)(?=^### [BF]-\d+\n|^## |$(?![\s\S]))/gm)];
  for (const b of blocks) {
    const id = b[1], block = b[2];
    if (!archived && out.has(id)) fail(`${label}: duplicate record ${id}`);
    const lines = block.split('\n');
    const summaries = lines.filter(l => l.startsWith('|')).map(cells).filter(c => ['🔴','🟠','🟡','🟢','🟣','🔵'].includes(c[0]));
    if (summaries.length !== 1) fail(`${label}:${id}: unsupported multiple/missing summary rows`);
    const row = summaries[0];
    if (!row || row.length !== 5) fail(`${label}:${id}: unsupported summary (run the owning repository's backlog check)`);
    const legacy = row[1] === id;
    const status = row[legacy ? 3 : 2];
    if (!['Open','Investigate','Implemented','Verified','Blocked','Closed'].includes(status)) fail(`${label}:${id}: unknown status`);
    const title = legacy ? row[4] : lines.find(l => /^\*\*[^\n]+\*\*$/.test(l))?.slice(2,-2);
    if (!title) fail(`${label}:${id}: missing title`);
    const field = name => lines.filter(l => l.startsWith('|')).map(cells).find(c => c[0] === name)?.[1] ?? '—';
    const components = field('Components');
    const refs = components === '—' ? [] : components.split(',').map(v => v.trim());
    if (refs.some(v => !/^[a-z][a-z0-9-]*:[BF]-\d+$/.test(v)) || new Set(refs).size !== refs.length) fail(`${label}:${id}: Components must contain unique repository-qualified IDs`);
    out.set(id,{id,file,archived,title,status,human:block.match(/Human action required: (Yes|No)/)?.[1] ?? 'Unknown', effort:legacy?'Unknown':row[3],complete:legacy?'Unknown':row[4], reviewed:field('Reviewed'), verification:field('Verification'), refs});
  }
  // An unreadable legacy table must not silently become an empty successful dashboard.
  for (const match of markdown.matchAll(/^\|.*\|\s*[BF]-\d+\s*\|.*$/gm)) {
    if (!blocks.some(b => match.index >= b.index && match.index < b.index + b[0].length)) fail(`${label}: unheaded IDs have no supported record headings`);
  }
  return out;
}
async function request(url) {
  const response = await fetch(url,{headers:{Accept:'application/vnd.github+json',...(process.env.GH_TOKEN ? {Authorization:`Bearer ${process.env.GH_TOKEN}`} : {})},signal:AbortSignal.timeout(15000)});
  if (!response.ok) fail(`GitHub returned HTTP ${response.status}`);
  return response.json();
}
try {
  if (!['check','dashboard'].includes(mode) || (write && mode !== 'dashboard')) fail('Usage: solution.mjs check|dashboard [--write] [--remote] [--manifest=PATH]');
  const flags = new Set();
  for (const arg of args) {
    const match = arg.match(/^--(remote|offline|write|manifest)(?:=(.+))?$/), key = match?.[1];
    if (!match || flags.has(key) || (key === 'manifest' ? match[2] === undefined : match[2] !== undefined)) fail(`Unknown, duplicate or malformed option: ${arg}`);
    flags.add(key);
  }
  if (remote && args.includes('--offline')) fail('--remote cannot be used offline');
  const stamp = existsSync(resolve(root,'.harness.json')) ? read(resolve(root,'.harness.json')) : {};
  const setting = stamp.solution;
  if (setting !== undefined && (!setting || typeof setting !== 'object' || !['coordinator','component'].includes(setting.role) || typeof setting.manifest !== 'string')) fail('solution needs a coordinator/component role and manifest path');
  const manifest = option('manifest') ?? setting?.manifest;
  if (stamp.stacks?.includes('solution') && !manifest) fail('Solution profile requires a manifest');
  if (!manifest) { console.log('No solution profile configured; ordinary repository behaviour is unchanged.'); process.exit(0); }
  const manifestPath = resolve(root,manifest);
  if (!existsSync(manifestPath)) fail('Solution manifest unavailable. Component work remains independent; run coordinator checks where the manifest is available.');
  const home = dirname(manifestPath), s = read(manifestPath);
  if (s.schemaVersion !== 1 || typeof s.name !== 'string' || !s.name.trim()) fail('Solution needs schemaVersion 1 and a name');
  if (!Array.isArray(s.repositories)) fail('Solution repositories must be an array');
  safeFile(home,s.dashboard ?? 'docs/SOLUTION-DASHBOARD.md');
  const all = [{id:'solution',repository:s.repository,path:'.',backlog:s.backlog ?? 'docs/BACKLOG.md',ref:'working checkout'},...s.repositories];
  const seen = new Set();
  for (const repo of all) {
    if (!repo || !/^[a-z][a-z0-9-]*$/.test(repo.id) || seen.has(repo.id)) fail(`Invalid/duplicate repository ID: ${repo?.id}`);
    seen.add(repo.id);
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo.repository ?? '')) fail(`${repo.id}: repository must be owner/name`);
    if (typeof repo.path !== 'string' || !repo.path.trim()) fail(`${repo.id}: explicit local checkout path required`);
    if (typeof repo.ref !== 'string' || !repo.ref.trim()) fail(`${repo.id}: explicit branch/tag/commit ref required`);
    if (repo.archives !== undefined && (!Array.isArray(repo.archives) || repo.archives.some(p=>typeof p !== 'string'))) fail(`${repo.id}: archives must be a list of file paths`);
    for (const path of [repo.backlog ?? 'docs/BACKLOG.md', ...(repo.archives ?? [])]) repositoryPath(path); // validate shape, then resolve filesystem paths in the actual owning checkout
  }
  if (new Set(all.map(r => r.repository.toLowerCase())).size !== all.length) fail('Each repository has one unique ID; do not alias the same repository twice');
  const results = [], problems = [];
  for (const repo of all) {
    const base = resolve(home,repo.path), backlog = repo.backlog ?? 'docs/BACKLOG.md';
    try {
      let revision, dirty = false;
      const loaded = new Map();
      const paths = [...(repo.archives ?? []), backlog];
      if (remote && repo.id !== 'solution') {
        // Resolve the requested ref once, then read every file at that immutable commit.
        const commit = await request(`https://api.github.com/repos/${repo.repository}/commits/${encodeURIComponent(repo.ref)}`);
        if (!/^[a-f0-9]{40}$/.test(commit.sha ?? '')) fail('Unsupported commit response');
        revision = commit.sha;
        for (const path of paths) {
          const file = await request(`https://api.github.com/repos/${repo.repository}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${revision}`);
          if (file.encoding !== 'base64' || typeof file.content !== 'string') fail('Unsupported backlog response');
          for (const [id,record] of records(Buffer.from(file.content,'base64').toString('utf8'),repo.id,path,path !== backlog)) loaded.set(id,record);
        }
      } else {
        if (!existsSync(base)) fail('checkout unavailable');
        const origin = git(base,'remote','get-url','origin');
        const canonical = origin?.replace(/\.git$/,'').match(/^(?:https?:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+\/[^/]+)$/)?.[1];
        if (!canonical || canonical.toLowerCase() !== repo.repository.toLowerCase()) fail('checkout origin does not match the declared repository');
        if (resolve(git(base,'rev-parse','--show-toplevel') ?? '') !== base) fail('path must name the repository root');
        revision = git(base,'rev-parse','HEAD');
        dirty = Boolean(git(base,'status','--porcelain'));
        const expected = repo.id === 'solution' ? revision : git(base,'rev-parse',repo.ref);
        if (!expected || expected !== revision) fail('checkout HEAD differs from the declared ref; refresh/check out the requested ref explicitly');
        for (const path of paths) {
          const file = safeFile(base,path);
          const content = dirty ? readFileSync(file,'utf8') : git(base,'show',`${revision}:${path}`);
          if (content === null) fail(`Committed source unavailable: ${path}`);
          for (const [id,record] of records(content,repo.id,path,path !== backlog)) loaded.set(id,record);
        }
      }
      results.push({...repo,records:loaded,revision,dirty,available:true});
    } catch (e) { problems.push(`${repo.id}: ${e.message}`); results.push({...repo,records:new Map(),available:false}); }
  }
  const coordinator = results[0];
  for (const record of coordinator.records.values()) for (const ref of record.refs) {
    const [owner,id] = ref.split(':');
    const repo = results.find(r => r.id === owner);
    if (!repo || owner === 'solution') problems.push(`solution:${record.id}: unknown component ${owner}`);
    else if (repo.available && !repo.records.has(id)) problems.push(`solution:${record.id}: missing ${ref} (closed/archived? reconcile the link with the owning repository)`);
  }
  const linked = new Set([...coordinator.records.values()].flatMap(r => r.refs));
  const recordLink = (r,b) => r.dirty
    ? relative(dirname(resolve(home,s.dashboard ?? 'docs/SOLUTION-DASHBOARD.md')), resolve(home,r.path,b.file)).split('/').map(encodeURIComponent).join('/') + `#${b.id.toLowerCase()}`
    : `https://github.com/${r.repository}/blob/${r.revision}/${b.file}#${b.id.toLowerCase()}`;
  const snapshot = new Date().toISOString();
  const output = ['<!-- generated: project-harness solution dashboard; edit owning backlogs, not this file -->',`# ${text(s.name)} dashboard`,'',`Snapshot: ${snapshot}. Read-only aggregation; no combined completion percentage. Solution integration status is independent of component status.`,'', '| Source | Revision | Snapshot state |','|---|---|---|'];
  for (const r of results) output.push(`| ${text(r.id)} | ${r.available ? `[${r.revision.slice(0,12)}](https://github.com/${r.repository}/commit/${r.revision})` : 'Unknown'} | ${r.available ? `${r.dirty ? 'Local changes — not a committed snapshot' : 'Committed snapshot'}; requested ${text(r.ref)}; ${remote && r.id !== 'solution' ? 'GitHub' : 'local checkout, not fetched'}` : 'Unavailable — status unknown'} |`);
  output.push('','## Integration outcomes','', '| Record | Outcome | Status | Human action | Effort | Complete | Component links |','|---|---|---|---|---|---|---|');
  for (const b of coordinator.records.values()) output.push(`| [solution:${b.id}](${recordLink(coordinator,b)}) | ${text(b.title)} | ${text(b.status)} | ${text(b.human)} | ${text(b.effort)} | ${text(b.complete)} | ${text(b.refs.join(', ') || '—')} |`);
  output.push('','## Component work','', '| Record | Item | Status | Human action | Effort | Complete | Reviewed |','|---|---|---|---|---|---|---|');
  for (const r of results.slice(1)) {
    if (!r.available) output.push(`| ${text(r.id)} | Source unavailable | Unknown | Unknown | Unknown | Unknown | Unknown |`);
    for (const b of r.records.values()) if (!b.archived || linked.has(`${r.id}:${b.id}`)) output.push(`| [${r.id}:${b.id}](${recordLink(r,b)}) | ${text(b.title)} | ${text(b.status)} | ${text(b.human)} | ${text(b.effort)} | ${text(b.complete)} | ${text(b.reviewed)} |`);
  }
  output.push('','## Source and link problems','',...(problems.length ? problems.map(p => `- ${text(p)}`) : ['None detected. This does not verify semantic ownership, integration behaviour or real-device acceptance.']),'');
  if (mode === 'dashboard') {
    const content = output.join('\n');
    if (write) {
      if (setting?.role === 'component' || resolve(root) !== resolve(home)) fail('Only the coordinator may write its generated dashboard');
      const dest = safeFile(home,s.dashboard ?? 'docs/SOLUTION-DASHBOARD.md');
      const protectedSource = all.some(r => [r.backlog ?? 'docs/BACKLOG.md', ...(r.archives ?? [])].some(p => resolve(home,r.path,p) === dest));
      const componentRoot = all.slice(1).some(r => {
        const base = resolve(home,r.path);
        return inside(base,dest) || (existsSync(base) && inside(realpathSync(base),realpathSync((() => { let p = dest; while (!existsSync(p)) p = dirname(p); return p; })())));
      });
      if (inside(resolve(home,'.git'),dest) || dest === resolve(manifestPath) || protectedSource || componentRoot) fail('Dashboard must not overwrite configuration, an owning backlog/archive or any component checkout');
      if (existsSync(dest) && !readFileSync(dest,'utf8').startsWith('<!-- generated: project-harness solution dashboard;')) fail('Refusing to replace a non-generated file');
      mkdirSync(dirname(dest),{recursive:true}); writeFileSync(dest,content); console.log(`Wrote ${relative(home,dest)} (${snapshot}); ${problems.length} source/link problem(s).`);
    } else console.log(content);
  } else console.log(`Solution ${s.name}: ${all.length} repository sources; ${problems.length} source/link problem(s).`);
  if (problems.length) { problems.forEach(p => console.error(p)); process.exitCode = 1; }
} catch (e) { console.error(e.message); process.exitCode = 1; }
