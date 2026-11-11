/** Per-action MAGI gate (F-017). Pure and deterministic: Casper's intent verdict comes from the model route. Lore names: docs/architecture/vocabulary.md. */
export type Effect = 'read' | 'write-local' | 'write-external' | 'irreversible' | 'physical';
export type Pattern = 'green' | 'orange' | 'blue';
export type Stage = 'prototype' | 'test' | 'production';
export type Trust = 'trusted' | 'tainted';
export type Executor = 'eva-00' | 'eva-01' | 'eva-02' | 'eva-03';
/** `owner`: every call reaches the owner (Pattern Blue) whatever the Scrolls say, e.g. a new fact in memory (F-022). */
/** `removes`: the action cancels or forgets something (B-009); it may be Green (undoable) but always gets Casper's intent check. */
export interface Tool {
  name: string;
  effect: Effect;
  inverse?: string;
  owner?: true;
  removes?: true;
  /** F-021: the EVA class an MCP tool was granted for (B-025). */ eva?: Executor;
}
/** The Scrolls: owner rules. Unknown keys are rejected so a typo cannot silently relax a rule. */
export interface Policy {
  deny: string[];
  blue: string[];
  syncThreshold: number;
  maxRejects: number;
  budget: number;
}
export interface Action {
  tool: string;
  args: Record<string, unknown>;
  trust: Trust;
  stage: Stage;
  cost: number;
  proactive?: boolean;
}
export interface Verdict {
  seat: string;
  vote: 'approve' | 'reject' | 'abstain';
  reason: string;
  confidence?: number;
  shadow?: boolean;
}
export interface Ballot {
  effect: Effect;
  pattern: Pattern;
  executor: Executor;
  verdicts: Verdict[];
  sync: { value: number; inputs: Record<string, number> };
  outcome: 'grant' | 'approval' | 'reject';
  reason: string;
  blocked?: 'isolation' | 'proactive' | 'budget';
}
export const effects: readonly Effect[] = ['read', 'write-local', 'write-external', 'irreversible', 'physical'];
export const defaultPolicy: Policy = { deny: [], blue: [], syncThreshold: 80, maxRejects: 3, budget: 1 };
const local = (e: Effect) => e === 'read' || e === 'write-local';
const effectFactor: Record<Effect, number> = {
  'read': 1,
  'write-local': 1,
  'write-external': 0.9,
  'irreversible': 0.6,
  'physical': 0.5,
};
const stageFactor: Record<Stage, number> = { prototype: 0.6, test: 0.85, production: 1 };
export function validatePolicy(value: unknown): Policy {
  const p = value as Record<string, unknown>;
  const names = (v: unknown) =>
    Array.isArray(v) && v.every((x) => typeof x === 'string' && x.length > 0 && x.length <= 100);
  if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).some((k) => !(k in defaultPolicy)))
    throw new Error('Invalid policy: unknown or missing fields.');
  const merged = { ...defaultPolicy, ...p } as Policy;
  if (
    !names(merged.deny) ||
    !names(merged.blue) ||
    !Number.isInteger(merged.syncThreshold) ||
    merged.syncThreshold < 0 ||
    merged.syncThreshold > 100 ||
    !Number.isInteger(merged.maxRejects) ||
    merged.maxRejects < 0 ||
    merged.maxRejects > 10 ||
    typeof merged.budget !== 'number' ||
    !Number.isFinite(merged.budget) ||
    merged.budget < 0
  )
    throw new Error('Invalid policy values.');
  return merged;
}
export function patternOf(effect: Effect, trust: Trust, tool: string, policy: Policy, ownerOnly = false): Pattern {
  if (
    ownerOnly ||
    effect === 'irreversible' ||
    effect === 'physical' ||
    policy.blue.includes(tool) ||
    (trust === 'tainted' && !local(effect))
  )
    return 'blue';
  return local(effect) ? 'green' : 'orange';
}
/** Casper checks intent for anything not Green, and for every action that removes something, Green or not (B-009). */
export function intentChecked(pattern: Pattern, tool: Tool | undefined): boolean {
  return pattern !== 'green' || tool?.removes === true;
}
/** EVA-00 shadow, EVA-01 bounded, EVA-02 production, EVA-03 quarantine for tainted local work. */
/** Most confined first: quarantine, shadow, bounded, production. */
const CONFINEMENT: Executor[] = ['eva-03', 'eva-00', 'eva-01', 'eva-02'];
/** B-025: a tool granted for an EVA class never runs less confined than that class, nor less than the stage allows. */
export function stricter(a: Executor, b: Executor | undefined): Executor {
  return b && CONFINEMENT.indexOf(b) < CONFINEMENT.indexOf(a) ? b : a;
}
export function executorOf(action: Action, effect: Effect): Executor {
  if (action.trust === 'tainted' && local(effect)) return 'eva-03';
  if (action.proactive && action.stage !== 'production') return 'eva-00';
  return action.stage === 'prototype' ? 'eva-00' : action.stage === 'test' ? 'eva-01' : 'eva-02';
}
export function melchior(action: Action, effect: Effect, policy: Policy): Verdict {
  if (policy.deny.includes(action.tool))
    return { seat: 'melchior', vote: 'reject', reason: 'Tool denied by the Scrolls.' };
  return { seat: 'melchior', vote: 'approve', reason: `Effect class ${effect}.` };
}
export function balthasar(action: Action, effect: Effect, executor: Executor, spent: number, policy: Policy): Verdict {
  if (!Number.isFinite(action.cost) || action.cost < 0)
    return { seat: 'balthasar', vote: 'reject', reason: 'Invalid action cost.' };
  if (spent + action.cost > policy.budget)
    return { seat: 'balthasar', vote: 'reject', reason: 'Battery exhausted: sortie budget exceeded.' };
  if (executor === 'eva-00' && !local(effect))
    return {
      seat: 'balthasar',
      vote: 'reject',
      reason: 'EVA-00 runs shadow work only: no external effects for this pilot stage or proactive sortie.',
    };
  return {
    seat: 'balthasar',
    vote: 'approve',
    reason:
      action.trust === 'tainted' ? 'Tainted context; external effects escalate.' : 'Within budget and executor class.',
  };
}
/** Extra seats are veto-only: their approvals never count, shadow seats are logged and ignored. */
/** Unregistered tools (no Tool) are treated as irreversible, so Pattern Blue. */
export function ballot(
  action: Action,
  tool: Tool | undefined,
  policy: Policy,
  spent: number,
  casper?: Verdict,
  extras: Verdict[] = [],
): Ballot {
  const effect = tool?.effect ?? 'irreversible';
  const pattern = patternOf(effect, action.trust, action.tool, policy, tool?.owner === true);
  const executor = stricter(executorOf(action, effect), tool?.eva);
  const verdicts = [melchior(action, effect, policy), balthasar(action, effect, executor, spent, policy)];
  if (action.proactive && action.stage !== 'production' && effect !== 'read')
    verdicts.push({
      seat: 'balthasar',
      vote: 'reject',
      reason: 'Proactive work is read-only until its pilot is Production.',
    });
  const isolationDenied =
    !!tool?.eva && (executor === 'eva-03' || (action.proactive === true && action.stage !== 'production'));
  if (isolationDenied)
    verdicts.push({
      seat: 'balthasar',
      vote: 'reject',
      reason:
        executor === 'eva-03'
          ? 'EVA-03 outside code requires isolation (F-049); it does not run.'
          : 'Proactive outside code requires EVA-00 isolation (F-049); it does not run.',
    });
  const needsCasper = intentChecked(pattern, tool);
  if (needsCasper && casper) verdicts.push({ ...casper, seat: 'casper' });
  verdicts.push(...extras.map((v) => ({ ...v, seat: 'extra:' + v.seat })));
  const inputs: Record<string, number> = { effect: effectFactor[effect], stage: stageFactor[action.stage] };
  if (needsCasper && casper?.vote === 'approve' && typeof casper.confidence === 'number')
    inputs.casper = Math.min(1, Math.max(0, casper.confidence));
  const value = Math.round(100 * Object.values(inputs).reduce((a, b) => a * b, 1));
  const veto = verdicts.find((v) => v.vote === 'reject' && !v.shadow);
  const blocked: Ballot['blocked'] = isolationDenied
    ? 'isolation'
    : action.proactive && action.stage !== 'production' && effect !== 'read'
      ? 'proactive'
      : undefined;
  const base = { effect, pattern, executor, verdicts, sync: { value, inputs }, ...(blocked ? { blocked } : {}) };
  if (veto) return { ...base, outcome: 'reject', reason: `${veto.seat}: ${veto.reason}` };
  if (needsCasper && (!casper || casper.vote !== 'approve'))
    return { ...base, outcome: 'approval', reason: 'Casper (intent) verdict unavailable; the owner decides.' };
  if (pattern === 'blue') return { ...base, outcome: 'approval', reason: 'Pattern Blue always needs the owner.' };
  if (value < policy.syncThreshold)
    return { ...base, outcome: 'approval', reason: `Sync Ratio ${value}% below ${policy.syncThreshold}%.` };
  return { ...base, outcome: 'grant', reason: `Sync Ratio ${value}%.` };
}
