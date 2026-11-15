import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig, readScrolls } from '../src/config.ts';
import {
  decideHitlThroughPersona,
  defaultPersonas,
  formatMisatoPendingHitl,
  validatePersonas,
} from '../src/persona.ts';
import { Store } from '../src/store.ts';
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

test('F-020-T02: Misato surfaces pending HITL and accepts/rejects through the existing decision path with audit', async () => {
  const home = mkdtempSync(join(tmpdir(), 'nerv-persona-hitl-'));
  try {
    const store = new Store(join(home, 'nerv.db'), readScrolls(home), { home });
    const sortieId = store.ledger.openSortie('owner', 'remember two facts', 'trusted');
    const act = store.runAction(sortieId, {
      tool: 'memory.remember',
      args: { texts: ['Fact alpha', 'Fact beta'] },
      stage: 'production',
    });
    assert.equal(act.approvalIds?.length, 2);

    const pending = store.approvals(10);
    const misatoView = formatMisatoPendingHitl(pending, {
      enabled: true,
      names: { misato: 'Misato', gendo: 'Gendo' },
    });
    assert.match(misatoView, /^Misato: 2 pending approvals:/);
    assert.match(misatoView, new RegExp(act.approvalIds![0]!));
    assert.match(misatoView, /memory\.remember/);

    const neutralView = formatMisatoPendingHitl(pending, {
      enabled: false,
      names: { misato: 'Misato', gendo: 'Gendo' },
    });
    assert.doesNotMatch(neutralView, /Misato/);
    assert.match(neutralView, /^2 pending approvals:/);

    const approved = await decideHitlThroughPersona(store, act.approvalIds![0]!, 'approve', {
      source: 'cli',
      persona: defaultPersonas,
    });
    assert.equal(approved.decision, 'approve');
    assert.equal(approved.tool, 'memory.remember');
    assert.ok(store.memory.list().some((f) => f.text === 'Fact alpha'));

    const rejected = await decideHitlThroughPersona(store, act.approvalIds![1]!, 'reject', {
      source: 'cli',
      persona: defaultPersonas,
    });
    assert.equal(rejected.decision, 'reject');
    assert.ok(!store.memory.list().some((f) => f.text === 'Fact beta'));

    const events = store.events(sortieId);
    assert.ok(events.some((e) => e.kind === 'approval.approve'));
    assert.ok(events.some((e) => e.kind === 'approval.reject'));

    await assert.rejects(
      () => decideHitlThroughPersona(store, 'missing-approval-id', 'approve'),
      /No pending HITL approval missing-approval-id/,
    );
    store.close();
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
