import type { Tool } from './policy.ts';
import type { Approval, SortieSummary } from './ledger.ts';
import type { Reminder, ReminderInput } from './store.ts';
import type { ToolDoc } from './misato.ts';
import type { Memory } from './memory.ts';
import { readConfig, savePilots, setSchedule } from './config.ts';
import { STAGES, applyPilotToolChange, mergePilots, nextStage, splitPilot, updatePilot, type Stage } from './pilots.ts';
import { reconcileReminderArgs } from './reminder-time.ts';
import { explainRecord, type WhyRecord } from './why.ts';
import { descriptorVersion, type ToolDescriptor } from './mcp.ts';
export interface AgencyBaseSnapshot {
  baseId: string;
  name: string;
  status: string;
  self: boolean;
  main: boolean;
  online: boolean;
  lastSeen: string | null;
  health: { state: string; reasons: string[] } | null;
  channel: { mode: string; destination?: string } | null;
}
export interface AgencySnapshot {
  health: { state: 'online' | 'degraded'; reasons: string[] };
  routes?: Record<string, unknown>;
  bases?: AgencyBaseSnapshot[];
}
/**
 * Built-in tools with an executor in the scheduler process (F-017). Each declares its effect class for the gate; an
 * executor runs only after `Ledger.authorize` accepted the grant for these exact arguments.
 */
