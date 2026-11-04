import type { Ballot, Trust } from './policy.ts';
/**
 * Sortie event schema (F-024): the one shape the ledger writes and every reader (CLI, REST, RPC, the F-019 dashboard,
 * a later OpenTelemetry export) consumes. Each stored event records the schema version it was written under.
 * Version 2 is the shape below (version 1 grant events also carried the grant ID, which readers never receive: it is removed on read); a change to a payload that a reader could misread bumps it, and readers branch on `v`.
 * A new kind does not bump it: readers skip kinds they do not know.
 */
export const EVENT_SCHEMA_VERSION=2;
/** Bounded so a page of 50 events stays well under one IPC frame (rpc.ts MAX_FRAME_BYTES). */
export const MAX_EVENT_PAYLOAD_BYTES=16_384;
/** The Spear lists at most this many executed effects in its event; the count is always exact. */
export const MAX_SPEAR_HAPPENED=50;
export interface Happened {actionId:string;tool:string;inverse:string|null}
export interface EventPayloads {
 'sortie.opened':{source:string;title:string;trust:Trust};
 'ballot':Ballot;
 'grant.issued':{expires:string};
 'grant.used':Record<string,never>;
 'grant.denied':{reason:string};
 'approval.requested':{approvalId:string;expires:string;reason:string};
 'approval.approve':{approvalId:string;source:string};
 'approval.reject':{approvalId:string;source:string};
 'approval.edit':{approvalId:string;source:string};
 'approval.expired':{approvalId:string;source:'ttl'};
 'spear':{reason:string;revoked:number;stoodDown:number;happenedCount:number;happened:Happened[]};
 'action.done':{tool:string;result:unknown};
 'action.failed':{tool:string;error:string};
 'sortie.done':Record<string,never>;
 'sortie.failed':Record<string,never>;
}
export type EventKind=keyof EventPayloads;
export const EVENT_KINDS=['sortie.opened','ballot','grant.issued','grant.used','grant.denied','approval.requested','approval.approve','approval.reject','approval.edit','approval.expired','spear','action.done','action.failed','sortie.done','sortie.failed'] as const satisfies readonly EventKind[];
/** One event as read back. `v` is the schema version it was written under; events written before versioning read as 1. */
export type SortieEvent={[K in EventKind]:{v:number;sequence:number;sortieId:string;actionId:string|null;kind:K;payload:EventPayloads[K];created:string}}[EventKind];
/** Serialises a payload for storage, refusing unknown kinds and oversized payloads so the ledger never stores an unbounded event. */
/** Grant IDs never leave the scheduler process; version 1 rows stored them, so every read drops them. */
export function readPayload(kind:string,text:string):unknown {
 const value=JSON.parse(text) as unknown;
 if(kind.startsWith('grant.')&&value&&typeof value==='object'&&'grantId' in value){const {grantId:_,...rest}=value as Record<string,unknown>;return rest;}
 return value;
}
export function encodePayload<K extends EventKind>(kind:K,payload:EventPayloads[K]):string {
 if(!(EVENT_KINDS as readonly string[]).includes(kind))throw new Error(`Unknown event kind: ${kind}.`);
 const text=JSON.stringify(payload);
 if(Buffer.byteLength(text)>MAX_EVENT_PAYLOAD_BYTES)throw new Error(`Event payload too large: ${kind}.`);
 return text;
}
