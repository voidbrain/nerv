import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { validateInspection, type NodeInspection } from './node-inspection.ts';
import { renderService } from './service.ts';

type Action = 'install' | 'update' | 'uninstall';
type Definition =
  { state: 'absent' } | { state: 'unknown' } | { state: 'file'; digest: string; uid: number; mode: number };
interface LifecycleInput {
  inspection: NodeInspection;
  action: Action;
  checkout: string;
  home: string;
  node: string;
  revision: string;
  nextRevision?: string;
  additionalProfile: boolean;
  evidence: {
    current: Definition;
    legacy: Definition;
    session: 'available' | 'unavailable' | 'unknown';
    registration: 'absent' | 'matching' | 'other' | 'unknown';
    runtime: 'stopped' | 'running' | 'unknown';
    profile: 'matching' | 'other' | 'unknown';
    source: 'clean' | 'dirty' | 'unknown';
    pending: 'none' | 'unresolved';
  };
}
export interface LifecyclePlan {
  version: 1;
  kind: 'review-only';
  input: LifecycleInput;
  resource: string;
  expectedDefinitionDigest: string;
  blockers: string[];
  steps: string[];
  recovery: string[];
  execution: 'adapter-not-implemented';
  digest: string;
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid lifecycle object.');
  return value as Record<string, unknown>;
}
function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) throw Error('Invalid lifecycle evidence.');
  return value as T;
}
function digest(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw Error('Invalid lifecycle digest.');
  return value;
}
function revision(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/.test(value)) throw Error('Pin a full source revision.');
  return value;
}
function definition(value: unknown): Definition {
  const v = object(value),
    state = choice(v.state, ['absent', 'unknown', 'file']);
  if (state !== 'file') return { state };
  if (
    !Number.isSafeInteger(v.uid) ||
    Number(v.uid) < 0 ||
    !Number.isInteger(v.mode) ||
    Number(v.mode) < 0 ||
    Number(v.mode) > 0o777
  )
    throw Error('Invalid definition ownership.');
  return { state, digest: digest(v.digest), uid: Number(v.uid), mode: Number(v.mode) };
}
/** Supplied evidence is a contract for a future bounded adapter, never a claim that this function inspected a host. */
export function lifecyclePlan(value: unknown, now = new Date()): LifecyclePlan {
  const v = object(value),
    inspection = validateInspection(v.inspection, now);
  if (inspection.platform === 'win32')
    throw Error('Windows lifecycle ownership requires a separate Task Scheduler adapter.');
  const path = (raw: unknown, inside = false): string => {
    if (
      typeof raw !== 'string' ||
      raw.length > 1024 ||
      !posix.isAbsolute(raw) ||
      /[\x00-\x1f\x7f]/.test(raw) ||
      posix.normalize(raw) !== raw
    )
      throw Error('Use canonical absolute lifecycle paths.');
    const relative = posix.relative(inspection.userHome, raw);
    if (inside && (!relative || relative === '..' || relative.startsWith('../')))
      throw Error('Installation directories must be inside the inspected user home.');
    const journal = posix.relative(posix.join(inspection.userHome, '.nerv-bootstrap'), raw);
    if (!journal || (journal !== '..' && !journal.startsWith('../')))
      throw Error('Bootstrap journal paths are reserved.');
    return raw;
  };
  const checkout = path(v.checkout, true),
    home = path(v.home, true),
    node = path(v.node);
  const nested = (a: string, b: string) => {
    const r = posix.relative(a, b);
    return !r || (r !== '..' && !r.startsWith('../'));
  };
  if (nested(checkout, home) || nested(home, checkout)) throw Error('Checkout and data home must be separate.');
  if (typeof v.additionalProfile !== 'boolean') throw Error('Choose the profile mode explicitly.');
  const action = choice(v.action, ['install', 'update', 'uninstall']);
  if (action !== 'update' && v.nextRevision !== undefined) throw Error('Only an update selects a next revision.');
  const e = object(v.evidence);
  const evidence: LifecycleInput['evidence'] = {
    current: definition(e.current),
    legacy: definition(e.legacy),
    session: choice(e.session, ['available', 'unavailable', 'unknown']),
    registration: choice(e.registration, ['absent', 'matching', 'other', 'unknown']),
    runtime: choice(e.runtime, ['stopped', 'running', 'unknown']),
    profile: choice(e.profile, ['matching', 'other', 'unknown']),
    source: choice(e.source, ['clean', 'dirty', 'unknown']),
    pending: choice(e.pending, ['none', 'unresolved']),
  };
  const input: LifecycleInput = {
    inspection,
    action,
    checkout,
    home,
    node,
    revision: revision(v.revision),
    ...(action === 'update' ? { nextRevision: revision(v.nextRevision) } : {}),
    additionalProfile: v.additionalProfile,
    evidence,
  };
  const expectedDefinitionDigest = hash(renderService(inspection.platform, home, checkout, node));
  const blockers: string[] = [];
  if (inspection.userId === null || inspection.userId === 0)
    blockers.push('An identified unprivileged target user is required.');
  if (Number(inspection.node.split('.')[0]) < 24) blockers.push('Install Node 24 or newer and inspect again.');
  if (action !== 'uninstall' && (!inspection.git || !inspection.npm))
    blockers.push('Verify Git and npm before installation or update.');
  if (input.additionalProfile) blockers.push('An additional profile cannot install or manage an OS service.');
  if (evidence.session !== 'available')
    blockers.push('Verify the target user service session; do not enable linger or elevate privileges.');
  if (evidence.profile !== 'matching')
    blockers.push(
      'Verify selected configuration, base identity, private ownership and symlink-free installation paths.',
    );
  if (evidence.source !== 'clean')
    blockers.push('Verify the selected clean checkout and exact installed source revision.');
  if (evidence.runtime !== 'stopped')
    blockers.push('Confirm the service, handler and descendants stopped before changing lifecycle state.');
  if (evidence.pending !== 'none')
    blockers.push('Reconcile the unresolved operation; expiry or timeout never releases ownership.');
  if (evidence.legacy.state !== 'absent')
    blockers.push('Legacy NERV/Nodo ownership needs a separate migration review; never replace it automatically.');
  if (action === 'install') {
    if (evidence.current.state !== 'absent' || evidence.registration !== 'absent')
      blockers.push(
        'Fresh service installation requires both the current definition and manager registration to be absent.',
      );
  } else {
    if (
      evidence.current.state !== 'file' ||
      evidence.current.digest !== expectedDefinitionDigest ||
      evidence.current.uid !== inspection.userId ||
      (evidence.current.mode & 0o077) !== 0
    )
      blockers.push('Existing definition must match the selected runtime paths and private user ownership exactly.');
    if (evidence.registration !== 'matching' && evidence.registration !== 'absent')
      blockers.push('The service manager registration belongs to another runtime or is unknown.');
  }
  if (action === 'update' && input.nextRevision === input.revision)
    blockers.push('Select a different reviewed update revision.');
  const steps =
    action === 'install'
      ? [
          'Revalidate target/session, absent current/legacy definitions and registration under the per-user lifecycle claim.',
          'Verify persistent configuration/token and built assets without disclosing credentials.',
          'Persist started before exclusively creating the private current definition.',
          'Register/start the exact definition; verify manager paths and authenticated runtime identity.',
          'Persist completion only after observed service and doctor acceptance.',
        ]
      : action === 'update'
        ? [
            'Revalidate exact owned definition, clean installed revision and stopped runtime under the per-user lifecycle claim.',
            'Require a consistent private data backup and reviewed migration/rollback compatibility before source changes.',
            'Persist started before fetching/checking out the pinned next revision; verify source and lifecycle protocol compatibility.',
            'Run locked dependencies/build with bounded children; preserve data, configuration, keys and logs.',
            'Revalidate definition/runtime paths before explicit restart; verify new runtime revision and doctor.',
            'Persist completion only after observed acceptance; a failed update remains uncertain, never auto-downgraded.',
          ]
        : [
            'Revalidate exact owned definition and stopped runtime under the per-user lifecycle claim.',
            'Persist started before unregistering only the selected owned service.',
            'Recheck definition digest and registration before unlinking only that definition.',
            'Verify definition and manager registration absent, then persist completion; retain checkout, data, keys and logs.',
          ];
  const result = {
    version: 1 as const,
    kind: 'review-only' as const,
    input,
    resource: `user-service:${inspection.userId}:${inspection.platform}`,
    expectedDefinitionDigest,
    blockers,
    steps,
    recovery: [
      'Persist target-local acceptance and a monotonic fence/nonce before effects; compare ownership in every transaction.',
      'Started effects without confirmed completion are uncertain, including disconnect, timeout and process failure.',
      'Replay returns the existing receipt; never restart a completed, uncertain or released digest.',
      'A PID or expired lease alone proves neither handler death nor stopped descendants.',
      'Release requires exact digest/fence/nonce, observed stopped handler and descendants, and a recorded operator reason.',
      'Release retains the receipt and every observed effect; a new plan requires fresh inspection and reconciliation.',
    ],
    execution: 'adapter-not-implemented' as const,
  };
  return { ...result, digest: hash(JSON.stringify(result)) };
}

