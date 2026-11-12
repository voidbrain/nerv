import { executeManualUpdate, type ManualUpdateDeps, type ManualUpdateOutcome } from './manual-update.ts';
import { parseUpdateChannel, type UpdateChannel } from './update-availability.ts';
import type { ServiceReceipt } from './node-lifecycle-execution.ts';

export interface AutoUpdatePolicy {
  enabled: boolean;
  channels: UpdateChannel[];
  targets: string[];
  acceptedAt?: string;
}

export interface AutoUpdateSchemaCheck {
  safe: boolean;
  reason?: string;
  recovery?: string[];
}

export interface AutoUpdateDeps extends ManualUpdateDeps {
  countActiveRuns?: () => Promise<number> | number;
  countPendingApprovals?: () => Promise<number> | number;
  checkSchemaSafety?: (revision?: string) => Promise<AutoUpdateSchemaCheck> | AutoUpdateSchemaCheck;
}

export type AutoUpdateOutcome = ManualUpdateOutcome | 'skipped';

export interface AutoUpdateEvaluation {
  outcome: AutoUpdateOutcome;
  enabled: boolean;
  target: string;
  channel: UpdateChannel;
  revision: string | null;
  planDigest?: string;
  reasons: string[];
  recovery: string[];
  receipt?: ServiceReceipt;
}

const TARGET_PATTERN = /^[A-Za-z0-9._:@/-]{1,128}$/;

export function defaultAutoUpdatePolicy(): AutoUpdatePolicy {
  return {
    enabled: false,
    channels: [],
    targets: [],
  };
}

export function validateAutoUpdateTarget(raw: unknown): string {
  if (typeof raw !== 'string') throw new Error('Invalid automatic update target: expected a string.');
  const target = raw.trim();
  if (!TARGET_PATTERN.test(target)) {
    throw new Error('Invalid automatic update target: use 1–128 non-whitespace identifier characters.');
  }
  return target;
}

export function validateAutoUpdatePolicy(raw: unknown): AutoUpdatePolicy {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid updatePolicy: expected a JSON object.');
  }
  const value = raw as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    if (!['enabled', 'channels', 'targets', 'acceptedAt'].includes(key)) {
      throw new Error(`Unsupported updatePolicy field: ${key}`);
    }
  }
  if (typeof value.enabled !== 'boolean') {
    throw new Error('Invalid updatePolicy.enabled: expected a boolean.');
  }
  if (!Array.isArray(value.channels)) {
    throw new Error('Invalid updatePolicy.channels: expected an array.');
  }
  if (!Array.isArray(value.targets)) {
    throw new Error('Invalid updatePolicy.targets: expected an array.');
  }

  const channels: UpdateChannel[] = [];
  for (const item of value.channels) {
    if (typeof item !== 'string') throw new Error('Invalid updatePolicy.channels entry: expected a string.');
    const ch = parseUpdateChannel(item);
    if (!channels.includes(ch)) channels.push(ch);
  }

  const targets: string[] = [];
  for (const item of value.targets) {
    const target = validateAutoUpdateTarget(item);
    if (!targets.includes(target)) targets.push(target);
  }

  let acceptedAt: string | undefined;
  if (value.acceptedAt !== undefined) {
    if (typeof value.acceptedAt !== 'string' || Number.isNaN(Date.parse(value.acceptedAt))) {
      throw new Error('Invalid updatePolicy.acceptedAt: expected an ISO timestamp.');
    }
    acceptedAt = value.acceptedAt;
  }

  if (value.enabled && (channels.length === 0 || targets.length === 0)) {
    throw new Error('Automatic updates require at least one opted-in channel and one opted-in target.');
  }

  return {
    enabled: value.enabled,
    channels,
    targets,
    ...(acceptedAt !== undefined ? { acceptedAt } : {}),
  };
}

/**
 * Evaluate and optionally execute an automatic update under an explicit opt-in policy (off by default).
 * Never interrupts active runs or pending approvals, never downgrades schemas, and delegates execution
 * through `executeManualUpdate` so fencing, backups, ownership, and recovery guarantees are preserved.
 */
