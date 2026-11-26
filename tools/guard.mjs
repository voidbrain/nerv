#!/usr/bin/env node
// Guards for the rules an agent must never break without asking (AGENTS, "What the agent does on its own, and what
// it asks first"; BACKLOG-RULES, "Closure and archives"). The rules live there; this script only enforces them and
// cites them. It depends on git and Node only, so plain git, any agent and Claude Code get the same refusals.
//   node tools/guard.mjs install    opt-in: install it as the git pre-push hook (never replaces another hook)
//   node tools/guard.mjs status     is the hook installed
//   node tools/guard.mjs pre-push <remote>
//       the hook itself: reads git's "<local ref> <local sha> <remote ref> <remote sha>" lines and refuses a push to the
//       default branch, a force-push (a remote branch rewound or replaced), a published tag moved or deleted, and a
//       pushed branch whose archives lost or changed a line that was on the default branch where the branch left it.
//       Deleting another branch is allowed: merged branches are deleted without asking.
//   node tools/guard.mjs claude
//       optional Claude Code PreToolUse adapter: reads the hook's JSON on stdin and exits 2 (refused, reason on
//       stderr) for a git push to the default branch or a forced one, and for an Edit, MultiEdit or Write that removes
//       or changes a line of an archive. It reads commands, not a shell: the pre-push hook is the full check.
// A refusal is an "ask first" rule, not a ban: once the owner has said yes to that one operation, run it with
// HARNESS_GUARD_ALLOW naming the rule (default-branch, force-push, archive), e.g. HARNESS_GUARD_ALLOW=force-push.
// Settings: .harness.json "defaultBranch" when the remote's default cannot be read.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RULES = {
  'default-branch':
    'never push to the default branch: open every change as a PR against it (AGENTS, "Checks before you finish")',
  'force-push':
    'rewriting published history, force-pushing or moving a published tag is asked first (AGENTS, "What the agent does on its own, and what it asks first")',
  archive:
    'archives only grow: never change or remove a line already on the default branch; add a dated correction instead (BACKLOG-RULES, "Closure and archives")',
};
const ZERO = /^0+$/;
const MARK = 'harness guard: node tools/guard.mjs pre-push';
// a pre-push hook runs the guard: the one install writes, or a line added by hand to another hook
export const isGuardHook = (text) => /tools\/guard\.mjs"?\s+pre-push\b/.test(text);

export function allowed(rule, env = process.env) {
  return (env.HARNESS_GUARD_ALLOW ?? '').split(/[\s,]+/).includes(rule);
}
const refusal = (rule, detail) => ({
  rule,
  message: `Refused: ${detail}. Rule: ${RULES[rule]}. If the owner approved this operation, rerun it with HARNESS_GUARD_ALLOW=${rule}.`,
});

function gitIn(root) {
  return (...args) => {
    try {
      return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return null;
    }
  };
}
/** The default branch: .harness.json "defaultBranch", else the remote's HEAD, else main. */
export function defaultBranch(root, remote = 'origin') {
  const git = gitIn(root);
  let stamp = {};
  try {
    stamp = JSON.parse(readFileSync(resolve(root, '.harness.json'), 'utf8'));
  } catch {
    /* no stamp: defaults */
  }
  return (
    stamp.defaultBranch ??
    git('symbolic-ref', '--short', `refs/remotes/${remote}/HEAD`)
      ?.trim()
      .slice(remote.length + 1) ??
    'main'
  );
}
// the remote git pushes to, by name; a push to a bare URL is compared with origin
const remoteName = (root, name) => (name && gitIn(root)('remote')?.split('\n').includes(name) ? name : 'origin');

