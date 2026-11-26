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
  /** F-089-T06: every call waits for the owner's approval card, whatever the Sync Ratio; the pattern stays its effect class. */
  card?: true;
  /** F-021: the EVA class an MCP tool was granted for (B-025). */ eva?: Executor;
}
/** The Scrolls: owner rules. Unknown keys are rejected so a typo cannot silently relax a rule. */
export interface Policy {
  deny: string[];
  blue: string[];
  localOnly?: string[];
  egressAllow?: string[];
  syncThreshold: number;
  maxRejects: number;
  budget: number;
}
export interface EgressDestination {
  readonly host: string;
  readonly port: number;
}
export const EVA_DENIED_LOCAL_PORTS: readonly number[] = [4317, 4319];
const DENIED_EGRESS_PORTS = new Set(EVA_DENIED_LOCAL_PORTS);

function parseIpv4Strict(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let num = 0;
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    num = (num << 8) | n;
  }
  return num >>> 0;
}

function parseIpv6ToBigInt(ip: string): bigint | null {
  const lower = ip.toLowerCase();
  const dbl = lower.indexOf('::');
  if (dbl !== -1 && lower.indexOf('::', dbl + 2) !== -1) return null;

  const parseSide = (side: string): number[] | null => {
    if (!side) return [];
    const parts = side.split(':');
    const out: number[] = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.includes('.')) {
        if (i !== parts.length - 1) return null;
        const v4 = parseIpv4Strict(part);
        if (v4 === null) return null;
        out.push((v4 >>> 16) & 0xffff, v4 & 0xffff);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
        out.push(Number.parseInt(part, 16));
      }
    }
    return out;
  };

  let hextets: number[];
  if (dbl !== -1) {
    const left = parseSide(lower.slice(0, dbl));
    const right = parseSide(lower.slice(dbl + 2));
    if (!left || !right) return null;
    const missing = 8 - (left.length + right.length);
    if (missing < 1) return null;
    hextets = [...left, ...new Array<number>(missing).fill(0), ...right];
  } else {
    const full = parseSide(lower);
    if (!full || full.length !== 8) return null;
    hextets = full;
  }

  let val = 0n;
  for (const h of hextets) val = (val << 16n) | BigInt(h);
  return val;
}

function isBlockedIpv4Number(n: number, allowExplicitLoopback: boolean): string | null {
  const inCidr = (base: number, prefix: number) => {
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    return (n & mask) === (base & mask);
  };
  if (inCidr(0x00000000, 8)) return 'Unspecified IPv4 range is blocked.';
  if (inCidr(0xa9fe0000, 16)) return 'Link-local / cloud metadata range (169.254.0.0/16) is blocked.';
  if (inCidr(0x7f000000, 8)) return allowExplicitLoopback ? null : 'Loopback address is blocked.';
  if (inCidr(0x0a000000, 8) || inCidr(0xac100000, 12) || inCidr(0xc0a80000, 16)) {
    return 'Private IPv4 network is blocked.';
  }
  if (inCidr(0x64400000, 10)) return 'Shared address space (100.64.0.0/10) is blocked.';
  if (inCidr(0xe0000000, 4) || inCidr(0xf0000000, 4)) return 'Multicast or reserved IPv4 range is blocked.';
  return null;
}

/**
 * Returns a human-readable block reason when `ip` is link-local, metadata, unspecified, multicast, private,
 * or (unless `allowExplicitLoopback` is true) loopback. Parses IPv6 into 128-bit values to catch all
 * mapped/compatible/NAT64/6to4/non-canonical encodings.
 */
export function isBlockedEgressIp(ip: string, allowExplicitLoopback = false): string | null {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, '');
  const v4 = parseIpv4Strict(lower);
  if (v4 !== null) return isBlockedIpv4Number(v4, allowExplicitLoopback);

  const v6 = parseIpv6ToBigInt(lower);
  if (v6 === null) return `Unsupported address format: ${ip}`;
  if (v6 === 0n) return 'Unspecified IPv6 address is blocked.';
  if (v6 === 1n) return allowExplicitLoopback ? null : 'Loopback IPv6 address is blocked.';
  const prefix96 = v6 >> 32n;
  if (prefix96 === 0xffffn || prefix96 === 0n || prefix96 === 0x0064ff9b_00000000_00000000n) {
    return isBlockedIpv4Number(Number(v6 & 0xffffffffn) >>> 0, allowExplicitLoopback);
  }
  if (v6 >> 112n === 0x2002n) {
    return isBlockedIpv4Number(Number((v6 >> 80n) & 0xffffffffn) >>> 0, allowExplicitLoopback);
  }
  if (v6 >> 118n === 0x3fan) return 'Link-local IPv6 range is blocked.';
  if (v6 >> 121n === 0x7en) return 'Unique-local / cloud metadata IPv6 range is blocked.';
  if (v6 >> 120n === 0xffn) return 'Multicast IPv6 range is blocked.';
  return null;
}

