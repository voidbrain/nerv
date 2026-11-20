import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EVA_CLASS_SPECS, admitEvaJob } from '../src/eva-classes.ts';
import { PilotRegistry, type EvaClass, type Pilot, type Stage } from '../src/pilots.ts';

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

  it('F-049-T08: reads pilot and stage from F-045/F-025 and caps every stage x class without ever raising', () => {
    const now = 1_760_000_000_000;
    const makePilot = (id: string, stage: Stage, evaClass?: EvaClass, retired = false): Pilot => ({
      id,
      name: id,
      role: 'specialist',
      domain: 'test',
      keywords: ['test'],
      model: 'qwen3:8b',
      stage,
      ...(evaClass ? { evaClass } : {}),
      ...(retired ? { retired: true } : {}),
    });

    const roster: Pilot[] = [
      makePilot('proto-overclaimed', 'prototype', 'eva-02'),
      makePilot('test-pilot', 'test'),
      makePilot('prod-pilot', 'production'),
      makePilot('prod-bounded', 'production', 'eva-01'),
      makePilot('test-shadow', 'test', 'eva-00'),
      makePilot('retired-prod', 'production', 'eva-02', true),
    ];
    const registry = new PilotRegistry('BASE-A', () => roster);

    const matrix: {
      pilotId: string;
      requestedClass: EvaClass;
      effect: 'read' | 'write-external' | 'irreversible';
      trust: 'trusted' | 'tainted';
      allowed: boolean;
    }[] = [
      { pilotId: 'proto-overclaimed', requestedClass: 'eva-03', effect: 'read', trust: 'tainted', allowed: true },
      { pilotId: 'proto-overclaimed', requestedClass: 'eva-00', effect: 'read', trust: 'trusted', allowed: true },
      {
        pilotId: 'proto-overclaimed',
        requestedClass: 'eva-01',
        effect: 'write-external',
        trust: 'trusted',
        allowed: false,
      },
      {
        pilotId: 'proto-overclaimed',
        requestedClass: 'eva-02',
        effect: 'irreversible',
        trust: 'trusted',
        allowed: false,
      },
      { pilotId: 'test-pilot', requestedClass: 'eva-03', effect: 'read', trust: 'tainted', allowed: true },
      { pilotId: 'test-pilot', requestedClass: 'eva-00', effect: 'read', trust: 'trusted', allowed: true },
      { pilotId: 'test-pilot', requestedClass: 'eva-01', effect: 'write-external', trust: 'trusted', allowed: true },
      { pilotId: 'test-pilot', requestedClass: 'eva-02', effect: 'irreversible', trust: 'trusted', allowed: false },
      { pilotId: 'prod-pilot', requestedClass: 'eva-03', effect: 'read', trust: 'tainted', allowed: true },
      { pilotId: 'prod-pilot', requestedClass: 'eva-00', effect: 'read', trust: 'trusted', allowed: true },
      { pilotId: 'prod-pilot', requestedClass: 'eva-01', effect: 'write-external', trust: 'trusted', allowed: true },
      { pilotId: 'prod-pilot', requestedClass: 'eva-02', effect: 'irreversible', trust: 'trusted', allowed: true },
    ];

    for (const row of matrix) {
      const decision = admitEvaJob({
        grantId: `grant-${row.pilotId}-${row.requestedClass}`,
        grantExpiresMs: now + 60_000,
        grantTool: 'test.tool',
        tool: 'test.tool',
        effect: row.effect,
        trust: row.trust,
        pilotId: row.pilotId,
        pilotRegistry: registry,
        requestedClass: row.requestedClass,
        hostEnforced: true,
        nowMs: now,
      });
      assert.equal(decision.admitted, row.allowed, `${row.pilotId} x ${row.requestedClass}`);
      if (decision.admitted) {
        assert.equal(decision.evaClass, row.requestedClass);
      } else {
        assert.equal(decision.blocked, 'isolation');
      }
    }

    // Cap only lowers, never raises: production pilot running read stays at eva-00.
    const prodRead = admitEvaJob({
      grantId: 'grant-prod-read',
      grantExpiresMs: now + 60_000,
      grantTool: 'memory.recall',
      tool: 'memory.recall',
      effect: 'read',
      trust: 'trusted',
      pilotId: 'prod-pilot',
      pilots: roster,
      nowMs: now,
    });
    assert.equal(prodRead.admitted, true);
    if (prodRead.admitted) {
      assert.equal(prodRead.evaClass, 'eva-00');
      assert.equal(prodRead.ceiling, 'eva-02');
    }

    // Production pilot with evaClass eva-01 is lowered to eva-01, never raised to eva-02.
    const prodBounded = admitEvaJob({
      grantId: 'grant-prod-bounded',
      grantExpiresMs: now + 60_000,
      grantTool: 'admin.exec',
      tool: 'admin.exec',
      effect: 'irreversible',
      trust: 'trusted',
      pilotId: 'prod-bounded',
      pilots: roster,
      nowMs: now,
    });
    assert.equal(prodBounded.admitted, false);
    if (!prodBounded.admitted) assert.equal(prodBounded.blocked, 'isolation');

    // Test pilot with evaClass eva-00 is lowered to eva-00, never raised to eva-01.
    const testShadow = admitEvaJob({
      grantId: 'grant-test-shadow',
      grantExpiresMs: now + 60_000,
      grantTool: 'web.post',
      tool: 'web.post',
      effect: 'write-external',
      trust: 'trusted',
      pilotId: 'test-shadow',
      pilots: roster,
      nowMs: now,
    });
    assert.equal(testShadow.admitted, false);
    if (!testShadow.admitted) assert.equal(testShadow.blocked, 'isolation');

    // Caller cannot raise a prototype pilot by passing pilotStage: 'production'.
    const spoofedStage = admitEvaJob({
      grantId: 'grant-spoof',
      grantExpiresMs: now + 60_000,
      grantTool: 'admin.exec',
      tool: 'admin.exec',
      effect: 'irreversible',
      trust: 'trusted',
      pilotId: 'proto-overclaimed',
      pilotStage: 'production',
      pilotRegistry: registry,
      nowMs: now,
    });
    assert.equal(spoofedStage.admitted, false);

    // Unknown or retired pilots fail closed.
    const unknownPilot = admitEvaJob({
      grantId: 'grant-unknown',
      grantExpiresMs: now + 60_000,
      grantTool: 'memory.recall',
      tool: 'memory.recall',
      effect: 'read',
      trust: 'trusted',
      pilotId: 'missing-pilot',
      pilotRegistry: registry,
      nowMs: now,
    });
    assert.equal(unknownPilot.admitted, false);

    const retiredPilot = admitEvaJob({
      grantId: 'grant-retired',
      grantExpiresMs: now + 60_000,
      grantTool: 'memory.recall',
      tool: 'memory.recall',
      effect: 'read',
      trust: 'trusted',
      pilotId: 'retired-prod',
      pilotRegistry: registry,
      nowMs: now,
    });
    assert.equal(retiredPilot.admitted, false);
  });
});
