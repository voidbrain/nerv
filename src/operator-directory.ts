import { sign, verify, type KeyObject } from 'node:crypto';
import { canonical, publicKeyFrom, type BaseEntry } from './kaji.ts';

export const DEFAULT_OPERATOR_NAME = 'Aoba';
const OPERATOR_NAME = /^[^\u0000-\u001f<>]{1,32}$/;
const BASE_ID = /^[A-Z0-9][A-Z0-9-]{1,15}$/;
const DEFAULT_ONLINE_MS = 90_000;

export interface OperatorConfig {
  name: string;
  aliases?: string[];
}

export interface OperatorDirectoryBody {
  kind: 'operator-directory';
  version: 1;
  baseId: string;
  name: string;
  aliases: string[];
  defaulted: boolean;
  serial: number;
  issued: string;
}

export interface SignedOperatorEntry {
  body: OperatorDirectoryBody;
  signature: string;
}

export interface PublicOperatorInfo {
  baseId: string;
  baseName: string;
  operatorName: string;
  aliases: string[];
  defaulted: boolean;
  online: boolean;
  stale: boolean;
  serial: number;
  issued: string;
}

export type OperatorResolution =
  | {
      status: 'resolved';
      baseId: string;
      baseName: string;
      operatorName: string;
      matchedAlias: string;
    }
  | {
      status: 'ambiguous';
      query: string;
      candidates: { baseId: string; baseName: string; operatorName: string; online: boolean }[];
      message: string;
    }
  | {
      status: 'stale';
      query: string;
      baseId: string;
      baseName: string;
      operatorName: string;
      reason: 'offline' | 'renamed';
      message: string;
    }
  | {
      status: 'unknown';
      query: string;
      message: string;
    };

