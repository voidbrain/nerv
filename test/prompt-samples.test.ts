import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import { misatoAsk, type ToolDoc } from '../src/misato.ts';
import { BUILTIN_TOOL_SUBJECTS, builtinTools, toolDocs } from '../src/executors.ts';
import { PromptSampleStore, measureMisatoPrompt } from '../src/prompt-samples.ts';
import { callModelWithUsage } from '../src/runtime-tools.ts';
import { Store } from '../src/store.ts';
import type { ProcessClient } from '../src/process-client.ts';

describe('F-106-T01: Misato prompt size sampling and doctor report', () => {
  it('measures route, estimated prompt tokens, and tool-schema share without storing text', () => {
    const tools: ToolDoc[] = [
      { name: 'system.status', effect: 'read', about: 'Check local system health', args: '{}' },
      { name: 'reminders.add', effect: 'write-local', about: 'Schedule a reminder', args: '{title,due}' },
    ];
    const ask = misatoAsk(
      {
        request: 'check system status',
        history: [],
        tools,
        now: '2026-11-19T19:00:00.000Z',
        timeZone: 'Europe/Rome',
      },
      'local',
    );
    const metrics = measureMisatoPrompt(ask, tools);
    assert.equal(metrics.route, 'local');
    assert.ok(metrics.promptTokens > 0);
    assert.ok(metrics.toolSchemaTokens > 0);
    assert.ok(metrics.toolSchemaShare > 0 && metrics.toolSchemaShare < 1);
  });

  it('enforces per-route rate limits, maxSamples, maxAgeMs, and zero text columns', () => {
    const db = new DatabaseSync(':memory:');
    try {
      const store = new PromptSampleStore(db, { minIntervalMs: 1000, maxSamples: 3, maxAgeMs: 10_000 });
      const cols = (db.prepare('PRAGMA table_info(prompt_samples)').all() as Array<{ name: string }>).map(
        (c) => c.name,
      );
      assert.deepEqual(cols, [
        'id',
        'sampled_at_ms',
        'route',
        'prompt_tokens',
        'tool_schema_tokens',
        'tool_schema_share',
      ]);

      assert.deepEqual(
        store.record({
          sampledAtMs: 10_000,
          route: 'local',
          promptTokens: 500,
          toolSchemaTokens: 200,
          toolSchemaShare: 0.4,
        }),
        { recorded: true },
      );
      assert.deepEqual(
        store.record({
          sampledAtMs: 10_500,
          route: 'local',
          promptTokens: 600,
          toolSchemaTokens: 200,
          toolSchemaShare: 0.33,
        }),
        { recorded: false, reason: 'rate-limited' },
      );
      // Different route is not blocked by local's rate limit.
      assert.deepEqual(
        store.record({
          sampledAtMs: 10_500,
          route: 'cloud',
          promptTokens: 900,
          toolSchemaTokens: 300,
          toolSchemaShare: 0.33,
        }),
        { recorded: true },
      );
      assert.deepEqual(
        store.record({
          sampledAtMs: 11_500,
          route: 'local',
          promptTokens: 700,
          toolSchemaTokens: 200,
          toolSchemaShare: 0.28,
        }),
        { recorded: true },
      );
      assert.deepEqual(
        store.record({
          sampledAtMs: 12_500,
          route: 'local',
          promptTokens: 800,
          toolSchemaTokens: 200,
          toolSchemaShare: 0.25,
        }),
        { recorded: true },
      );

      // maxSamples = 3 keeps only the 3 newest rows; oldest local (10_000) is evicted.
      const rows = store.list(10);
      assert.equal(rows.length, 3);
      assert.deepEqual(
        rows.map((r) => r.promptTokens),
        [800, 700, 900],
      );

      // Recording at 25_000 evicts samples older than 15_000 (maxAgeMs = 10_000).
      store.record({
        sampledAtMs: 25_000,
        route: 'local',
        promptTokens: 1000,
        toolSchemaTokens: 250,
        toolSchemaShare: 0.25,
      });
      const afterAge = store.list(10);
      assert.equal(afterAge.length, 1);
      assert.equal(afterAge[0]!.promptTokens, 1000);
    } finally {
      db.close();
    }
  });

  it('summarizes last 24h median and max per route in Store.doctor() and records from callModelWithUsage', async () => {
    const store = new Store(':memory:');
    try {
      const sampleStore = new PromptSampleStore(store.db, { minIntervalMs: 0 });
      const now = 1_700_000_000_000;
      const dayMs = 24 * 60 * 60 * 1000;

      // Older than 24h -> excluded from last-day summary.
      sampleStore.record({
        sampledAtMs: now - dayMs - 1000,
        route: 'local',
        promptTokens: 9999,
        toolSchemaTokens: 100,
        toolSchemaShare: 0.99,
      });

      // Local samples: [400, 600, 1200] -> median 600, max 1200
      sampleStore.record({
        sampledAtMs: now - 3000,
        route: 'local',
        promptTokens: 400,
        toolSchemaTokens: 160,
        toolSchemaShare: 0.4,
      });
      sampleStore.record({
        sampledAtMs: now - 2000,
        route: 'local',
        promptTokens: 1200,
        toolSchemaTokens: 300,
        toolSchemaShare: 0.25,
      });
      sampleStore.record({
        sampledAtMs: now - 1000,
        route: 'local',
        promptTokens: 600,
        toolSchemaTokens: 180,
        toolSchemaShare: 0.3,
      });

      // Cloud samples via callModelWithUsage hook
      const recorded: unknown[] = [];
      const mockNervous = {
        call: async (method: string) => (method === 'usage.begin' ? 'usage-1' : undefined),
      } as unknown as ProcessClient;
      const mockBrain = {
        call: async () => ({
          value: {
            plan: { reply: 'ok' },
            model: 'cloud-model',
            promptMetrics: { route: 'cloud', promptTokens: 1500, toolSchemaTokens: 450, toolSchemaShare: 0.3 },
          },
          accounting: null,
        }),
      } as unknown as ProcessClient;

      await callModelWithUsage({
        nervous: mockNervous,
        brain: mockBrain,
        method: 'misato.step',
        params: {},
        timeoutMs: 1000,
        onPromptMetrics: (m) => {
          recorded.push(m);
          sampleStore.record({ ...m, sampledAtMs: now });
        },
      });
      assert.equal(recorded.length, 1);

      const summary = sampleStore.summarizeLastDay(now);
      assert.deepEqual(summary.local, {
        count: 3,
        medianPromptTokens: 600,
        maxPromptTokens: 1200,
        medianToolSchemaShare: 0.3,
        maxToolSchemaShare: 0.4,
      });
      assert.deepEqual(summary.cloud, {
        count: 1,
        medianPromptTokens: 1500,
        maxPromptTokens: 1500,
        medianToolSchemaShare: 0.3,
        maxToolSchemaShare: 0.3,
      });

      // Store.doctor() exposes promptSizes
      const doc = store.doctor();
      assert.ok('promptSizes' in doc);
    } finally {
      store.close();
    }
  });
});

describe('F-113-T01: built-in tool subject grouping and tool-doc share', () => {
  it('assigns every built-in tool to one subject and measures tool-doc share on neutral samples', () => {
    for (const tool of builtinTools) {
      assert.ok(BUILTIN_TOOL_SUBJECTS[tool.name], `missing subject for ${tool.name}`);
    }
    for (const doc of toolDocs) {
      assert.equal(doc.subject, BUILTIN_TOOL_SUBJECTS[doc.name]);
      assert.ok(doc.subject, `missing subject on toolDoc ${doc.name}`);
    }
    const ask = misatoAsk(
      {
        request: 'Hello, how are you today?',
        history: [],
        tools: toolDocs,
        now: '2026-11-20T18:00:00.000Z',
        timeZone: 'Europe/Rome',
      },
      'local',
    );
    const metrics = measureMisatoPrompt(ask, toolDocs);
    assert.ok(metrics.toolSchemaTokens > 2000);
    assert.ok(metrics.toolSchemaShare > 0.5 && metrics.toolSchemaShare < 1);
  });
});
