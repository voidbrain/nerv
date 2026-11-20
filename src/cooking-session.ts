/**
 * F-083-T06: a saved recipe walked through one step at a time, by text (Telegram first). Only the saved lines are
 * shown, verbatim: NERV adds no step, quantity or advice of its own.
 */

/** The Ingredients and Steps lines of a saved recipe, as written. */
export interface RecipeParts {
  readonly ingredients: string[];
  readonly steps: string[];
}

const INGREDIENTS = /^\s*(ingredients|ingredienti)\s*:?\s*$/i;
const STEPS = /^\s*(steps|method|procedimento|passaggi|preparazione)\s*:?\s*$/i;
const ITEM = /^\s*(?:[-*•]|\d+[.)])\s+(.+?)\s*$/;

/** Reads the "Ingredients:" and "Steps:" sections; a line belongs to one only as a list item ("- …" or "1. …"). */
export function recipeParts(body: string): RecipeParts {
  const parts = { ingredients: [] as string[], steps: [] as string[] };
  let section: 'ingredients' | 'steps' | undefined;
  for (const line of body.split(/\r?\n/)) {
    if (INGREDIENTS.test(line)) section = 'ingredients';
    else if (STEPS.test(line)) section = 'steps';
    else if (section && ITEM.test(line)) parts[section].push(ITEM.exec(line)![1]!);
    else if (line.trim() && !ITEM.test(line) && /:\s*$/.test(line)) section = undefined;
  }
  return parts;
}

export type CookingCommand =
  | { kind: 'start'; recipe: string; it: boolean }
  | { kind: 'first' | 'next' | 'repeat' | 'back' | 'stop' }
  | { kind: 'timer-set'; seconds: number; it: boolean }
  | { kind: 'timer-confirm'; it: boolean }
  | { kind: 'timer-stop'; it: boolean };

const DURATION_UNIT = '(ore|ora|hours?|hrs?|h|minuti|minuto|minutes?|mins?|m|secondi|secondo|seconds?|secs?|s)';
const SET_TIMER = new RegExp(
  `^(?:(?:imposta|metti|avvia|fai\\s+partire|set|start)\\s+(?:un\\s+|il\\s+|a\\s+|the\\s+)?)?timer\\s+(?:di|da|for|of)\\s+(\\d+(?:[.,]\\d+)?)\\s*${DURATION_UNIT}$`,
  'i',
);
const STEP_DURATION = new RegExp(`\\b(\\d+(?:[.,]\\d+)?)\\s*${DURATION_UNIT}\\b`, 'i');

function toSeconds(rawAmount: string, rawUnit: string): number {
  const amount = Number(rawAmount.replace(',', '.'));
  const unit = rawUnit.toLowerCase();
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (unit.startsWith('h') || unit.startsWith('or')) return Math.round(amount * 3600);
  if (unit.startsWith('m')) return Math.round(amount * 60);
  return Math.round(amount);
}

/** Extracts a positive duration in seconds from a recipe step if one is written, else undefined. */
export function stepTimerSeconds(step: string): number | undefined {
  const m = STEP_DURATION.exec(step);
  if (!m) return undefined;
  const seconds = toSeconds(m[1]!, m[2]!);
  return seconds > 0 ? seconds : undefined;
}

