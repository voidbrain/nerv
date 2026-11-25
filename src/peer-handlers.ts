import { decisionText } from './telegram.ts';

export interface PeerRelayAoba {
  relayed(from: string, name: string, relay: unknown): Promise<boolean> | boolean;
}

export interface PeerHandlersDeps<TChat extends object, TSortie, TEvent> {
  readonly base: { readonly id: string; readonly name: string };
  getAoba(): PeerRelayAoba | undefined;
  bases(): Promise<readonly { baseId: string; name: string }[]>;
  decide(
    approvalId: string,
    decision: 'approve' | 'reject',
    source: 'telegram',
  ): Promise<{ decision: string; result?: unknown; error?: string }>;
  chat(message: string, conversation: string): Promise<TChat>;
  sortie(sortieId: string): Promise<TSortie | null>;
  events(sortieId: string, after: number, limit: number): Promise<TEvent[]>;
}

export interface PeerHandlers<TChat extends object, TSortie, TEvent> {
  onRelay(from: string, relay: unknown): Promise<boolean>;
  onDecide(approvalId: string, decision: 'approve' | 'reject'): Promise<string>;
  onChat(from: string, message: string, conversation?: string): Promise<TChat & { base: { id: string; name: string } }>;
  onSortie(from: string, sortieId: string): Promise<{ sortie: TSortie; events: TEvent[] } | null>;
}

/** Builds the peer-facing Kaji handlers so `serve` only wires dependencies and policy is unit-testable. */
export function createPeerHandlers<TChat extends object, TSortie, TEvent>(
  deps: PeerHandlersDeps<TChat, TSortie, TEvent>,
): PeerHandlers<TChat, TSortie, TEvent> {
  return {
    onRelay: async (from, relay) => {
      const aoba = deps.getAoba();
      if (!aoba) return false;
      const name = (await deps.bases()).find((b) => b.baseId === from)?.name ?? from;
      return aoba.relayed(from, name, relay);
    },
    onDecide: async (approvalId, decision) => decisionText(await deps.decide(approvalId, decision, 'telegram')),
    onChat: async (from, message, conversation) => ({
      ...(await deps.chat(message, `kaji:${from.toLowerCase()}${conversation ? '-' + conversation : ''}`)),
      base: { id: deps.base.id, name: deps.base.name },
    }),
    onSortie: async (_from, sortieId) => {
      const sortie = await deps.sortie(sortieId);
      if (!sortie) return null;
      const events = await deps.events(sortieId, 0, 100);
      return { sortie, events };
    },
  };
}
