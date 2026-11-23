import { dataHome } from './config.ts';
import {
  applyService,
  macServiceHost,
  planService,
  serviceReceipt,
  type ServiceHost,
  type ServicePlan,
  type ServiceReceipt,
} from './node-lifecycle-execution.ts';
import { parseUpdateChannel, type UpdateAvailability, type UpdateChannel } from './update-availability.ts';

/** `started`: the update was handed to the updater outside the service (B-108); its result arrives after the restart. */
export type ManualUpdateOutcome = 'completed' | 'refused' | 'uncertain' | 'started';

export interface ManualUpdateResult {
  outcome: ManualUpdateOutcome;
  channel: UpdateChannel;
  revision: string | null;
  planDigest?: string;
  reasons: string[];
  recovery: string[];
  receipt?: ServiceReceipt;
}

export interface ManualUpdateDeps {
  resolveUpdate: (channel: UpdateChannel, refresh: boolean) => Promise<UpdateAvailability>;
  lifecycleHost?: () => ServiceHost;
  plan?: (host: ServiceHost, action: 'update' | 'stop' | 'start', nextRevision?: string) => Promise<ServicePlan>;
  applyPlan?: (host: ServiceHost, plan: ServicePlan, confirm: string) => Promise<ServiceReceipt>;
  readReceipt?: (host: ServiceHost, digest: string) => ServiceReceipt | { state: 'absent' };
  /**
   * B-108: true when this runs inside the service it would update (dashboard Update now, scheduled apply). The
   * lifecycle refuses to update a running service, so the update is handed to `startUpdater` instead.
   */
  inService?: boolean;
  /** Starts the updater as its own OS job, outside the service's process tree, for this revision. */
  startUpdater?: (input: { channel: UpdateChannel; revision: string }) => Promise<void>;
  /** The outside updater: stop the running service through the lifecycle before planning the update. */
  stopFirst?: boolean;
  /** Bring the target revision into the managed checkout first: the lifecycle admits only a commit it can read. */
  fetchRevision?: (revision: string) => Promise<void>;
}

/** The planner's blocker for a running service: the only one the outside updater resolves itself, by stopping it. */
const STOP_FIRST = 'Stop the selected service and descendants first.';

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function availabilityRefusalReason(availability: UpdateAvailability): string {
  switch (availability.status) {
    case 'up-to-date':
      return 'Already running the latest revision on this channel.';
    case 'ahead':
      return 'Running revision is ahead of the channel; manual update refused.';
    case 'offline':
      return availability.reason
        ? `Update check offline: ${availability.reason}`
        : 'Update check offline; target revision unavailable.';
    default:
      return availability.reason || 'Target update revision is unavailable.';
  }
}

