import type { Step, ToolDoc } from './misato.ts';
/**
 * Compact tool index for the planner (F-113-T02). Built-in tools are grouped by subject (F-113-T01); the planner prompt
 * shows one line per subject until the planner reads a subject with `tools.read` (or already used one of its tools),
 * and only then that subject's full docs. Tools without a subject (granted MCP tools, kaji.run's live offer) and the
 * read tool itself always keep their full docs. This only shapes the prompt: every call still goes through the gate.
 */
export const TOOL_INDEX_READ = 'tools.read';

/** Granted subject reads that do not count against the planner's step limit (each request gets this many at most). */
export const MAX_FREE_SUBJECT_READS = 2;

/** Extra planning turns earned by granted subject reads, capped at MAX_FREE_SUBJECT_READS. */
export function freeReadTurns(steps: readonly Step[]): number {
  const reads = steps.filter((s) => s.tool === TOOL_INDEX_READ && s.outcome === 'grant' && !s.error).length;
  return Math.min(MAX_FREE_SUBJECT_READS, reads);
}

/** One planner-prompt line per subject: what it covers and its tool names. */
export const TOOL_SUBJECT_SUMMARIES: Readonly<Record<string, string>> = {
  reminders: 'pending reminders: list, add, change, cancel and restore them',
  memory: 'lasting facts the owner confirmed: recall, remember, edit and forget them',
  lists: "the owner's checklists (shopping, to-do): add items, show, tick and remove",
  docs: 'saved documents and recipes: list, show, compute amounts, save, edit and forget',
  gmail: "the owner's mailbox: search, read, draft and send mail",
  pantry: 'pantry purchases, shelf life and expiry checks',
  batteries: 'drone batteries: state, cycles, storage checks due and resistance readings',
  fleet: 'the drone fleet: aircraft, parts, flights and maintenance notes',
  fpv: 'FPV builds: blackbox vibration reports, build import, build documents and wiring answers',
  pilots: 'specialist pilots: create, promote, split, merge and change their tools',
  browser: "the browser page the owner allowed: click a named control, after the owner's approval card",
  agency:
    'the agency itself: sortie records, what waits for the owner, base health and status, schedules, other bases, desktop replay, coding PRs and printing',
};

export interface SubjectIndexEntry {
  readonly subject: string;
  readonly summary: string;
  readonly tools: readonly string[];
}

/** The one line the planner sees for a subject it has not read yet. */
export function formatSubjectLine(entry: SubjectIndexEntry): string {
  return `- ${entry.subject}: ${entry.summary}. Tools: ${entry.tools.join(', ')}`;
}

/** Full docs of one subject's tools among those offered, in catalogue order. */
export function subjectDocs<T extends ToolDoc>(docs: readonly T[], subject: string): T[] {
  return docs.filter((d) => d.subject === subject && d.name !== TOOL_INDEX_READ);
}

/** Subjects the planner has read with `tools.read` (granted, no error) or whose tools it already proposed. */
export function readSubjects(history: readonly Step[], docs: readonly ToolDoc[]): Set<string> {
  const subjectOf = new Map(docs.map((d) => [d.name, d.subject]));
  const out = new Set<string>();
  for (const step of history) {
    if (!step.tool) continue;
    if (step.tool === TOOL_INDEX_READ) {
      const subject = step.args?.subject;
      if (step.outcome === 'grant' && !step.error && typeof subject === 'string') out.add(subject);
      continue;
    }
    const subject = subjectOf.get(step.tool);
    if (subject) out.add(subject);
  }
  return out;
}

/**
 * Splits the offered tools into those shown in full and a one-line-per-subject index of the rest. Without the read
 * tool among the offered tools nothing is compacted, so the planner is never left without a way to read the docs.
 */
export function compactToolCatalogue<T extends ToolDoc>(
  docs: readonly T[],
  history: readonly Step[],
): { tools: T[]; index: SubjectIndexEntry[] } {
  if (!docs.some((d) => d.name === TOOL_INDEX_READ)) return { tools: [...docs], index: [] };
  const read = readSubjects(history, docs);
  const tools: T[] = [];
  const grouped = new Map<string, string[]>();
  for (const doc of docs) {
    const subject = doc.subject;
    if (doc.name === TOOL_INDEX_READ || !subject || read.has(subject)) {
      tools.push(doc);
      continue;
    }
    const names = grouped.get(subject) ?? [];
    names.push(doc.name);
    grouped.set(subject, names);
  }
  const index = [...grouped].map(([subject, names]) => ({
    subject,
    summary: TOOL_SUBJECT_SUMMARIES[subject] ?? subject,
    tools: names,
  }));
  return { tools, index };
}
