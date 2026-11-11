import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/store.ts';
import { DatabaseSync } from 'node:sqlite';
import { MEMORY_SCHEMA } from '../src/memory.ts';
import { LEDGER_SCHEMA } from '../src/ledger.ts';
import { fillLcl } from '../src/misato.ts';
import { ballot, defaultPolicy } from '../src/policy.ts';

test('F-027: durable source/taint follows intake, gate, approved memory, duplicate facts and conversation across reopen', () => {
  const home = mkdtempSync(join(tmpdir(), 'nerv-provenance-'));
  const path = join(home, 'nerv.sqlite');
  let store = new Store(path);
  try {
    const id = store.ledger.openSortie('misato', 'Read a message', 'trusted');
    store.ledger.note(id, 'misato.request', { text: 'Read a message', conversation: 'cli' });
    store.ledger.setExternal([{ name: 'fixture.send', effect: 'write-external' }]);
    assert.equal(store.ledger.preview(id, 'fixture.send').pattern, 'orange', 'direct owner context stays trusted');
    store.ledger.intake(id, 'email:fixture', 'tainted');
    store.ledger.intake(id, 'owner:clarification', 'trusted');
    assert.equal(store.ledger.preview(id, 'fixture.send').pattern, 'blue', 'owner clarification does not erase taint');
    const p = store.ledger.propose(id, {
      tool: 'fixture.send',
      args: {},
      stage: 'production',
      casper: { seat: 'casper', vote: 'approve', reason: 'Intent matches', confidence: 1 },
    });
    assert.equal(p.ballot.outcome, 'approval');
    assert.equal(p.ballot.pattern, 'blue');
    const m = store.runAction(id, {
      tool: 'memory.remember',
      args: { text: 'The fixture prefers tea' },
      stage: 'production',
    });
    store.decide(m.approvalId!, 'approve');
    assert.equal(store.memory.list()[0]?.tainted, true);
    const clean = store.memory.add('The fixture prefers coffee', 'owner');
    assert.equal(
      store.memory.add(clean.text, 'misato', { tainted: true, sortieId: id }).tainted,
      true,
      'duplicate merging never launders taint',
    );
    assert.equal(store.memory.add(clean.text, 'owner').tainted, true);
    store.ledger.reply(id, 'Fixture result');
    store.ledger.close(id, 'done');
    store.close();
    store = new Store(path);
    assert.equal(store.ledger.trust(id), 'tainted');
    assert.equal(
      store.memory.list().every((f) => f.tainted),
      true,
    );
    const earlier = store.ledger.conversation('cli');
    assert.equal(earlier[0]?.tainted, true);
    assert.equal(earlier[0]?.source, id);
    const lcl = fillLcl(
      [{ id: 'summary', text: 'Fixture result', shareable: false, tainted: true, kind: 'summary', source: id }],
      earlier,
      'local',
    );
    assert.equal(lcl.memory[0]?.tainted, true);
    assert.equal(lcl.earlier[0]?.tainted, true);
    assert.equal(store.events(id).filter((e) => e.kind === 'context.intake').length, 2);
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('F-027: persisted summaries retain taint; legacy summaries default to tainted and remain local', () => {
  const store = new Store(':memory:');
  try {
    const base = {
      since: '2030-01-01T00:00:00Z',
      until: '2030-01-02T00:00:00Z',
      summary: 'Fixture nectar',
      exchanges: 1,
      proposed: 0,
    };
    store.memory.saveEpisode(base);
    assert.equal(store.memory.recallEpisodes('nectar')[0]?.tainted, true);
    store.memory.saveEpisode({ ...base, summary: 'Fixture pollen', tainted: false });
    assert.equal(store.memory.recallEpisodes('pollen')[0]?.tainted, false);
  } finally {
    store.close();
  }
});

test('F-027: tainted local outside code selects EVA-03 and fails closed even with a production grant', () => {
  const result = ballot(
    { tool: 'fixture.read', args: {}, trust: 'tainted', stage: 'production', cost: 0 },
    { name: 'fixture.read', effect: 'read', eva: 'eva-02' },
    defaultPolicy,
    0,
  );
  assert.equal(result.executor, 'eva-03');
  assert.equal(result.outcome, 'reject');
  assert.match(result.reason, /F-049/);
});

test('F-027: repeated quarantine denials never become owner approvals at the reject limit', () => {
  const store = new Store(':memory:');
  try {
    const id = store.ledger.openSortie('misato', 'Fixture context', 'tainted');
    store.ledger.setExternal([{ name: 'fixture.read', effect: 'read', eva: 'eva-02' }]);
    for (let n = 0; n < 8; n++) {
      const r = store.runAction(id, { tool: 'fixture.read', args: { n }, stage: 'production' });
      assert.equal(r.outcome, 'reject');
      assert.equal(r.approvalId, undefined);
      assert.equal(r.external, undefined);
    }
    assert.equal(store.approvals().length, 0);
    assert.equal(
      store.events(id).some((e) => e.kind === 'grant.used'),
      false,
    );
  } finally {
    store.close();
  }
});

test('F-027: an actual legacy schema migrates planner context, facts and summaries once without losing evidence', () => {
  const home = mkdtempSync(join(tmpdir(), 'nerv-provenance-old-'));
  const path = join(home, 'nerv.sqlite');
  const old = new DatabaseSync(path);
  // These schemas deliberately predate provenance markers and the summary taint column.
  old.exec(MEMORY_SCHEMA + LEDGER_SCHEMA);
  old.exec(
    "INSERT INTO sorties(id,source,title,trust,status,created) VALUES('legacy','misato','Legacy fixture','trusted','done','2030-01-01T00:00:00Z'); INSERT INTO facts VALUES('model','Legacy fixture fact','active','misato','legacy',0,0,'2030-01-01','2030-01-01'); INSERT INTO facts VALUES('owner','Direct fixture fact','active','owner',NULL,0,0,'2030-01-01','2030-01-01'); INSERT INTO fact_history(fact_id,kind,text,source,created) VALUES('model','created','Legacy fixture fact','misato','2030-01-01'); INSERT INTO episodes VALUES('episode','2030-01-01','2030-01-02','Legacy nectar summary',1,0,'2030-01-02')",
  );
  old.close();
  let store = new Store(path);
  try {
    assert.equal(store.ledger.trust('legacy'), 'tainted');
    const facts = store.memory.list();
    assert.equal(facts.find((f) => f.source === 'misato')?.tainted, true);
    assert.equal(facts.find((f) => f.source === 'owner')?.tainted, false);
    assert.deepEqual(
      store.memory.historyOf('model').map((h) => h.kind),
      ['created', 'tainted'],
    );
    assert.equal(store.memory.recallEpisodes('nectar')[0]?.tainted, true);
    assert.equal(store.events('legacy').filter((e) => e.kind === 'context.intake').length, 1);
    store.close();
    store = new Store(path);
    assert.equal(
      store.events('legacy').filter((e) => e.kind === 'context.intake').length,
      1,
      'migration is idempotent',
    );
    assert.deepEqual(
      store.memory.historyOf('model').map((h) => h.kind),
      ['created', 'tainted'],
    );
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});
