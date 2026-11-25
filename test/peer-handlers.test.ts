import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createPeerHandlers, type PeerRelayAoba } from '../src/peer-handlers.ts';

describe('F-080-T01: peer handlers module', () => {
  it('onRelay refuses when Aoba is absent and resolves peer name when present', async () => {
    const aobaRef: { current?: PeerRelayAoba } = {};
    const calls: { from: string; name: string; relay: unknown }[] = [];
    const handlers = createPeerHandlers({
      base: { id: 'BASE-01', name: 'Main' },
      getAoba: () => aobaRef.current,
      bases: async () => [{ baseId: 'NERV-02', name: 'Field Base' }],
      decide: async () => ({ decision: 'approve' }),
      chat: async () => ({ reply: 'ok' }),
      sortie: async () => null,
      events: async () => [],
    });

    assert.equal(await handlers.onRelay('NERV-02', { text: 'hi' }), false);

    aobaRef.current = {
      relayed: (from, name, relay) => {
        calls.push({ from, name, relay });
        return true;
      },
    };
    assert.equal(await handlers.onRelay('NERV-02', { text: 'hi' }), true);
    assert.deepEqual(calls, [{ from: 'NERV-02', name: 'Field Base', relay: { text: 'hi' } }]);
    assert.equal(await handlers.onRelay('UNKNOWN-BASE', { text: 'yo' }), true);
    assert.equal(calls[1]?.name, 'UNKNOWN-BASE');
  });

  it('onDecide formats approve and reject outcomes via telegram source', async () => {
    const seen: { id: string; decision: string; source: string }[] = [];
    const handlers = createPeerHandlers({
      base: { id: 'BASE-01', name: 'Main' },
      getAoba: () => undefined,
      bases: async () => [],
      decide: async (id, decision, source) => {
        seen.push({ id, decision, source });
        return { decision };
      },
      chat: async () => ({ reply: 'ok' }),
      sortie: async () => null,
      events: async () => [],
    });

    const ok = await handlers.onDecide('ap-1', 'approve');
    const rej = await handlers.onDecide('ap-2', 'reject');
    assert.match(ok, /Approved/);
    assert.match(rej, /Rejected/);
    assert.deepEqual(seen, [
      { id: 'ap-1', decision: 'approve', source: 'telegram' },
      { id: 'ap-2', decision: 'reject', source: 'telegram' },
    ]);
  });

  it('onChat scopes conversation to peer base and attaches base identity', async () => {
    const conversations: string[] = [];
    const handlers = createPeerHandlers({
      base: { id: 'BASE-01', name: 'Main' },
      getAoba: () => undefined,
      bases: async () => [],
      decide: async () => ({ decision: 'approve' }),
      chat: async (message, conversation) => {
        conversations.push(`${conversation}:${message}`);
        return { reply: 'pong' };
      },
      sortie: async () => null,
      events: async () => [],
    });

    const first = await handlers.onChat('NERV-02', 'status');
    const second = await handlers.onChat('NERV-02', 'hello', 'tg42');
    assert.deepEqual(first, { reply: 'pong', base: { id: 'BASE-01', name: 'Main' } });
    assert.deepEqual(second, { reply: 'pong', base: { id: 'BASE-01', name: 'Main' } });
    assert.deepEqual(conversations, ['kaji:nerv-02:status', 'kaji:nerv-02-tg42:hello']);
  });

  it('onSortie returns null when missing and returns sortie + events when found', async () => {
    const handlers = createPeerHandlers({
      base: { id: 'BASE-01', name: 'Main' },
      getAoba: () => undefined,
      bases: async () => [],
      decide: async () => ({ decision: 'approve' }),
      chat: async () => ({ reply: 'ok' }),
      sortie: async (id) => (id === 'S-1' ? { id: 'S-1', status: 'done' } : null),
      events: async () => [{ sequence: 1, kind: 'sortie.done' }],
    });

    assert.equal(await handlers.onSortie('NERV-02', 'S-MISSING'), null);
    assert.deepEqual(await handlers.onSortie('NERV-02', 'S-1'), {
      sortie: { id: 'S-1', status: 'done' },
      events: [{ sequence: 1, kind: 'sortie.done' }],
    });
  });
});
