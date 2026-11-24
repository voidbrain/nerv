import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ManualUpdateDeps, ManualUpdateResult } from './manual-update.ts';
import { applyService, planService } from './node-lifecycle-execution.ts';

/**
 * B-123: what the dashboard shows beside Update now. The updater runs outside the service (B-108) and its one-time
 * inbox report consumes `updater-result.json`, so the last run is also kept here, never consumed: running (with its
 * step) until the updater writes its outcome, then that outcome until the owner dismisses it or a new run replaces it.
 */
export const UPDATER_STATUS = 'updater-status.json';

export type UpdaterState = 'running' | 'completed' | 'refused' | 'failed' | 'uncertain';

export interface UpdaterStatus {
  version: 1;
  state: UpdaterState;
  channel: string;
  revision: string | null;
  /** When this run was handed off (or started from a terminal). */
  startedAt: string;
  /** The last change: the hand-off, a step, or the outcome. */
  at: string;
  /** While running: what the updater is doing now. */
  step?: string;
  reasons: string[];
  recovery: string[];
  dismissed?: boolean;
}

/** A run that has said nothing for this long is shown as uncertain (the file itself is left as it is). */
export const UPDATER_SILENCE_MS = 15 * 60_000;
const STATES: readonly UpdaterState[] = ['running', 'completed', 'refused', 'failed', 'uncertain'];
const LOG_HINT = 'Check ~/.nerv/updater.log; the inbox reports the result once the updater writes it.';
const short = (revision: string | null) => (revision ?? '').slice(0, 7);
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 500)) : [];

function write(home: string, status: UpdaterStatus): void {
  const path = join(home, UPDATER_STATUS);
  writeFileSync(path + '.tmp', JSON.stringify(status) + '\n', { mode: 0o600 });
  renameSync(path + '.tmp', path);
}

