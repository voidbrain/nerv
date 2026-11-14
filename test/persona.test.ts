import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig } from '../src/config.ts';
import { defaultPersonas, personaReply, validatePersonas } from '../src/persona.ts';

test('F-020: persona names are configured independently on each base and default by role', () => {
  const first = validatePersonas({ enabled: true, names: { misato: 'Bob', gendo: 'Fritz' } });
  const second = validatePersonas({ enabled: true, names: { misato: 'Tim' } });
  assert.deepEqual(first.names, { misato: 'Bob', gendo: 'Fritz' });
  assert.deepEqual(second.names, { misato: 'Tim', gendo: 'Gendo' });
  assert.deepEqual(defaultPersonas.names, { misato: 'Misato', gendo: 'Gendo' });
});

test('F-020: the persona adapter can be disabled and exposes presentation, never authority', () => {
  assert.equal(
    personaReply(validatePersonas({ enabled: false }), 'misato', {
      text: 'Waiting for your decision.',
      sources: ['A-1'],
    }),
    undefined,
  );
  const reply = personaReply(validatePersonas({ enabled: true }), 'gendo', {
    text: 'Pattern Red requires the owner.',
    sources: ['decision:D-1'],
  });
  assert.deepEqual(reply, {
    role: 'gendo',
    name: 'Gendo',
    text: 'Pattern Red requires the owner.',
    sources: ['decision:D-1'],
  });
  assert.deepEqual(Object.keys(reply!).sort(), ['name', 'role', 'sources', 'text']);
  assert.throws(() => personaReply(defaultPersonas, 'misato', { text: 'Trust me.', sources: [] }), /record source/);
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
