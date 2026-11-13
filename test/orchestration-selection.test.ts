import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ModelError,
  selectExecutionWorker,
  selectInferenceTarget,
  selectOrchestration,
  type EnrolledBaseCandidate,
  type Models,
} from '../src/model.ts';

const baseModels: Models = {
  local: { baseUrl: 'http://127.0.0.1:11434/v1', model: 'gemma4:e2b-it-q4_K_M' },
  cloud: { provider: 'anthropic', model: 'claude-opus-5-5', enabled: true },
  remote: {
    endpoints: {
      mac: { baseId: 'NERV-01', model: 'qwen2.5:14b' },
      mini: { baseId: 'NERV-02', model: 'qwen2.5:7b' },
    },
    allowBases: ['NERV-01', 'NERV-02'],
  },
};

const enrolledBases: EnrolledBaseCandidate[] = [
  { baseId: 'NERV-01', status: 'enrolled', address: '100.64.0.1', online: true, offers: ['code.run'] },
  { baseId: 'NERV-02', status: 'enrolled', address: '100.64.0.2', online: true, offers: ['code.run', 'test.run'] },
  { baseId: 'NERV-03', status: 'enrolled', address: 'fd7a:115c:a1e0::3', online: true, offers: ['gpio.read'] },
];

test('selectOrchestration chooses inference endpoint and execution worker independently', () => {
  // Mini PC worker (NERV-02) running on local controller, using Mac remote inference (NERV-01)
  const miniWorkerMacInference = selectOrchestration(
    { privacy: 'owner-bases', endpoint: 'mac', workerBaseId: 'NERV-02', tool: 'test.run' },
    { selfBaseId: 'NERV-00', models: baseModels, hasCloudKey: true, bases: enrolledBases },
  );
  assert.deepEqual(miniWorkerMacInference, {
    inference: { kind: 'remote', endpoint: 'mac', baseId: 'NERV-01', model: 'qwen2.5:14b' },
    worker: { kind: 'remote', baseId: 'NERV-02', tool: 'test.run' },
  });

  // Pi capability worker (NERV-03) with policy-approved cloud inference
  const piWorkerCloud = selectOrchestration(
    { privacy: 'any', route: 'cloud', workerBaseId: 'NERV-03', tool: 'gpio.read' },
    { selfBaseId: 'NERV-01', models: baseModels, hasCloudKey: true, bases: enrolledBases },
  );
  assert.deepEqual(piWorkerCloud, {
    inference: { kind: 'cloud', model: 'claude-opus-5-5' },
    worker: { kind: 'remote', baseId: 'NERV-03', tool: 'gpio.read' },
  });

  // Local worker (self) with remote inference (NERV-02)
  const localWorkerRemoteInference = selectOrchestration(
    { privacy: 'owner-bases', endpoint: 'mini' },
    { selfBaseId: 'NERV-01', models: baseModels, hasCloudKey: false, bases: enrolledBases },
  );
  assert.deepEqual(localWorkerRemoteInference, {
    inference: { kind: 'remote', endpoint: 'mini', baseId: 'NERV-02', model: 'qwen2.5:7b' },
    worker: { kind: 'local', baseId: 'NERV-01' },
  });
});

test('selectInferenceTarget refuses disallowed or ungranted endpoints with no silent fallback', () => {
  assert.throws(
    () =>
      selectInferenceTarget(
        { privacy: 'local-only', endpoint: 'mac' },
        { models: baseModels, hasCloudKey: true, bases: enrolledBases },
      ),
    ModelError,
  );
  assert.throws(
    () =>
      selectInferenceTarget(
        { privacy: 'owner-bases', route: 'cloud' },
        { models: baseModels, hasCloudKey: true, bases: enrolledBases },
      ),
    ModelError,
  );
  assert.throws(
    () =>
      selectInferenceTarget(
        { privacy: 'owner-bases', route: 'local', endpoint: 'mac' },
        { models: baseModels, hasCloudKey: true, bases: enrolledBases },
      ),
    /either route or remote endpoint/,
  );
  assert.throws(
    () =>
      selectInferenceTarget(
        { privacy: 'owner-bases', endpoint: 'unknown' },
        { models: baseModels, hasCloudKey: true, bases: enrolledBases },
      ),
    /not configured/,
  );
  assert.throws(
    () =>
      selectInferenceTarget(
        { privacy: 'owner-bases', endpoint: 'mac' },
        {
          models: { ...baseModels, remote: { ...baseModels.remote, allowBases: ['NERV-02'] } },
          hasCloudKey: true,
          bases: enrolledBases,
        },
      ),
    /not granted/,
  );
  assert.throws(
    () =>
      selectInferenceTarget(
        { privacy: 'owner-bases', endpoint: 'mac' },
        {
          models: baseModels,
          hasCloudKey: true,
          bases: [{ baseId: 'NERV-01', status: 'revoked', address: '100.64.0.1', online: true }],
        },
      ),
    /not enrolled/,
  );
  assert.throws(
    () =>
      selectInferenceTarget(
        { privacy: 'owner-bases', endpoint: 'mac' },
        {
          models: baseModels,
          hasCloudKey: true,
          bases: [{ baseId: 'NERV-01', status: 'enrolled', address: '192.168.1.5', online: true }],
        },
      ),
    /Tailscale range/,
  );

  // Offline enrolled Tailscale base keeps the remote target without falling back to local or cloud.
  const offlineMac = selectInferenceTarget(
    { privacy: 'owner-bases', endpoint: 'mac' },
    {
      models: baseModels,
      hasCloudKey: true,
      bases: [{ baseId: 'NERV-01', status: 'enrolled', address: '100.64.0.1', online: false }],
    },
  );
  assert.deepEqual(offlineMac, { kind: 'remote', endpoint: 'mac', baseId: 'NERV-01', model: 'qwen2.5:14b' });
});

test('selectExecutionWorker refuses unenrolled workers or missing capabilities with no silent fallback', () => {
  assert.throws(
    () => selectExecutionWorker({ workerBaseId: 'NERV-99' }, { selfBaseId: 'NERV-01', bases: enrolledBases }),
    /not enrolled/,
  );
  assert.throws(
    () =>
      selectExecutionWorker(
        { workerBaseId: 'NERV-02', tool: 'gpio.read' },
        { selfBaseId: 'NERV-01', bases: enrolledBases },
      ),
    /does not offer capability/,
  );
  assert.throws(
    () =>
      selectExecutionWorker(
        { workerBaseId: 'NERV-01', tool: 'gpio.read' },
        { selfBaseId: 'NERV-01', bases: enrolledBases, localTools: ['reminders.list'] },
      ),
    /does not offer capability/,
  );
});
