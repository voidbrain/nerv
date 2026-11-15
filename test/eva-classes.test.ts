import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EVA_CLASS_SPECS, admitEvaJob } from '../src/eva-classes.ts';

describe('F-049-T02: EVA class definitions and least-class admission', () => {
  it('defines eva-00..03 as data with filesystem, network, credential, and resource fields', () => {
    assert.deepEqual(Object.keys(EVA_CLASS_SPECS).sort(), ['eva-00', 'eva-01', 'eva-02', 'eva-03']);
    assert.equal(EVA_CLASS_SPECS['eva-03'].quarantine, true);
    assert.equal(EVA_CLASS_SPECS['eva-03'].allowsExternalEffects, false);
    assert.equal(EVA_CLASS_SPECS['eva-00'].allowsExternalEffects, false);
    assert.equal(EVA_CLASS_SPECS['eva-01'].allowsExternalEffects, true);
    assert.equal(EVA_CLASS_SPECS['eva-02'].allowsExternalEffects, true);

    for (const spec of Object.values(EVA_CLASS_SPECS)) {
      assert.equal(spec.filesystem.allowNervState, false);
      assert.equal(spec.filesystem.allowHostHome, false);
      assert.equal(spec.filesystem.allowGraderWrite, false);
      assert.equal(spec.network.allowLoopbackAdmin, false);
      assert.equal(spec.network.allowMetadata, false);
      assert.equal(spec.credentials.ambientEnv, false);
      assert.equal(spec.credentials.keychainAccess, false);
      assert.ok(spec.resources.maxCpuSeconds > 0);
      assert.ok(spec.resources.maxMemoryMb > 0);
      assert.ok(spec.resources.maxProcesses > 0);
      assert.ok(spec.resources.maxOutputBytes > 0);
      assert.ok(spec.resources.maxWallMs > 0);
    }
  });

  it('picks the least EVA class a job needs within its grant and pilot stage', () => {
    const now = 1_760_000_000_000;
    const localOnProduction = admitEvaJob({
      grantId: 'grant-1',
      grantExpiresMs: now + 60_000,
      grantTool: 'memory.recall',
      tool: 'memory.recall',
      effect: 'read',
      trust: 'trusted',
      pilotStage: 'production',
      nowMs: now,
    });
    assert.equal(localOnProduction.admitted, true);
    if (localOnProduction.admitted) {
      assert.equal(localOnProduction.evaClass, 'eva-00');
      assert.equal(localOnProduction.ceiling, 'eva-02');
    }

    const externalOnTest = admitEvaJob({
      grantId: 'grant-2',
      grantExpiresMs: now + 60_000,
      grantTool: 'web.post',
      tool: 'web.post',
      effect: 'write-external',
      trust: 'trusted',
      pilotStage: 'test',
      nowMs: now,
    });
    assert.equal(externalOnTest.admitted, true);
    if (externalOnTest.admitted) {
      assert.equal(externalOnTest.evaClass, 'eva-01');
    }

    const taintedLocal = admitEvaJob({
      grantId: 'grant-3',
      grantExpiresMs: now + 60_000,
      grantTool: 'mcp.read',
      tool: 'mcp.read',
      effect: 'read',
      trust: 'tainted',
      pilotStage: 'production',
      hostEnforced: true,
      nowMs: now,
    });
    assert.equal(taintedLocal.admitted, true);
    if (taintedLocal.admitted) {
      assert.equal(taintedLocal.evaClass, 'eva-03');
      assert.equal(taintedLocal.ceiling, 'eva-03');
    }
  });

  it('refuses fail-closed when a job asks above its grant, pilot stage, or lacks host confinement', () => {
    const now = 1_760_000_000_000;
    const prototypeAskingEva02 = admitEvaJob({
      grantId: 'grant-4',
      grantExpiresMs: now + 60_000,
      grantTool: 'memory.recall',
      tool: 'memory.recall',
      effect: 'read',
      trust: 'trusted',
      pilotStage: 'prototype',
      requestedClass: 'eva-02',
      nowMs: now,
    });
    assert.deepEqual(prototypeAskingEva02, {
      admitted: false,
      blocked: 'isolation',
      reason: 'Requested class eva-02 exceeds allowed ceiling eva-00.',
    });

    const taintedAskingEva00 = admitEvaJob({
      grantId: 'grant-5',
      grantExpiresMs: now + 60_000,
      grantTool: 'mcp.read',
      tool: 'mcp.read',
      effect: 'read',
      trust: 'tainted',
      pilotStage: 'production',
      requestedClass: 'eva-00',
      hostEnforced: true,
      nowMs: now,
    });
    assert.equal(taintedAskingEva00.admitted, false);
    if (!taintedAskingEva00.admitted) {
      assert.equal(taintedAskingEva00.blocked, 'isolation');
    }

    const taintedWithoutHostEnforcement = admitEvaJob({
      grantId: 'grant-6',
      grantExpiresMs: now + 60_000,
      grantTool: 'mcp.read',
      tool: 'mcp.read',
      effect: 'read',
      trust: 'tainted',
      pilotStage: 'production',
      hostEnforced: false,
      nowMs: now,
    });
    assert.equal(taintedWithoutHostEnforcement.admitted, false);
    if (!taintedWithoutHostEnforcement.admitted) {
      assert.equal(taintedWithoutHostEnforcement.blocked, 'isolation');
    }

    const expiredGrant = admitEvaJob({
      grantId: 'grant-7',
      grantExpiresMs: now - 1,
      grantTool: 'memory.recall',
      tool: 'memory.recall',
      effect: 'read',
      trust: 'trusted',
      pilotStage: 'production',
      nowMs: now,
    });
    assert.deepEqual(expiredGrant, {
      admitted: false,
      blocked: 'grant',
      reason: 'NERV grant has expired.',
    });
  });
});
