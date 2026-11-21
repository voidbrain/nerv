import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  READ_TOOL_RESULT_SHAPES,
  builtinToolDescriptors,
  builtinTools,
  execute,
  formatResultShape,
  toolDocs,
  validateToolResult,
  type ReminderBackend,
} from '../src/executors.ts';
import { misatoAsk } from '../src/misato.ts';
import { measureMisatoPrompt } from '../src/prompt-samples.ts';
import { Store } from '../src/store.ts';

describe('F-111-T01: declared result shapes for built-in read tools', () => {
  it('declares a result shape next to every built-in read tool descriptor', () => {
    const readTools = builtinTools.filter((t) => t.effect === 'read');
    assert.ok(readTools.length >= 16);
    for (const tool of readTools) {
      assert.ok(READ_TOOL_RESULT_SHAPES[tool.name], `missing result shape for ${tool.name}`);
      const desc = builtinToolDescriptors.find((d) => d.name === tool.name) as
        ((typeof builtinToolDescriptors)[number] & { resultShape?: unknown }) | undefined;
      assert.ok(desc?.resultShape, `descriptor for ${tool.name} missing resultShape`);
    }
  });

  it('refuses malformed results naming the tool and field', () => {
    assert.throws(
      () => validateToolResult('reminders.list', { not: 'an-array' }),
      /Malformed result from reminders\.list: field "<root>" expected array/,
    );
    assert.throws(
      () => validateToolResult('docs.show', { id: 123 }),
      /Malformed result from docs\.show: field "id" expected string/,
    );
    assert.throws(
      () => validateToolResult('agency.status', { health: 'ok' }),
      /Malformed result from agency\.status: field "health" expected object/,
    );
  });

  it('enforces result shapes across gate/executor join with valid and malformed results', async () => {
    const store = new Store(':memory:');
    try {
      const sortieValid = store.ledger.openSortie('misato', 'Valid read', 'trusted');
      const resValid = await store.runAction(sortieValid, {
        tool: 'reminders.list',
        args: {},
        stage: 'production',
      });
      assert.ok(Array.isArray(resValid.result));

      const badBackend: ReminderBackend = {
        pendingReminders: () => [],
        add: () => {
          throw new Error('unused');
        },
        update: () => undefined,
        cancel: () => false,
        restore: () => false,
        agencyStatus: () => ({ health: 'ok' }) as never,
        memory: store.memory,
      };
      assert.throws(
        () => execute(badBackend, 'agency.status', {}),
        /Malformed result from agency\.status: field "health" expected object/,
      );
    } finally {
      store.close();
    }
  });
});

describe('F-111-T02: result shapes in planner tool docs and prompt metrics', () => {
  it('includes every read tool result shape in toolDocs and misatoAsk system prompt', () => {
    const readDocs = toolDocs.filter((doc) => doc.effect === 'read');
    assert.ok(readDocs.length >= 16);
    const ask = misatoAsk(
      {
        request: 'List my pending reminders',
        history: [],
        tools: toolDocs,
        now: '2026-11-21T12:00:00.000Z',
        timeZone: 'Europe/Rome',
      },
      'local',
    );
    for (const doc of readDocs) {
      const shape = READ_TOOL_RESULT_SHAPES[doc.name];
      assert.ok(shape, `missing shape for ${doc.name}`);
      const expected = formatResultShape(shape);
      assert.equal(doc.returns, expected);
      assert.ok(
        ask.system?.includes(`- ${doc.name} (read): ${doc.about} Arguments: ${doc.args} Returns: ${expected}`),
        `planner system prompt missing Returns for ${doc.name}`,
      );
    }
    for (const doc of toolDocs.filter((d) => d.effect !== 'read')) {
      assert.equal(doc.returns, undefined);
    }
  });

  it('measures planner prompt size before and after adding result shapes via promptMetrics', () => {
    const docsWithoutReturns = toolDocs.map(({ returns: _returns, ...rest }) => rest);
    const input = {
      request: 'List my pending reminders',
      history: [],
      now: '2026-11-21T12:00:00.000Z',
      timeZone: 'Europe/Rome',
    };
    const before = measureMisatoPrompt(misatoAsk({ ...input, tools: docsWithoutReturns }, 'local'), docsWithoutReturns);
    const after = measureMisatoPrompt(misatoAsk({ ...input, tools: toolDocs }, 'local'), toolDocs);
    assert.ok(after.toolSchemaTokens > before.toolSchemaTokens);
    assert.ok(after.promptTokens > before.promptTokens);
    assert.ok(after.toolSchemaShare >= before.toolSchemaShare);
  });
});