export interface ReminderBackend {
  pendingReminders(limit?: number): Reminder[];
  add(title: string, due: string, now?: Date, options?: ReminderInput): Reminder & { existing?: true };
  update(
    id: string,
    patch: { title?: string; due?: string; kind?: string; end?: string | null },
    now?: Date,
  ): Reminder | undefined;
  cancel(id: string): boolean;
  restore(id: string): boolean;
  rescheduleAllDayReminders?(briefAt?: string, timeZone?: string): void;
  sortie?(id: string): { title: string } | null | undefined;
  sorties?(limit?: number, before?: string, q?: string): SortieSummary[];
  explain?(ref: string): { found: 'none' | 'many'; count?: number } | { found: 'one'; record: WhyRecord };
  approvals?(limit?: number): Approval[];
  waitingQuestions?(): { sortieId: string; title: string; text: string; expires: string }[];
  agencyStatus?(target?: string, live?: AgencySnapshot): unknown;
  reminderDefaults?(): { timeZone: string; briefAt: string; language: 'en' | 'it' };
  memory: Memory;
  home?: string;
  /** F-036 slice 3b: queues one action for another base; the coordinator sends it over the Kaji line. */
  queueRemote?(
    sortieId: string,
    base: string,
    tool: string,
    args: Record<string, unknown>,
    pilot?: string,
  ): { id: string };
}
export const builtinTools: Tool[] = [
  { name: 'reminders.list', effect: 'read' },
  { name: 'reminders.add', effect: 'write-local', inverse: 'reminders.cancel' },
  { name: 'reminders.update', effect: 'write-local', inverse: 'reminders.update' },
  { name: 'reminders.cancel', effect: 'write-local', inverse: 'reminders.restore', removes: true },
  { name: 'reminders.restore', effect: 'write-local', inverse: 'reminders.cancel' },
  { name: 'memory.recall', effect: 'read' },
  // A new fact is only stored after the owner approves its card: Misato never writes memory on its own.
  { name: 'memory.remember', effect: 'write-local', inverse: 'memory.forget', owner: true },
  { name: 'memory.edit', effect: 'write-local', owner: true },
  { name: 'memory.forget', effect: 'write-local', removes: true },
  // F-042: read-only agency tools over sorties/ballots, waiting approvals/questions, and base health/status.
  { name: 'sorties.explain', effect: 'read' },
  { name: 'approvals.list', effect: 'read' },
  { name: 'agency.status', effect: 'read' },
  // Only the brief and Instrumentality schedules: local, reversible by setting the previous values back.
  { name: 'settings.schedule', effect: 'write-local', inverse: 'settings.schedule' },
  // F-045: a new pilot, stage promotion, split/merge, or tool change only after the owner approves its card.
  { name: 'pilots.create', effect: 'write-local', owner: true },
  { name: 'pilots.promote', effect: 'write-local', owner: true },
  { name: 'pilots.split', effect: 'write-local', owner: true },
  { name: 'pilots.merge', effect: 'write-local', owner: true },
  { name: 'pilots.tools', effect: 'write-local', owner: true },
  // F-036 slice 3b: one action on another base. Owner-only for now (always a card); that base's own gate reviews it again.
  { name: 'kaji.run', effect: 'write-external', owner: true },
];
const text = (args: Record<string, unknown>, key: string) => {
  const v = args[key];
  if (typeof v !== 'string') throw new Error(`Argument ${key} must be a string.`);
  return v;
};
const only = (args: Record<string, unknown>, keys: string[]) => {
  if (Object.keys(args).some((k) => !keys.includes(k)))
    throw new Error(`Arguments allowed: ${keys.join(', ') || 'none'}.`);
};
/** What Misato is told about each built-in tool. */
export const toolDocs: ToolDoc[] = [
  {
    name: 'reminders.list',
    effect: 'read',
    about: 'Lists pending reminders (up to 20). The owner may call reminders notes, promemoria or note.',
    args: 'none, {}',
  },
  {
    name: 'reminders.add',
    effect: 'write-local',
    about:
      'Adds a reminder delivered to the local inbox when due. Set kind from the request: "all-day" for a day with no clock time ("on 3 March"), "at" for a clock time ("at 10"), "from-to" with "end" for a range ("between 10 and 12"), "from" for an open start ("after 15"), or "until" for a deadline ("by 18"). Never make up a clock time when the request only gives a day.',
    args: '{"title": text up to 500 characters, "due": ISO 8601 date-time in the future with an explicit offset or YYYY-MM-DD for all-day, "kind"?: "all-day" | "at" | "from-to" | "from" | "until", "end"?: ISO 8601 date-time with offset for from-to or until}',
  },
  {
    name: 'reminders.update',
    effect: 'write-local',
    about:
      "Updates an existing pending reminder's title and/or time by its id. Use this instead of reminders.add when the owner changes an existing reminder.",
    args: '{"id": reminder id, "title"?: new title up to 500 characters, "due"?: ISO 8601 date-time in the future with an explicit offset or YYYY-MM-DD for all-day, "kind"?: "all-day" | "at" | "from-to" | "from" | "until", "end"?: ISO 8601 date-time with offset or null} (at least one of title, due, kind, end)',
  },
  {
    name: 'reminders.cancel',
    effect: 'write-local',
    about:
      'Cancels pending reminders by id from reminders.list; several at once with ids. Undo with reminders.restore.',
    args: '{"id": reminder id} or {"ids": [up to 20 reminder ids]}',
  },
  {
    name: 'reminders.restore',
    effect: 'write-local',
    about: 'Restores cancelled reminders that are still in the future.',
    args: '{"id": reminder id} or {"ids": [up to 20 reminder ids]}',
  },
  {
    name: 'memory.recall',
    effect: 'read',
    about: 'Searches the facts the owner confirmed earlier (Lilith) by keywords.',
    args: '{"query": words to look for}',
  },
  {
    name: 'memory.remember',
    effect: 'write-local',
    about:
      'Proposes a lasting fact about the owner (a preference, a person, a routine). It always asks the owner first; store only what they stated, in their words.',
    args: '{"text": one fact, up to 500 characters} or {"texts": [2 to 10 facts, one subject per fact]}',
  },
  {
    name: 'memory.edit',
    effect: 'write-local',
    about:
      'Proposes updating an existing fact in memory (from the memory list or memory.recall) when the owner corrects or changes it. Always asks the owner first.',
    args: '{"id": existing fact id, "text": updated fact, up to 500 characters}',
  },
  {
    name: 'memory.forget',
    effect: 'write-local',
    about: 'Forgets a fact by its id from memory.recall or the memory list.',
    args: '{"id": fact id}',
  },
  {
    name: 'sorties.explain',
    effect: 'read',
    about:
      'Reads a sortie\'s record from the ledger by its short ID (such as "S-1A2B" or "1a2b"), or lists recent sorties when no ref is given: decision, ballot with each seat\'s vote and reason, peer seats, consultant advice, approver and time.',
    args: '{"ref"?: "S-1A2B" or hex prefix, "limit"?: 1 to 20}',
  },
  {
    name: 'approvals.list',
    effect: 'read',
    about:
      'Lists what is currently waiting for the owner: pending approval cards (sortie short ID, title, tool, arguments, Pattern, reason, ballot verdicts and expiry) and open clarification questions.',
    args: 'none, {}',
  },
  {
    name: 'agency.status',
    effect: 'read',
    about:
      "Reads this base's health (state, degraded reasons, model routes and pending reminders) and the status of all enrolled NERV bases (id, name, whether it is this base or the main base, online or offline, last seen, health state and reasons, and channel).",
    args: '{"base"?: base id or name}',
  },
  {
    name: 'settings.schedule',
    effect: 'write-local',
    about:
      "Changes when the daily brief is sent and when Instrumentality (nightly memory consolidation) runs. Times are the owner's local time.",
    args: '{"brief": "HH:MM" or "off", "instrumentality": "HH:MM", "idle" or "off"} (one or both)',
  },
  {
    name: 'pilots.create',
    effect: 'write-local',
    about:
      'Proposes a new pilot, a permanent specialist that advises you before you plan on requests with its keywords. The owner approves it first; it starts at Prototype.',
    args: '{"id": lower-case letters and dashes, "name": up to 40 characters, "domain": what it knows, "keywords": [1 to 30 words or short phrases], "model": a local model (optional: the generic pilot\'s)}',
  },
  {
    name: 'pilots.promote',
    effect: 'write-local',
    about:
      'Proposes promoting an existing pilot to the next trust stage (prototype -> test -> production). Always requires owner approval.',
    args: '{"id": pilot id, "stage": "test" or "production"}',
  },
  {
    name: 'pilots.split',
    effect: 'write-local',
    about:
      'Proposes splitting a narrower specialist pilot from an existing pilot with versioned lineage. Always requires owner approval.',
    args: '{"parentId": existing pilot id, "id": new pilot id, "name": up to 40 chars, "domain": narrower domain, "keywords": [1 to 30 words]}',
  },
  {
    name: 'pilots.merge',
    effect: 'write-local',
    about:
      'Proposes merging two overlapping pilots while preserving versioned lineage. Always requires owner approval.',
    args: '{"sourceIds": [leftId, rightId], "id": target pilot id, "name": optional name, "domain": optional domain, "keywords": optional array}',
  },
  {
    name: 'pilots.tools',
    effect: 'write-local',
    about: 'Proposes adding or discarding tools for an existing pilot. Always requires owner approval.',
    args: '{"id": pilot id, "add": [tool names] (optional), "remove": [tool names] (optional)}',
  },
];
/** Versioned descriptors for NERV's own tools, on the same shape used for registered MCP tools (F-021). */
export const builtinToolDescriptors: ToolDescriptor[] = builtinTools.map((tool) => {
  const doc = toolDocs.find((candidate) => candidate.name === tool.name);
  const dynamic =
    tool.name === 'kaji.run'
      ? {
          about:
            "Runs one gated action on another of the owner's enrolled bases; live offers supply the available tools.",
          args: '{"base": enrolled base id or name, "tool": offered tool name, "args": object}',
        }
      : undefined;
  if (!doc && !dynamic) throw new Error(`Tool registration has no descriptor: ${tool.name}`);
  const value = {
    name: tool.name,
    effect: tool.effect,
    description: (doc ?? dynamic)!.about,
    inputSchema: (doc ?? dynamic)!.args,
  };
  return { ...value, source: 'nerv', version: descriptorVersion(value) };
});
/** {id} or {ids: [...]} (1–20 distinct strings): bulk changes stay one reviewed action, bound by the gate's argument hash. */
function ids(args: Record<string, unknown>): string[] {
  only(args, ['id', 'ids']);
  if ('id' in args === 'ids' in args) throw new Error('Give id or ids.');
  const list = 'id' in args ? [text(args, 'id')] : args.ids;
  if (
    !Array.isArray(list) ||
    !list.length ||
    list.length > 20 ||
    list.some((v) => typeof v !== 'string' || !v || v.length > 100) ||
    new Set(list).size !== list.length
  )
    throw new Error('ids must be 1–20 distinct reminder ids.');
  return list as string[];
}
export function hasExecutor(tool: string): boolean {
  return builtinTools.some((t) => t.name === tool);
}
export function execute(
  backend: ReminderBackend,
  tool: string,
  args: Record<string, unknown>,
  context: { sortieId?: string; tainted?: boolean; agency?: AgencySnapshot } = {},
): unknown {
  switch (tool) {
    case 'sorties.explain': {
      only(args, ['ref', 'limit']);
      if (args.ref !== undefined) {
        if (!backend.explain) throw new Error('Sortie records are not available here.');
        const clean = text(args, 'ref').trim().replace(/^s-/i, '').toLowerCase();
        if (!/^[0-9a-f]{4,36}$/.test(clean)) throw new Error('ref must be a sortie short ID such as S-1A2B.');
        const found = backend.explain(clean);
        const defaults = backend.reminderDefaults
          ? backend.reminderDefaults()
          : { timeZone: 'Europe/Rome', briefAt: '08:00', language: 'en' as const };
        const summary = explainRecord(found, clean, defaults.language, defaults.timeZone);
        if (found.found !== 'one')
          return {
            found: found.found,
            ref: 'S-' + clean.slice(0, 4).toUpperCase(),
            ...(found.count ? { count: found.count } : {}),
            summary,
          };
        return {
          found: 'one',
          shortId: 'S-' + found.record.id.slice(0, 4).toUpperCase(),
          ...found.record,
          actions: found.record.actions.map((a) => ({
            ...a,
            ...(a.decision === 'approve' || a.decision === 'reject' || a.decision === 'edit'
              ? { approver: 'owner' }
              : {}),
          })),
          summary,
        };
      }
      if (!backend.sorties) throw new Error('Sortie records are not available here.');
      const limit = args.limit === undefined ? 10 : Number(args.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('limit must be 1–20.');
      return backend.sorties(limit).map((s) => ({
        id: s.id,
        shortId: 'S-' + s.id.slice(0, 4).toUpperCase(),
        source: s.source,
        title: s.title,
        status: s.status,
        why: s.why,
        actions: s.actions,
        waiting: s.waiting,
        patterns: s.patterns,
        created: s.created,
        ...(s.closed ? { closed: s.closed } : {}),
        ...(s.question ? { question: s.question } : {}),
      }));
    }
    case 'approvals.list': {
      only(args, []);
      const approvals = (backend.approvals ? backend.approvals(20) : []).map((a) => ({
        id: a.id,
        sortieId: a.card.sortieId,
        shortId: 'S-' + a.card.sortieId.slice(0, 4).toUpperCase(),
        title: (backend.sortie ? backend.sortie(a.card.sortieId)?.title : undefined) ?? '',
        tool: a.card.tool,
        args: a.card.args,
        effect: a.card.effect,
        pattern: a.card.pattern,
        reason: a.card.reason,
        verdicts: a.card.verdicts,
        expires: a.expires,
      }));
      const questions = (backend.waitingQuestions ? backend.waitingQuestions() : []).map((q) => ({
        sortieId: q.sortieId,
        shortId: 'S-' + q.sortieId.slice(0, 4).toUpperCase(),
        title: q.title,
        question: q.text,
        expires: q.expires,
      }));
      return { approvals, questions };
    }
    case 'agency.status': {
      only(args, ['base']);
      const target = args.base !== undefined ? text(args, 'base').trim() : undefined;
      if (target !== undefined && (!target || target.length > 80)) throw new Error('base must be 1–80 characters.');
      if (!backend.agencyStatus) throw new Error('Agency status is not available here.');
      return backend.agencyStatus(target, context.agency);
    }
    case 'reminders.list':
      only(args, []);
      return backend.pendingReminders(20).map((r) => ({
        id: r.id,
        title: r.title,
        due: r.due,
        ...(r.kind && r.kind !== 'at' ? { kind: r.kind } : {}),
        ...(r.end ? { end: r.end } : {}),
      }));
    case 'reminders.add': {
      only(args, ['title', 'due', 'kind', 'end']);
      const defaults = backend.reminderDefaults
        ? backend.reminderDefaults()
        : { timeZone: 'Europe/Rome', briefAt: '08:00' };
      const sortieTitle = context.sortieId && backend.sortie ? backend.sortie(context.sortieId)?.title : undefined;
      const effective = sortieTitle ? reconcileReminderArgs(sortieTitle, args, defaults) : args;
      const r = backend.add(text(effective, 'title'), text(effective, 'due'), new Date(), {
        ...(effective.kind !== undefined && effective.kind !== null ? { kind: text(effective, 'kind') } : {}),
        ...(effective.end !== undefined && effective.end !== null ? { end: text(effective, 'end') } : {}),
      });
      return {
        id: r.id,
        title: r.title,
        due: r.due,
        ...(r.kind !== 'at' ? { kind: r.kind } : {}),
        ...(r.end ? { end: r.end } : {}),
        ...(r.existing ? { existing: true, note: 'This reminder already existed; nothing was added.' } : {}),
      };
    }
    case 'reminders.update': {
      only(args, ['id', 'title', 'due', 'kind', 'end']);
      const id = text(args, 'id');
      const defaults = backend.reminderDefaults
        ? backend.reminderDefaults()
        : { timeZone: 'Europe/Rome', briefAt: '08:00' };
      const sortieTitle = context.sortieId && backend.sortie ? backend.sortie(context.sortieId)?.title : undefined;
      const effective =
        sortieTitle && typeof args.due === 'string' ? reconcileReminderArgs(sortieTitle, args, defaults) : args;
      const patch: { title?: string; due?: string; kind?: string; end?: string | null } = {};
      if (effective.title !== undefined && effective.title !== null) patch.title = text(effective, 'title');
      if (effective.due !== undefined && effective.due !== null) patch.due = text(effective, 'due');
      if (effective.kind !== undefined && effective.kind !== null) patch.kind = text(effective, 'kind');
      if (effective.end !== undefined) patch.end = effective.end === null ? null : text(effective, 'end');
      if (!Object.keys(patch).length) throw new Error('Give a new title or a new due time.');
      const r = backend.update(id, patch, new Date());
      if (!r) throw new Error(`No pending reminder with id ${id}.`);
      return {
        id: r.id,
        title: r.title,
        due: r.due,
        ...(r.kind !== 'at' ? { kind: r.kind } : {}),
        ...(r.end ? { end: r.end } : {}),
      };
    }
    case 'reminders.cancel': {
      const list = ids(args);
      return { cancelled: list.filter((id) => backend.cancel(id)), ids: list };
    }
    case 'reminders.restore': {
      const list = ids(args);
      return { restored: list.filter((id) => backend.restore(id)), ids: list };
    }
    case 'memory.recall':
      only(args, ['query']);
      return backend.memory
        .recall(text(args, 'query'))
        .map((f) => ({ id: f.id, text: f.text, source: f.source, tainted: f.tainted }));
    case 'memory.remember': {
      only(args, ['text']);
      const f = backend.memory.add(text(args, 'text'), 'misato', {
        tainted: context.tainted,
        ...(context.sortieId ? { sortieId: context.sortieId } : {}),
      });
      return { id: f.id, text: f.text };
    }
    case 'memory.edit': {
      only(args, ['id', 'text', 'oldText']);
      const id = text(args, 'id');
      const edited = backend.memory.edit(id, text(args, 'text'), 'misato');
      if (!edited) throw new Error(`No active fact with id ${id}.`);
      return { id: edited.id, text: edited.text };
    }
    case 'settings.schedule': {
      only(args, ['brief', 'instrumentality']);
      if (!Object.keys(args).length) throw new Error('Give brief and/or instrumentality.');
      if (!backend.home) throw new Error('Settings are not available here.');
      const updated = setSchedule(backend.home, {
        ...(args.brief !== undefined ? { brief: text(args, 'brief') } : {}),
        ...(args.instrumentality !== undefined ? { instrumentality: text(args, 'instrumentality') } : {}),
      });
      if (args.brief !== undefined && backend.rescheduleAllDayReminders) {
        backend.rescheduleAllDayReminders();
      }
      return updated;
    }
    case 'pilots.create': {
      only(args, ['id', 'name', 'domain', 'keywords', 'model']);
      if (!backend.home) throw new Error('Pilots are not available here.');
      const config = readConfig(backend.home);
      const model =
        typeof args.model === 'string' && args.model.trim()
          ? args.model
          : (config.models.roles?.consultant?.model ?? config.models.local?.model);
      if (!model) throw new Error('No local model for the pilot: set one with models set consultant MODEL.');
      const roster = config.pilots ?? [];
      if (roster.some((p) => p.id === args.id)) throw new Error(`A pilot ${String(args.id)} already exists.`);
      savePilots(backend.home, [
        ...roster,
        {
          id: text(args, 'id'),
          name: text(args, 'name'),
          domain: text(args, 'domain'),
          keywords: args.keywords as string[],
          model,
          stage: 'prototype',
          parent: 'generic',
        },
      ]);
      return { created: args.id, name: args.name, model, stage: 'prototype' };
    }
    case 'pilots.promote': {
      only(args, ['id', 'stage']);
      if (!backend.home) throw new Error('Pilots are not available here.');
      const id = text(args, 'id');
      const target = text(args, 'stage') as Stage;
      if (!STAGES.includes(target)) throw new Error('Target stage must be prototype, test or production.');
      const roster = readConfig(backend.home).pilots ?? [];
      const pilot = roster.find((p) => p.id === id);
      if (!pilot) throw new Error(`Unknown specialist pilot: ${id}.`);
      if (pilot.retired) throw new Error(`Pilot ${id} is retired.`);
      const expected = nextStage(pilot.stage);
      if (!expected || target !== expected)
        throw new Error(`Pilot ${id} at ${pilot.stage} can only be promoted to ${expected ?? 'none'}.`);
      savePilots(backend.home, updatePilot(roster, id, { stage: target }));
      return { promoted: id, from: pilot.stage, to: target };
    }
    case 'pilots.split': {
      only(args, ['parentId', 'id', 'name', 'domain', 'keywords', 'model', 'skills', 'tools']);
      if (!backend.home) throw new Error('Pilots are not available here.');
      const roster = readConfig(backend.home).pilots ?? [];
      const next = splitPilot(roster, text(args, 'parentId'), {
        id: text(args, 'id'),
        name: text(args, 'name'),
        domain: text(args, 'domain'),
        keywords: args.keywords as string[],
        ...(typeof args.model === 'string' ? { model: args.model } : {}),
        ...(Array.isArray(args.skills) ? { skills: args.skills as string[] } : {}),
        ...(Array.isArray(args.tools) ? { tools: args.tools as string[] } : {}),
      });
      savePilots(backend.home, next);
      const created = next.find((p) => p.id === args.id)!;
      return { split: created.id, from: created.parent, stage: created.stage, lineage: created.lineage };
    }
    case 'pilots.merge': {
      only(args, ['sourceIds', 'id', 'name', 'domain', 'keywords']);
      if (!backend.home) throw new Error('Pilots are not available here.');
      if (!Array.isArray(args.sourceIds) || args.sourceIds.length !== 2)
        throw new Error('sourceIds must be [leftId, rightId].');
      const roster = readConfig(backend.home).pilots ?? [];
      const next = mergePilots(roster, [String(args.sourceIds[0]), String(args.sourceIds[1])], {
        id: text(args, 'id'),
        ...(typeof args.name === 'string' ? { name: args.name } : {}),
        ...(typeof args.domain === 'string' ? { domain: args.domain } : {}),
        ...(Array.isArray(args.keywords) ? { keywords: args.keywords as string[] } : {}),
      });
      savePilots(backend.home, next);
      const merged = next.find((p) => p.id === args.id)!;
      return { merged: merged.id, version: merged.version, lineage: merged.lineage };
    }
    case 'pilots.tools': {
      only(args, ['id', 'add', 'remove']);
      if (!backend.home) throw new Error('Pilots are not available here.');
      const id = text(args, 'id');
      const add = args.add === undefined ? undefined : (args.add as string[]);
      const remove = args.remove === undefined ? undefined : (args.remove as string[]);
      if (add !== undefined && !Array.isArray(add)) throw new Error('add must be an array of tool names.');
      if (remove !== undefined && !Array.isArray(remove)) throw new Error('remove must be an array of tool names.');
      const roster = readConfig(backend.home).pilots ?? [];
      const res = applyPilotToolChange(roster, id, { add, remove });
      savePilots(backend.home, res.roster);
      return { id, added: res.added, removed: res.removed, tools: res.pilot.tools ?? [], version: res.pilot.version };
    }
    case 'memory.forget':
      only(args, ['id']);
      return { forgotten: backend.memory.forget(text(args, 'id'), 'misato') };
    case 'kaji.run': {
      only(args, ['base', 'tool', 'args', 'pilot']);
      const base = text(args, 'base'),
        tool = text(args, 'tool');
      const pilot = args.pilot === undefined ? undefined : text(args, 'pilot');
      if (pilot !== undefined && !/^[a-z0-9-]{1,40}$/.test(pilot))
        throw new Error('kaji.run pilot must be a valid pilot id (lowercase letters, digits, hyphens).');
      if (
        !/^[A-Z0-9-]{2,16}$/.test(base) ||
        !/^[a-z]+\.[a-z]+$/.test(tool) ||
        tool === 'kaji.run' ||
        !args.args ||
        typeof args.args !== 'object' ||
        Array.isArray(args.args)
      )
        throw new Error("kaji.run needs a base id, one of its actions and that action's arguments.");
      if (!backend.queueRemote || !context.sortieId)
        throw new Error('Running actions on other bases is not available here.');
      const q = backend.queueRemote(context.sortieId, base, tool, args.args as Record<string, unknown>, pilot);
      return {
        queued: true,
        to: base,
        tool,
        ...(pilot ? { pilot } : {}),
        id: q.id,
        note: 'Sent over the Kaji line; its result follows as a message.',
      };
    }
    default:
      throw new Error('No executor for this tool.');
  }
}
