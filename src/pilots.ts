/**
 * Pilots (F-045): the owner's permanent agents, as data. Slice 1: a local roster in config.json, the generic pilot (the
 * consultant model of F-025, for anything no specialist covers) and advice mode: before Misato plans, the pilot whose
 * domain fits the request gives short advice. Advice is data in Misato's prompt, never a vote or an action.
 * Explicit proactive watches may bind their local planner model/stage to a named pilot (F-026); ordinary chat remains advice mode.
 * Later slices: pilots offered by other bases, pilots that act in an EVA, new specialists proposed from unmatched jobs.
 */
export type Stage = 'prototype' | 'test' | 'production';
export interface Pilot {
  id: string;
  name: string;
  domain: string;
  keywords: string[];
  model: string;
  stage: Stage;
  parent?: string;
  pinned?: boolean;
  retired?: boolean;
}
/** The pilot chosen for one request: who, on which model, and why it was chosen. */
export interface Chosen {
  id: string;
  name: string;
  domain: string;
  model: string;
  why: 'pinned' | 'keywords';
}
export const GENERIC = 'generic';
export const STAGES: readonly Stage[] = ['prototype', 'test', 'production'];
const MAX_PILOTS = 30;
/** Lower case, accents removed, words only: "Perché la stampa 3D?" → "perche la stampa 3d". */
export function words(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
/** B-027: domain labels overlap when they share a significant whole word. */
export function overlappingDomains(left: string, right: string): boolean {
  const a = words(left),
    b = words(right);
  if (a === b) return true;
  const significant = (text: string) =>
    text.split(' ').filter((w) => w.length >= 4 && !['with', 'from', 'that', 'this', 'and', 'for', 'the'].includes(w));
  const terms = new Set(significant(a));
  return significant(b).some((w) => terms.has(w));
}
/** Checks the roster from config.json; the generic pilot is implicit (its model is roles.consultant) and never listed. */
export function validatePilots(value: unknown): Pilot[] {
  if (!Array.isArray(value) || value.length > MAX_PILOTS)
    throw new Error(`Invalid pilots: a list of at most ${MAX_PILOTS}.`);
  const out: Pilot[] = [];
  for (const raw of value) {
    const p = raw as Record<string, unknown>;
    if (
      !p ||
      typeof p !== 'object' ||
      Array.isArray(p) ||
      Object.keys(p).some(
        (k) => !['id', 'name', 'domain', 'keywords', 'model', 'stage', 'parent', 'pinned', 'retired'].includes(k),
      )
    )
      throw new Error('Invalid pilot: id, name, domain, keywords, model, stage, parent, pinned, retired.');
    if (typeof p.id !== 'string' || !/^[a-z][a-z0-9-]{1,30}$/.test(p.id) || p.id === GENERIC)
      throw new Error(
        `Invalid pilot id ${JSON.stringify(p.id)}: lower-case letters, digits and dashes, not "${GENERIC}".`,
      );
    if (out.some((o) => o.id === p.id)) throw new Error(`Pilot ${p.id} is listed twice.`);
    if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 40)
      throw new Error(`Pilot ${p.id}: a name up to 40 characters.`);
    if (typeof p.domain !== 'string' || !p.domain.trim() || p.domain.length > 200)
      throw new Error(`Pilot ${p.id}: a domain up to 200 characters.`);
    if (
      !Array.isArray(p.keywords) ||
      !p.keywords.length ||
      p.keywords.length > 30 ||
      p.keywords.some((k) => typeof k !== 'string' || !words(k) || k.length > 40)
    )
      throw new Error(`Pilot ${p.id}: 1 to 30 keywords, each up to 40 characters.`);
    if (typeof p.model !== 'string' || !p.model.trim() || p.model.length > 100)
      throw new Error(`Pilot ${p.id}: a local model name.`);
    if (p.stage !== undefined && !STAGES.includes(p.stage as Stage))
      throw new Error(`Pilot ${p.id}: stage is prototype, test or production.`);
    if (p.parent !== undefined && (typeof p.parent !== 'string' || !/^[a-z][a-z0-9-]{1,30}$/.test(p.parent)))
      throw new Error(`Pilot ${p.id}: parent is a pilot id or "${GENERIC}".`);
    for (const f of ['pinned', 'retired'] as const)
      if (p[f] !== undefined && typeof p[f] !== 'boolean') throw new Error(`Pilot ${p.id}: ${f} is true or false.`);
    out.push({
      id: p.id,
      name: p.name.trim(),
      domain: p.domain.trim(),
      keywords: [...new Set((p.keywords as string[]).map(words))],
      model: p.model.trim(),
      stage: (p.stage as Stage | undefined) ?? 'prototype',
      ...(p.parent ? { parent: p.parent as string } : {}),
      ...(p.pinned ? { pinned: true } : {}),
      ...(p.retired ? { retired: true } : {}),
    });
  }
  for (const p of out)
    if (p.parent && p.parent !== GENERIC && !out.some((o) => o.id === p.parent))
      throw new Error(`Pilot ${p.id}: parent ${p.parent} is not in the roster.`);
  return out;
}
/** How many of a pilot's keywords (whole words or phrases) the request contains. */
export function hits(request: string, pilot: Pick<Pilot, 'keywords'>): number {
  const text = ` ${words(request)} `;
  return pilot.keywords.filter((k) => text.includes(` ${k} `)).length;
}
/**
 * The specialist for a request, if any: among active pilots whose keywords it contains, a pinned one first, then the
 * most keywords matched, then the later trust stage, then the id. Undefined means the generic pilot (or none) advises.
 */
export function choosePilot(request: string, roster: readonly Pilot[]): Chosen | undefined {
  const scored = roster
    .filter((p) => !p.retired)
    .map((p) => ({ p, n: hits(request, p) }))
    .filter((x) => x.n > 0);
  scored.sort(
    (a, b) =>
      Number(!!b.p.pinned) - Number(!!a.p.pinned) ||
      b.n - a.n ||
      STAGES.indexOf(b.p.stage) - STAGES.indexOf(a.p.stage) ||
      a.p.id.localeCompare(b.p.id),
  );
  const best = scored[0];
  if (!best) return undefined;
  return {
    id: best.p.id,
    name: best.p.name,
    domain: best.p.domain,
    model: best.p.model,
    why: best.p.pinned ? 'pinned' : 'keywords',
  };
}
/** The roster as `nerv pilots` prints it, the generic pilot first. */
export function describePilots(roster: readonly Pilot[], generic: string | null): string {
  const lines = [
    `generic · Generic pilot · anything no specialist covers · ${generic ?? 'off (nerv pilots generic MODEL)'}`,
  ];
  for (const p of roster)
    lines.push(
      `${p.id} · ${p.name} · ${p.domain} · ${p.model} · ${p.stage}${p.pinned ? ' · pinned' : ''}${p.retired ? ' · retired' : ''}${p.parent && p.parent !== GENERIC ? ` · from ${p.parent}` : ''}\n   keywords: ${p.keywords.join(', ')}`,
    );
  return lines.join('\n');
}
