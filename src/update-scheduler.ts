import { parseUpdateChannel, type UpdateAvailability, type UpdateChannel } from './update-availability.ts';
import {
  DEFAULT_UPDATE_SCHEDULE,
  isQuietHour,
  type AutoUpdateEvaluation,
  type AutoUpdatePolicy,
  type UpdateSchedule,
} from './update-policy.ts';

/**
 * F-102-T02: the scheduled automatic update with advance notice, under the owner's decision (F-102-T01): check once a
 * day, announce an available revision with its apply time, apply it at the apply hour unless the owner says "aspetta"
 * or "wait", never apply in the no-apply window, and report the result. Nothing runs while the opt-in policy is off.
 * F-110-T02: the hours and the mode (apply, or notify only) come from the saved policy's schedule, read on every tick
 * (defaults 20:00, 03:00, 08:00–23:00). Times are in the configured time zone. State lives in memory: after a restart
 * the next check announces again.
 */
export { isQuietHour };

export interface UpdateSchedulerSettings {
  timeZone: string;
  language: 'en' | 'it';
  target: string;
}

export interface UpdateSchedulerDeps {
  readPolicy(): AutoUpdatePolicy;
  check(channel: UpdateChannel): Promise<UpdateAvailability>;
  evaluate(input: { target: string; channel: UpdateChannel; revision?: string }): Promise<AutoUpdateEvaluation>;
  /** An owner notice: the inbox delivers it to Telegram, web push and the dashboard, once. */
  notify(message: string): void | Promise<void>;
  settings(): UpdateSchedulerSettings;
}

export interface ScheduledUpdate {
  revision: string;
  channel: UpdateChannel;
  applyAt: string;
}

export type UpdateSchedulerTick =
  | { action: 'disabled' }
  | { action: 'idle' }
  | { action: 'busy' }
  | { action: 'checked'; status: UpdateAvailability['status'] }
  | { action: 'announced'; revision: string; applyAt: string }
  | { action: 'postponed'; applyAt: string }
  | { action: 'evaluated'; evaluation: AutoUpdateEvaluation; nextApplyAt?: string };

export interface PostponeResult {
  postponed: boolean;
  reply?: string;
}

/** The wall-clock day, hour and minute of `now` in `timeZone`. */
export function localParts(now: Date, timeZone: string): { day: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
  };
}

/** The instant of `hour`:00 on the local day `day` (YYYY-MM-DD) in `timeZone`. */
export function zonedTime(day: string, hour: number, timeZone: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const wanted = Date.UTC(y, m - 1, d, hour);
  let guess = wanted;
  for (let i = 0; i < 2; i++) {
    const local = localParts(new Date(guess), timeZone);
    const [ly, lm, ld] = local.day.split('-').map(Number) as [number, number, number];
    guess += wanted - Date.UTC(ly, lm - 1, ld, local.hour, local.minute);
  }
  return new Date(guess);
}

/** The next apply hour (03:00 unless the schedule says otherwise) in `timeZone` strictly after `from`. */
export function nextApplyWindow(from: Date, timeZone: string, applyHour = DEFAULT_UPDATE_SCHEDULE.applyHour): Date {
  const local = localParts(from, timeZone);
  let candidate = zonedTime(local.day, applyHour, timeZone);
  while (candidate.getTime() <= from.getTime()) {
    const [y, m, d] = local.day.split('-').map(Number) as [number, number, number];
    const next = new Date(Date.UTC(y, m - 1, d) + candidate.getTime() - zonedTime(local.day, 0, timeZone).getTime());
    local.day = new Date(next.getTime() + 86_400_000).toISOString().slice(0, 10);
    candidate = zonedTime(local.day, applyHour, timeZone);
  }
  return candidate;
}

/** The owner's postponement, deliberately narrow: the bare word, so "wait, what is…" still reaches Misato. */
export function isPostponeCommand(text: string): boolean {
  return /^\s*(?:aspetta|wait)\s*[.!]*\s*$/i.test(text);
}

function rev7(revision: string): string {
  return revision.slice(0, 7);
}

