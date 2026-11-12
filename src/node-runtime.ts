import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { NODE_FLAGS } from './process-client.ts';

export type NodeRuntimeOwnership = 'nerv-managed' | 'user-managed' | 'missing' | 'unknown';
export type NodeRuntimeChoice =
  'use-existing' | 'install-nerv-managed' | 'upgrade-nerv-managed' | 'user-upgrade-required';

export interface NodeRuntimeChoiceOption {
  choice: NodeRuntimeChoice;
  label: string;
  targetPath: string | null;
  requiresOwnerConfirmation: boolean;
  replacesUserManaged: false;
}

export interface NodeRuntimePlan {
  ownership: NodeRuntimeOwnership;
  currentPath: string | null;
  currentVersion: string | null;
  requiredNode: string;
  satisfied: boolean;
  recommendedChoice: NodeRuntimeChoice;
  choices: NodeRuntimeChoiceOption[];
  blockers: string[];
  recovery: string[];
}

export interface ManagedNodeState {
  activeVersion: string | null;
  activePath: string | null;
  previousVersion: string | null;
  previousPath: string | null;
  status: 'completed' | 'uncertain' | 'rolled-back' | 'refused';
  updatedAt: string;
  reason?: string;
}

export type NodeCommandRunner = (
  program: string,
  args: string[],
) => Promise<{ status: number; out: string; err: string }>;

function satisfiesEngine(range: unknown, version: string): boolean {
  const need = typeof range === 'string' ? /^>=(\d+)\.(\d+)\.(\d+)$/.exec(range.trim()) : null;
  const have = /^v(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!need || !have) return false;
  for (let i = 1; i <= 3; i++) {
    if (Number(have[i]) !== Number(need[i])) return Number(have[i]) > Number(need[i]);
  }
  return true;
}

function requiredNodeRange(source: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')) as {
      engines?: { node?: unknown };
    };
    if (typeof pkg.engines?.node === 'string' && pkg.engines.node.trim()) return pkg.engines.node.trim();
  } catch {
    // Fall back to baseline Node 24 requirement when package.json is absent in review fixtures.
  }
  return '>=24.0.0';
}

export function managedNodeRoot(home: string): string {
  return join(resolve(home), 'runtimes', 'node');
}

function managedStatePath(home: string): string {
  return join(managedNodeRoot(home), 'state.json');
}

function isWithin(target: string, parent: string): boolean {
  const cleanTarget = resolve(target);
  const cleanParent = resolve(parent);
  return cleanTarget === cleanParent || cleanTarget.startsWith(cleanParent + sep);
}

function safeExecutable(path: string, uid: number): boolean {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile()) return false;
    if (process.platform !== 'win32') {
      if (stat.uid !== uid && stat.uid !== 0) return false;
      if (stat.mode & 0o022) return false;
      if ((stat.mode & 0o111) === 0) return false;
    }
    return realpathSync(path) === resolve(path);
  } catch {
    return false;
  }
}

export function classifyNodeOwnership(
  nodePath: string | null,
  home: string,
  uid = process.getuid?.() ?? 0,
): NodeRuntimeOwnership {
  if (!nodePath || !nodePath.trim()) return 'missing';
  try {
    lstatSync(nodePath);
  } catch (e) {
    if (e instanceof Error && 'code' in e && e.code === 'ENOENT') return 'missing';
    return 'unknown';
  }
  if (!safeExecutable(nodePath, uid)) return 'unknown';
  return isWithin(nodePath, managedNodeRoot(home)) ? 'nerv-managed' : 'user-managed';
}

export function readManagedNodeState(home: string): ManagedNodeState | null {
  const path = managedStatePath(home);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ManagedNodeState;
  } catch {
    return null;
  }
}

function writeManagedNodeState(home: string, state: ManagedNodeState): void {
  const root = managedNodeRoot(home);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const target = managedStatePath(home);
  const tmp = target + '.tmp';
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, target);
}

