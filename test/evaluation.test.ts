import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ballot, defaultPolicy, effects, type Action, type Verdict, type Tool } from '../src/policy.ts';

const action: Action = {
  tool: 'fixture.write',
  args: { value: 'Neutral fixture' },
  trust: 'trusted',
  stage: 'production',
  cost: 0,
};
const approved: Verdict = { seat: 'casper', vote: 'approve', reason: 'Matches the neutral request.', confidence: 1 };
// Every local counted-seat combination, with each peer vote both counted and shadow.
for (const melchior of ['approve', 'reject'] as const)
  for (const balthasar of ['approve', 'reject'] as const)
    for (const casper of ['approve', 'reject', 'abstain'] as const)
      for (const peer of ['approve', 'reject', 'abstain'] as const)
        for (const shadow of [false, true]) {
          const id = `mel-${melchior}-bal-${balthasar}-cas-${casper}-peer-${peer}-${shadow ? 'shadow' : 'counted'}`;
          test('golden-v1/votes/' + id, () => {
            const policy = { ...defaultPolicy, deny: melchior === 'reject' ? [action.tool] : [] };
            const result = ballot(
              action,
              { name: action.tool, effect: 'write-external' },
              policy,
              balthasar === 'reject' ? 2 : 0,
              { ...approved, vote: casper },
              [{ seat: 'fixture-peer', vote: peer, reason: 'Neutral peer verdict.', shadow }],
            );
            const countedReject =
              melchior === 'reject' || balthasar === 'reject' || casper === 'reject' || (!shadow && peer === 'reject');
            const expected = countedReject ? 'reject' : casper === 'abstain' ? 'approval' : 'grant';
            assert.equal(result.outcome, expected);
            assert.equal(result.pattern, 'orange');
            assert.equal(result.verdicts.find((v) => v.seat === 'melchior')!.vote, melchior);
            assert.equal(result.verdicts.find((v) => v.seat === 'balthasar')!.vote, balthasar);
            assert.equal(result.verdicts.find((v) => v.seat === 'extra:fixture-peer')!.shadow, shadow);
          });
        }
for (const effect of effects)
  for (const trust of ['trusted', 'tainted'] as const) {
    test(`golden-v1/effect/${effect}/${trust}`, () => {
      const local = effect === 'read' || effect === 'write-local';
      const blue = effect === 'irreversible' || effect === 'physical' || (!local && trust === 'tainted');
      const result = ballot({ ...action, trust }, { name: action.tool, effect }, defaultPolicy, 0, approved);
      assert.equal(result.pattern, blue ? 'blue' : local ? 'green' : 'orange');
      assert.equal(result.outcome, blue ? 'approval' : 'grant');
      assert.equal(result.executor, local && trust === 'tainted' ? 'eva-03' : 'eva-02');
    });
  }
for (const [id, tool, changes, verdict, expect] of [
  ['unknown-tool', undefined, {}, approved, 'approval'],
  ['owner-only', { name: action.tool, effect: 'read', owner: true }, {}, approved, 'approval'],
  ['missing-casper', { name: action.tool, effect: 'write-external' }, {}, undefined, 'approval'],
  ['low-confidence', { name: action.tool, effect: 'write-external' }, {}, { ...approved, confidence: 0.5 }, 'approval'],
  ['prototype-external', { name: action.tool, effect: 'write-external' }, { stage: 'prototype' }, approved, 'reject'],
  ['prototype-read', { name: action.tool, effect: 'read' }, { stage: 'prototype' }, undefined, 'approval'],
  ['test-stage-read', { name: action.tool, effect: 'read' }, { stage: 'test' }, undefined, 'grant'],
  ['quarantine-denied', { name: action.tool, effect: 'read', eva: 'eva-03' }, {}, undefined, 'reject'],
] as const) {
  test('golden-v1/boundary/' + id, () => {
    const result = ballot({ ...action, ...changes }, tool as Tool | undefined, defaultPolicy, 0, verdict);
    assert.equal(result.outcome, expect);
    if (id === 'quarantine-denied') assert.equal(result.executor, 'eva-03');
  });
}