function when(iso: string, timeZone: string, language: 'en' | 'it'): string {
  return new Intl.DateTimeFormat(language === 'it' ? 'it-IT' : 'en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

export function announceText(s: ScheduledUpdate, timeZone: string, language: 'en' | 'it'): string {
  const at = when(s.applyAt, timeZone, language);
  return language === 'it'
    ? `🔄 Aggiornamento ${rev7(s.revision)} disponibile (${s.channel}). Lo applico ${at} salvo tu dica "aspetta".`
    : `🔄 Update ${rev7(s.revision)} available (${s.channel}). Applying ${at} unless you say "wait".`;
}

export function notifyOnlyText(s: { revision: string; channel: UpdateChannel }, language: 'en' | 'it'): string {
  return language === 'it'
    ? `🔄 Aggiornamento ${rev7(s.revision)} disponibile (${s.channel}). Solo avviso: applicalo dalla dashboard.`
    : `🔄 Update ${rev7(s.revision)} available (${s.channel}). Notify only: apply it from the dashboard.`;
}

function cancelledText(s: ScheduledUpdate, language: 'en' | 'it'): string {
  return language === 'it'
    ? `⏹ L'aggiornamento ${rev7(s.revision)} non sarà applicato automaticamente (solo avviso).`
    : `⏹ Update ${rev7(s.revision)} will not be applied automatically (notify only).`;
}

export function postponedText(s: ScheduledUpdate, timeZone: string, language: 'en' | 'it'): string {
  const at = when(s.applyAt, timeZone, language);
  return language === 'it'
    ? `⏸ Va bene, aspetto: aggiornamento ${rev7(s.revision)} rimandato a ${at}.`
    : `⏸ Alright, waiting: update ${rev7(s.revision)} postponed to ${at}.`;
}

function applyingText(s: ScheduledUpdate, language: 'en' | 'it'): string {
  return language === 'it'
    ? `🔄 Applico l'aggiornamento ${rev7(s.revision)} (${s.channel}) adesso: backup, prova, installazione, verifica e riavvio.`
    : `🔄 Applying update ${rev7(s.revision)} (${s.channel}) now: backup, rehearsal, install, verify and restart.`;
}

export function resultText(
  evaluation: AutoUpdateEvaluation,
  s: ScheduledUpdate,
  nextApplyAt: string | undefined,
  timeZone: string,
  language: 'en' | 'it',
): string {
  const it = language === 'it';
  const rev = rev7(s.revision);
  const reasons = evaluation.reasons.join(' ');
  const recovery = evaluation.recovery.join(' ');
  const receipt = evaluation.receipt;
  const restarted = receipt?.steps.includes('restart') || receipt?.steps.includes('start');
  const health = receipt?.health;
  switch (evaluation.outcome) {
    case 'completed': {
      const parts: string[] = [];
      if (restarted) parts.push(it ? 'riavvio eseguito' : 'restarted');
      if (health) {
        if (health.ok) {
          parts.push(
            it
              ? `verifica dopo avvio OK${health.commit ? ` (${rev7(health.commit)})` : ''}`
              : `after-start health check OK${health.commit ? ` (${rev7(health.commit)})` : ''}`,
          );
        } else {
          parts.push(
            it
              ? `verifica dopo avvio fallita (${health.failures.join(', ')})`
              : `after-start health check failed (${health.failures.join(', ')})`,
          );
        }
      }
      return it
        ? `✅ Aggiornamento ${rev} applicato${parts.length ? `: ${parts.join(', ')}` : ''}.`
        : `✅ Update ${rev} applied${parts.length ? `: ${parts.join(', ')}` : ''}.`;
    }
    case 'refused': {
      const next = nextApplyAt ? when(nextApplyAt, timeZone, language) : undefined;
      return it
        ? `⛔ Aggiornamento ${rev} rinviato: ${reasons}${next ? ` Prossimo tentativo ${next}.` : ''}`
        : `⛔ Update ${rev} refused: ${reasons}${next ? ` Next try ${next}.` : ''}`;
    }
    case 'uncertain': {
      const details: string[] = [];
      if (reasons) details.push(reasons);
      if (health && !health.ok && health.failures.length) {
        details.push(
          it
            ? `Verifica dopo avvio fallita: ${health.failures.join(', ')}.`
            : `After-start health check failed: ${health.failures.join(', ')}.`,
        );
      }
      if (receipt?.restoredBackup) {
        details.push(
          it
            ? `Ripristinato backup ${rev7(receipt.restoredBackup.revision)}.`
            : `Restored backup ${rev7(receipt.restoredBackup.revision)}.`,
        );
      }
      return it
        ? `⚠️ Aggiornamento ${rev} non riuscito: ${details.join(' ')}${recovery ? ` Ripristino: ${recovery}` : ''}`
        : `⚠️ Update ${rev} failed: ${details.join(' ')}${recovery ? ` Recovery: ${recovery}` : ''}`;
    }
    default:
      return it ? `Aggiornamento ${rev} saltato: ${reasons}` : `Update ${rev} skipped: ${reasons}`;
  }
}

export class AutoUpdateScheduler {
  private scheduled: ScheduledUpdate | undefined;
  private lastCheckDay: string | undefined;
  private notified: string | undefined;
  private running = false;
  private readonly deps: UpdateSchedulerDeps;

  constructor(deps: UpdateSchedulerDeps) {
    this.deps = deps;
  }

  state(): { scheduled: ScheduledUpdate | undefined; lastCheckDay: string | undefined } {
    return { scheduled: this.scheduled ? { ...this.scheduled } : undefined, lastCheckDay: this.lastCheckDay };
  }

  /** One minute of the schedule: at most one check a day, one apply per announced revision. */
  async tick(now = new Date()): Promise<UpdateSchedulerTick> {
    if (this.running) return { action: 'busy' };
    this.running = true;
    try {
      return await this.step(now);
    } finally {
      this.running = false;
    }
  }

  /** "aspetta" / "wait": the announced update moves to the next apply hour. Undefined when the text is not that command. */
  postpone(text: string, now = new Date()): PostponeResult | undefined {
    if (!isPostponeCommand(text)) return undefined;
    if (!this.scheduled) return { postponed: false };
    const { timeZone, language } = this.deps.settings();
    const { applyHour } = this.schedule();
    const from = new Date(Math.max(now.getTime(), Date.parse(this.scheduled.applyAt)));
    this.scheduled = { ...this.scheduled, applyAt: nextApplyWindow(from, timeZone, applyHour).toISOString() };
    return { postponed: true, reply: postponedText(this.scheduled, timeZone, language) };
  }

  private schedule(): UpdateSchedule {
    return this.deps.readPolicy().schedule ?? DEFAULT_UPDATE_SCHEDULE;
  }

  private async step(now: Date): Promise<UpdateSchedulerTick> {
    const policy = this.deps.readPolicy();
    if (!policy.enabled) {
      this.scheduled = undefined;
      return { action: 'disabled' };
    }
    const schedule = policy.schedule ?? DEFAULT_UPDATE_SCHEDULE;
    const { timeZone, language, target } = this.deps.settings();
    const local = localParts(now, timeZone);
    if (schedule.mode === 'notify' && this.scheduled) {
      // Switched to notify only after an announcement: the announced apply is cancelled, and the owner told.
      const cancelled = this.scheduled;
      this.scheduled = undefined;
      this.notified = cancelled.revision;
      await this.deps.notify(cancelledText(cancelled, language));
    }
    if (this.scheduled && now.getTime() >= Date.parse(this.scheduled.applyAt)) {
      if (isQuietHour(local.hour, schedule)) {
        // A window missed while the service was down is never caught up during the day.
        const applyAt = nextApplyWindow(now, timeZone, schedule.applyHour).toISOString();
        this.scheduled = { ...this.scheduled, applyAt };
        return { action: 'postponed', applyAt };
      }
      const scheduled = this.scheduled;
      this.scheduled = undefined;
      await this.deps.notify(applyingText(scheduled, language));
      let evaluation: AutoUpdateEvaluation;
      try {
        evaluation = await this.deps.evaluate({ target, channel: scheduled.channel, revision: scheduled.revision });
      } catch (error) {
        evaluation = {
          outcome: 'refused',
          enabled: true,
          target,
          channel: scheduled.channel,
          revision: scheduled.revision,
          reasons: [error instanceof Error ? error.message : String(error)],
          recovery: [],
        };
      }
      let nextApplyAt: string | undefined;
      if (evaluation.outcome === 'refused') {
        nextApplyAt = nextApplyWindow(now, timeZone, schedule.applyHour).toISOString();
        this.scheduled = { ...scheduled, applyAt: nextApplyAt };
      }
      await this.deps.notify(resultText(evaluation, scheduled, nextApplyAt, timeZone, language));
      return { action: 'evaluated', evaluation, ...(nextApplyAt ? { nextApplyAt } : {}) };
    }
    if (local.hour >= schedule.checkHour && this.lastCheckDay !== local.day) {
      const channel = policy.channels[0] ?? parseUpdateChannel(undefined);
      // A failed check (network) is retried on the next minute until the day ends; a successful one is once a day.
      const availability = await this.deps.check(channel);
      this.lastCheckDay = local.day;
      if (
        schedule.mode === 'notify' &&
        availability.status === 'update-available' &&
        availability.availableRevision &&
        this.notified !== availability.availableRevision
      ) {
        this.notified = availability.availableRevision;
        await this.deps.notify(
          notifyOnlyText({ revision: availability.availableRevision, channel: availability.channel }, language),
        );
        return { action: 'checked', status: availability.status };
      }
      if (
        schedule.mode === 'apply' &&
        availability.status === 'update-available' &&
        availability.availableRevision &&
        this.scheduled?.revision !== availability.availableRevision
      ) {
        const scheduled: ScheduledUpdate = {
          revision: availability.availableRevision,
          channel: availability.channel,
          applyAt: nextApplyWindow(now, timeZone, schedule.applyHour).toISOString(),
        };
        this.scheduled = scheduled;
        await this.deps.notify(announceText(scheduled, timeZone, language));
        return { action: 'announced', revision: scheduled.revision, applyAt: scheduled.applyAt };
      }
      return { action: 'checked', status: availability.status };
    }
    return { action: 'idle' };
  }
}

/** Runs the scheduler once a minute during `serve`; the timer never keeps the process alive. */
export function startAutoUpdateScheduler(
  deps: UpdateSchedulerDeps & { onError?: (error: unknown) => void },
  everyMs = 60_000,
): { scheduler: AutoUpdateScheduler; stop: () => void } {
  const scheduler = new AutoUpdateScheduler(deps);
  const timer = setInterval(() => {
    scheduler.tick().catch((error: unknown) => deps.onError?.(error));
  }, everyMs);
  timer.unref();
  return { scheduler, stop: () => clearInterval(timer) };
}