export async function planNodeRuntime(
  input: {
    home: string;
    source: string;
    nodePath: string | null;
    uid?: number;
    targetVersion?: string;
  },
  run: NodeCommandRunner,
): Promise<NodeRuntimePlan> {
  const uid = input.uid ?? process.getuid?.() ?? 0;
  const requiredNode = requiredNodeRange(input.source);
  const ownership = classifyNodeOwnership(input.nodePath, input.home, uid);
  const targetVersion = input.targetVersion ?? '24.0.0';
  const managedTarget = join(managedNodeRoot(input.home), `v${targetVersion}`, 'bin', 'node');

  let currentVersion: string | null = null;
  if (input.nodePath && (ownership === 'nerv-managed' || ownership === 'user-managed')) {
    const res = await run(input.nodePath, [...NODE_FLAGS, '--version']).catch(() => ({
      status: -1,
      out: '',
      err: '',
    }));
    if (res.status === 0 && res.out.trim()) currentVersion = res.out.trim();
  }

  const satisfied = Boolean(
    currentVersion &&
    (ownership === 'nerv-managed' || ownership === 'user-managed') &&
    satisfiesEngine(requiredNode, currentVersion),
  );
  const blockers: string[] = [];
  const recovery: string[] = [];
  const state = readManagedNodeState(input.home);
  if (state?.status === 'uncertain') {
    blockers.push('Previous NERV-managed Node operation is uncertain; recover or roll back before continuing.');
    recovery.push('Run recoverManagedNodeRuntime to restore the previous NERV-managed Node or inspect state.json.');
  }

  const choices: NodeRuntimeChoiceOption[] = [];
  let recommendedChoice: NodeRuntimeChoice;

  if (ownership === 'user-managed' && satisfied) {
    recommendedChoice = 'use-existing';
    choices.push(
      {
        choice: 'use-existing',
        label: `Keep existing user-managed Node (${currentVersion})`,
        targetPath: input.nodePath,
        requiresOwnerConfirmation: false,
        replacesUserManaged: false,
      },
      {
        choice: 'install-nerv-managed',
        label: `Install isolated NERV-managed Node v${targetVersion} without modifying user runtime`,
        targetPath: managedTarget,
        requiresOwnerConfirmation: true,
        replacesUserManaged: false,
      },
    );
  } else if (ownership === 'user-managed' && !satisfied) {
    recommendedChoice = 'user-upgrade-required';
    blockers.push(
      `User-managed Node (${currentVersion ?? 'unusable'}) does not satisfy ${requiredNode}; NERV never replaces a user-managed runtime silently.`,
    );
    choices.push(
      {
        choice: 'user-upgrade-required',
        label: `Upgrade your user-managed Node to ${requiredNode} and re-run prerequisite check`,
        targetPath: input.nodePath,
        requiresOwnerConfirmation: true,
        replacesUserManaged: false,
      },
      {
        choice: 'install-nerv-managed',
        label: `Install isolated NERV-managed Node v${targetVersion} for this NERV service only`,
        targetPath: managedTarget,
        requiresOwnerConfirmation: true,
        replacesUserManaged: false,
      },
    );
    recovery.push('Your existing user-managed Node and shell PATH remain untouched.');
  } else if (ownership === 'nerv-managed' && satisfied) {
    recommendedChoice = 'use-existing';
    choices.push(
      {
        choice: 'use-existing',
        label: `Keep NERV-managed Node (${currentVersion})`,
        targetPath: input.nodePath,
        requiresOwnerConfirmation: false,
        replacesUserManaged: false,
      },
      {
        choice: 'upgrade-nerv-managed',
        label: `Upgrade NERV-managed Node to v${targetVersion} (retaining previous version for rollback)`,
        targetPath: managedTarget,
        requiresOwnerConfirmation: true,
        replacesUserManaged: false,
      },
    );
  } else if (ownership === 'nerv-managed') {
    recommendedChoice = 'upgrade-nerv-managed';
    blockers.push(`NERV-managed Node (${currentVersion ?? 'unusable'}) does not satisfy ${requiredNode}.`);
    choices.push({
      choice: 'upgrade-nerv-managed',
      label: `Upgrade NERV-managed Node to v${targetVersion} with rollback preserved`,
      targetPath: managedTarget,
      requiresOwnerConfirmation: true,
      replacesUserManaged: false,
    });
  } else {
    recommendedChoice = 'install-nerv-managed';
    blockers.push(`No valid Node executable found (${ownership}).`);
    choices.push({
      choice: 'install-nerv-managed',
      label: `Install isolated NERV-managed Node v${targetVersion}`,
      targetPath: managedTarget,
      requiresOwnerConfirmation: true,
      replacesUserManaged: false,
    });
  }

  return {
    ownership,
    currentPath: input.nodePath,
    currentVersion,
    requiredNode,
    satisfied,
    recommendedChoice,
    choices,
    blockers,
    recovery,
  };
}

