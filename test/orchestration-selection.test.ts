import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  authorizeRemoteInferenceRequest,
  ModelError,
  selectExecutionWorker,
  selectInferenceTarget,
  selectOrchestration,
  validateWorkerInferRequest,
  verifyRemoteInferenceReply,
  WORKER_MAX_INFER_PROMPT_BYTES,
  WORKER_MAX_INFER_REPLY_BYTES,
  WORKER_MAX_INFER_SYSTEM_BYTES,
  type EnrolledBaseCandidate,
  type Models,
} from '../src/model.ts';
import { signRecord, type RegistryBody } from '../src/kaji.ts';
import { Runtime } from '../src/runtime.ts';
import { WorkerLink, type WorkerAdapter } from '../src/worker-link.ts';

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

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function until(check: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 15000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for worker link readiness.');
    await wait(20);
  }
}

function genKeys() {
  const pair = generateKeyPairSync('ed25519');
  return {
    privateKey: pair.privateKey,
    publicKey: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
}

interface MockS2State {
  calls: number;
  lastModel?: string;
  replyModel?: string;
  replyText: string;
}

async function startMockS2(state: MockS2State) {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      state.calls += 1;
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { model?: string };
      state.lastModel = body.model;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          model: state.replyModel ?? body.model,
          choices: [{ message: { content: state.replyText }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 11, completion_tokens: 5 },
        }),
      );
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    close: () =>
      new Promise<void>((done) => {
        server.close(() => done());
        server.closeAllConnections();
      }),
  };
}