function cleanLabel(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid operator ${label}: must be a string.`);
  const trimmed = value.trim();
  if (!trimmed || !OPERATOR_NAME.test(trimmed))
    throw new Error(`Invalid operator ${label}: 1-32 printable characters without < or >.`);
  return trimmed;
}

/** Validates per-base operator configuration; rejects unknown or private channel fields. */
export function validateOperatorConfig(value: unknown): OperatorConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid operator: {"name": "Aoba", "aliases": [...]} expected.');
  const raw = value as Record<string, unknown>;
  const keys = Object.keys(raw);
  if (keys.some((k) => k !== 'name' && k !== 'aliases'))
    throw new Error('Invalid operator: only "name" and "aliases" are allowed.');
  const name = cleanLabel(raw.name, 'name');
  let aliases: string[] | undefined;
  if (raw.aliases !== undefined) {
    if (!Array.isArray(raw.aliases) || raw.aliases.length > 10)
      throw new Error('Invalid operator.aliases: up to 10 alias strings.');
    const seen = new Set<string>([name.toLowerCase()]);
    aliases = [];
    for (const item of raw.aliases) {
      const cleaned = cleanLabel(item, 'alias');
      const key = cleaned.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        aliases.push(cleaned);
      }
    }
  }
  return aliases && aliases.length > 0 ? { name, aliases } : { name };
}

/** Returns the effective operator name, aliases, and whether the default role label is active. */
export function effectiveOperator(config?: OperatorConfig): { name: string; aliases: string[]; defaulted: boolean } {
  if (!config) return { name: DEFAULT_OPERATOR_NAME, aliases: [], defaulted: true };
  return {
    name: config.name,
    aliases: config.aliases ? [...config.aliases] : [],
    defaulted: false,
  };
}

/** Builds and signs an operator directory entry with the base's own Ed25519 key. */
export function signOperatorEntry(
  baseId: string,
  privateKey: KeyObject,
  config: OperatorConfig | undefined,
  serial: number,
  now = new Date(),
): SignedOperatorEntry {
  if (!BASE_ID.test(baseId)) throw new Error(`Invalid baseId for operator entry: ${baseId}`);
  if (!Number.isSafeInteger(serial) || serial < 1) throw new Error('Operator entry serial must be >= 1.');
  const eff = effectiveOperator(config);
  const body: OperatorDirectoryBody = {
    kind: 'operator-directory',
    version: 1,
    baseId,
    name: eff.name,
    aliases: eff.aliases,
    defaulted: eff.defaulted,
    serial,
    issued: now.toISOString(),
  };
  const signature = sign(null, Buffer.from(canonical(body)), privateKey).toString('base64');
  return { body, signature };
}

const ALLOWED_BODY_KEYS = new Set(['kind', 'version', 'baseId', 'name', 'aliases', 'defaulted', 'serial', 'issued']);

/** Verifies shape, absence of private channel fields, enrolled base membership, and Ed25519 signature. */
export function verifyOperatorEntry(raw: unknown, enrolledBases: BaseEntry[]): SignedOperatorEntry | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  if (Object.keys(obj).some((k) => k !== 'body' && k !== 'signature')) return undefined;
  if (typeof obj.signature !== 'string' || !obj.signature) return undefined;
  if (!obj.body || typeof obj.body !== 'object' || Array.isArray(obj.body)) return undefined;

  const b = obj.body as Record<string, unknown>;
  if (Object.keys(b).some((k) => !ALLOWED_BODY_KEYS.has(k))) return undefined;
  if (
    b.kind !== 'operator-directory' ||
    b.version !== 1 ||
    typeof b.baseId !== 'string' ||
    !BASE_ID.test(b.baseId) ||
    typeof b.name !== 'string' ||
    !OPERATOR_NAME.test(b.name.trim()) ||
    !Array.isArray(b.aliases) ||
    b.aliases.length > 10 ||
    typeof b.defaulted !== 'boolean' ||
    typeof b.serial !== 'number' ||
    !Number.isSafeInteger(b.serial) ||
    b.serial < 1 ||
    typeof b.issued !== 'string' ||
    !Number.isFinite(Date.parse(b.issued))
  ) {
    return undefined;
  }

  const name = b.name.trim();
  const seen = new Set<string>([name.toLowerCase()]);
  const aliases: string[] = [];
  for (const item of b.aliases) {
    if (typeof item !== 'string') return undefined;
    const trimmed = item.trim();
    if (!trimmed || !OPERATOR_NAME.test(trimmed)) return undefined;
    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) return undefined;
    seen.add(lower);
    aliases.push(trimmed);
  }

  const base = enrolledBases.find((e) => e.baseId === b.baseId && e.status === 'enrolled');
  if (!base) return undefined;

  const body: OperatorDirectoryBody = {
    kind: 'operator-directory',
    version: 1,
    baseId: b.baseId,
    name,
    aliases,
    defaulted: b.defaulted,
    serial: b.serial,
    issued: b.issued,
  };

  try {
    const ok = verify(
      null,
      Buffer.from(canonical(body)),
      publicKeyFrom(base.publicKey),
      Buffer.from(obj.signature, 'base64'),
    );
    return ok ? { body, signature: obj.signature } : undefined;
  } catch {
    return undefined;
  }
}

interface StoredOperatorEntry {
  entry: SignedOperatorEntry;
  receivedAt: string;
}

/**
 * Authenticated, per-base directory of communication operator names and aliases.
 * Rejects unverified/revoked entries, enforces monotonic updates on rename, and resolves aliases safely.
 */
export class OperatorDirectory {
  private readonly entries = new Map<string, StoredOperatorEntry>();
  private readonly retired = new Map<string, Set<string>>();

  record(
    rawEntry: unknown,
    enrolledBases: BaseEntry[],
    expectedFrom?: string,
    now = new Date(),
  ): SignedOperatorEntry | undefined {
    const verified = verifyOperatorEntry(rawEntry, enrolledBases);
    if (!verified) return undefined;
    if (expectedFrom && verified.body.baseId !== expectedFrom) return undefined;

    const baseId = verified.body.baseId;
    const current = this.entries.get(baseId);
    if (current) {
      if (verified.body.serial < current.entry.body.serial) return undefined;
      if (
        verified.body.serial === current.entry.body.serial &&
        Date.parse(verified.body.issued) < Date.parse(current.entry.body.issued)
      ) {
        return undefined;
      }
      const nextSet = new Set([verified.body.name.toLowerCase(), ...verified.body.aliases.map((a) => a.toLowerCase())]);
      const prevNames = [current.entry.body.name, ...current.entry.body.aliases];
      let retiredSet = this.retired.get(baseId);
      for (const prev of prevNames) {
        const lower = prev.toLowerCase();
        if (!nextSet.has(lower)) {
          if (!retiredSet) {
            retiredSet = new Set<string>();
            this.retired.set(baseId, retiredSet);
          }
          retiredSet.add(lower);
        }
      }
      if (retiredSet) {
        for (const active of nextSet) retiredSet.delete(active);
        if (retiredSet.size === 0) this.retired.delete(baseId);
      }
    }

    this.entries.set(baseId, { entry: verified, receivedAt: now.toISOString() });
    return verified;
  }

  prune(enrolledBases: BaseEntry[]): void {
    const active = new Set(enrolledBases.filter((b) => b.status === 'enrolled').map((b) => b.baseId));
    for (const id of this.entries.keys()) {
      if (!active.has(id)) {
        this.entries.delete(id);
        this.retired.delete(id);
      }
    }
  }

  get(baseId: string): StoredOperatorEntry | undefined {
    return this.entries.get(baseId);
  }

  list(
    enrolledBases: BaseEntry[],
    lastSeen: Record<string, string>,
    selfBaseId?: string,
    now = Date.now(),
    onlineMs = DEFAULT_ONLINE_MS,
  ): PublicOperatorInfo[] {
    this.prune(enrolledBases);
    const out: PublicOperatorInfo[] = [];
    for (const base of enrolledBases) {
      if (base.status !== 'enrolled') continue;
      const stored = this.entries.get(base.baseId);
      if (!stored) continue;
      const self = base.baseId === selfBaseId;
      const seenAt = lastSeen[base.baseId];
      const online = self || (!!seenAt && now - Date.parse(seenAt) < onlineMs);
      const stale = !online || (!self && now - Date.parse(stored.receivedAt) >= onlineMs);
      out.push({
        baseId: base.baseId,
        baseName: base.name,
        operatorName: stored.entry.body.name,
        aliases: [...stored.entry.body.aliases],
        defaulted: stored.entry.body.defaulted,
        online,
        stale,
        serial: stored.entry.body.serial,
        issued: stored.entry.body.issued,
      });
    }
    return out;
  }

  hasKnownOrRetiredAlias(query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return false;
    for (const { entry } of this.entries.values()) {
      if (entry.body.name.toLowerCase() === q) return true;
      if (entry.body.aliases.some((a) => a.toLowerCase() === q)) return true;
    }
    for (const set of this.retired.values()) {
      if (set.has(q)) return true;
    }
    return false;
  }

  resolve(
    query: string,
    enrolledBases: BaseEntry[],
    lastSeen: Record<string, string>,
    options: { selfBaseId?: string; now?: number; onlineMs?: number; excludeSelf?: boolean } = {},
  ): OperatorResolution {
    const trimmed = query.trim();
    const q = trimmed.toLowerCase();
    if (!q) {
      return {
        status: 'unknown',
        query: trimmed,
        message: 'Operator name is empty. Specify an enrolled base ID or configured operator alias.',
      };
    }

    const list = this.list(enrolledBases, lastSeen, options.selfBaseId, options.now, options.onlineMs).filter(
      (item) => !(options.excludeSelf && item.baseId === options.selfBaseId),
    );

    const matches: { info: PublicOperatorInfo; matchedAlias: string }[] = [];
    for (const info of list) {
      if (info.operatorName.toLowerCase() === q) {
        matches.push({ info, matchedAlias: info.operatorName });
        continue;
      }
      const alias = info.aliases.find((a) => a.toLowerCase() === q);
      if (alias) {
        matches.push({ info, matchedAlias: alias });
      }
    }

    if (matches.length > 1) {
      const candidates = matches.map((m) => ({
        baseId: m.info.baseId,
        baseName: m.info.baseName,
        operatorName: m.info.operatorName,
        online: m.info.online,
      }));
      const summary = candidates
        .map((c) => `${c.baseId} (${c.baseName}, operator: ${c.operatorName}, ${c.online ? 'online' : 'offline'})`)
        .join('; ');
      return {
        status: 'ambiguous',
        query: trimmed,
        candidates,
        message: `Operator alias "${trimmed}" is ambiguous across multiple bases: ${summary}. Please clarify which base ID you mean.`,
      };
    }

    if (matches.length === 1) {
      const { info, matchedAlias } = matches[0]!;
      if (!info.online || info.stale) {
        return {
          status: 'stale',
          query: trimmed,
          baseId: info.baseId,
          baseName: info.baseName,
          operatorName: info.operatorName,
          reason: 'offline',
          message: `Operator "${trimmed}" on ${info.baseId} (${info.baseName}) is currently offline or stale. No message was sent.`,
        };
      }
      return {
        status: 'resolved',
        baseId: info.baseId,
        baseName: info.baseName,
        operatorName: info.operatorName,
        matchedAlias,
      };
    }

    // Check if the alias was recently retired via a rename on an enrolled base.
    for (const [baseId, set] of this.retired.entries()) {
      if (options.excludeSelf && baseId === options.selfBaseId) continue;
      if (set.has(q)) {
        const current = list.find((item) => item.baseId === baseId);
        if (current) {
          return {
            status: 'stale',
            query: trimmed,
            baseId: current.baseId,
            baseName: current.baseName,
            operatorName: current.operatorName,
            reason: 'renamed',
            message: `Operator alias "${trimmed}" is stale: ${current.baseId} (${current.baseName}) renamed its operator to "${current.operatorName}". Use the current alias or base ID.`,
          };
        }
      }
    }

    const available = list
      .filter((i) => i.online && !i.stale)
      .map((i) => `${i.operatorName} (${i.baseId})`)
      .join(', ');
    return {
      status: 'unknown',
      query: trimmed,
      message: available
        ? `No online enrolled base has an operator named "${trimmed}". Available online operators: ${available}.`
        : `No online enrolled base has an operator named "${trimmed}".`,
    };
  }
}