export async function activateManagedNodeRuntime(
  input: {
    home: string;
    source: string;
    candidateBinary: string;
    version: string;
    uid?: number;
    confirmChoice: 'install-nerv-managed' | 'upgrade-nerv-managed';
  },
  run: NodeCommandRunner,
): Promise<ManagedNodeState> {
  const uid = input.uid ?? process.getuid?.() ?? 0;
  if (input.confirmChoice !== 'install-nerv-managed' && input.confirmChoice !== 'upgrade-nerv-managed') {
    throw Error('Explicit owner choice install-nerv-managed or upgrade-nerv-managed is required.');
  }
  const root = managedNodeRoot(input.home);
  if (!isWithin(input.candidateBinary, root)) {
    throw Error('Managed Node activation refuses paths outside NERV managed runtime directory.');
  }
  const existing = readManagedNodeState(input.home);
  if (existing?.status === 'uncertain') {
    throw Error('Previous NERV-managed Node state is uncertain; recover before activating a new version.');
  }

  const required = requiredNodeRange(input.source);
  if (!safeExecutable(input.candidateBinary, uid)) {
    const failed: ManagedNodeState = {
      activeVersion: existing?.activeVersion ?? null,
      activePath: existing?.activePath ?? null,
      previousVersion: existing?.previousVersion ?? null,
      previousPath: existing?.previousPath ?? null,
      status: 'refused',
      updatedAt: new Date().toISOString(),
      reason: 'Candidate Node binary failed ownership, permission or canonical path checks.',
    };
    writeManagedNodeState(input.home, failed);
    return failed;
  }

  const probe = await run(input.candidateBinary, [...NODE_FLAGS, '--version']).catch(() => ({
    status: -1,
    out: '',
    err: 'Probe failed',
  }));
  if (probe.status !== 0 || !satisfiesEngine(required, probe.out)) {
    const uncertain: ManagedNodeState = {
      activeVersion: existing?.activeVersion ?? null,
      activePath: existing?.activePath ?? null,
      previousVersion: existing?.previousVersion ?? null,
      previousPath: existing?.previousPath ?? null,
      status: 'uncertain',
      updatedAt: new Date().toISOString(),
      reason: `Candidate Node probe failed or did not satisfy ${required}.`,
    };
    writeManagedNodeState(input.home, uncertain);
    return uncertain;
  }

  const next: ManagedNodeState = {
    activeVersion: input.version,
    activePath: resolve(input.candidateBinary),
    previousVersion: existing?.activeVersion ?? null,
    previousPath: existing?.activePath ?? null,
    status: 'completed',
    updatedAt: new Date().toISOString(),
  };
  writeManagedNodeState(input.home, next);
  return next;
}

export function recoverManagedNodeRuntime(home: string, uid = process.getuid?.() ?? 0): ManagedNodeState {
  const existing = readManagedNodeState(home);
  if (!existing) {
    throw Error('No NERV-managed Node state exists to recover.');
  }
  if (
    existing.previousPath &&
    isWithin(existing.previousPath, managedNodeRoot(home)) &&
    safeExecutable(existing.previousPath, uid)
  ) {
    const restored: ManagedNodeState = {
      activeVersion: existing.previousVersion,
      activePath: existing.previousPath,
      previousVersion: null,
      previousPath: null,
      status: 'rolled-back',
      updatedAt: new Date().toISOString(),
      reason: 'Restored previous verified NERV-managed Node runtime.',
    };
    writeManagedNodeState(home, restored);
    return restored;
  }
  const stageDir = join(managedNodeRoot(home), 'staging');
  if (existsSync(stageDir)) rmSync(stageDir, { recursive: true, force: true });
  const cleared: ManagedNodeState = {
    activeVersion: null,
    activePath: null,
    previousVersion: null,
    previousPath: null,
    status: 'rolled-back',
    updatedAt: new Date().toISOString(),
    reason: 'Cleared unverified NERV-managed Node runtime state without touching any user-managed Node.',
  };
  writeManagedNodeState(home, cleared);
  return cleared;
}
