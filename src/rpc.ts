import { Ajv } from 'ajv';
import { methodSchemas, type Method } from './rpc-schemas.ts';
export { methodSchemas, type Method };
export const MAX_FRAME_BYTES = 65536;
export const MAX_RPC_CONNECTIONS = 16,
  MAX_RPC_INFLIGHT = 4;
export interface RpcError {
  code: number;
  message: string;
}
export type RpcResponse =
  | { jsonrpc: '2.0'; id: string | number | null; result: unknown }
  | { jsonrpc: '2.0'; id: string | number | null; error: RpcError };
export class RpcFault extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}
const ajv = new Ajv({ allErrors: false, strict: true });
const validators = new Map(Object.entries(methodSchemas).map(([name, schema]) => [name, ajv.compile(schema)]));
export function validateParams(method: string, params: unknown): asserts method is Method {
  const validate = validators.get(method);
  if (!validate) throw new RpcFault(-32601, 'Method not found.');
  if (!validate(params)) throw new RpcFault(-32602, 'Invalid method parameters.');
}
export type Principal = 'interface' | 'coordinator' | 'nervous' | 'brain' | 'tools';
/** Directed edges describe permission, not routing or model capability. Deny by default. */
export const communicationGraph = [
  {
    from: 'interface',
    to: 'coordinator',
    methods: [
      'runtime.ping',
      'runtime.doctor',
      'reminders.list',
      'reminders.page',
      'inbox.history',
      'dashboard.history',
      'reminders.pending',
      'reminders.add',
      'reminders.update',
      'reminders.cancel',
      'lists.show',
      'lists.toggle',
      'push.key',
      'push.subscribe',
      'push.unsubscribe',
      'push.status',
      'inbox.list',
      'inbox.page',
      'approvals.pending',
      'events.page',
      'sorties.list',
      'sorties.get',
    ],
  },
  {
    from: 'coordinator',
    to: 'nervous',
    methods: [
      'watch.poll',
      'watch.recover',
      'watch.claim',
      'watch.get',
      'watch.plan',
      'watch.finish',
      'context.intake',
      'instrumentality.claim',
      'instrumentality.finish',
      'instrumentality.latest',
      'dashboard.revision',
      'usage.begin',
      'usage.finish',
      'usage.page',
      'runtime.ping',
      'runtime.doctor',
      'reminders.list',
      'reminders.page',
      'inbox.history',
      'dashboard.history',
      'reminders.pending',
      'reminders.add',
      'reminders.update',
      'reminders.cancel',
      'lists.show',
      'lists.toggle',
      'push.key',
      'push.subscribe',
      'push.unsubscribe',
      'push.status',
      'inbox.list',
      'inbox.brief',
      'inbox.lastBrief',
      'inbox.page',
      'approvals.pending',
      'approvals.pendingIds',
      'approvals.expired',
      'approvals.decide',
      'events.page',
      'sorties.list',
      'sorties.get',
      'actions.finished',
      'pilots.unmatched',
      'actions.shadowVote',
      'sorties.closedSince',
      'sorties.timings',
      'sorties.explain',
      'sorties.spear',
      'sorties.open',
      'sorties.finish',
      'actions.preview',
      'actions.act',
      'misato.note',
      'misato.resumable',
      'misato.interrupted',
      'misato.closeInterrupted',
      'misato.context',
      'misato.question',
      'misato.ask',
      'misato.answer',
      'misato.claim',
      'memory.recall',
      'kaji.bases',
      'kaji.records',
      'kaji.lastSeen',
      'kaji.main',
      'kaji.outbox',
      'kaji.outboxCancels',
      'kaji.outboxAttempt',
      'kaji.outboxHeld',
      'kaji.outboxDone',
      'kaji.outboxProgress',
      'worker.open',
      'worker.close',
      'worker.claim',
      'worker.cancel',
      'worker.finish',
      'kaji.add',
      'kaji.seen',
      'milestones.health',
      'memory.lastRequest',
      'memory.list',
      'memory.add',
      'memory.edit',
      'memory.forget',
      'memory.share',
      'memory.history',
      'memory.episodes',
      'memory.exchanges',
      'memory.known',
      'memory.saveEpisode',
    ],
  },
  { from: 'coordinator', to: 'tools', methods: ['runtime.ping', 'tools.list', 'tools.call'] },
  {
    from: 'coordinator',
    to: 'brain',
    methods: [
      'runtime.ping',
      'model.complete',
      'casper.verdict',
      'misato.step',
      'consultant.advise',
      'models.reload',
      'instrumentality.digest',
    ],
  },
] as const;
export function authorize(from: Principal, to: Principal, method: string): void {
  if (
    !communicationGraph.some(
      (edge) => edge.from === from && edge.to === to && (edge.methods as readonly string[]).includes(method),
    )
  )
    throw new RpcFault(-32003, 'Communication edge denied.');
}
export type RpcHandler = (method: Method, params: Record<string, unknown>) => unknown | Promise<unknown>;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const error = (id: string | number | null, code: number, message: string): RpcResponse => ({
  jsonrpc: '2.0',
  id,
  error: { code, message },
});
/** Sent by a child process once it handles requests; the coordinator sends nothing before it (B-007). */
export const READY = { nerv: 'ready' } as const;
export async function dispatchRpc(value: unknown, handler: RpcHandler): Promise<RpcResponse | undefined> {
  if (
    !object(value) ||
    value.jsonrpc !== '2.0' ||
    typeof value.method !== 'string' ||
    Object.keys(value).some((k) => !['jsonrpc', 'method', 'params', 'id'].includes(k)) ||
    ('id' in value &&
      value.id !== null &&
      typeof value.id !== 'string' &&
      !(typeof value.id === 'number' && Number.isSafeInteger(value.id)))
  )
    return error(null, -32600, 'Invalid Request.');
  const id = value.id as string | number | null;
  const notification = !('id' in value);
  try {
    const params = value.params ?? {};
    validateParams(value.method, params);
    const result = await handler(value.method, params as Record<string, unknown>);
    return notification ? undefined : { jsonrpc: '2.0', id, result: result ?? null };
  } catch (e) {
    return notification
      ? undefined
      : error(id, e instanceof RpcFault ? e.code : -32603, e instanceof RpcFault ? e.message : 'Internal error.');
  }
}
export async function handleFrame(text: string, handler: RpcHandler): Promise<RpcResponse | RpcResponse[] | undefined> {
  if (Buffer.byteLength(text) > MAX_FRAME_BYTES) return error(null, -32600, 'Frame too large.');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return error(null, -32700, 'Parse error.');
  }
  if (Array.isArray(value)) {
    if (!value.length || value.length > 16) return error(null, -32600, 'Invalid batch.');
    const replies: RpcResponse[] = [];
    for (const item of value) {
      const response = await dispatchRpc(item, handler);
      if (response) replies.push(response);
    }
    return replies.length ? replies : undefined;
  }
  return dispatchRpc(value, handler);
}
