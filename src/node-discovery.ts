import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { Registry, REGISTRY_SCHEMA, type SignedRecord } from './kaji.ts';
export const NODE_INVENTORY_BYTES = 262144,
  NODE_CANDIDATES = 64;
export interface NodeTarget {
  host: string;
  user?: string;
  port: number;
}
export interface NodeCandidate {
  id: string;
  source: 'inventory' | 'ssh-config' | 'tailscale' | 'registry';
  name: string;
  target: NodeTarget;
  trust: 'candidate';
  reportedOnline?: boolean;
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export function nodeTarget(value: unknown): NodeTarget {
  if (
    !object(value) ||
    Object.keys(value).some((key) => !['host', 'user', 'port'].includes(key)) ||
    typeof value.host !== 'string' ||
    value.host.length > 253 ||
    (!isIP(value.host) && !/^([a-z0-9][a-z0-9._-]*)$/i.test(value.host))
  )
    throw Error('Use an explicit host/IP or SSH alias, without options or shell characters.');
  if (value.user !== undefined && (typeof value.user !== 'string' || !/^[a-z_][a-z0-9_.-]{0,63}$/i.test(value.user)))
    throw Error('Invalid SSH user.');
  const port = value.port ?? 22;
  if (!Number.isInteger(port) || Number(port) < 1 || Number(port) > 65535) throw Error('Invalid SSH port.');
  return { host: value.host, ...(value.user ? { user: value.user as string } : {}), port: Number(port) };
}
function candidate(source: NodeCandidate['source'], name: string, target: NodeTarget, online?: boolean): NodeCandidate {
  if (!name.trim() || name.length > 100 || /[\x00-\x1f\x7f]/.test(name)) throw Error('Invalid candidate label.');
  return {
    id: createHash('sha256').update(JSON.stringify({ source, target })).digest('hex').slice(0, 32),
    source,
    name,
    target,
    trust: 'candidate',
    ...(online === undefined ? {} : { reportedOnline: online }),
  };
}
export function parseNodeInput(raw: string): unknown {
  if (Buffer.byteLength(raw) > NODE_INVENTORY_BYTES) throw Error('Node inventory exceeds 256 KiB.');
  try {
    return JSON.parse(raw);
  } catch {
    throw Error('Invalid node inventory JSON.');
  }
}
export function inventoryCandidates(input: unknown): NodeCandidate[] {
  if (!object(input) || input.version !== 1 || !Array.isArray(input.targets) || input.targets.length > NODE_CANDIDATES)
    throw Error('Node inventory needs version 1 and at most 64 targets.');
  return input.targets.map((value) => {
    if (!object(value) || typeof value.name !== 'string') throw Error('Invalid node inventory target.');
    return candidate('inventory', value.name, nodeTarget(value.ssh));
  });
}
/** Enumerate literal aliases only; never evaluate Include, Match exec, ProxyCommand or Host wildcards. */
export function sshCandidates(raw: string): NodeCandidate[] {
  if (Buffer.byteLength(raw) > NODE_INVENTORY_BYTES) throw Error('SSH inventory exceeds 256 KiB.');
  const aliases = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*Host(?:\s*=\s*|\s+)([^#]+)/i.exec(line);
    if (!match) continue;
    for (const alias of match[1]!.trim().split(/\s+/)) {
      if (/[*?!"']/.test(alias)) continue;
      nodeTarget({ host: alias });
      aliases.add(alias);
      if (aliases.size > NODE_CANDIDATES) throw Error('More than 64 SSH candidates; supply a selected inventory.');
    }
  }
  return [...aliases].map((alias) => candidate('ssh-config', alias, nodeTarget({ host: alias })));
}
export function tailscaleCandidates(input: unknown): NodeCandidate[] {
  if (!object(input) || (input.BackendState !== undefined && input.BackendState !== 'Running'))
    throw Error('Tailscale inventory is not available from a running client.');
  if (input.Peer === null) return [];
  if (!object(input.Peer)) throw Error('Expected a Tailscale status JSON Peer map.');
  const values = Object.values(input.Peer);
  if (values.length > NODE_CANDIDATES) throw Error('More than 64 Tailscale peers; supply a selected inventory.');
  return values.map((value) => {
    if (!object(value) || typeof value.HostName !== 'string' || !Array.isArray(value.TailscaleIPs))
      throw Error('Invalid Tailscale peer.');
    const host = value.TailscaleIPs.find((ip) => typeof ip === 'string' && isIP(ip));
    if (typeof host !== 'string') throw Error('Tailscale peer has no IP address.');
    return candidate(
      'tailscale',
      value.HostName,
      nodeTarget({ host }),
      typeof value.Online === 'boolean' ? value.Online : undefined,
    );
  });
}
/** Registry signatures are checked against an already pinned root, not the bundle's self-declared identity. */
export function registryCandidates(input: unknown, pinnedRoot: string): NodeCandidate[] {
  if (!object(input) || input.root !== pinnedRoot || !Array.isArray(input.records) || input.records.length > 1000)
    throw Error('Registry bundle does not match the pinned root or exceeds its bound.');
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(REGISTRY_SCHEMA);
    const registry = new Registry(db, pinnedRoot);
    for (const record of input.records) registry.add(record as SignedRecord);
    return mergeCandidates(
      registry
        .bases()
        .filter((base) => base.status === 'enrolled')
        .map((base) => candidate('registry', base.name, nodeTarget({ host: addressHost(base.address) }))),
    );
  } finally {
    db.close();
  }
}
function addressHost(address: string): string {
  if (isIP(address)) return address;
  const match = /^(\[[a-f0-9:]+\]|[a-z0-9.-]+)(?::\d+)?$/i.exec(address);
  if (!match) throw Error('Invalid registry address.');
  return match[1]!.replace(/^\[|\]$/g, '');
}
export function mergeCandidates(...sources: NodeCandidate[][]): NodeCandidate[] {
  const values = new Map<string, NodeCandidate>();
  for (const source of sources)
    for (const item of source) {
      values.set(item.id, item);
      if (values.size > NODE_CANDIDATES) throw Error('More than 64 candidates; narrow the selected sources.');
    }
  return [...values.values()];
}
