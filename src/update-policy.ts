import { executeManualUpdate, type ManualUpdateDeps, type ManualUpdateOutcome } from './manual-update.ts';
import { parseUpdateChannel, type UpdateChannel } from './update-availability.ts';
import type { ServiceReceipt } from './node-lifecycle-execution.ts';

export interface AutoUpdatePolicy {
  enabled: boolean;
  channels: UpdateChannel[];
  targets: string[];
  acceptedAt?: string;
  /** F-110-T02: when the scheduled update checks and applies; absent means DEFAULT_UPDATE_SCHEDULE. */
  schedule?: UpdateSchedule;
}

/**
 * F-110-T02 (owner decision 2026-11-19): the owner's update schedule. `notify` announces an available update and never
 * applies it; hours are local hours (0–23) in the configured time zone; no automatic apply from `quietFrom` until
 * `quietUntil` (the window may wrap midnight; equal hours mean no window).
 */
export interface UpdateSchedule {
  mode: 'apply' | 'notify';
  checkHour: number;
  applyHour: number;
  quietFrom: number;
  quietUntil: number;
}

export const DEFAULT_UPDATE_SCHEDULE: UpdateSchedule = {
  mode: 'apply',
  checkHour: 20,
  applyHour: 3,
  quietFrom: 8,
  quietUntil: 23,
};

/** Whether `hour` falls in the no-apply window of `schedule`. */
export function isQuietHour(hour: number, schedule: UpdateSchedule = DEFAULT_UPDATE_SCHEDULE): boolean {
  const { quietFrom: from, quietUntil: until } = schedule;
  if (from === until) return false;
  return from < until ? hour >= from && hour < until : hour >= from || hour < until;
}

export function validateUpdateSchedule(raw: unknown): UpdateSchedule {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Invalid updatePolicy.schedule: expected a JSON object.');
  const value = raw as Record<string, unknown>;
  for (const key of Object.keys(value))
    if (!['mode', 'checkHour', 'applyHour', 'quietFrom', 'quietUntil'].includes(key))
      throw new Error(`Unsupported updatePolicy.schedule field: ${key}`);
  if (value.mode !== 'apply' && value.mode !== 'notify')
    throw new Error('Invalid updatePolicy.schedule.mode: expected "apply" or "notify".');
  const hour = (key: string): number => {
    const h = value[key];
    if (typeof h !== 'number' || !Number.isInteger(h) || h < 0 || h > 23)
      throw new Error(`Invalid updatePolicy.schedule.${key}: expected a whole hour from 0 to 23.`);
    return h;
  };
  const schedule: UpdateSchedule = {
    mode: value.mode,
    checkHour: hour('checkHour'),
    applyHour: hour('applyHour'),
    quietFrom: hour('quietFrom'),
    quietUntil: hour('quietUntil'),
  };
  if (isQuietHour(schedule.applyHour, schedule))
    throw new Error(
      'Invalid updatePolicy.schedule.applyHour: it falls in the no-apply window, so nothing would apply.',
    );
  return schedule;
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

const UPDATE_POLICY_FIELDS_BY_VERSION: readonly { readonly since: string; readonly fields: readonly string[] }[] = [
  { since: '1.0', fields: ['enabled', 'channels', 'targets', 'acceptedAt'] },
  { since: '1.1', fields: ['schedule'] },
];
const CURRENT_UPDATE_POLICY_FIELDS = UPDATE_POLICY_FIELDS_BY_VERSION.flatMap((entry) => entry.fields);

export function validateAutoUpdatePolicy(
  raw: unknown,
  supportedFields: readonly string[] = CURRENT_UPDATE_POLICY_FIELDS,
): AutoUpdatePolicy {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid updatePolicy: expected a JSON object.');
  }
  const value = raw as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    if (!supportedFields.includes(key)) {
      const newer = UPDATE_POLICY_FIELDS_BY_VERSION.find((entry) => entry.fields.includes(key));
      if (newer) {
        throw new Error(
          `Configuration field updatePolicy.${key} was written by a newer NERV (since ${newer.since}); update this base before running this code.`,
        );
      }
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

  const schedule = value.schedule === undefined ? undefined : validateUpdateSchedule(value.schedule);

  return {
    enabled: value.enabled,
    channels,
    targets,
    ...(acceptedAt !== undefined ? { acceptedAt } : {}),
    ...(schedule ? { schedule } : {}),
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
