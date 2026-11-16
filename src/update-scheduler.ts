import { parseUpdateChannel, type UpdateAvailability, type UpdateChannel } from './update-availability.ts';
import type { AutoUpdateEvaluation, AutoUpdatePolicy } from './update-policy.ts';

/**
 * F-102-T02: the scheduled automatic update with advance notice, under the owner's decision (F-102-T01): check once a
 * day at 20:00, announce an available revision with its apply time, apply at 03:00 unless the owner says "aspetta" or
 * "wait", never apply between 08:00 and 23:00, and report the result. Nothing runs while the opt-in policy is off.
 * Times are in the configured time zone. State lives in memory: after a restart the next 20:00 check announces again.
 */
export const UPDATE_CHECK_HOUR = 20;
export const UPDATE_APPLY_HOUR = 3;
/** No automatic apply from 08:00 until 23:00, the owner's waking hours. */
export const UPDATE_QUIET = { from: 8, until: 23 };

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

/** The next 03:00 in `timeZone` strictly after `from`. */
export function nextApplyWindow(from: Date, timeZone: string): Date {
  const local = localParts(from, timeZone);
  let candidate = zonedTime(local.day, UPDATE_APPLY_HOUR, timeZone);
  while (candidate.getTime() <= from.getTime()) {
    const [y, m, d] = local.day.split('-').map(Number) as [number, number, number];
    const next = new Date(Date.UTC(y, m - 1, d) + candidate.getTime() - zonedTime(local.day, 0, timeZone).getTime());
    local.day = new Date(next.getTime() + 86_400_000).toISOString().slice(0, 10);
    candidate = zonedTime(local.day, UPDATE_APPLY_HOUR, timeZone);
  }
  return candidate;
}

export function isQuietHour(hour: number): boolean {
  return hour >= UPDATE_QUIET.from && hour < UPDATE_QUIET.until;
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
  switch (evaluation.outcome) {
    case 'completed':
      return it ? `✅ Aggiornamento ${rev} applicato.` : `✅ Update ${rev} applied.`;
    case 'refused': {
      const next = nextApplyAt ? when(nextApplyAt, timeZone, language) : undefined;
      return it
        ? `⛔ Aggiornamento ${rev} rinviato: ${reasons}${next ? ` Prossimo tentativo ${next}.` : ''}`
        : `⛔ Update ${rev} refused: ${reasons}${next ? ` Next try ${next}.` : ''}`;
    }
    case 'uncertain':
      return it
        ? `⚠️ Aggiornamento ${rev}: esito incerto. ${reasons}${recovery ? ` Ripristino: ${recovery}` : ''}`
        : `⚠️ Update ${rev}: uncertain outcome. ${reasons}${recovery ? ` Recovery: ${recovery}` : ''}`;
    default:
      return it ? `Aggiornamento ${rev} saltato: ${reasons}` : `Update ${rev} skipped: ${reasons}`;
  }
}

export class AutoUpdateScheduler {
  private scheduled: ScheduledUpdate | undefined;
  private lastCheckDay: string | undefined;
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

  /** "aspetta" / "wait": the announced update moves to the next 03:00. Undefined when the text is not that command. */
  postpone(text: string, now = new Date()): PostponeResult | undefined {
    if (!isPostponeCommand(text)) return undefined;
    if (!this.scheduled) return { postponed: false };
    const { timeZone, language } = this.deps.settings();
    const from = new Date(Math.max(now.getTime(), Date.parse(this.scheduled.applyAt)));
    this.scheduled = { ...this.scheduled, applyAt: nextApplyWindow(from, timeZone).toISOString() };
    return { postponed: true, reply: postponedText(this.scheduled, timeZone, language) };
  }

  private async step(now: Date): Promise<UpdateSchedulerTick> {
    const policy = this.deps.readPolicy();
    if (!policy.enabled) {
      this.scheduled = undefined;
      return { action: 'disabled' };
    }
    const { timeZone, language, target } = this.deps.settings();
    const local = localParts(now, timeZone);
    if (this.scheduled && now.getTime() >= Date.parse(this.scheduled.applyAt)) {
      if (isQuietHour(local.hour)) {
        // A window missed while the service was down is never caught up during the day.
        const applyAt = nextApplyWindow(now, timeZone).toISOString();
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
        nextApplyAt = nextApplyWindow(now, timeZone).toISOString();
        this.scheduled = { ...scheduled, applyAt: nextApplyAt };
      }
      await this.deps.notify(resultText(evaluation, scheduled, nextApplyAt, timeZone, language));
      return { action: 'evaluated', evaluation, ...(nextApplyAt ? { nextApplyAt } : {}) };
    }
    if (local.hour >= UPDATE_CHECK_HOUR && this.lastCheckDay !== local.day) {
      const channel = policy.channels[0] ?? parseUpdateChannel(undefined);
      // A failed check (network) is retried on the next minute until the day ends; a successful one is once a day.
      const availability = await this.deps.check(channel);
      this.lastCheckDay = local.day;
      if (
        availability.status === 'update-available' &&
        availability.availableRevision &&
        this.scheduled?.revision !== availability.availableRevision
      ) {
        const scheduled: ScheduledUpdate = {
          revision: availability.availableRevision,
          channel: availability.channel,
          applyAt: nextApplyWindow(now, timeZone).toISOString(),
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
