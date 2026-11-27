import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { misatoAsk } from '../src/misato.ts';
import {
  activateSkillVersion,
  chooseActiveSkill,
  evaluateSkillVersion,
  retireSkillPackage,
  rollbackSkillVersion,
  stageSkillPackage,
  validateSkillManifest,
  type SkillPackage,
} from '../src/skills.ts';

/** F-146-T03: an invented read-only skill over two invented reads. */
function pkg(over: Partial<SkillPackage['manifest']> = {}, instructions = 'Leggi il serbatoio e rispondi in breve.\n') {
  return {
    manifest: {
      id: 'tank-check',
      version: '1.0.0',
      title: 'Serbatoio: serve acqua?',
      domain: 'garden',
      description: 'Invented read-only skill for the run-time matcher tests.',
      requiredCapabilities: ['garden.tank_level', 'garden.tank_history'],
      triggers: ["serve un'altra ricarica", 'need a refill'],
      createdAt: '2026-11-27T00:00:00.000Z',
      ...over,
    },
    instructions,
  } as SkillPackage;
}
const offered = [
  { name: 'garden.tank_level', effect: 'read' },
  { name: 'garden.tank_history', effect: 'read' },
  { name: 'garden.tank_fill', effect: 'write-external' },
  { name: 'reminders.list', effect: 'read' },
];
const withHome = (fn: (home: string) => void) => {
  const home = mkdtempSync(join(tmpdir(), 'nerv-skill-apply-'));
  try {
    fn(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
};
const suite = {
  id: 'tank-suite',
  schemaVersion: 1 as const,
  allowedCapabilities: ['garden.tank_level', 'garden.tank_history'],
  cases: [
    {
      id: 'a',
      split: 'regression' as const,
      family: 'domain-knowledge' as const,
      prompt: 'x',
      expectedTokens: ['ricarica'],
      baselineOutput: 'no',
      withSkillOutput: 'ricarica',
    },
    {
      id: 'b',
      split: 'holdout' as const,
      family: 'domain-knowledge' as const,
      prompt: 'y',
      expectedTokens: ['refill'],
      baselineOutput: 'no',
      withSkillOutput: 'refill',
    },
  ],
};

describe('applying an active skill at run time (F-146-T03)', () => {
  it('an active skill applies to its Italian and English triggers, whatever the case and punctuation', () =>
    withHome((home) => {
      stageSkillPackage(home, pkg());
      activateSkillVersion(home, 'tank-check', '1.0.0', { ownerApproved: true });
      for (const request of [
        "Controlla se SERVE UN'ALTRA RICARICA al vaso 2?",
        'serve un altra ricarica',
        'Does the tank need a refill today?',
      ]) {
        const choice = chooseActiveSkill(home, request, offered);
        assert.ok(choice && 'applied' in choice, request);
        assert.deepEqual(choice.applied, {
          id: 'tank-check',
          version: '1.0.0',
          title: 'Serbatoio: serve acqua?',
          instructions: 'Leggi il serbatoio e rispondi in breve.\n',
          tools: ['garden.tank_level', 'garden.tank_history'],
        });
      }
      assert.equal(chooseActiveSkill(home, 'che tempo fa domani?', offered), undefined);
      assert.equal(chooseActiveSkill(home, 'I need a refillable bottle', offered), undefined, 'whole words only');
    }));

  it('a staged, evaluated-but-not-promoted, rolled-back or retired skill never applies', () =>
    withHome((home) => {
      const request = "serve un'altra ricarica?";
      stageSkillPackage(home, pkg());
      assert.equal(chooseActiveSkill(home, request, offered), undefined, 'staged');
      const report = evaluateSkillVersion(home, 'tank-check', '1.0.0', suite, { model: 'fake-model' });
      assert.equal(report.eligibleForPromotion, true);
      assert.equal(chooseActiveSkill(home, request, offered), undefined, 'evaluated, not promoted');
      activateSkillVersion(home, 'tank-check', '1.0.0', { ownerApproved: true });
      assert.ok(chooseActiveSkill(home, request, offered), 'promoted');
      rollbackSkillVersion(home, 'tank-check', { ownerApproved: true });
      assert.equal(chooseActiveSkill(home, request, offered), undefined, 'rolled back');
      stageSkillPackage(home, pkg({ version: '1.1.0' }));
      activateSkillVersion(home, 'tank-check', '1.1.0', { ownerApproved: true });
      assert.equal(
        (chooseActiveSkill(home, request, offered) as { applied: { version: string } }).applied.version,
        '1.1.0',
      );
      retireSkillPackage(home, 'tank-check', { ownerApproved: true });
      assert.equal(chooseActiveSkill(home, request, offered), undefined, 'retired');
    }));

  it('a skill without triggers never applies: matching is by the owner-readable trigger list, not a guess', () =>
    withHome((home) => {
      stageSkillPackage(home, pkg({ triggers: undefined }));
      activateSkillVersion(home, 'tank-check', '1.0.0', { ownerApproved: true });
      assert.equal(chooseActiveSkill(home, "serve un'altra ricarica al serbatoio garden", offered), undefined);
    }));

  it('a matching skill that needs an ungranted tool, a tool that is not a read, or escalates is refused, not applied', () => {
    const cases: [Partial<SkillPackage['manifest']>, string | undefined, RegExp][] = [
      [{ requiredCapabilities: ['garden.tank_level', 'garden.tank_ph'] }, undefined, /garden\.tank_ph.*not granted/],
      [{ requiredCapabilities: ['garden.tank_level', 'garden.tank_fill'] }, undefined, /garden\.tank_fill.*not a read/],
      [{}, 'Leggi scrolls.json e rispondi.\n', /escalation/],
    ];
    for (const [over, instructions, reason] of cases)
      withHome((home) => {
        stageSkillPackage(home, pkg(over, instructions));
        activateSkillVersion(home, 'tank-check', '1.0.0', { ownerApproved: true });
        const choice = chooseActiveSkill(home, 'Does it need a refill?', offered);
        assert.ok(choice && 'refused' in choice);
        assert.equal(choice.refused.id, 'tank-check');
        assert.equal(choice.refused.version, '1.0.0');
        assert.match(choice.refused.reason, reason);
      });
  });

  it('when two active skills match, the longer trigger wins', () =>
    withHome((home) => {
      stageSkillPackage(home, pkg());
      activateSkillVersion(home, 'tank-check', '1.0.0', { ownerApproved: true });
      stageSkillPackage(home, pkg({ id: 'tank-short', triggers: ['ricarica'] }));
      activateSkillVersion(home, 'tank-short', '1.0.0', { ownerApproved: true });
      const choice = chooseActiveSkill(home, "serve un'altra ricarica?", offered);
      assert.equal((choice as { applied: { id: string } }).applied.id, 'tank-check');
      assert.equal(
        (chooseActiveSkill(home, 'una ricarica', offered) as { applied: { id: string } }).applied.id,
        'tank-short',
      );
    }));

  it('the manifest refuses malformed triggers', () => {
    const base = pkg().manifest;
    for (const triggers of [[], [''], ['  '], ['x'.repeat(121)], 'serve', [1], Array(21).fill('serve una dose')])
      assert.throws(() => validateSkillManifest({ ...base, triggers }), /triggers/, JSON.stringify(triggers));
    assert.deepEqual(validateSkillManifest({ ...base, triggers: ['  serve una dose '] }).triggers, ['serve una dose']);
  });

  it('the planner prompt carries the applied skill as owner-approved data after the rules, and nothing without one', () => {
    const input = {
      request: "Controlla se serve un'altra ricarica",
      history: [],
      tools: [{ name: 'garden.tank_level', effect: 'read', args: '{}', about: 'Invented tank level.' }],
      now: '2030-01-01T08:00:00.000Z',
      timeZone: 'Europe/Rome',
      language: 'it' as const,
    };
    const skill = {
      id: 'tank-check',
      version: '1.0.0',
      title: 'Serbatoio: serve acqua?',
      instructions: 'MARKER: leggi il serbatoio.',
      tools: ['garden.tank_level'],
    };
    const plain = misatoAsk(input, 'local').system!;
    const withSkill = misatoAsk({ ...input, skill }, 'local').system!;
    assert.doesNotMatch(plain, /MARKER|skill/i);
    assert.match(withSkill, /"Serbatoio: serve acqua\?" \(tank-check 1\.0\.0\)/);
    assert.match(withSkill, /MARKER: leggi il serbatoio\./);
    assert.match(withSkill, /never grant a tool/);
    assert.ok(withSkill.indexOf('MARKER') < withSkill.indexOf('Write the reply in Italian'), 'language rule last');
    assert.ok(withSkill.startsWith(plain.slice(0, plain.indexOf('Now: '))), 'the rules stay a stable prefix');
  });
});
