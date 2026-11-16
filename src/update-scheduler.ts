import type { UpdateChannel } from './update-availability.ts';
import type { AutoUpdateEvaluation, AutoUpdatePolicy } from './update-policy.ts';

export const UPDATE_CHECK_HOUR = 20;
export const UPDATE_APPLY_HOUR = 3;

export interface UpdateAvailabilitySummary {
  status: string;
  channel: UpdateChannel;
  availableRevision: string | null;
}

export interface UpdateNotice {
  message: string;
  revision: string;
  applyAt: string;
}

export interface UpdateSchedulerDeps {
  readPolicy: () => AutoUpdatePolicy;
  checkAvailability: () => Promise<UpdateAvailabilitySummary>;
  evaluate: (input: {
    policy: AutoUpdatePolicy;
    target: string;
    channel: UpdateChannel;
    revision?: string;
  }) => Promise<AutoUpdateEvaluation>;
  notify: (notice: UpdateNotice) => Promise<void> | void;
  target?: string;
}

export type UpdateSchedulerTickResult =
  | { action: 'disabled' }
  | { action: 'idle' }
  | { action: 'announced'; revision: string; applyAt: string }
  | { action: 'postponed'; nextApplyAt: string }
  | { action: 'evaluated'; evaluation: AutoUpdateEvaluation };

/** Returns true when automatic update application is allowed (outside 08:00–23:00). */
export function isApplyWindowAllowed(now: Date): boolean {
  const hour = now.getHours();
  return hour < 8 || hour >= 23;
}

/** Computes the next 03:00 apply window strictly after `from`. */
export function computeNextApplyWindow(from: Date): Date {
  const next = new Date(from.getTime());
  next.setHours(UPDATE_APPLY_HOUR, 0, 0, 0);
  if (next.getTime() <= from.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

/** Matches owner postponement replies ("aspetta" or "wait"). */
export function isPostponeCommand(text: string): boolean {
  return /^\s*(?:aspetta|wait)(?:\b|\s|$)/i.test(text);
}

function localDayKey(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Coordinates the daily 20:00 update availability check, advance notice in Telegram
 * and inbox, "aspetta"/"wait" postponement, and 03:00 evaluation under the opt-in
 * automatic update policy (F-102-T02).
 */
export class AutoUpdateScheduler {
  private readonly deps: UpdateSchedulerDeps;
  private lastCheckedDay: string | null = null;
  private announcedRevision: string | null = null;
  private announcedChannel: UpdateChannel | null = null;
  private scheduledApplyAt: string | null = null;
  private postponedUntil: string | null = null;

  constructor(deps: UpdateSchedulerDeps) {
    this.deps = deps;
  }

  state() {
    return {
      lastCheckedDay: this.lastCheckedDay,
      announcedRevision: this.announcedRevision,
      announcedChannel: this.announcedChannel,
      scheduledApplyAt: this.scheduledApplyAt,
      postponedUntil: this.postponedUntil,
    };
  }

  postpone(text: string, now = new Date()): { postponed: boolean; nextApplyAt?: string } {
    if (!isPostponeCommand(text)) return { postponed: false };
    const anchor = this.scheduledApplyAt ? new Date(Math.max(now.getTime(), Date.parse(this.scheduledApplyAt))) : now;
    const next = computeNextApplyWindow(anchor);
    const nextIso = next.toISOString();
    this.scheduledApplyAt = nextIso;
    this.postponedUntil = nextIso;
    return { postponed: true, nextApplyAt: nextIso };
  }

  async tick(now = new Date()): Promise<UpdateSchedulerTickResult> {
    const policy = this.deps.readPolicy();
    if (!policy.enabled) {
      return { action: 'disabled' };
    }

    if (
      this.scheduledApplyAt &&
      now.getTime() >= Date.parse(this.scheduledApplyAt) &&
      (!this.postponedUntil || now.getTime() >= Date.parse(this.postponedUntil))
    ) {
      if (!isApplyWindowAllowed(now)) {
        const nextIso = computeNextApplyWindow(now).toISOString();
        this.scheduledApplyAt = nextIso;
        return { action: 'postponed', nextApplyAt: nextIso };
      }
      const revision = this.announcedRevision ?? undefined;
      const channel = this.announcedChannel ?? policy.channels[0] ?? 'main';
      this.scheduledApplyAt = null;
      this.postponedUntil = null;
      const evaluation = await this.deps.evaluate({
        policy,
        target: this.deps.target ?? policy.targets[0] ?? 'local',
        channel,
        revision,
      });
      return { action: 'evaluated', evaluation };
    }

    const today = localDayKey(now);
    if (now.getHours() >= UPDATE_CHECK_HOUR && this.lastCheckedDay !== today) {
      this.lastCheckedDay = today;
      const availability = await this.deps.checkAvailability();
      if (availability.status === 'update-available' && availability.availableRevision) {
        const applyAt = computeNextApplyWindow(now).toISOString();
        this.announcedRevision = availability.availableRevision;
        this.announcedChannel = availability.channel;
        this.scheduledApplyAt = applyAt;
        const shortRev = availability.availableRevision.slice(0, 7);
        const hhmm = applyAt.slice(11, 16);
        await this.deps.notify({
          revision: availability.availableRevision,
          applyAt,
          message: `Update ${shortRev} available, applying at ${hhmm} UTC (${applyAt}) unless you say "wait" / "aspetta".`,
        });
        return { action: 'announced', revision: availability.availableRevision, applyAt };
      }
    }

    return { action: 'idle' };
  }
}
