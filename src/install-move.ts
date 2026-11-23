import { isAbsolute, relative } from 'node:path';
import type { ServiceHost, ServicePlan, ServiceReceipt } from './node-lifecycle-execution.ts';

/**
 * F-117-T01: move the service from the checkout it runs from today into its own install folder, through the reviewed
 * lifecycle (stop, uninstall, install, start). Data in the profile home is never touched: uninstall removes only the
 * owned service definition. Any failure after the old service stopped puts the old definition back and starts it.
 */
export interface MoveDeps {
  /** The checkout the service runs from today. */
  from: string;
  /** The install folder (absolute). */
  to: string;
  exec: (program: string, args: string[], cwd?: string) => Promise<{ status: number; out: string }>;
  /** True when the path exists and is not an empty directory. */
  occupied: (path: string) => boolean;
  host: (source: string) => ServiceHost;
  plan: (host: ServiceHost, action: 'stop' | 'uninstall' | 'install' | 'start') => Promise<ServicePlan>;
  apply: (host: ServiceHost, plan: ServicePlan, confirm: string) => Promise<ServiceReceipt>;
  /** The service answers after the move (dashboard health). */
  probe: () => Promise<boolean>;
  log?: (line: string) => void;
}

export interface MoveResult {
  outcome: 'moved' | 'refused' | 'rolled-back' | 'uncertain';
  revision: string | null;
  from: string;
  to: string;
  steps: string[];
  reasons: string[];
}

const SHA = /^[a-f0-9]{40}$/;
/** True when `path` lies strictly inside `folder` (any platform separator). */
const inside = (path: string, folder: string): boolean => {
  const r = relative(folder, path);
  return !!r && !r.startsWith('..') && !isAbsolute(r);
};

export async function moveInstall(deps: MoveDeps): Promise<MoveResult> {
  const steps: string[] = [];
  const say = (line: string) => {
    steps.push(line);
    deps.log?.(line);
  };
  const result = (outcome: MoveResult['outcome'], revision: string | null, reasons: string[] = []): MoveResult => ({
    outcome,
    revision,
    from: deps.from,
    to: deps.to,
    steps,
    reasons,
  });
  const git = (args: string[], cwd = deps.from) => deps.exec('git', ['-C', cwd, ...args]);

  if (deps.from === deps.to) return result('refused', null, ['The service already runs from the install folder.']);
  if (inside(deps.to, deps.from) || inside(deps.from, deps.to))
    return result('refused', null, ['The install folder and the current checkout must not contain each other.']);
  if (deps.occupied(deps.to))
    return result('refused', null, [`${deps.to} already exists and is not empty; remove it or choose another --to.`]);

  const head = await git(['rev-parse', 'HEAD']);
  const revision = head.out.trim();
  if (head.status !== 0 || !SHA.test(revision)) return result('refused', null, ['Cannot read the current revision.']);
  const dirty = await git(['status', '--porcelain', '--untracked-files=no']);
  if (dirty.status !== 0 || dirty.out.trim())
    return result('refused', revision, ['The current checkout has uncommitted changes; commit or stash them first.']);
  const origin = await git(['remote', 'get-url', 'origin']);
  if (origin.status !== 0 || !origin.out.trim()) return result('refused', revision, ['The checkout has no origin.']);

  // The old service must be one the lifecycle can stop before anything is prepared: a service running another
  // revision than this checkout (pulled without a restart) is not proven ours, and nothing should change then.
  const oldHost = deps.host(deps.from);
  const before = await oldHost.inspect();
  if (before.definition !== 'owned')
    return result('refused', revision, [
      'The current service definition is not owned by this checkout; inspect it with nerv nodes lifecycle-inspect.',
    ]);
  const mustStop = before.registration !== 'absent' || before.runtime !== 'stopped';
  if (mustStop) {
    const stop = await deps.plan(oldHost, 'stop');
    if (stop.blockers.length)
      return result('refused', revision, [
        ...stop.blockers,
        'Nothing changed. If the service runs another revision than this checkout, restart it first (launchctl kickstart -k gui/$(id -u)/io.nerv.agent), then retry.',
      ]);
  }

  // 1. Prepare the install folder at exactly the running revision. Nothing about the service changes yet.
  const prepare: [string, string, string[], string?][] = [
    ['clone', 'git', ['clone', '--no-hardlinks', '--no-checkout', '--quiet', deps.from, deps.to]],
    ['origin', 'git', ['-C', deps.to, 'remote', 'set-url', 'origin', origin.out.trim()]],
    ['checkout', 'git', ['-C', deps.to, 'checkout', '--quiet', '--detach', revision]],
    ['dependencies', 'npm', ['ci', '--engine-strict', '--ignore-scripts'], deps.to],
    ['build', 'npm', ['run', 'build'], deps.to],
  ];
  for (const [name, program, args, cwd] of prepare) {
    const r = await deps.exec(program, args, cwd);
    if (r.status !== 0)
      return result('refused', revision, [
        `Preparing the install folder failed at ${name}; the service was not touched. Remove ${deps.to} before retrying.`,
      ]);
    say(`prepared: ${name}`);
  }

  // 2. Switch the service through the lifecycle, old definition out, new one in.
  const newHost = deps.host(deps.to);
  const run = async (host: ServiceHost, action: 'stop' | 'uninstall' | 'install' | 'start', label: string) => {
    const plan = await deps.plan(host, action);
    if (plan.blockers.length) throw Error(`${label} ${action} blocked: ${plan.blockers.join(' ')}`);
    const receipt = await deps.apply(host, plan, plan.digest);
    if (receipt.state !== 'completed') throw Error(`${label} ${action} ended ${receipt.state}.`);
    say(`${label}: ${action}`);
  };

  let oldStopped = !mustStop,
    oldRemoved = false;
  try {
    if (mustStop) await run(oldHost, 'stop', 'old');
    oldStopped = true;
    await run(oldHost, 'uninstall', 'old');
    oldRemoved = true;
    await run(newHost, 'install', 'new');
    await run(newHost, 'start', 'new');
    if (!(await deps.probe())) throw Error('The service did not answer from the install folder.');
    say('probe: dashboard answers');
    return result('moved', revision);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    say(`failed: ${reason}`);
    // Nothing changed yet (the old service was never stopped): no rollback, nothing to start.
    if (!oldStopped && mustStop) return result('refused', revision, [reason, 'The service was not changed.']);
    try {
      if (oldRemoved) {
        const now = await newHost.inspect();
        if (now.registration !== 'absent' || now.runtime !== 'stopped') await run(newHost, 'stop', 'rollback new');
        if (now.definition === 'owned') await run(newHost, 'uninstall', 'rollback new');
        await run(oldHost, 'install', 'rollback old');
      }
      await run(oldHost, 'start', 'rollback old');
      return result('rolled-back', revision, [reason, 'The service runs from the previous checkout again.']);
    } catch (rollbackError) {
      return result('uncertain', revision, [
        reason,
        `Rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        'Inspect with nerv nodes lifecycle-inspect --action start from the previous checkout.',
      ]);
    }
  }
}