const isBlockedLiteralHost = (host: string): boolean => {
  const h = host.toLowerCase();
  if (h === 'metadata' || h === 'metadata.google.internal') return true;
  if (parseIpv4Strict(h) !== null || parseIpv6ToBigInt(h) !== null) {
    return isBlockedEgressIp(h, true) !== null;
  }
  return false;
};
/** Parses and validates a Scrolls egress destination (`host`, `host:port`, `[ipv6]`, or `[ipv6]:port`). */
export function parseEgressDestination(raw: string): EgressDestination {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 253)
    throw new Error('Egress destination must be a non-empty string (max 253 chars).');
  if (/[\s*@#/?\\]/.test(raw) || /[\u0000-\u001f\u007f]/.test(raw) || raw.includes('://'))
    throw new Error(`Invalid egress destination: ${raw}`);
  let host: string;
  let port = 443;
  if (raw.startsWith('[')) {
    const close = raw.indexOf(']');
    if (close <= 1) throw new Error(`Invalid IPv6 egress destination: ${raw}`);
    host = raw.slice(1, close).toLowerCase();
    if (parseIpv6ToBigInt(host) === null) throw new Error(`Invalid IPv6 egress destination: ${raw}`);
    const rest = raw.slice(close + 1);
    if (rest.length > 0) {
      if (!rest.startsWith(':') || !/^\d+$/.test(rest.slice(1)))
        throw new Error(`Invalid port in egress destination: ${raw}`);
      port = Number(rest.slice(1));
    }
  } else {
    const firstColon = raw.indexOf(':');
    const lastColon = raw.lastIndexOf(':');
    if (firstColon !== lastColon) throw new Error(`IPv6 egress destination must use brackets: ${raw}`);
    if (firstColon !== -1) {
      host = raw.slice(0, lastColon).toLowerCase();
      const portStr = raw.slice(lastColon + 1);
      if (!/^\d+$/.test(portStr)) throw new Error(`Invalid port in egress destination: ${raw}`);
      port = Number(portStr);
    } else {
      host = raw.toLowerCase();
    }
    if ((/^[\d.]+$/.test(host) || /^0x[\da-f]+$/i.test(host)) && parseIpv4Strict(host) === null) {
      throw new Error(`Invalid numeric host in egress destination: ${raw}`);
    }
  }
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(`Invalid egress destination: ${raw}`);
  if (DENIED_EGRESS_PORTS.has(port)) throw new Error(`Egress destination cannot target NERV port ${port}.`);
  if (isBlockedLiteralHost(host))
    throw new Error(`Egress destination cannot target link-local or metadata host: ${host}`);
  return { host, port };
}
export function isEgressDestinationAllowed(
  host: string,
  port: number,
  allowlist: readonly EgressDestination[],
): boolean {
  const normalized = host.replace(/^\[|\]$/g, '').toLowerCase();
  return allowlist.some((d) => d.host === normalized && d.port === port);
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
  durationMs?: number;
  transferMs?: number;
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
export const defaultPolicy: Policy = {
  deny: [],
  blue: [],
  localOnly: [],
  egressAllow: [],
  syncThreshold: 80,
  maxRejects: 3,
  budget: 1,
};
const local = (e: Effect) => e === 'read' || e === 'write-local';
/** True only when the Scrolls and action trust allow sending the action's request/args to a cloud seat (F-025-T02). */
export function canLeaveMachine(action: { tool: string; effect: Effect; trust: Trust }, policy: Policy): boolean {
  if (action.trust === 'tainted') return false;
  if (local(action.effect)) return false;
  if (policy.deny.includes(action.tool)) return false;
  if (policy.localOnly?.includes(action.tool)) return false;
  return true;
}
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
    ('localOnly' in p && !Array.isArray(p.localOnly)) ||
    !names(merged.localOnly ?? []) ||
    ('egressAllow' in p && !Array.isArray(p.egressAllow)) ||
    !Array.isArray(merged.egressAllow ?? []) ||
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
  for (const dest of merged.egressAllow ?? []) parseEgressDestination(dest);
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
/** B-175: the EVA-03 refusal caused by a tainted conversation, as opposed to a tool granted for EVA-03 itself. */
export const TAINTED_ISOLATION =
  'EVA-03 outside code requires isolation; it does not run. A tool result earlier in this conversation made it untrusted: start a new conversation to use this tool.';
/**
 * B-175 (owner decision 2026-11-26): the service's reply when a granted outside tool is refused because the
 * conversation is tainted. Misato stops there instead of retrying; the owner learns why and how to start clean.
 */
export function isolationRefusalReply(language: 'it' | 'en', tool: string, sameRequest = false): string {
  if (sameRequest)
    return language === 'it'
      ? `Non ho potuto usare ${tool}: il risultato di uno strumento in questa stessa richiesta l'ha resa non fidata, e per sicurezza da lì in poi NERV non esegue altri strumenti esterni. Per avere anche quello, chiedi solo quello in una nuova conversazione (nella chat della dashboard, il pulsante «New conversation»).`
      : `I could not use ${tool}: a tool result in this same request made it untrusted, so for safety NERV runs no further outside tools in it. To get that too, ask for it on its own in a new conversation (in the dashboard chat: "New conversation").`;
  return language === 'it'
    ? `Non ho usato ${tool}: in questa conversazione è già entrato il risultato di uno strumento, e per sicurezza da lì in poi NERV non esegue qui altri strumenti esterni. Apri una nuova conversazione (nella chat della dashboard, il pulsante «New conversation») e ripeti la domanda, oppure scrivi di nuovo qui dopo 30 minuti di pausa.`
    : `I did not use ${tool}: a tool result already entered this conversation, so for safety NERV runs no further outside tools in it. Start a new conversation (in the dashboard chat: "New conversation") and ask again, or write here again after a pause of 30 minutes.`;
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
        executor !== 'eva-03'
          ? 'Proactive outside code requires EVA-00 isolation; it does not run.'
          : action.trust === 'tainted'
            ? TAINTED_ISOLATION
            : 'EVA-03 outside code requires isolation; it does not run.',
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
  if (tool?.card) return { ...base, outcome: 'approval', reason: 'Every call of this tool waits for the owner.' };
  if (value < policy.syncThreshold)
    return { ...base, outcome: 'approval', reason: `Sync Ratio ${value}% below ${policy.syncThreshold}%.` };
  return { ...base, outcome: 'grant', reason: `Sync Ratio ${value}%.` };
}