export async function evaluateAutoUpdate(
  deps: AutoUpdateDeps,
  input: {
    policy?: AutoUpdatePolicy;
    target: string;
    channel?: string;
    revision?: string;
  },
): Promise<AutoUpdateEvaluation> {
  const policy = input.policy ?? defaultAutoUpdatePolicy();
  const channel = parseUpdateChannel(input.channel);
  const target = validateAutoUpdateTarget(input.target);

  if (!policy.enabled) {
    return {
      outcome: 'skipped',
      enabled: false,
      target,
      channel,
      revision: input.revision ?? null,
      reasons: ['Automatic updates are disabled (opt-in policy is off by default).'],
      recovery: [
        'Opt in via `POST /api/update/policy` or `config.json` `updatePolicy` with selected channels and targets, or run a manual update.',
      ],
    };
  }

  if (!policy.channels.includes(channel)) {
    return {
      outcome: 'refused',
      enabled: true,
      target,
      channel,
      revision: input.revision ?? null,
      reasons: [`Channel "${channel}" is not opted in for automatic updates.`],
      recovery: [`Add "${channel}" to \`updatePolicy.channels\` or trigger a manual update for "${channel}".`],
    };
  }

  if (!policy.targets.includes(target)) {
    return {
      outcome: 'refused',
      enabled: true,
      target,
      channel,
      revision: input.revision ?? null,
      reasons: [`Target "${target}" is not opted in for automatic updates.`],
      recovery: [`Add "${target}" to \`updatePolicy.targets\` or update target "${target}" manually.`],
    };
  }

  const activeRuns = deps.countActiveRuns ? await deps.countActiveRuns() : 0;
  if (activeRuns > 0) {
    return {
      outcome: 'refused',
      enabled: true,
      target,
      channel,
      revision: input.revision ?? null,
      reasons: [
        `Refused automatic update: ${activeRuns} active run(s) in progress; active runs are never interrupted.`,
      ],
      recovery: ['Wait for active runs to finish or inspect `/api/sorties` before retrying automatic update.'],
    };
  }

  const pendingApprovals = deps.countPendingApprovals ? await deps.countPendingApprovals() : 0;
  if (pendingApprovals > 0) {
    return {
      outcome: 'refused',
      enabled: true,
      target,
      channel,
      revision: input.revision ?? null,
      reasons: [`Refused automatic update: ${pendingApprovals} pending approval(s) waiting.`],
      recovery: ['Resolve pending approvals in `/api/approvals` before retrying automatic update.'],
    };
  }

  if (deps.checkSchemaSafety) {
    const schema = await deps.checkSchemaSafety(input.revision);
    if (!schema.safe) {
      return {
        outcome: 'refused',
        enabled: true,
        target,
        channel,
        revision: input.revision ?? null,
        reasons: [
          schema.reason ?? 'Refused automatic update: target schema change or downgrade is not allowed automatically.',
        ],
        recovery: schema.recovery?.length
          ? schema.recovery
          : ['Inspect schema compatibility and perform any required backup/migration manually before updating.'],
      };
    }
  }

  try {
    const result = await executeManualUpdate(deps, {
      channel,
      ...(input.revision !== undefined ? { revision: input.revision } : {}),
    });
    return {
      outcome: result.outcome,
      enabled: true,
      target,
      channel: result.channel,
      revision: result.revision,
      ...(result.planDigest ? { planDigest: result.planDigest } : {}),
      reasons: result.reasons,
      recovery: result.recovery,
      ...(result.receipt ? { receipt: result.receipt } : {}),
    };
  } catch (error) {
    return {
      outcome: 'uncertain',
      enabled: true,
      target,
      channel,
      revision: input.revision ?? null,
      reasons: [error instanceof Error ? error.message : String(error)],
      recovery: [
        'Inspect the service receipt (`nerv nodes lifecycle-inspect --action update`) and `nerv doctor` before retrying.',
      ],
    };
  }
}