function readStoredReceipt(deps: ManualUpdateDeps, host: ServiceHost, digest: string): ServiceReceipt | undefined {
  try {
    const stored = (deps.readReceipt ?? serviceReceipt)(host, digest);
    return 'digest' in stored ? stored : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Execute a manual update through the reviewed service lifecycle update path (`planService` -> `applyService`),
 * surfacing deterministic refusals and ordered recovery steps without mutating unowned or unsafe state.
 */
export async function executeManualUpdate(
  deps: ManualUpdateDeps,
  input: { channel?: string; revision?: string } = {},
): Promise<ManualUpdateResult> {
  const channel = parseUpdateChannel(input.channel);
  if (input.revision !== undefined && !/^[a-f0-9]{40}$/.test(input.revision)) {
    throw new Error('Invalid target revision; expected a 40-character commit SHA.');
  }

  const availability = await deps.resolveUpdate(channel, true);
  const targetRevision =
    input.revision ?? (availability.status === 'update-available' ? availability.availableRevision : null);
  if (!targetRevision) {
    return {
      outcome: 'refused',
      channel,
      revision: null,
      reasons: [availabilityRefusalReason(availability)],
      recovery: ['Run `nerv nodes update-check` or inspect `GET /api/update?refresh=1` once online before retrying.'],
    };
  }

  if (deps.inService) {
    if (!deps.startUpdater)
      return {
        outcome: 'refused',
        channel,
        revision: targetRevision,
        reasons: ['No updater outside the service is available on this platform.'],
        recovery: [`Run \`nerv nodes self-update --revision ${targetRevision}\` from a terminal.`],
      };
    try {
      await deps.startUpdater({ channel, revision: targetRevision });
    } catch (error) {
      return {
        outcome: 'refused',
        channel,
        revision: targetRevision,
        reasons: [`The updater did not start: ${errorMessage(error)}`],
        recovery: [`Run \`nerv nodes self-update --revision ${targetRevision}\` from a terminal.`],
      };
    }
    return {
      outcome: 'started',
      channel,
      revision: targetRevision,
      reasons: [],
      recovery: ['NERV stops, updates and starts again; the result appears once it is back.'],
    };
  }

  let host: ServiceHost;
  try {
    host = (deps.lifecycleHost ?? (() => macServiceHost(dataHome())))();
  } catch (error) {
    return {
      outcome: 'refused',
      channel,
      revision: targetRevision,
      reasons: [errorMessage(error)],
      recovery: [
        `Run the manual update from the supported local macOS user service host (\`nerv nodes lifecycle-inspect --action update --revision ${targetRevision}\`).`,
      ],
    };
  }

  let stoppedHere = false;
  if (deps.stopFirst) {
    if (deps.fetchRevision) {
      try {
        await deps.fetchRevision(targetRevision);
      } catch (error) {
        return {
          outcome: 'refused',
          channel,
          revision: targetRevision,
          reasons: [`Fetching ${targetRevision.slice(0, 7)} into the install folder failed: ${errorMessage(error)}`],
          recovery: ['Nothing was stopped. Check the network and the origin remote, then retry.'],
        };
      }
    }
    // Refuse before stopping anything when the update would be refused for any other reason than the running service.
    const preview = await (deps.plan ?? planService)(host, 'update', targetRevision);
    const other = preview.blockers.filter((b) => b !== STOP_FIRST);
    if (other.length)
      return {
        outcome: 'refused',
        channel,
        revision: targetRevision,
        planDigest: preview.digest,
        reasons: other,
        recovery: ['Nothing was stopped; NERV keeps running the current revision.'],
      };
    if (preview.blockers.length) {
      const stopped = await stopService(deps, host);
      if (stopped) return { channel, revision: targetRevision, ...stopped };
      stoppedHere = true;
    }
  }

  let plan: ServicePlan;
  try {
    plan = await (deps.plan ?? planService)(host, 'update', targetRevision);
  } catch (error) {
    return {
      outcome: 'refused',
      channel,
      revision: targetRevision,
      reasons: [errorMessage(error)],
      recovery: [
        `Inspect service prerequisites and ownership with \`nerv nodes lifecycle-inspect --action update --revision ${targetRevision}\` before retrying.`,
      ],
    };
  }

  if (plan.blockers.length > 0) {
    if (stoppedHere) {
      const restarted = await startService(deps, host);
      return {
        outcome: restarted ? 'refused' : 'uncertain',
        channel,
        revision: targetRevision,
        planDigest: plan.digest,
        reasons: plan.blockers,
        recovery: [
          restarted
            ? 'The service was stopped for the update, then started again on the current revision.'
            : 'The service was stopped for the update and did not start again: run `nerv nodes lifecycle-inspect --action start`.',
        ],
      };
    }
    return {
      outcome: 'refused',
      channel,
      revision: targetRevision,
      planDigest: plan.digest,
      reasons: plan.blockers,
      recovery: [
        'Resolve each listed blocker (or release any held lifecycle operation with `nerv nodes lifecycle-release`), then retry the manual update.',
      ],
    };
  }

  try {
    const receipt = await (deps.applyPlan ?? applyService)(host, plan, plan.digest);
    if (receipt.state === 'refused') {
      const reasons = receipt.rehearsal?.blockers?.length
        ? receipt.rehearsal.blockers
        : ['Upgrade rehearsal refused the candidate revision.'];
      return {
        outcome: 'refused',
        channel,
        revision: targetRevision,
        planDigest: plan.digest,
        reasons,
        recovery: [
          'Service and data remain unchanged at the previous revision. Resolve the rehearsal blockers before retrying.',
        ],
        receipt,
      };
    }
    if (receipt.state === 'completed') {
      return {
        outcome: 'completed',
        channel,
        revision: targetRevision,
        planDigest: plan.digest,
        reasons: [],
        recovery: [],
        receipt,
      };
    }
    return {
      outcome: 'uncertain',
      channel,
      revision: targetRevision,
      planDigest: plan.digest,
      reasons: [`Lifecycle update ended in state '${receipt.state}'.`],
      recovery: receipt.recovery?.length
        ? receipt.recovery
        : [
            `Inspect the lifecycle journal (\`nerv nodes lifecycle-status --digest ${plan.digest}\`) and follow ordered manual recovery.`,
          ],
      receipt,
    };
  } catch (error) {
    const stored = readStoredReceipt(deps, host, plan.digest);
    return {
      outcome: 'uncertain',
      channel,
      revision: targetRevision,
      planDigest: plan.digest,
      reasons: [errorMessage(error)],
      recovery: stored?.recovery?.length
        ? stored.recovery
        : [
            `Inspect the lifecycle journal (\`nerv nodes lifecycle-status --digest ${plan.digest}\`) and follow ordered manual recovery.`,
          ],
      ...(stored ? { receipt: stored } : {}),
    };
  }
}

/** B-108: the outside updater stops the running service through the lifecycle; a refusal or an unfinished stop ends here. */
async function stopService(
  deps: ManualUpdateDeps,
  host: ServiceHost,
): Promise<Pick<ManualUpdateResult, 'outcome' | 'reasons' | 'recovery' | 'planDigest' | 'receipt'> | undefined> {
  const now = await host.inspect();
  if (now.registration === 'absent' && now.runtime === 'stopped') return undefined;
  let plan: ServicePlan;
  try {
    plan = await (deps.plan ?? planService)(host, 'stop');
  } catch (error) {
    return {
      outcome: 'refused',
      reasons: [errorMessage(error)],
      recovery: ['Inspect with `nerv nodes lifecycle-inspect --action stop`.'],
    };
  }
  if (plan.blockers.length)
    return {
      outcome: 'refused',
      planDigest: plan.digest,
      reasons: plan.blockers,
      recovery: ['The service was not stopped. If it runs another revision than its checkout, restart it, then retry.'],
    };
  const receipt = await (deps.applyPlan ?? applyService)(host, plan, plan.digest);
  if (receipt.state !== 'completed')
    return {
      outcome: 'uncertain',
      planDigest: plan.digest,
      receipt,
      reasons: [`Stopping the service ended ${receipt.state}.`],
      recovery: [`Inspect the stop with \`nerv nodes lifecycle-status --digest ${plan.digest}\`.`],
    };
  return undefined;
}

/** B-108: put the service back after a refusal found only once it was stopped. True when it runs again. */
async function startService(deps: ManualUpdateDeps, host: ServiceHost): Promise<boolean> {
  try {
    const plan = await (deps.plan ?? planService)(host, 'start');
    if (plan.blockers.length) return false;
    return (await (deps.applyPlan ?? applyService)(host, plan, plan.digest)).state === 'completed';
  } catch {
    return false;
  }
}