const isArchive = (path) => /^docs\/archive\/[^/]+\.md$/.test(path) && !path.endsWith('/README.md');
// Lines that count as history: not blank, not a file or section heading (those may change when a record moves), and
// not inside a generated archive-recap block (archive-recap.mjs rewrites it; check-backlog validates it).
export function historyLines(text) {
  const out = [];
  let recap = false;
  for (const line of text.split('\n')) {
    if (line.includes('<!-- archive-recap:start -->')) {
      recap = true;
      continue;
    }
    if (line.includes('<!-- archive-recap:end -->')) {
      recap = false;
      continue;
    }
    if (!recap && line.trim() && !/^#{1,2} /.test(line)) out.push(line);
  }
  return out;
}
/** Lines of `before` (a multiset) missing from `after`: what an edit removed or changed. */
export function lostLines(before, after) {
  const have = new Map();
  for (const line of after) have.set(line, (have.get(line) ?? 0) + 1);
  return before.filter((line) => {
    const n = have.get(line) ?? 0;
    if (n) have.set(line, n - 1);
    return !n;
  });
}

/** The refusals for one push, from git's pre-push lines; `remote` is the name git passes the hook. */
export function checkPush(root, lines, env = process.env, remote = 'origin') {
  remote = remoteName(root, remote);
  const git = gitIn(root),
    branch = defaultBranch(root, remote),
    found = [],
    seen = new Map();
  const archives = (rev) => {
    if (!seen.has(rev))
      seen.set(
        rev,
        (git('ls-tree', '--name-only', rev, 'docs/archive/')?.split('\n').filter(isArchive) ?? []).flatMap((f) =>
          historyLines(git('show', `${rev}:${f}`) ?? ''),
        ),
      );
    return seen.get(rev);
  };
  for (const line of lines.filter((l) => l.trim())) {
    const [, localSha, remoteRef, remoteSha] = line.trim().split(/\s+/);
    if (!remoteRef) continue;
    if (remoteRef === `refs/heads/${branch}` && !allowed('default-branch', env))
      found.push(refusal('default-branch', `${ZERO.test(localSha) ? 'deleting' : 'pushing to'} ${branch}`));
    // a published tag moved or deleted
    if (
      remoteRef.startsWith('refs/tags/') &&
      !ZERO.test(remoteSha) &&
      localSha !== remoteSha &&
      !allowed('force-push', env)
    )
      found.push(
        refusal(
          'force-push',
          `${ZERO.test(localSha) ? 'deleting' : 'moving'} the published tag ${remoteRef.slice(10)}`,
        ),
      );
    if (ZERO.test(localSha) || !remoteRef.startsWith('refs/heads/')) continue; // deleting a branch other than the default one (merged branches go on their own)
    // the remote commit is not in what is pushed: a rewrite (an unknown commit counts too: git only lets that through forced)
    if (
      !ZERO.test(remoteSha) &&
      !allowed('force-push', env) &&
      git('merge-base', '--is-ancestor', remoteSha, localSha) === null
    )
      found.push(refusal('force-push', `rewriting ${remoteRef.slice(11)} on the remote`));
    // what the archives held where this branch left the default branch must all still be there; lines the default
    // branch gained since are not this branch's to keep
    const base = git('merge-base', localSha, `${remote}/${branch}`)?.trim() || `${remote}/${branch}`;
    if (base === localSha) continue; // nothing new on it
    const before = archives(base);
    if (before.length && !allowed('archive', env)) {
      const lost = lostLines(before, archives(localSha));
      if (lost.length)
        found.push(
          refusal(
            'archive',
            `${remoteRef.replace('refs/heads/', '')} drops or changes ${lost.length} archive line(s) already on ${branch}, first "${lost[0].slice(0, 80)}"`,
          ),
        );
    }
  }
  return found;
}

// --------------------------------------------------------------------------------------------- Claude Code adapter

// Shell words of each simple command, split on separators; a quoted word that holds a command (bash -c "…", eval '…')
// is split again. Enough to see a git push and its arguments, not a shell parser: the pre-push hook is the full check.
const words = (command, depth = 0) =>
  command.split(/\s*(?:&&|\|\||;|\||\n)\s*/).flatMap((part) => {
    const w = part.match(/"[^"]*"|'[^']*'|\S+/g)?.map((x) => x.replace(/^["']|["']$/g, '')) ?? [];
    const inner = w.filter((x, i) => /\s/.test(x) && (w[i - 1] === '-c' || w[i - 1] === 'eval'));
    return [w, ...(depth < 2 ? inner.flatMap((x) => words(x, depth + 1)) : [])];
  });

// a path relative to the repository, compared through real paths (a symlinked checkout, /var and /private/var on macOS)
const real = (path) => {
  let p = path,
    rest = [];
  while (!existsSync(p) && dirname(p) !== p) {
    rest.unshift(p.slice(dirname(p).length + 1));
    p = dirname(p);
  }
  return resolve(realpathSync(p), ...rest);
};
const inside = (root, path) => relative(real(root), real(path)).split('\\').join('/');

