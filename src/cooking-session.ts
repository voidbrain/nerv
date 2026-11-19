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
  { kind: 'start'; recipe: string; it: boolean } | { kind: 'first' | 'next' | 'repeat' | 'back' | 'stop' };

/** The owner's words for a cooking session, in Italian or English; anything else is not one. */
export function readCookingCommand(message: string): CookingCommand | undefined {
  const m = message.trim().replace(/[.!?]+$/, '');
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

interface Session {
  readonly title: string;
  /** The language the session started in: a one-word "avanti" or "next" does not tell. */
  readonly it: boolean;
  readonly parts: RecipeParts;
  step: number; // -1 before the first step
}

/** One cooking session per conversation, in memory: a restart ends it, and nothing about it is stored. */
export class CookingSessions {
  private readonly sessions = new Map<string, Session>();

  has(conversation: string): boolean {
    return this.sessions.has(conversation);
  }

  /** Starts a session on a saved recipe and lists its ingredients; a recipe with no saved steps is not walked through. */
  start(conversation: string, title: string, body: string, it: boolean): string {
    const parts = recipeParts(body);
    if (!parts.steps.length) {
      this.sessions.delete(conversation);
      return it
        ? `"${title}" non ha passaggi salvati come lista ("Procedimento:" e poi "1. …"): non posso guidarti passo per passo.`
        : `"${title}" has no saved steps as a list ("Steps:" then "1. …"), so I cannot walk you through it.`;
    }
    this.sessions.set(conversation, { title, it, parts, step: -1 });
    const head = it ? `${title} — ingredienti:` : `${title} — ingredients:`;
    const list = parts.ingredients.length
      ? parts.ingredients.map((i) => `• ${i}`).join('\n')
      : it
        ? '(nessun ingrediente salvato come lista)'
        : '(no ingredients saved as a list)';
    const next = it
      ? `${parts.steps.length} passaggi. Di' "vai col primo step" quando sei pronto.`
      : `${parts.steps.length} steps. Say "first step" when you are ready.`;
    return `${head}\n${list}\n\n${next}`;
  }

  /** Moves through the saved steps; undefined when this conversation has no session (the message is not for it). */
  move(conversation: string, kind: 'first' | 'next' | 'repeat' | 'back' | 'stop'): string | undefined {
    const s = this.sessions.get(conversation);
    if (!s) return undefined;
    const it = s.it;
    if (kind === 'stop') {
      this.sessions.delete(conversation);
      return it ? `Fine di ${s.title}.` : `Finished ${s.title}.`;
    }
    const last = s.parts.steps.length - 1;
    if (kind === 'first') s.step = 0;
    else if (kind === 'next') {
      if (s.step >= last) {
        this.sessions.delete(conversation);
        return it
          ? `Era l'ultimo passaggio di ${s.title}. Buon appetito.`
          : `That was the last step of ${s.title}. Enjoy.`;
      }
      s.step += 1;
    } else if (kind === 'back') s.step = Math.max(0, s.step - 1);
    else if (s.step < 0) s.step = 0;
    const n = s.step + 1;
    return `${it ? 'Passaggio' : 'Step'} ${n}/${s.parts.steps.length}: ${s.parts.steps[s.step]}`;
  }
}
