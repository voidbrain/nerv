import assert from 'node:assert/strict';
import test from 'node:test';
import { placementProbe } from '../src/placement-campaign.ts';
import { makeServer } from '../src/server.ts';

test('placement probes keep P2 local and P3 remote without execution fallback', () => {
  const p2 = placementProbe({ placement: 'P2', prompt: 'Return READY.' });
  assert.deepEqual(p2.orchestration, {
    privacy: 'local-only',
    route: 'local',
    waitBudgetMs: 0,
    maxAttempts: 1,
    maxOutputTokens: 512,
    maxTotalTokens: 1024,
    maxDelegations: 1,
    delegationDepth: 0,
  });
  const p3 = placementProbe({ placement: 'P3', prompt: 'Return READY.', endpoint: 'mac' });
  assert.equal(p3.orchestration.endpoint, 'mac');
  assert.equal(p3.orchestration.privacy, 'owner-bases');
  assert.equal(p3.orchestration.route, undefined);
  assert.equal(p3.orchestration.workerBaseId, undefined);
});

test('P4 has a bounded wait and malformed or expansive probes are refused', () => {
  const p4 = placementProbe({ placement: 'P4', prompt: 'Return READY.' });
  assert.equal(p4.orchestration.waitBudgetMs, 5_000);
  assert.equal(p4.timeoutMs, 20_000);
  assert.equal(p4.requestBudgetMs, 50_000);
  assert.throws(() => placementProbe({ placement: 'P4', prompt: '', endpoint: 'mac' }), /prompt/);
  assert.throws(() => placementProbe({ placement: 'P3', prompt: 'x', endpoint: 'https://host' }), /endpoint/);
  assert.throws(() => placementProbe({ placement: 'P2', prompt: 'x', extra: true }), /Unknown/);
});

test('placement HTTP plans without inference and runs only with explicit confirmation', async () => {
  let runs = 0;
  const api = {
    selectExecution: async () => ({
      inference: { kind: 'local', baseUrl: 'http://127.0.0.1:11434', model: 'm' },
      worker: { kind: 'local', baseId: 'NERV-02' },
    }),
    runOrchestratedJob: async () => {
      runs++;
      return {
        selection: {
          inference: { kind: 'remote', endpoint: 'mac', baseId: 'NERV-01', model: 'm' },
          worker: { kind: 'local', baseId: 'NERV-02' },
        },
        inference: {
          model: 'm',
          text: 'READY',
          stop: 'stop',
          truncated: false,
          usage: { inputTokens: 1, outputTokens: 1 },
          durationMs: 1,
        },
        provenance: {
          executionBaseId: 'NERV-02',
          executionKind: 'local',
          inferenceBaseId: 'NERV-01',
          inferenceKind: 'remote',
          inferenceModel: 'm',
          endpoint: 'mac',
          privacy: 'owner-bases',
        },
      };
    },
  };
  const server = makeServer(api as never, 'x'.repeat(32));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const call = (path: string, value: object) =>
    fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${'x'.repeat(32)}`, 'content-type': 'application/json' },
      body: JSON.stringify(value),
    });
  try {
    const sessionOnly = await fetch(`http://127.0.0.1:${address.port}/api/placement/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ placement: 'P2', prompt: 'READY' }),
    });
    assert.equal(sessionOnly.status, 401);
    assert.equal((await call('/api/placement/plan', { placement: 'P2', prompt: 'READY' })).status, 200);
    assert.equal(runs, 0);
    assert.equal((await call('/api/placement/run', { placement: 'P3', prompt: 'READY' })).status, 400);
    assert.equal(runs, 0);
    assert.equal(
      (await call('/api/placement/run', { placement: 'P3', prompt: 'READY', confirmExecute: true })).status,
      200,
    );
    assert.equal(runs, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test(
  'a placement run longer than the server idle timeout but within its timeoutMs returns its result (B-119)',
  {
    timeout: 60_000,
  },
  async () => {
    // The run outlasts the server's 15 s default socket timeout but stays inside the probe's 30 s budget.
    const inferenceMs = 15_500;
    let budgetSeen: number | undefined;
    const api = {
      runOrchestratedJob: async (input: { timeoutMs: number }) => {
        budgetSeen = input.timeoutMs;
        await new Promise((resolve) => setTimeout(resolve, inferenceMs));
        return {
          selection: {
            inference: { kind: 'remote', endpoint: 'mac', baseId: 'NERV-01', model: 'm' },
            worker: { kind: 'local', baseId: 'NERV-02' },
          },
          inference: {
            model: 'm',
            text: 'READY',
            stop: 'stop',
            truncated: false,
            usage: { inputTokens: 1, outputTokens: 1 },
            durationMs: inferenceMs,
          },
          provenance: {
            executionBaseId: 'NERV-02',
            executionKind: 'local',
            inferenceBaseId: 'NERV-01',
            inferenceKind: 'remote',
            inferenceModel: 'm',
            endpoint: 'mac',
            privacy: 'owner-bases',
          },
        };
      },
    };
    const server = makeServer(api as never, 'x'.repeat(32));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert(address && typeof address === 'object');
    try {
      const res = await fetch(`http://127.0.0.1:${address.port}/api/placement/run`, {
        method: 'POST',
        headers: { authorization: `Bearer ${'x'.repeat(32)}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          placement: 'P3',
          prompt: 'Return READY.',
          endpoint: 'mac',
          timeoutMs: 30_000,
          confirmExecute: true,
        }),
        signal: AbortSignal.timeout(45_000),
      });
      assert.equal(res.status, 200);
      const value = (await res.json()) as { inference: { text: string } };
      assert.equal(value.inference.text, 'READY');
      assert.equal(budgetSeen, 30_000);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