/** The refusals for one Claude Code tool call (PreToolUse input: { tool_name, tool_input, cwd }). */
export function checkToolCall(root, call, env = process.env) {
  const input = call.tool_input ?? {},
    found = [];
  if (call.tool_name === 'Bash' && typeof input.command === 'string') {
    const branch = defaultBranch(root),
      cwd = call.cwd ?? root;
    for (const w of words(input.command)) {
      const at = w.findIndex((x, i) => x === 'push' && w.slice(0, i).includes('git'));
      if (at < 0) continue;
      const args = w.slice(at + 1),
        flags = args.filter((a) => a.startsWith('-'));
      // the first word is the remote unless --repo names it; no refspec or HEAD pushes the current branch
      const positional = args.filter((a) => !a.startsWith('-')),
        named = flags.some((f) => f.startsWith('--repo'));
      let refs = named ? positional : positional.slice(1);
      const current = () => gitIn(cwd)('rev-parse', '--abbrev-ref', 'HEAD')?.trim();
      if (!refs.length && !flags.some((f) => /^--(all|tags|mirror|delete)$|^-d$/.test(f))) refs = [current() ?? ''];
      refs = refs.map((r) =>
        r.replace(/^\+/, '').split(':')[0] === 'HEAD' && !r.includes(':') ? r.replace('HEAD', current() ?? 'HEAD') : r,
      );
      const forced =
        flags.some(
          (f) => /^--(force|force-with-lease|force-if-includes|mirror)(=|$)/.test(f) || /^-[a-zA-Z]*f/.test(f),
        ) || refs.some((r) => r.startsWith('+'));
      if (forced && !allowed('force-push', env)) found.push(refusal('force-push', `\`${w.join(' ')}\``));
      const target = refs.map((r) =>
        r
          .replace(/^\+/, '')
          .split(':')
          .at(-1)
          .replace(/^refs\/heads\//, ''),
      );
      if (target.includes(branch) && !allowed('default-branch', env))
        found.push(refusal('default-branch', `\`${w.join(' ')}\``));
    }
  }
  const path = typeof input.file_path === 'string' ? inside(root, resolve(call.cwd ?? root, input.file_path)) : '';
  if (isArchive(path) && !allowed('archive', env)) {
    const current = existsSync(resolve(root, path)) ? readFileSync(resolve(root, path), 'utf8') : '';
    let lost = [];
    if (call.tool_name === 'Write') lost = lostLines(historyLines(current), historyLines(input.content ?? ''));
    const edits = call.tool_name === 'Edit' ? [input] : call.tool_name === 'MultiEdit' ? (input.edits ?? []) : [];
    // an edit inside the generated archive-recap block is not history (archive-recap.mjs owns it)
    const recap = current.match(/<!-- archive-recap:start -->[\s\S]*?<!-- archive-recap:end -->/)?.[0] ?? '';
    for (const e of edits)
      if (!(e.old_string && recap.includes(e.old_string)))
        lost.push(...lostLines(historyLines(e.old_string ?? ''), historyLines(e.new_string ?? '')));
    if (lost.length)
      found.push(
        refusal(
          'archive',
          `this edit of ${path} removes or changes ${lost.length} line(s), first "${lost[0].slice(0, 80)}"`,
        ),
      );
  }
  return found;
}

// ------------------------------------------------------------------------------------------------------- the hook

function hookPath(root) {
  const path = gitIn(root)('rev-parse', '--git-path', 'hooks/pre-push')?.trim();
  return path ? (isAbsolute(path) ? path : resolve(root, path)) : null;
}
export function status(root) {
  const path = hookPath(root);
  return { path, installed: Boolean(path && existsSync(path) && isGuardHook(readFileSync(path, 'utf8'))) };
}
export function install(root) {
  const { path, installed } = status(root);
  if (!path) throw Error('Not a git repository: nothing to install');
  if (installed) return `${relative(root, path)} already runs the guard.`;
  if (existsSync(path))
    throw Error(
      `${relative(root, path)} exists and is not the guard: add "node tools/guard.mjs pre-push \\"$@\\"" to it by hand`,
    );
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `#!/bin/sh\n# ${MARK}\nexec node "$(git rev-parse --show-toplevel)/tools/guard.mjs" pre-push "$@"\n`,
  );
  chmodSync(path, 0o755);
  return `${relative(root, path)} installed: pushes to the default branch, force-pushes and archive rewrites are refused.`;
}

// run as a script (also through a symlinked folder, /var and /private/var on macOS), not imported
const direct = (() => {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1] ?? '');
  } catch {
    return false;
  }
})();
if (direct) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const command = process.argv[2];
  const stdin = () => {
    try {
      return readFileSync(0, 'utf8');
    } catch {
      return '';
    }
  };
  try {
    if (command === 'install') console.log(install(root));
    else if (command === 'status') {
      const s = status(root);
      console.log(
        s.installed ? 'Guard installed as the pre-push hook.' : 'Guard not installed: node tools/guard.mjs install',
      );
    } else if (command === 'pre-push') {
      const found = checkPush(root, stdin().split('\n'), process.env, process.argv[3]);
      for (const f of found) console.error(f.message);
      process.exitCode = found.length ? 1 : 0;
    } else if (command === 'claude') {
      let call = {};
      try {
        call = JSON.parse(stdin() || '{}');
      } catch {
        /* not a tool call: allow */
      }
      const found = checkToolCall(root, call);
      for (const f of found) console.error(f.message);
      process.exitCode = found.length ? 2 : 0; // 2: Claude Code blocks the call and shows the reason to the agent
    } else throw Error('Use install, status, pre-push or claude');
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
