import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  READ_TOOL_RESULT_SHAPES,
  builtinToolDescriptors,
  builtinTools,
  execute,
  validateToolResult,
  type ReminderBackend,
} from '../src/executors.ts';
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