test('F-006-T07: 2-node scheduler join runs job on worker X using remote inference on endpoint Y over signed WorkerLink', async () => {
  const root = genKeys();
  const keyA = genKeys();
  const keyB = genKeys();
  const homeA = mkdtempSync(join(tmpdir(), 'nerv-t07-2a-'));
  const homeB = mkdtempSync(join(tmpdir(), 'nerv-t07-2b-'));
  const s2State: MockS2State = { calls: 0, replyText: 'Remote Mac summary ok' };
  const s2 = await startMockS2(s2State);
  const wsServer = createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((done) => wsServer.listen(0, '127.0.0.1', done));
  const wsPort = (wsServer.address() as { port: number }).port;
  const addrA = `100.64.0.1:${wsPort}`;
  const addrB = '100.64.0.2:1';

  let ra: Runtime | undefined;
  let rb: Runtime | undefined;
  let linkA: WorkerLink | undefined;
  let linkB: WorkerLink | undefined;

  try {
    writeFileSync(
      join(homeA, 'config.json'),
      JSON.stringify({
        base: { id: 'NERV-01', name: 'Mac Endpoint' },
        kaji: { root: root.publicKey, offers: ['model.infer'] },
        models: {
          local: { baseUrl: s2.url, model: 'gemma4:e2b-it-q4_K_M' },
          remote: {
            endpoints: { mac: { baseId: 'NERV-01', model: 'qwen2.5:14b' } },
            allowBases: ['NERV-01'],
            serve: { enabled: true, bases: ['NERV-02'], models: ['qwen2.5:14b'] },
          },
        },
      }),
    );
    writeFileSync(
      join(homeB, 'config.json'),
      JSON.stringify({
        base: { id: 'NERV-02', name: 'Mini Worker' },
        kaji: { root: root.publicKey, offers: ['reminders.add'] },
        models: {
          local: { baseUrl: 'http://127.0.0.1:9/v1', model: 'gemma4:e2b-it-q4_K_M' },
          remote: {
            endpoints: { mac: { baseId: 'NERV-01', model: 'qwen2.5:14b' } },
            allowBases: ['NERV-01'],
          },
        },
      }),
    );

    ra = new Runtime(join(homeA, 'nerv.sqlite'), undefined, homeA);
    rb = new Runtime(join(homeB, 'nerv.sqlite'), undefined, homeB);
    await Promise.all([ra.ready(), rb.ready()]);

    let serial = 0;
    const rec = (body: Omit<RegistryBody, 'serial' | 'issued'>) =>
      signRecord(root.privateKey, { ...body, serial: ++serial, issued: new Date().toISOString() } as RegistryBody);
    const records = [
      rec({ kind: 'enrol', baseId: 'NERV-01', name: 'Mac', publicKey: keyA.publicKey, address: addrA }),
      rec({ kind: 'enrol', baseId: 'NERV-02', name: 'Mini', publicKey: keyB.publicKey, address: addrB }),
      rec({ kind: 'main', baseId: 'NERV-01' }),
    ];
    await Promise.all([ra.kaji.add(records), rb.kaji.add(records)]);

    linkA = new WorkerLink({
      id: 'NERV-01',
      key: keyA.privateKey,
      registry: ra.kaji,
      adapter: ra.worker,
      offers: () => ['model.infer'],
      onOffers: (id, tools) => ra!.notePeerOffers(id, tools),
      address: (s) => `ws://127.0.0.1:${s.split(':').pop()}`,
      heartbeatMs: 500,
      requestMs: 5000,
      reconnectMs: 30,
    });
    linkA.attach(wsServer);
    linkA.start();
    ra.useWorkerLink(linkA);

    const workerAdapterB: WorkerAdapter = {
      open: (o, s, k, ok) => rb!.worker.open(o, s, k, ok),
      close: (o, s) => rb!.worker.close(o, s),
      cancel: (o, id, r, k) => rb!.worker.cancel(o, id, r, k),
      run: async (owner, item, context) => {
        // Worker X executes remote inference on Y (NERV-01) during worker.run before completing its own effect.
        const remoteReply = await linkB!.infer('NERV-01', {
          endpoint: 'mac',
          model: 'qwen2.5:14b',
          privacy: 'owner-bases',
          prompt: `Worker contextual prompt: ${item.request}`,
          system: 'Neutral neutral check',
        });
        return rb!.worker.run(owner, { ...item, args: { ...item.args, title: remoteReply.text } }, context);
      },
    };
    linkB = new WorkerLink({
      id: 'NERV-02',
      key: keyB.privateKey,
      registry: rb.kaji,
      adapter: workerAdapterB,
      offers: () => ['reminders.add'],
      onOffers: (id, tools) => rb!.notePeerOffers(id, tools),
      address: (s) => `ws://127.0.0.1:${s.split(':').pop()}`,
      heartbeatMs: 500,
      requestMs: 5000,
      reconnectMs: 30,
    });
    linkB.start();
    rb.useWorkerLink(linkB);

    await until(() => linkA!.connected('NERV-02') && (linkB!.offersOf('NERV-01')?.includes('model.infer') ?? false));

    const joined = await ra.runOrchestratedJob({
      orchestration: {
        privacy: 'owner-bases',
        endpoint: 'mac',
        workerBaseId: 'NERV-02',
        tool: 'reminders.add',
      },
      ask: {
        prompt: 'Plan neutral maintenance reminder',
        system: 'Be concise.',
      },
      item: {
        id: '00000000-0000-4000-8000-000000000701',
        sequence: 1,
        tool: 'reminders.add',
        args: { title: 'Placeholder', due: '2031-01-01T09:00:00Z' },
      },
    });

    assert.equal(joined.selection.inference.kind, 'remote');
    assert.equal(joined.selection.inference.baseId, 'NERV-01');
    assert.equal(joined.selection.inference.model, 'qwen2.5:14b');
    assert.equal(joined.selection.worker.kind, 'remote');
    assert.equal(joined.selection.worker.baseId, 'NERV-02');
    assert.deepEqual(joined.provenance, {
      executionBaseId: 'NERV-02',
      executionKind: 'remote',
      inferenceBaseId: 'NERV-01',
      inferenceKind: 'remote',
      inferenceModel: 'qwen2.5:14b',
      endpoint: 'mac',
      privacy: 'owner-bases',
    });
    assert.equal(joined.inference.text, 'Remote Mac summary ok');
    assert.equal(s2State.calls, 2);
    assert.equal(s2State.lastModel, 'qwen2.5:14b');
    const execResult = joined.execution as { outcome?: string; result?: { title?: string } };
    assert.equal(execResult.outcome, 'grant');
    assert.equal(execResult.result?.title, 'Remote Mac summary ok');
  } finally {
    await linkB?.stop();
    await linkA?.stop();
    await new Promise<void>((done) => {
      wsServer.close(() => done());
      wsServer.closeAllConnections();
    });
    await s2.close();
    await Promise.allSettled([rb?.close(), ra?.close()]);
    rmSync(homeA, { recursive: true, force: true });
    rmSync(homeB, { recursive: true, force: true });
  }
});

