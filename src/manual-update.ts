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

export type ManualUpdateOutcome = 'completed' | 'refused' | 'uncertain';

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
  plan?: (host: ServiceHost, action: 'update', nextRevision?: string) => Promise<ServicePlan>;
  applyPlan?: (host: ServiceHost, plan: ServicePlan, confirm: string) => Promise<ServiceReceipt>;
  readReceipt?: (host: ServiceHost, digest: string) => ServiceReceipt | { state: 'absent' };
}

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
