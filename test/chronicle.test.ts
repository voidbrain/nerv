import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { Registry, canonical, createRootKey, signRecord, unlockRootKey, type RegistryBody } from '../src/kaji.ts';
import { chronicleDays, composeChronicle, gatherMilestones, type Milestone } from '../src/chronicle.ts';
const pub = () => generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const m = (at: string, kind: Milestone['kind'], subject: string, detail: string, source: string): Milestone => ({
  at,
  kind,
  subject,
  detail,
  source,
});
test('one entry per local day, newest day first, in the order things happened; days with nothing have no entry', () => {
  const days = chronicleDays(
    [
      m('2030-01-02T08:00:00Z', 'pilot.created', 'Fuyutsuki', 'history', 'S-AAAA'),
      // 23:30 UTC on 1 January is 00:30 on 2 January in Rome: the owner's day, not UTC's.
      m('2030-01-01T23:30:00Z', 'base.enrolled', 'Tabgha', 'NERV-02', 'registry:11111111'),
      m('2030-01-01T09:00:00Z', 'base.main', 'Lilith', 'NERV-01', 'registry:22222222'),
      m('2030-01-05T09:00:00Z', 'remote.first', 'Tabgha', 'reminders.add', 'S-BBBB'),
      m('not a time', 'base.revoked', 'Ghost', 'NERV-09', 'registry:33333333'),
      { ...m('2030-01-05T10:00:00Z', 'base.revoked', 'Bad', 'X', 'registry:4'), kind: 'outage' as Milestone['kind'] },
    ],
    'Europe/Rome',
  );
  assert.deepEqual(
    days.map((d) => [d.day, d.milestones.map((x) => x.subject)]),
    [
      ['2030-01-05', ['Tabgha']],
      ['2030-01-02', ['Tabgha', 'Fuyutsuki']],
      ['2030-01-01', ['Lilith']],
    ],
    'no entry for 3 and 4 January; an unreadable time or an unknown kind is left out, never guessed',
  );
  assert.deepEqual(
    chronicleDays(
      days.flatMap((d) => d.milestones),
      'Europe/Rome',
      new Date('2030-01-03T00:00:00Z'),
    ).map((d) => d.day),
    ['2030-01-05'],
    'since leaves out older days',
  );
});
test('the Simple chronicle names every fact with its source, in English and Italian, and says when nothing is recorded', () => {
  const days = chronicleDays(
    [
      m('2030-01-01T09:00:00Z', 'base.enrolled', 'Tabgha', 'NERV-02', 'registry:11111111'),
      m('2030-01-01T10:00:00Z', 'remote.first', 'Tabgha', 'reminders.add', 'S-BBBB'),
      m('2030-01-01T11:00:00Z', 'pilot.created', 'Fuyutsuki', 'history', 'S-AAAA'),
    ],
    'Europe/Rome',
  );
  assert.equal(
    composeChronicle(days, 'en'),
    'Base chronicle\n\n2030-01-01\n• Tabgha (NERV-02) joined the agency. [registry:11111111]\n• First action run on Tabgha: reminders.add. [S-BBBB]\n• New pilot: Fuyutsuki, for history. [S-AAAA]',
  );
  assert.match(
    composeChronicle(days, 'it'),
    /^Cronaca della base\n\n2030-01-01\n• La base Tabgha \(NERV-02\) è entrata/,
  );
  assert.equal(composeChronicle([], 'en'), 'Base chronicle\nNothing recorded yet.');
  assert.equal(composeChronicle([], 'it'), 'Cronaca della base\nAncora nulla di registrato.');
});
test('across the store, the ledger and the registry: only recorded milestones, each with a source that leads to its record', () => {
  const home = mkdtempSync(join(tmpdir(), 'nerv-chronicle-'));
  try {
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({ models: { local: { baseUrl: 'http://127.0.0.1:9/v1', model: 'm' } } }),
    );
    const store = new Store(join(home, 'nerv.sqlite'), undefined, { home });
    const k = createRootKey('correct horse battery');
    const root = unlockRootKey(k.file, 'correct horse battery');
    const registry = new Registry(store.db, k.publicKey);
    const enrol = (serial: number, baseId: string, name: string, issued: string): RegistryBody => ({
      kind: 'enrol',
      serial,
      baseId,
      name,
      publicKey: pub(),
      address: '100.64.0.2',
      issued,
    });
    const records = [
      signRecord(root.privateKey, enrol(1, 'NERV-01', 'Lilith', '2030-01-01T09:00:00.000Z')),
      signRecord(root.privateKey, enrol(2, 'NERV-02', 'Tabgha', '2030-01-02T09:00:00.000Z')),
      signRecord(root.privateKey, { kind: 'main', serial: 3, baseId: 'NERV-01', issued: '2030-01-02T10:00:00.000Z' }),
      signRecord(root.privateKey, enrol(4, 'NERV-02', 'Tabgha', '2030-01-03T09:00:00.000Z')),
      signRecord(root.privateKey, { kind: 'revoke', serial: 5, baseId: 'NERV-02', issued: '2030-01-04T09:00:00.000Z' }),
    ];
    for (const r of records) registry.add(r);
    // A pilot proposed and approved (it runs), and one turned down (it never ran, so it is not a milestone).
    const propose = (id: string, name: string) => {
      const sortie = store.ledger.openSortie('marduk', 'New pilot', 'trusted');
      const r = store.runAction(sortie, {
        tool: 'pilots.create',
        args: { id, name, domain: 'history', keywords: ['history'] },
        stage: 'production',
      });
      return { sortie, approvalId: r.approvalId! };
    };
    const made = propose('fuyutsuki', 'Fuyutsuki');
    store.decide(made.approvalId, 'approve', 'cli');
    const refused = propose('other', 'Other');
    store.decide(refused.approvalId, 'reject', 'cli');
    // Remote actions: one that failed, then the first that ran, then a later one that also ran.
    const sortie = store.ledger.openSortie('owner', 'Remote work', 'trusted');
    const failed = store.queueRemote(sortie, 'NERV-02', 'notes.add', {});
    store.outboxDone(failed.id, { outcome: 'grant', error: 'disk full' });
    const first = store.queueRemote(sortie, 'NERV-02', 'reminders.add', {});
    store.outboxDone(first.id, { outcome: 'grant', result: {} });
    const later = store.queueRemote(sortie, 'NERV-02', 'reminders.cancel', {});
    store.outboxDone(later.id, { outcome: 'grant', result: {} });
    const asked = store.queueRemote(sortie, 'NERV-01', 'reminders.add', {});
    store.outboxDone(asked.id, { outcome: 'approval', approvalId: 'x' });

    const found = gatherMilestones(store.db, k.publicKey);
    const id = (i: number) =>
      'registry:' + createHash('sha256').update(canonical(records[i]!)).digest('hex').slice(0, 8);
    assert.deepEqual(
      found.filter((x) => x.source.startsWith('registry:')).map((x) => [x.kind, x.subject, x.at, x.source]),
      [
        ['base.enrolled', 'Lilith', '2030-01-01T09:00:00.000Z', id(0)],
        ['base.enrolled', 'Tabgha', '2030-01-02T09:00:00.000Z', id(1)],
        ['base.main', 'Lilith', '2030-01-02T10:00:00.000Z', id(2)],
        ['base.reenrolled', 'Tabgha', '2030-01-03T09:00:00.000Z', id(3)],
        ['base.revoked', 'Tabgha', '2030-01-04T09:00:00.000Z', id(4)],
      ],
      'dated by the signed issue time, named by the enrolment',
    );
    const stored = (store.db.prepare('SELECT id FROM registry').all() as { id: string }[]).map((r) => r.id.slice(0, 8));
    for (let i = 0; i < records.length; i++)
      assert.ok(stored.includes(id(i).slice('registry:'.length)), 'each registry source is a stored record ID');
    const pilots = found.filter((x) => x.kind === 'pilot.created');
    assert.deepEqual(
      pilots.map((x) => [x.subject, x.detail, x.source]),
      [['Fuyutsuki', 'history', 'S-' + made.sortie.slice(0, 4).toUpperCase()]],
      'only the approved pilot, linked to its sortie',
    );
    const remote = found.filter((x) => x.kind === 'remote.first');
    assert.deepEqual(
      remote.map((x) => [x.subject, x.detail, x.source]),
      [['Tabgha', 'reminders.add', 'S-' + sortie.slice(0, 4).toUpperCase()]],
      'per base the first action that ran: not the failed one, not the later one, not one only waiting for approval',
    );
    assert.deepEqual(
      gatherMilestones(store.db).map((x) => [x.kind, x.subject, x.source]),
      found
        .filter((x) => !x.source.startsWith('registry:'))
        .map((x) => [x.kind, x.kind === 'remote.first' ? 'NERV-02' : x.subject, x.source]),
      'no root: no registry milestones, and a base is shown by its ID',
    );
    store.db.close();

    // The command the owner runs.
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({
        models: { local: { baseUrl: 'http://127.0.0.1:9/v1', model: 'm' } },
        kaji: { root: k.publicKey },
        timeZone: 'Europe/Rome',
        language: 'en',
      }),
    );
    const run = (...args: string[]) =>
      spawnSync(process.execPath, ['src/cli.ts', 'chronicle', ...args], {
        env: { ...process.env, NERV_HOME: home, NERV_OLLAMA: 'http://127.0.0.1:9' },
        encoding: 'utf8',
      });
    const all = run('3660');
    assert.equal(all.status, 0, all.stderr);
    assert.match(all.stdout, /^Base chronicle\n\n\d{4}-\d{2}-\d{2}\n/);
    assert.match(
      all.stdout,
      /2030-01-02\n• Tabgha \(NERV-02\) joined the agency\. \[registry:[0-9a-f]{8}\]\n• Lilith \(NERV-01\) became the main base\./,
    );
    assert.match(all.stdout, /• New pilot: Fuyutsuki, for history\. \[S-[0-9A-F]{4}\]/);
    assert.match(all.stdout, /• First action run on Tabgha: reminders\.add\. \[S-[0-9A-F]{4}\]/);
    assert.doesNotMatch(all.stdout, /Other|notes\.add|reminders\.cancel/);
    assert.match(run('0').stderr, /Usage: chronicle \[DAYS\]/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