test('F-006-T07: 3-node scheduler join (coordinator NERV-01, worker X NERV-02, endpoint Y NERV-03) + strict zero-fallback refusals', async () => {
  const root = genKeys();
  const keyA = genKeys();
  const keyB = genKeys();
  const keyC = genKeys();
  const homeA = mkdtempSync(join(tmpdir(), 'nerv-t07-3a-'));
  const homeB = mkdtempSync(join(tmpdir(), 'nerv-t07-3b-'));
  const homeC = mkdtempSync(join(tmpdir(), 'nerv-t07-3c-'));
  const s2State: MockS2State = { calls: 0, replyText: 'Verified Pi/Mac Y inference' };
  const s2 = await startMockS2(s2State);
  const wsServer = createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((done) => wsServer.listen(0, '127.0.0.1', done));
  const wsPort = (wsServer.address() as { port: number }).port;
  const addrA = `100.64.0.1:${wsPort}`;
  const addrB = '100.64.0.2:1';
  const addrC = 'fd7a:115c:a1e0::3';

  let ra: Runtime | undefined;
  let rb: Runtime | undefined;
  let rc: Runtime | undefined;
  let linkA: WorkerLink | undefined;
  let linkB: WorkerLink | undefined;
  let linkC: WorkerLink | undefined;

  let offersC: string[] = ['model.infer'];
  const configC = (serveBases: string[], serveModels: string[]) => ({
    base: { id: 'NERV-03', name: 'Inference Host Y' },
    kaji: { root: root.publicKey, offers: offersC },
    models: {
      local: { baseUrl: s2.url, model: 'gemma4:e2b-it-q4_K_M' },
      remote: {
        serve: { enabled: true, bases: serveBases, models: serveModels },
      },
    },
  });

  try {
    writeFileSync(
      join(homeA, 'config.json'),
      JSON.stringify({
        base: { id: 'NERV-01', name: 'Coordinator' },
        kaji: { root: root.publicKey, offers: [] },
        models: {
          local: { baseUrl: 'http://127.0.0.1:9/v1', model: 'gemma4:e2b-it-q4_K_M' },
          remote: {
            endpoints: { inferenceY: { baseId: 'NERV-03', model: 'qwen2.5:14b' } },
            allowBases: ['NERV-03'],
          },
        },
      }),
    );
    writeFileSync(
      join(homeB, 'config.json'),
      JSON.stringify({
        base: { id: 'NERV-02', name: 'Worker X' },
        kaji: { root: root.publicKey, offers: ['reminders.add'] },
        models: {
          local: { baseUrl: 'http://127.0.0.1:9/v1', model: 'gemma4:e2b-it-q4_K_M' },
          remote: {
            endpoints: { inferenceY: { baseId: 'NERV-03', model: 'qwen2.5:14b' } },
            allowBases: ['NERV-03'],
          },
        },
      }),
    );
    writeFileSync(join(homeC, 'config.json'), JSON.stringify(configC(['NERV-01', 'NERV-02'], ['qwen2.5:14b'])));

    ra = new Runtime(join(homeA, 'nerv.sqlite'), undefined, homeA);
    rb = new Runtime(join(homeB, 'nerv.sqlite'), undefined, homeB);
    rc = new Runtime(join(homeC, 'nerv.sqlite'), undefined, homeC);
    await Promise.all([ra.ready(), rb.ready(), rc.ready()]);

    let serial = 0;
    const rec = (body: Omit<RegistryBody, 'serial' | 'issued'>) =>
      signRecord(root.privateKey, { ...body, serial: ++serial, issued: new Date().toISOString() } as RegistryBody);
    const records = [
      rec({ kind: 'enrol', baseId: 'NERV-01', name: 'Coord', publicKey: keyA.publicKey, address: addrA }),
      rec({ kind: 'enrol', baseId: 'NERV-02', name: 'WorkerX', publicKey: keyB.publicKey, address: addrB }),
      rec({ kind: 'enrol', baseId: 'NERV-03', name: 'InferY', publicKey: keyC.publicKey, address: addrC }),
      rec({ kind: 'main', baseId: 'NERV-01' }),
    ];
    await Promise.all([ra.kaji.add(records), rb.kaji.add(records), rc.kaji.add(records)]);

    linkA = new WorkerLink({
      id: 'NERV-01',
      key: keyA.privateKey,
      registry: ra.kaji,
      adapter: ra.worker,
      offers: () => [],
      onOffers: (id, tools) => ra!.notePeerOffers(id, tools),
      address: (s) => `ws://127.0.0.1:${s.split(':').pop()}`,
      heartbeatMs: 500,
      requestMs: 5000,
      reconnectMs: 30,
    });
    linkA.attach(wsServer);
    linkA.start();
    ra.useWorkerLink(linkA);

    linkB = new WorkerLink({
      id: 'NERV-02',
      key: keyB.privateKey,
      registry: rb.kaji,
      adapter: rb.worker,
      offers: () => ['reminders.add'],
      address: (s) => `ws://127.0.0.1:${s.split(':').pop()}`,
      heartbeatMs: 500,
      requestMs: 5000,
      reconnectMs: 30,
    });
    linkB.start();
    rb.useWorkerLink(linkB);

    linkC = new WorkerLink({
      id: 'NERV-03',
      key: keyC.privateKey,
      registry: rc.kaji,
      adapter: rc.worker,
      offers: () => offersC,
      address: (s) => `ws://127.0.0.1:${s.split(':').pop()}`,
      heartbeatMs: 500,
      requestMs: 5000,
      reconnectMs: 30,
    });
    linkC.start();
    rc.useWorkerLink(linkC);

    await until(() => linkA!.connected('NERV-02') && linkA!.connected('NERV-03'));

    // 1. Coordinator joins selection -> NERV-03 remote inference -> NERV-02 remote worker execution
    const joined = await ra.runOrchestratedJob({
      orchestration: {
        privacy: 'owner-bases',
        endpoint: 'inferenceY',
        workerBaseId: 'NERV-02',
        tool: 'reminders.add',
      },
      ask: { prompt: 'Joined 3-node ask' },
      item: {
        id: '00000000-0000-4000-8000-000000000702',
        sequence: 1,
        tool: 'reminders.add',
        args: { title: 'Joined', due: '2031-01-01T10:00:00Z' },
      },
    });
    assert.deepEqual(joined.provenance, {
      executionBaseId: 'NERV-02',
      executionKind: 'remote',
      inferenceBaseId: 'NERV-03',
      inferenceKind: 'remote',
      inferenceModel: 'qwen2.5:14b',
      endpoint: 'inferenceY',
      privacy: 'owner-bases',
    });
    assert.equal(joined.inference.text, 'Verified Pi/Mac Y inference');

    // 2. Worker X forwards worker.infer through coordinator NERV-01 to endpoint Y NERV-03
    const forwarded = await linkB.infer('NERV-03', {
      endpoint: 'inferenceY',
      model: 'qwen2.5:14b',
      privacy: 'owner-bases',
      prompt: 'Worker X asks endpoint Y directly through coordinator',
    });
    assert.equal(forwarded.model, 'qwen2.5:14b');
    assert.equal(forwarded.text, 'Verified Pi/Mac Y inference');

    // 3. Exact frame-bound acceptance: 32768-byte prompt + 8192-byte system + 16384-byte reply succeeds
    s2State.replyText = 'r'.repeat(WORKER_MAX_INFER_REPLY_BYTES);
    const maxBoundReply = await linkB.infer('NERV-03', {
      endpoint: 'inferenceY',
      model: 'qwen2.5:14b',
      privacy: 'owner-bases',
      prompt: 'p'.repeat(WORKER_MAX_INFER_PROMPT_BYTES),
      system: 's'.repeat(WORKER_MAX_INFER_SYSTEM_BYTES),
    });
    assert.equal(Buffer.byteLength(maxBoundReply.text, 'utf8'), WORKER_MAX_INFER_REPLY_BYTES);

    // 4. Oversize S² reply (> 16384 bytes) fails closed with ModelError (boundText marks truncated: true)
    const callsBeforeOversizeReply = s2State.calls;
    s2State.replyText = 'r'.repeat(WORKER_MAX_INFER_REPLY_BYTES + 1);
    await assert.rejects(
      linkB.infer('NERV-03', {
        model: 'qwen2.5:14b',
        privacy: 'owner-bases',
        prompt: 'Small prompt expecting oversize reply failure',
      }),
      ModelError,
    );
    assert.equal(s2State.calls, callsBeforeOversizeReply + 1);
    s2State.replyText = 'ok';

    // 5. Model mismatch from loopback S² fails closed with ModelError
    s2State.replyModel = 'qwen2.5:7b';
    await assert.rejects(
      ra.inferRemote('NERV-03', {
        endpoint: 'inferenceY',
        model: 'qwen2.5:14b',
        privacy: 'owner-bases',
        prompt: 'Check exact model match',
      }),
      /mismatch/i,
    );
    s2State.replyModel = undefined;

    // 6. Unauthorized caller base in serve.bases refuses without hitting loopback S²
    const callsBeforePolicy = s2State.calls;
    writeFileSync(join(homeC, 'config.json'), JSON.stringify(configC(['NERV-01'], ['qwen2.5:14b'])));
    await assert.rejects(
      linkB.infer('NERV-03', {
        model: 'qwen2.5:14b',
        privacy: 'owner-bases',
        prompt: 'Caller NERV-02 removed from serve.bases',
      }),
      /not allowed/i,
    );
    assert.equal(s2State.calls, callsBeforePolicy);

    // 7. Unoffered model in serve.models refuses without hitting loopback S²
    writeFileSync(join(homeC, 'config.json'), JSON.stringify(configC(['NERV-01', 'NERV-02'], ['qwen2.5:7b'])));
    await assert.rejects(
      ra.inferRemote('NERV-03', {
        model: 'qwen2.5:14b',
        privacy: 'owner-bases',
        prompt: 'Model not offered in serve.models',
      }),
      /not offered/i,
    );
    assert.equal(s2State.calls, callsBeforePolicy);

    // 8. Missing 'model.infer' offer refuses on direct call and on serving host without hitting loopback S²
    offersC = ['code.run'];
    writeFileSync(join(homeC, 'config.json'), JSON.stringify(configC(['NERV-01', 'NERV-02'], ['qwen2.5:14b'])));
    await assert.rejects(
      rc.serveRemoteInference('NERV-01', {
        callerBaseId: 'NERV-01',
        targetBaseId: 'NERV-03',
        model: 'qwen2.5:14b',
        privacy: 'owner-bases',
        prompt: 'Missing model.infer offer on serving node',
      }),
      /model\.infer/i,
    );
    await linkA.observe('NERV-03', ['code.run']);
    await assert.rejects(
      ra.inferRemote('NERV-03', {
        model: 'qwen2.5:14b',
        privacy: 'owner-bases',
        prompt: 'Missing model.infer offer on WorkerLink',
      }),
      /model\.infer/i,
    );
    // Re-adding offer via Peer.handle / WorkerLink without config support still fails without loopback S² call
    offersC = ['model.infer'];
    writeFileSync(join(homeC, 'config.json'), JSON.stringify(configC(['NERV-01', 'NERV-02'], ['qwen2.5:14b'])));
    await linkA.observe('NERV-03', ['model.infer']);

    // 9. Non-Tailscale address fails closed at WorkerLink.infer without opening remote inference
    const nonTailscale = rec({
      kind: 'enrol',
      baseId: 'NERV-04',
      name: 'LanPeer',
      publicKey: genKeys().publicKey,
      address: '192.168.1.50:4444',
    });
    await ra.kaji.add([nonTailscale]);
    await assert.rejects(
      ra.inferRemote('NERV-04', {
        model: 'qwen2.5:14b',
        privacy: 'owner-bases',
        prompt: 'Must refuse non-Tailscale LAN address',
      }),
      /Tailscale/i,
    );
    assert.equal(s2State.calls, callsBeforePolicy);
  } finally {
    await Promise.allSettled([linkB?.stop(), linkC?.stop(), linkA?.stop()]);
    await new Promise<void>((done) => {
      wsServer.close(() => done());
      wsServer.closeAllConnections();
    });
    await s2.close();
    await Promise.allSettled([rb?.close(), rc?.close(), ra?.close()]);
    rmSync(homeA, { recursive: true, force: true });
    rmSync(homeB, { recursive: true, force: true });
    rmSync(homeC, { recursive: true, force: true });
  }
});