function readRaw(home: string): UpdaterStatus | null {
  const path = join(home, UPDATER_STATUS);
  if (!existsSync(path)) return null;
  try {
    const v = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    if (v.version !== 1 || !STATES.includes(v.state as UpdaterState)) return null;
    if (typeof v.startedAt !== 'string' || typeof v.at !== 'string' || !Number.isFinite(Date.parse(v.at))) return null;
    return {
      version: 1,
      state: v.state as UpdaterState,
      channel: typeof v.channel === 'string' ? v.channel : 'main',
      revision: typeof v.revision === 'string' ? v.revision : null,
      startedAt: v.startedAt,
      at: v.at,
      ...(typeof v.step === 'string' ? { step: v.step.slice(0, 200) } : {}),
      reasons: strings(v.reasons),
      recovery: strings(v.recovery),
      ...(v.dismissed === true ? { dismissed: true } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * The status to show, or null (none, unreadable). A run silent for 15 minutes reads as uncertain: the updater may have
 * died without writing its outcome.
 */
export function readUpdaterStatus(home: string, now = Date.now()): UpdaterStatus | null {
  const status = readRaw(home);
  if (!status || status.state !== 'running' || now - Date.parse(status.at) < UPDATER_SILENCE_MS) return status;
  return {
    ...status,
    state: 'uncertain',
    reasons: [
      `The updater has said nothing since ${status.at}` + (status.step ? ` (last step: ${status.step}).` : '.'),
    ],
    recovery: [LOG_HINT],
  };
}

/** A new run: replaces whatever was shown before, dismissed or not. The same revision still running keeps its start. */
export function markUpdaterRunning(home: string, input: { channel: string; revision: string }): void {
  const now = new Date().toISOString();
  const previous = readRaw(home);
  const same = previous?.state === 'running' && previous.revision === input.revision;
  write(home, {
    version: 1,
    state: 'running',
    channel: input.channel,
    revision: input.revision,
    startedAt: same ? previous.startedAt : now,
    at: now,
    reasons: [],
    recovery: [],
  });
}

/** Best effort: a step is display only and never stops the update. */
export function markUpdaterStep(home: string, step: string): void {
  try {
    const status = readRaw(home);
    if (status?.state !== 'running') return;
    const { step: _old, ...rest } = status;
    write(home, { ...rest, step, at: new Date().toISOString() });
  } catch {
    /* display only */
  }
}

function finish(home: string, input: Omit<UpdaterStatus, 'version' | 'startedAt' | 'at'>): void {
  const now = new Date().toISOString();
  const previous = readRaw(home);
  const same = previous?.state === 'running' && previous.revision === input.revision;
  write(home, { version: 1, ...input, startedAt: same ? previous.startedAt : now, at: now });
}

/** The updater's outcome (called with the inbox copy, `writeUpdaterResult`). `started` is not an outcome. */
export function markUpdaterFinished(home: string, result: ManualUpdateResult): void {
  if (result.outcome === 'started') return;
  finish(home, {
    state: result.outcome,
    channel: result.channel,
    revision: result.revision,
    reasons: result.reasons ?? [],
    recovery: result.recovery ?? [],
  });
}

/** The updater threw before it had an outcome. */
export function markUpdaterFailed(home: string, input: { channel: string; revision: string }, error: unknown): void {
  finish(home, {
    state: 'failed',
    channel: input.channel,
    revision: input.revision,
    reasons: [error instanceof Error ? error.message : String(error)],
    recovery: [
      'The update stopped with an error; check ~/.nerv/updater.log and `nerv nodes lifecycle-inspect --action start` if NERV is not running.',
    ],
  });
}

/** Hide the shown outcome until a new run. A running update cannot be dismissed. */
export function dismissUpdaterStatus(home: string): 'dismissed' | 'running' | 'none' {
  const status = readUpdaterStatus(home);
  if (!status) return 'none';
  if (status.state === 'running') return 'running';
  const raw = readRaw(home)!;
  write(home, { ...raw, dismissed: true });
  return 'dismissed';
}

/**
 * The service's hand-off: marks the run started before the updater job starts (it can finish first), and a job that
 * does not start is a refusal, never a run left "running".
 */
export function trackUpdaterStart(
  home: string,
  start: NonNullable<ManualUpdateDeps['startUpdater']>,
): NonNullable<ManualUpdateDeps['startUpdater']> {
  return async (input) => {
    markUpdaterRunning(home, input);
    try {
      await start(input);
    } catch (error) {
      finish(home, {
        state: 'refused',
        channel: input.channel,
        revision: input.revision,
        reasons: [`The updater did not start: ${error instanceof Error ? error.message : String(error)}`],
        recovery: [`Run \`nerv nodes self-update --revision ${input.revision}\` from a terminal.`],
      });
      throw error;
    }
  };
}

/** The updater's steps, recorded as they begin; the update itself is unchanged. */
export function withUpdaterSteps(home: string, deps: ManualUpdateDeps): ManualUpdateDeps {
  const plan = deps.plan ?? planService;
  const apply = deps.applyPlan ?? applyService;
  return {
    ...deps,
    ...(deps.fetchRevision
      ? {
          fetchRevision: (revision: string) => {
            markUpdaterStep(home, `Fetching ${short(revision)} into the install folder`);
            return deps.fetchRevision!(revision);
          },
        }
      : {}),
    plan: (host, action, nextRevision) => {
      if (action === 'update') markUpdaterStep(home, 'Checking the update plan');
      return plan(host, action, nextRevision);
    },
    applyPlan: (host, servicePlan, confirm) => {
      markUpdaterStep(
        home,
        servicePlan.action === 'stop'
          ? 'Stopping the service'
          : servicePlan.action === 'start'
            ? 'Starting the service again'
            : `Installing ${short(servicePlan.nextRevision ?? readRaw(home)?.revision ?? null)} and starting it`,
      );
      return apply(host, servicePlan, confirm);
    },
  };
}