function formatDuration(seconds: number, it: boolean): string {
  if (seconds >= 3600 && seconds % 3600 === 0) {
    const h = seconds / 3600;
    return it ? `${h} ${h === 1 ? 'ora' : 'ore'}` : `${h} ${h === 1 ? 'hour' : 'hours'}`;
  }
  if (seconds >= 60 && seconds % 60 === 0) {
    const m = seconds / 60;
    return it ? `${m} ${m === 1 ? 'minuto' : 'minuti'}` : `${m} ${m === 1 ? 'minute' : 'minutes'}`;
  }
  return it
    ? `${seconds} ${seconds === 1 ? 'secondo' : 'secondi'}`
    : `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;
}

/** The owner's words for a cooking session, in Italian or English; anything else is not one. */
export function readCookingCommand(message: string): CookingCommand | undefined {
  const m = message.trim().replace(/[.!?]+$/, '');
  const timerSet = SET_TIMER.exec(m);
  if (timerSet) {
    const seconds = toSeconds(timerSet[1]!, timerSet[2]!);
    if (seconds > 0) {
      return {
        kind: 'timer-set',
        seconds,
        it: /^(?:imposta|metti|avvia|fai\s+partire)\b|\b(?:di|da)\b|\b(?:minuti|minuto|secondi|secondo|ore|ora)$/i.test(
          m,
        ),
      };
    }
  }
  if (/^(?:stoppa|ferma|annulla|togli|spegni)\s+(?:il\s+)?timer$/i.test(m)) {
    return { kind: 'timer-stop', it: true };
  }
  if (/^(?:stop|cancel|clear)\s+(?:the\s+)?timer$/i.test(m)) {
    return { kind: 'timer-stop', it: false };
  }
  if (/^(?:sono\s+pronto|pronto|avvia(?:\s+il)?\s+timer)$/i.test(m)) {
    return { kind: 'timer-confirm', it: true };
  }
  if (/^(?:i'?m\s+ready|ready|start(?:\s+the)?\s+timer)$/i.test(m)) {
    return { kind: 'timer-confirm', it: false };
  }
  const start =
    /^(?:let'?s\s+cook|cook|cuciniamo|cucina|prepariamo)\s+(?:the\s+|la\s+|il\s+|lo\s+|i\s+|le\s+|gli\s+)?(.{1,120})$/i.exec(
      m,
    );
  if (start)
    return {
      kind: 'start',
      recipe: start[1]!.replace(/\s+recipe$|^ricetta\s+(?:del(?:la|lo|l')?\s+)?/i, '').trim(),
      // The verb says the language: a recipe's name may well be in the other one.
      it: /^(?:cuciniamo|cucina|prepariamo)\b/i.test(m),
    };
  if (/^(?:vai\s+col\s+primo\s+step|primo\s+step|primo\s+passaggio|first\s+step|start\s+cooking)$/i.test(m))
    return { kind: 'first' };
  if (/^(?:avanti|prossimo|next(?:\s+step)?)$/i.test(m)) return { kind: 'next' };
  if (/^(?:ripeti|di\s+nuovo|repeat|again)$/i.test(m)) return { kind: 'repeat' };
  if (/^(?:indietro|torna\s+indietro|back|previous(?:\s+step)?)$/i.test(m)) return { kind: 'back' };
  if (/^(?:basta|fine|stop\s+cooking|stop|done\s+cooking)$/i.test(m)) return { kind: 'stop' };
  return undefined;
}

interface TimerScheduler {
  schedule(fn: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
}

const DEFAULT_SCHEDULER: TimerScheduler = {
  schedule: (fn, ms) => setTimeout(fn, ms).unref(),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

import type { RecipePhoto } from '../shared/surface.ts';

interface Session {
  readonly title: string;
  /** The language the session started in: a one-word "avanti" or "next" does not tell. */
  readonly it: boolean;
  readonly parts: RecipeParts;
  readonly photos: readonly RecipePhoto[];
  step: number; // -1 before the first step
  pendingTimerSeconds?: number;
  timerHandle?: unknown;
}

function formatPhotoLines(photos: readonly RecipePhoto[], label: string): string {
  if (!photos.length) return '';
  const items = photos.map((p) => (p.caption ? `${p.url} (${p.caption})` : p.url));
  return `\n\n${label}: ${items.join(', ')}`;
}

/** One cooking session per conversation, in memory: a restart ends it, and nothing about it is stored. */
export class CookingSessions {
  private readonly sessions = new Map<string, Session>();
  private readonly scheduler: TimerScheduler;

  constructor(scheduler: TimerScheduler = DEFAULT_SCHEDULER) {
    this.scheduler = scheduler;
  }

  has(conversation: string): boolean {
    return this.sessions.has(conversation);
  }

  private clearTimer(session: Session): void {
    if (session.timerHandle !== undefined) {
      this.scheduler.cancel(session.timerHandle);
      session.timerHandle = undefined;
    }
  }

  private endSession(conversation: string): void {
    const existing = this.sessions.get(conversation);
    if (existing) this.clearTimer(existing);
    this.sessions.delete(conversation);
  }

  /** Starts a session on a saved recipe and lists its ingredients; a recipe with no saved steps is not walked through. */
  start(conversation: string, title: string, body: string, it: boolean, photos: readonly RecipePhoto[] = []): string {
    const parts = recipeParts(body);
    if (!parts.steps.length) {
      this.endSession(conversation);
      return it
        ? `"${title}" non ha passaggi salvati come lista ("Procedimento:" e poi "1. …"): non posso guidarti passo per passo.`
        : `"${title}" has no saved steps as a list ("Steps:" then "1. …"), so I cannot walk you through it.`;
    }
    this.endSession(conversation);
    this.sessions.set(conversation, { title, it, parts, photos, step: -1 });
    const head = it ? `${title} — ingredienti:` : `${title} — ingredients:`;
    const list = parts.ingredients.length
      ? parts.ingredients.map((i) => `• ${i}`).join('\n')
      : it
        ? '(nessun ingrediente salvato come lista)'
        : '(no ingredients saved as a list)';
    const recipePhotos = photos.filter((p) => p.stepIndex === null || p.stepIndex === undefined);
    const photoText = formatPhotoLines(recipePhotos, it ? 'Foto' : 'Photos');
    const next = it
      ? `${parts.steps.length} passaggi. Di' "vai col primo step" quando sei pronto.`
      : `${parts.steps.length} steps. Say "first step" when you are ready.`;
    return `${head}\n${list}${photoText}\n\n${next}`;
  }

  /** Moves through the saved steps; undefined when this conversation has no session (the message is not for it). */
  move(conversation: string, kind: 'first' | 'next' | 'repeat' | 'back' | 'stop'): string | undefined {
    const s = this.sessions.get(conversation);
    if (!s) return undefined;
    const it = s.it;
    if (kind === 'stop') {
      this.endSession(conversation);
      return it ? `Fine di ${s.title}.` : `Finished ${s.title}.`;
    }
    const last = s.parts.steps.length - 1;
    if (kind === 'first') s.step = 0;
    else if (kind === 'next') {
      if (s.step >= last) {
        this.endSession(conversation);
        return it
          ? `Era l'ultimo passaggio di ${s.title}. Buon appetito.`
          : `That was the last step of ${s.title}. Enjoy.`;
      }
      s.step += 1;
    } else if (kind === 'back') s.step = Math.max(0, s.step - 1);
    else if (s.step < 0) s.step = 0;
    const n = s.step + 1;
    const stepText = s.parts.steps[s.step]!;
    const timerSecs = stepTimerSeconds(stepText);
    s.pendingTimerSeconds = timerSecs;
    const line = `${it ? 'Passaggio' : 'Step'} ${n}/${s.parts.steps.length}: ${stepText}`;
    const stepPhotos = s.photos.filter((p) => p.stepIndex === s.step);
    const photoText = formatPhotoLines(stepPhotos, it ? 'Foto passaggio' : 'Step photo');
    if (!timerSecs) return `${line}${photoText}`;
    const ask = it ? 'dimmi quando pronto che avvio il timer' : 'tell me when ready to start the timer';
    return `${line}${photoText}\n\n${ask} (${formatDuration(timerSecs, it)}).`;
  }

  /** Sets a timer in an active cooking session; announces completion with its own line via onExpire. */
  setTimer(conversation: string, seconds: number, onExpire: (line: string) => void): string | undefined {
    const s = this.sessions.get(conversation);
    if (!s) return undefined;
    this.clearTimer(s);
    s.pendingTimerSeconds = undefined;
    const it = s.it;
    const label = formatDuration(seconds, it);
    s.timerHandle = this.scheduler.schedule(() => {
      s.timerHandle = undefined;
      onExpire(it ? `Timer scaduto (${label}) — ${s.title}.` : `Timer finished (${label}) — ${s.title}.`);
    }, seconds * 1000);
    return it ? `Timer impostato: ${label}.` : `Timer set: ${label}.`;
  }

  /** Starts the pending timer suggested by the current step; undefined when no session or no pending timer. */
  confirmTimer(conversation: string, onExpire: (line: string) => void): string | undefined {
    const s = this.sessions.get(conversation);
    if (!s || !s.pendingTimerSeconds) return undefined;
    return this.setTimer(conversation, s.pendingTimerSeconds, onExpire);
  }

  /** Stops the active timer in a cooking session; undefined when this conversation has no session. */
  stopTimer(conversation: string): string | undefined {
    const s = this.sessions.get(conversation);
    if (!s) return undefined;
    const hadTimer = s.timerHandle !== undefined;
    this.clearTimer(s);
    const it = s.it;
    if (!hadTimer) return it ? 'Nessun timer attivo.' : 'No active timer.';
    return it ? 'Timer fermato.' : 'Timer stopped.';
  }
}