interface Receipt {
  digest: string;
  resource: string;
  fence: number;
  nonce: string;
  state: 'accepted' | 'running' | 'completed' | 'uncertain' | 'released' | 'refused';
}
/** Release decision only. A durable adapter must compare this exact snapshot atomically before updating its journal. */
export function lifecycleRecovery(
  value: unknown,
  confirmation: unknown,
): { action: 'return-receipt' | 'retain' | 'release'; snapshot: Receipt; reason?: string } {
  const v = object(value),
    c = object(confirmation);
  if (
    typeof v.resource !== 'string' ||
    !/^user-service:(?:[1-9]\d*:(?:darwin|linux)|\d+:win32)$/.test(v.resource) ||
    !Number.isSafeInteger(v.fence) ||
    Number(v.fence) < 1 ||
    typeof v.nonce !== 'string' ||
    !/^[a-f0-9]{32}$/.test(v.nonce)
  )
    throw Error('Invalid lifecycle receipt ownership.');
  const snapshot: Receipt = {
    digest: digest(v.digest),
    resource: v.resource,
    fence: Number(v.fence),
    nonce: v.nonce,
    state: choice(v.state, ['accepted', 'running', 'completed', 'uncertain', 'released', 'refused']),
  };
  if (snapshot.state === 'completed' || snapshot.state === 'released' || snapshot.state === 'refused')
    return { action: 'return-receipt', snapshot };
  if (
    c.digest !== snapshot.digest ||
    c.fence !== snapshot.fence ||
    c.nonce !== snapshot.nonce ||
    c.resource !== snapshot.resource
  )
    throw Error('Lifecycle ownership changed; reconcile the current receipt.');
  if (c.handlerStopped !== true || c.descendantsStopped !== true || c.operatorConfirmed !== true)
    return { action: 'retain', snapshot };
  if (typeof c.reason !== 'string' || !c.reason.trim() || c.reason.length > 500 || /[\x00-\x1f\x7f]/.test(c.reason))
    throw Error('Record bounded stopped-operation evidence.');
  return { action: 'release', snapshot, reason: c.reason.trim() };
}
