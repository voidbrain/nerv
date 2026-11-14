import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig } from '../src/config.ts';
import { defaultPersonas, validatePersonas } from '../src/persona.ts';
import { misatoAsk } from '../src/misato.ts';

test('F-020: persona names are configured independently on each base and default by role', () => {
  const first = validatePersonas({ enabled: true, names: { misato: 'Bob', gendo: 'Fritz' } });
  const second = validatePersonas({ enabled: true, names: { misato: 'Tim' } });
  assert.deepEqual(first.names, { misato: 'Bob', gendo: 'Fritz' });
  assert.deepEqual(second.names, { misato: 'Tim', gendo: 'Gendo' });
  assert.deepEqual(defaultPersonas.names, { misato: 'Misato', gendo: 'Gendo' });
});

test('F-020: the planner persona is presentation-only and can be disabled', () => {
  const input = { request: 'status', history: [], tools: [], now: '2030-01-01T00:00:00Z', timeZone: 'UTC' };
  const named = misatoAsk({ ...input, personaName: 'Operator' }, 'local').system!;
  assert.match(named, /configured display name is "Operator"/);
  assert.match(named, /never grant a capability, change a Pattern, or override the gate/);
  const disabled = misatoAsk({ ...input, personaName: null }, 'local').system!;
  assert.doesNotMatch(disabled, /Misato|Operator|configured display name/);
  assert.match(disabled, /You are the planner/);
});

test('F-020: config.json validates per-base persona settings', () => {
  const home = mkdtempSync(join(tmpdir(), 'nerv-personas-'));
  try {
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({ personas: { enabled: true, names: { misato: 'Operator', gendo: 'Command' } } }),
    );
    assert.deepEqual(readConfig(home).personas, {
      enabled: true,
      names: { misato: 'Operator', gendo: 'Command' },
    });
    writeFileSync(join(home, 'config.json'), JSON.stringify({ personas: { enabled: true, names: { magi: 'Bob' } } }));
    assert.throws(() => readConfig(home), /Invalid persona names/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
