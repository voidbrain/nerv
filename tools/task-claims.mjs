// Cooperative cross-machine claims via atomic normal Git fast-forward updates.
// No shared worktree/FETCH_HEAD, force push, model execution or permission grant.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { settings, taskCatalog, resource, overlaps, TASK } from './work-items.mjs';
const REF = 'refs/heads/harness/claims-v1';
const HASH = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
function git(root, args, input) {
  const p = spawnSync('git', args, { cwd: root, input, encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024 });
  if (p.error || p.status !== 0)
    throw Error('Git operation failed; claim state is unknown. Reconcile before retrying.');
  return p.stdout.trim();
}
export function validateState(value) {
  if (
    !value ||
    value.version !== 1 ||
    !Number.isSafeInteger(value.fence) ||
    value.fence < 0 ||
    !Array.isArray(value.claims) ||
    value.claims.length > 256
  )
    throw Error('Invalid claim registry');
  const ids = new Set(),
    tokens = new Set();
  for (const c of value.claims) {
    if (
      !c ||
      !TASK.test(c.task) ||
      ids.has(c.task) ||
      typeof c.owner !== 'string' ||
      !/^[a-zA-Z0-9_.-]{1,80}$/.test(c.owner) ||
      !HASH.test(c.baseline) ||
      typeof c.branch !== 'string' ||
      !/^[-a-zA-Z0-9_./]{1,150}$/.test(c.branch) ||
      !Number.isSafeInteger(c.fence) ||
      c.fence < 1 ||
      c.fence > value.fence ||
      tokens.has(c.fence) ||
      !Array.isArray(c.resources) ||
      !c.resources.length ||
      c.resources.length > 32 ||
      typeof c.leaseId !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(c.leaseId) ||
      !Number.isSafeInteger(c.expires) ||
      c.expires < 0 ||
      !['active', 'released'].includes(c.state) ||
      (c.profile !== null && typeof c.profile !== 'string')
    )
      throw Error('Invalid claim entry');
    c.resources.forEach(resource);
    ids.add(c.task);
    tokens.add(c.fence);
  }
  return value;
}
export function transition(input, operation, request, now = Date.now()) {
  const state = structuredClone(validateState(input)),
    old = state.claims.find((c) => c.task === request.task);
  if (!TASK.test(request.task ?? '') || !Number.isSafeInteger(now) || now < 0) throw Error('Invalid task/time');
  if (operation === 'acquire') {
    if (
      !/^[a-zA-Z0-9_.-]{1,80}$/.test(request.owner ?? '') ||
      !HASH.test(request.baseline ?? '') ||
      !/^[-a-zA-Z0-9_./]{1,150}$/.test(request.branch ?? '') ||
      !Number.isInteger(request.minutes) ||
      request.minutes < 1 ||
      request.minutes > 120 ||
      !Array.isArray(request.resources) ||
      !request.resources.length ||
      request.resources.length > 32
    )
      throw Error('Invalid acquisition');
    request.resources.forEach(resource);
    for (const c of state.claims.filter((c) => c.state === 'active'))
      if (c.task === request.task || c.resources.some((a) => request.resources.some((b) => overlaps(a, b))))
        throw Error(
          c.expires <= now
            ? 'Expired ownership needs confirmed-stopped reconciliation'
            : 'Task or resource is already claimed',
        );
    if (!old && state.claims.length >= 256)
      throw Error('Registry capacity reached; review retention before adding claims');
    if (state.fence >= Number.MAX_SAFE_INTEGER) throw Error('Fencing counter exhausted');
    const claim = {
      task: request.task,
      owner: request.owner,
      baseline: request.baseline,
      branch: request.branch,
      resources: request.resources,
      profile: request.profile ?? null,
      fence: ++state.fence,
      leaseId: randomUUID(),
      expires: now + request.minutes * 60000,
      state: 'active',
    };
    state.claims = state.claims.filter((c) => c.task !== request.task);
    state.claims.push(claim);
    return { state, claim };
  }
  if (!old || old.state !== 'active' || old.fence !== request.fence) throw Error('Stale or absent claim');
  if (operation === 'recover') {
    if (
      old.expires > now ||
      !request.confirmedStopped ||
      typeof request.reason !== 'string' ||
      request.reason.trim().length < 12 ||
      request.reason.length > 500
    )
      throw Error('Recovery requires expired ownership, confirmed stopped work and evidence');
    old.state = 'released';
    old.recovery = { reason: request.reason, at: now };
    return { state, claim: old };
  }
  if (old.owner !== request.owner || old.leaseId !== request.leaseId) throw Error('Claim ownership mismatch');
  if (operation === 'release') {
    if (!request.confirmedStopped) throw Error('Confirm work stopped before release');
    old.state = 'released';
    return { state, claim: old };
  }
  if (old.expires <= now) throw Error('Claim expired; reconcile stopped work before reacquiring');
  if (operation === 'renew') {
    if (!Number.isInteger(request.minutes) || request.minutes < 1 || request.minutes > 120)
      throw Error('Invalid lease duration');
    old.expires = now + request.minutes * 60000;
    return { state, claim: old };
  }
  if (operation === 'verify') return { state, claim: old };
  throw Error('Unknown claim operation');
}
function snapshot(root, remote) {
  const result = git(root, ['ls-remote', '--heads', remote, REF]);
  if (!result) return { head: null, state: { version: 1, fence: 0, claims: [] } };
  const lines = result.split('\n');
  if (lines.length !== 1) throw Error('Ambiguous registry reference');
  const [head, ref] = lines[0].split(/\s+/);
  if (!HASH.test(head) || ref !== REF) throw Error('Invalid remote registry');
  git(root, ['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', remote, head]);
  return { head, state: validateState(JSON.parse(git(root, ['show', head + ':.harness-claims.json']))) };
}
export function claimOperation(root, operation, request, { remote = 'origin', beforePush, afterPush } = {}) {
  if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,60}$/.test(remote)) throw Error('Select a named Git remote, not a URL');
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = snapshot(root, remote);
    if (operation === 'status') return current;
    if (!current.head && operation !== 'initialize')
      throw Error(
        'Claim registry is absent; initialize once after reviewing existing ownership. Never silently reset fencing history',
      );
    if (operation === 'initialize' && (!request.confirmNewRegistry || current.head))
      throw Error('Initialization needs explicit confirmation and an absent registry');
    const next =
      operation === 'initialize'
        ? { state: current.state, claim: null }
        : transition(current.state, operation, request);
    if (operation === 'verify') return { head: current.head, claim: next.claim };
    const parent = current.head ?? git(root, ['ls-remote', remote, 'HEAD']).split(/\s+/)[0];
    if (!HASH.test(parent)) throw Error('Remote default branch is unavailable');
    git(root, ['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', remote, parent]);
    const blob = git(root, ['hash-object', '-w', '--stdin'], JSON.stringify(next.state) + '\n');
    const entries = git(root, ['ls-tree', '-z', parent]).split('\0').filter(Boolean);
    if (!current.head && entries.some((e) => e.split('\t')[1] === '.harness-claims.json'))
      throw Error('Reserved claim file already exists on default branch');
    const kept = entries.filter((e) => e.split('\t')[1] !== '.harness-claims.json');
    const tree = git(root, ['mktree', '-z'], [...kept, `100644 blob ${blob}\t.harness-claims.json`].join('\0') + '\0');
    const head = git(
      root,
      ['-c', 'user.name=Harness claims', '-c', 'user.email=claims@example.invalid', 'commit-tree', tree, '-p', parent],
      `Claim ${operation} ${request.task}\n`,
    );
    beforePush?.({ attempt, head });
    const pushed = spawnSync('git', ['push', '--porcelain', remote, head + ':' + REF], {
      cwd: root,
      encoding: 'utf8',
      timeout: 20000,
      maxBuffer: 1024 * 1024,
    });
    afterPush?.(pushed);
    if (!pushed.error && pushed.status === 0) return { head, claim: next.claim };
    // Only an observed competing update permits a retry; transport failure stays uncertain.
    const observed = snapshot(root, remote);
    if (observed.head === head) return { head, claim: next.claim };
    if (
      next.claim &&
      JSON.stringify(observed.state.claims.find((c) => c.task === next.claim.task)) === JSON.stringify(next.claim)
    )
      return { head: observed.head, claim: next.claim };
    if (observed.head === current.head)
      throw Error('Registry push failed; no competing update observed. Reconcile before retrying.');
  }
  throw Error('Claim registry remained busy; no ownership acquired');
}
export function parseClaimArgs(args) {
  const [operation, ...rest] = args;
  if (!['initialize', 'status', 'acquire', 'renew', 'verify', 'release', 'recover'].includes(operation))
    throw Error('Unknown claim operation');
  const allowed = {
    initialize: ['remote', 'confirm-new-registry'],
    status: ['remote'],
    acquire: ['remote', 'task', 'owner', 'minutes', 'profile'],
    renew: ['remote', 'task', 'owner', 'fence', 'lease', 'minutes'],
    verify: ['remote', 'task', 'owner', 'fence', 'lease'],
    release: ['remote', 'task', 'owner', 'fence', 'lease', 'confirmed-stopped'],
    recover: ['remote', 'task', 'fence', 'confirmed-stopped', 'reason'],
  }[operation];
  const values = {};
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i].slice(2);
    if (!rest[i].startsWith('--') || !allowed.includes(key) || key in values)
      throw Error('Unknown/duplicate claim argument');
    if (['confirmed-stopped', 'confirm-new-registry'].includes(key)) values[key] = true;
    else {
      if (!rest[i + 1] || rest[i + 1].startsWith('--')) throw Error('Missing claim argument');
      values[key] = rest[++i];
    }
  }
  return { operation, values };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { operation, values } = parseClaimArgs(process.argv.slice(2)),
      root = process.cwd(),
      config = settings(root);
    if (!config) throw Error('Adopt work items before using claims');
    const request = {
      confirmNewRegistry: values['confirm-new-registry'] === true,
      task: values.task,
      owner: values.owner,
      fence: Number(values.fence),
      leaseId: values.lease,
      minutes: Number(values.minutes ?? 30),
      confirmedStopped: values['confirmed-stopped'] === true,
      reason: values.reason,
    };
    if (operation === 'acquire') {
      const catalog = taskCatalog(root, config),
        task = catalog.tasks.find((t) => t.id === request.task);
      if (
        !task ||
        task.status !== 'ready' ||
        task.dependsOn.some((d) => !['verified', 'closed'].includes(catalog.tasks.find((t) => t.id === d)?.status))
      )
        throw Error('Task is not ready or prerequisites remain');
      const parent = readFileSync(join(root, config.records, task.parent + '.md'), 'utf8');
      if (/Human action required: (?:Procedure|Decision|Both|Yes)\*\*|\| (?:Blocked|Closed|Verified) \|/.test(parent))
        throw Error('Parent needs human/prerequisite/status review before claiming');
      if (values.profile) {
        const profile = catalog.profiles.find((p) => p.id === values.profile);
        if (
          !profile ||
          profile.status !== 'qualified' ||
          task.capabilities.some((c) => !profile.capabilities.includes(c))
        )
          throw Error('Model profile is unqualified or lacks required capabilities');
      }
      Object.assign(request, {
        resources: task.resources,
        profile: values.profile ?? null,
        baseline: git(root, ['rev-parse', 'HEAD']),
        branch: git(root, ['symbolic-ref', '--short', 'HEAD']),
      });
    }
    console.log(
      JSON.stringify(claimOperation(root, operation, request, { remote: values.remote ?? 'origin' }), null, 2),
    );
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