test('validateWorkerInferRequest and verifyRemoteInferenceReply enforce size bounds and privacy strictly', () => {
  assert.throws(
    () =>
      validateWorkerInferRequest({
        callerBaseId: 'NERV-02',
        targetBaseId: 'NERV-01',
        model: 'qwen2.5:14b',
        privacy: 'local-only',
        prompt: 'Must stay on local host',
      }),
    ModelError,
  );
  assert.throws(
    () =>
      validateWorkerInferRequest({
        callerBaseId: 'NERV-02',
        targetBaseId: 'NERV-01',
        model: 'qwen2.5:14b',
        privacy: 'owner-bases',
        prompt: 'p'.repeat(WORKER_MAX_INFER_PROMPT_BYTES + 1),
      }),
    ModelError,
  );
  assert.throws(
    () =>
      validateWorkerInferRequest({
        callerBaseId: 'NERV-02',
        targetBaseId: 'NERV-01',
        model: 'qwen2.5:14b',
        privacy: 'owner-bases',
        prompt: 'Valid prompt',
        system: 's'.repeat(WORKER_MAX_INFER_SYSTEM_BYTES + 1),
      }),
    ModelError,
  );
  assert.throws(
    () =>
      verifyRemoteInferenceReply('qwen2.5:14b', {
        model: 'qwen2.5:14b',
        text: 'r'.repeat(WORKER_MAX_INFER_REPLY_BYTES + 1),
        stop: 'stop',
        truncated: false,
        usage: { inputTokens: 1, outputTokens: 1 },
        durationMs: 1,
      }),
    ModelError,
  );
  assert.throws(
    () =>
      authorizeRemoteInferenceRequest(
        {
          callerBaseId: 'NERV-02',
          targetBaseId: 'NERV-01',
          model: 'qwen2.5:14b',
          privacy: 'owner-bases',
          prompt: 'Check non-Tailscale rejection',
        },
        {
          selfBaseId: 'NERV-01',
          remote: { serve: { enabled: true, bases: ['NERV-02'], models: ['qwen2.5:14b'] } },
          offers: ['model.infer'],
          bases: [
            { baseId: 'NERV-01', status: 'enrolled', address: '100.64.0.1:4444', online: true },
            { baseId: 'NERV-02', status: 'enrolled', address: '192.168.1.50:4444', online: true },
          ],
        },
      ),
    ModelError,
  );
});
