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
import { toolDocs } from '../src/executors.ts';
import { signRecord, type RegistryBody } from '../src/kaji.ts';
import { misatoAsk } from '../src/misato.ts';
import { Runtime } from '../src/runtime.ts';
import { makeServer } from '../src/server.ts';
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
  lastSystem?: string;
  replyModel?: string;
  replyText: string;
  /** Input tokens the fake model reports for the UTF-8 bytes of its messages; 11 when unset. */
  promptTokens?: (bytes: number) => number;
}

async function startMockS2(state: MockS2State) {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      state.calls += 1;
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        model?: string;
        messages?: { role: string; content: string }[];
      };
      state.lastModel = body.model;
      state.lastSystem = body.messages?.find((m) => m.role === 'system')?.content;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          model: state.replyModel ?? body.model,
          choices: [{ message: { content: state.replyText }, finish_reason: 'stop' }],
          usage: {
            prompt_tokens:
              state.promptTokens?.(
                (body.messages ?? []).reduce((n, m) => n + Buffer.byteLength(m.content, 'utf8'), 0),
              ) ?? 11,
            completion_tokens: 5,
          },
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
      heartbeatMs: 5000,
      requestMs: 15000,
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
      heartbeatMs: 5000,
      requestMs: 15000,
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

    // F-006-T27: a P3 placement probe with Misato's own system message (about 17,600 characters) crosses the
    // whole join: NERV-02's HTTP route -> probe -> NERV-02 runtime -> WorkerLink -> NERV-01 receiver -> its model.
    const ask = misatoAsk(
      {
        request: 'Remind me to water the plants tomorrow at 9.',
        history: [],
        tools: toolDocs,
        now: '2031-01-01T10:00:00Z',
        timeZone: 'Europe/Rome',
      },
      'local',
    );
    assert.ok(ask.system && Buffer.byteLength(ask.system) > 16_000);
    const tokenB = 'y'.repeat(32);
    const httpB = makeServer(rb, tokenB);
    await new Promise<void>((done) => httpB.listen(0, '127.0.0.1', done));
    try {
      const res = await fetch(`http://127.0.0.1:${(httpB.address() as { port: number }).port}/api/placement/run`, {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenB}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          placement: 'P3',
          endpoint: 'mac',
          system: ask.system,
          prompt: ask.prompt,
          timeoutMs: 20_000,
          confirmExecute: true,
        }),
      });
      const value = (await res.json()) as { inference?: { text: string }; provenance?: object; error?: string };
      assert.equal(res.status, 200, value.error);
      assert.equal(value.inference?.text, 'Remote Mac summary ok');
      assert.deepEqual(value.provenance, {
        executionBaseId: 'NERV-02',
        executionKind: 'local',
        inferenceBaseId: 'NERV-01',
        inferenceKind: 'remote',
        inferenceModel: 'qwen2.5:14b',
        endpoint: 'mac',
        privacy: 'owner-bases',
      });
      assert.equal(s2State.lastSystem, ask.system);

      // B-131: the fake model now counts input tokens like a real tokenizer (about 4 bytes a token, plus a chat
      // template), so Misato's ask costs about 4,500 input tokens, more than twice the probe's 2,048 output tokens.
      // NERV-02 applies the total budget after NERV-01 replied; the probe's budget must cover its own input.
      s2State.promptTokens = (bytes) => Math.ceil(bytes / 4) + 32;
      s2State.replyText = 'Misato-sized probe ok';
      const callsBefore = s2State.calls;
      const probe = (maxOutputTokens: number) =>
        fetch(`http://127.0.0.1:${(httpB.address() as { port: number }).port}/api/placement/run`, {
          method: 'POST',
          headers: { authorization: `Bearer ${tokenB}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            placement: 'P3',
            endpoint: 'mac',
            system: ask.system,
            prompt: ask.prompt,
            timeoutMs: 20_000,
            maxOutputTokens,
            confirmExecute: true,
          }),
        });
      const sized = await probe(2048);
      const sizedValue = (await sized.json()) as { inference?: { text: string; usage: object }; error?: string };
      assert.equal(sized.status, 200, sizedValue.error);
      assert.equal(sizedValue.inference?.text, 'Misato-sized probe ok');
      assert.ok(
        (sizedValue.inference?.usage as { inputTokens: number }).inputTokens > 2 * 2048,
        'the fixture input exceeds 2 x maxOutputTokens',
      );
      assert.equal(s2State.calls, callsBefore + 1);
      // The total budget still bounds the run: a model reporting more input tokens than the probe's bytes can
      // encode is refused on NERV-02.
      s2State.promptTokens = (bytes) => 2 * bytes;
      const over = await probe(2048);
      const overValue = (await over.json()) as { error?: string };
      assert.notEqual(over.status, 200);
      assert.match(overValue.error ?? '', /Orchestrated token budget exhausted/);
      s2State.promptTokens = undefined;
    } finally {
      httpB.closeAllConnections();
      await new Promise<void>((done) => httpB.close(() => done()));
    }
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
      heartbeatMs: 5000,
      requestMs: 15000,
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
      heartbeatMs: 5000,
      requestMs: 15000,
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
      heartbeatMs: 5000,
      requestMs: 15000,
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

    // 3b. F-006-T27 review: within the raw byte limits, an escape-heavy prompt and system (one quote in 20 characters)
    // encode past the 64 KiB frame. That one request is refused; the session stays up and the next request works.
    s2State.replyText = 'ok';
    const quoted = (bytes: number) => ('"' + 'q'.repeat(19)).repeat(bytes / 20) + 'q'.repeat(bytes % 20);
    const callsBeforeEscaped = s2State.calls;
    await assert.rejects(
      linkB.infer('NERV-03', {
        endpoint: 'inferenceY',
        model: 'qwen2.5:14b',
        privacy: 'owner-bases',
        prompt: quoted(WORKER_MAX_INFER_PROMPT_BYTES),
        system: quoted(WORKER_MAX_INFER_SYSTEM_BYTES),
      }),
      /exceeds its bound/,
    );
    assert.equal(s2State.calls, callsBeforeEscaped);
    assert.ok(linkA.connected('NERV-02') && linkA.connected('NERV-03'));
    const afterEscaped = await linkB.infer('NERV-03', {
      endpoint: 'inferenceY',
      model: 'qwen2.5:14b',
      privacy: 'owner-bases',
      prompt: 'Same session after a refused oversize frame',
    });
    assert.equal(afterEscaped.text, 'ok');

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

test('F-006-T08: policy-approved cloud path, Pi capability route, and delegation/budget guardrails', () => {
  const piAndMiniBases: EnrolledBaseCandidate[] = [
    ...enrolledBases,
    {
      baseId: 'NERV-PI',
      status: 'enrolled',
      address: '100.64.0.4',
      online: true,
      offers: ['sensor.read', 'voice.speak', 'peripheral.display'],
    },
  ];

  // Policy-approved cloud inference (Claude) paired with mini PC worker (NERV-02)
  const cloudApproved = selectOrchestration(
    {
      privacy: 'any',
      route: 'cloud',
      trust: 'trusted',
      effect: 'write',
      workerBaseId: 'NERV-02',
      tool: 'code.run',
      maxOutputTokens: 1024,
      maxTotalTokens: 4096,
      maxAttempts: 2,
      waitBudgetMs: 5000,
    },
    {
      selfBaseId: 'NERV-01',
      models: baseModels,
      hasCloudKey: true,
      bases: piAndMiniBases,
      policy: { localOnly: ['secrets.read'], deny: ['shell.raw'] },
    },
  );
  assert.deepEqual(cloudApproved, {
    inference: { kind: 'cloud', model: 'claude-opus-5-5' },
    worker: { kind: 'remote', baseId: 'NERV-02', tool: 'code.run' },
  });

  // Tainted input refuses cloud route and remote endpoint without fallback
  assert.throws(
    () =>
      selectOrchestration(
        { privacy: 'any', route: 'cloud', trust: 'tainted', workerBaseId: 'NERV-02', tool: 'code.run' },
        { selfBaseId: 'NERV-01', models: baseModels, hasCloudKey: true, bases: piAndMiniBases },
      ),
    /Tainted input never goes to the cloud route/,
  );
  assert.throws(
    () =>
      selectOrchestration(
        { privacy: 'owner-bases', endpoint: 'mac', trust: 'tainted', workerBaseId: 'NERV-02', tool: 'code.run' },
        { selfBaseId: 'NERV-01', models: baseModels, hasCloudKey: true, bases: piAndMiniBases },
      ),
    /Tainted input never leaves this machine/,
  );

  // Policy localOnly and deny rules refuse cloud or denied tools without fallback
  assert.throws(
    () =>
      selectOrchestration(
        { privacy: 'any', route: 'cloud', trust: 'trusted', tool: 'code.run', effect: 'write' },
        {
          selfBaseId: 'NERV-01',
          models: baseModels,
          hasCloudKey: true,
          bases: piAndMiniBases,
          policy: { localOnly: ['code.run'] },
        },
      ),
    /Policy localOnly forbids leaving the machine/,
  );
  assert.throws(
    () =>
      selectOrchestration(
        { privacy: 'local-only', route: 'local', tool: 'shell.raw' },
        {
          selfBaseId: 'NERV-01',
          models: baseModels,
          hasCloudKey: true,
          bases: piAndMiniBases,
          policy: { deny: ['shell.raw'] },
        },
      ),
    /Policy denies tool "shell\.raw"/,
  );

  // Pi capability route executes only offered peripheral/voice/sensor capabilities
  const piSensor = selectOrchestration(
    {
      privacy: 'owner-bases',
      endpoint: 'mac',
      workerBaseId: 'NERV-PI',
      tool: 'sensor.read',
    },
    { selfBaseId: 'NERV-02', models: baseModels, hasCloudKey: false, bases: piAndMiniBases },
  );
  assert.deepEqual(piSensor, {
    inference: { kind: 'remote', endpoint: 'mac', baseId: 'NERV-01', model: 'qwen2.5:14b' },
    worker: { kind: 'remote', baseId: 'NERV-PI', tool: 'sensor.read' },
  });

  // Pi refuses unoffered coder/reminder capabilities without falling back to NERV-02 or local
  assert.throws(
    () =>
      selectOrchestration(
        { privacy: 'owner-bases', endpoint: 'mac', workerBaseId: 'NERV-PI', tool: 'code.run' },
        { selfBaseId: 'NERV-02', models: baseModels, hasCloudKey: false, bases: piAndMiniBases },
      ),
    /Execution worker NERV-PI does not offer capability "code\.run"/,
  );
  assert.throws(
    () =>
      selectOrchestration(
        { privacy: 'local-only', route: 'local', tool: 'sensor.read' },
        {
          selfBaseId: 'NERV-02',
          models: baseModels,
          hasCloudKey: false,
          bases: piAndMiniBases,
          localTools: ['code.run'],
        },
      ),
    /Local base NERV-02 does not offer capability "sensor\.read"/,
  );

  // Non-recursive delegation and budget bounds
  assert.throws(
    () =>
      selectExecutionWorker(
        { workerBaseId: 'NERV-02', tool: 'kaji.run' },
        { selfBaseId: 'NERV-01', bases: piAndMiniBases },
      ),
    /Recursive kaji\.run delegation is not allowed/,
  );
  assert.throws(
    () =>
      selectExecutionWorker(
        { workerBaseId: 'NERV-02', tool: 'code.run', delegationDepth: 2, maxDelegations: 1 },
        { selfBaseId: 'NERV-01', bases: piAndMiniBases },
      ),
    /delegation depth 2 exceeds limit 1/,
  );
  assert.throws(
    () =>
      selectInferenceTarget(
        { privacy: 'owner-bases', endpoint: 'mac', maxOutputTokens: 2048, maxTotalTokens: 1024 },
        { models: baseModels, hasCloudKey: false, bases: piAndMiniBases },
      ),
    /maxOutputTokens cannot exceed maxTotalTokens/,
  );
});

test('F-006-T08: unavailable Mac endpoint waits or expires within budget, retries same endpoint, and enforces token/concurrency limits', async () => {
  const root = genKeys();
  const keyMac = genKeys();
  const keyMini = genKeys();
  const keyPi = genKeys();
  const homeMac = mkdtempSync(join(tmpdir(), 'nerv-t08-mac-'));
  const homeMini = mkdtempSync(join(tmpdir(), 'nerv-t08-mini-'));
  const homePi = mkdtempSync(join(tmpdir(), 'nerv-t08-pi-'));

  let failNextS2 = false;
  const s2State: MockS2State = { calls: 0, replyText: 'Mac inference ready' };
  const s2Server = createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404);
      res.end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      s2State.calls += 1;
      if (failNextS2) {
        failNextS2 = false;
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Temporary S2 overload' } }));
        return;
      }
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { model?: string };
      s2State.lastModel = parsed.model;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          model: parsed.model ?? 'qwen2.5:14b',
          choices: [{ message: { content: s2State.replyText }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 18, completion_tokens: 12 },
        }),
      );
    });
  });
  await new Promise<void>((done) => s2Server.listen(0, '127.0.0.1', done));
  const s2Port = (s2Server.address() as { port: number }).port;
  const s2Url = `http://127.0.0.1:${s2Port}/v1`;

  const wsServer = createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((done) => wsServer.listen(0, '127.0.0.1', done));
  const wsPort = (wsServer.address() as { port: number }).port;
  const addrMini = `100.64.0.2:${wsPort}`;
  const addrMac = '100.64.0.1:1';
  const addrPi = '100.64.0.4:1';

  let rMac: Runtime | undefined;
  let rMini: Runtime | undefined;
  let rPi: Runtime | undefined;
  let linkMac: WorkerLink | undefined;
  let linkMini: WorkerLink | undefined;
  let linkPi: WorkerLink | undefined;

  try {
    writeFileSync(
      join(homeMac, 'config.json'),
      JSON.stringify({
        base: { id: 'NERV-01', name: 'Mac Inference Host' },
        kaji: { root: root.publicKey, offers: ['model.infer'] },
        models: {
          local: { baseUrl: s2Url, model: 'qwen2.5:14b' },
          remote: {
            serve: { enabled: true, bases: ['NERV-02', 'NERV-PI'], models: ['qwen2.5:14b'] },
          },
        },
      }),
    );
    writeFileSync(
      join(homeMini, 'config.json'),
      JSON.stringify({
        base: { id: 'NERV-02', name: 'Mini PC Worker' },
        kaji: { root: root.publicKey, offers: ['reminders.add'] },
        models: {
          local: { baseUrl: 'http://127.0.0.1:9/v1', model: 'gemma4:e2b-it-q4_K_M' },
          cloud: { provider: 'anthropic', model: 'claude-opus-5-5', enabled: true },
          remote: {
            endpoints: { mac: { baseId: 'NERV-01', model: 'qwen2.5:14b' } },
            allowBases: ['NERV-01'],
          },
          concurrency: { default: 1, perModel: { 'qwen2.5:14b': 1 } },
        },
      }),
    );
    writeFileSync(join(homeMini, 'anthropic-key'), 'sk-ant-test-neutral-key-value\n', { mode: 0o600 });
    writeFileSync(
      join(homePi, 'config.json'),
      JSON.stringify({
        base: { id: 'NERV-PI', name: 'Pi Capability Worker' },
        kaji: { root: root.publicKey, offers: ['reminders.add'] },
        models: {
          local: { baseUrl: 'http://127.0.0.1:9/v1', model: 'gemma4:e2b-it-q4_K_M' },
        },
      }),
    );

    rMac = new Runtime(join(homeMac, 'nerv.sqlite'), undefined, homeMac);
    rMini = new Runtime(join(homeMini, 'nerv.sqlite'), undefined, homeMini);
    rPi = new Runtime(join(homePi, 'nerv.sqlite'), undefined, homePi);
    await Promise.all([rMac.ready(), rMini.ready(), rPi.ready()]);

    let serial = 0;
    const rec = (body: Omit<RegistryBody, 'serial' | 'issued'>) =>
      signRecord(root.privateKey, { ...body, serial: ++serial, issued: new Date().toISOString() } as RegistryBody);
    const records = [
      rec({ kind: 'enrol', baseId: 'NERV-02', name: 'Mini', publicKey: keyMini.publicKey, address: addrMini }),
      rec({ kind: 'enrol', baseId: 'NERV-01', name: 'Mac', publicKey: keyMac.publicKey, address: addrMac }),
      rec({ kind: 'enrol', baseId: 'NERV-PI', name: 'Pi', publicKey: keyPi.publicKey, address: addrPi }),
      rec({ kind: 'main', baseId: 'NERV-02' }),
    ];
    await Promise.all([rMac.kaji.add(records), rMini.kaji.add(records), rPi.kaji.add(records)]);

    linkMini = new WorkerLink({
      id: 'NERV-02',
      key: keyMini.privateKey,
      registry: rMini.kaji,
      adapter: rMini.worker,
      offers: () => ['reminders.add'],
      onOffers: (id, tools) => rMini!.notePeerOffers(id, tools),
      address: (s) => `ws://127.0.0.1:${s.split(':').pop()}`,
      heartbeatMs: 5000,
      requestMs: 15000,
      reconnectMs: 25,
    });
    linkMini.attach(wsServer);
    linkMini.start();
    rMini.useWorkerLink(linkMini);

    const piAdapter: WorkerAdapter = {
      ...rPi.worker,
      run: async (owner, item, context) => {
        if (item.tool === 'sensor.read') {
          return { outcome: 'grant', actionId: 'act-pi-sensor', result: { celsius: 21.5, promptEcho: item.request } };
        }
        return rPi!.worker.run(owner, item, context);
      },
    };
    linkPi = new WorkerLink({
      id: 'NERV-PI',
      key: keyPi.privateKey,
      registry: rPi.kaji,
      adapter: piAdapter,
      offers: () => ['sensor.read', 'voice.speak'],
      address: (s) => `ws://127.0.0.1:${s.split(':').pop()}`,
      heartbeatMs: 5000,
      requestMs: 15000,
      reconnectMs: 25,
    });
    linkPi.start();
    rPi.useWorkerLink(linkPi);

    await until(() => linkMini!.connected('NERV-PI'));

    // 1. Mac is offline: waiting within short budget (80 ms) expires with explicit endpoint unavailable and zero fallback
    await assert.rejects(
      () =>
        rMini!.runOrchestratedJob({
          orchestration: {
            privacy: 'owner-bases',
            endpoint: 'mac',
            workerBaseId: 'NERV-02',
            tool: 'reminders.add',
            waitBudgetMs: 80,
          },
          ask: { prompt: 'Should expire while Mac is offline' },
        }),
      /expired after waiting 80 ms: endpoint unavailable/,
    );
    assert.equal(s2State.calls, 0);
    const degradedWhileOffline = await rMini.health();
    assert.ok(
      degradedWhileOffline.degraded.some((d) => d.includes('NERV-01') && d.includes('unavailable')),
      `Expected degraded reason mentioning NERV-01 unavailable, got: ${JSON.stringify(degradedWhileOffline.degraded)}`,
    );

    // 2. Mac comes online within waitBudgetMs: request waits and succeeds
    linkMac = new WorkerLink({
      id: 'NERV-01',
      key: keyMac.privateKey,
      registry: rMac.kaji,
      adapter: rMac.worker,
      offers: () => ['model.infer'],
      address: (s) => `ws://127.0.0.1:${s.split(':').pop()}`,
      heartbeatMs: 5000,
      requestMs: 15000,
      reconnectMs: 25,
    });
    setTimeout(() => {
      linkMac?.start();
      rMac?.useWorkerLink(linkMac!);
    }, 40);

    const waitedJob = await rMini.runOrchestratedJob({
      orchestration: {
        privacy: 'owner-bases',
        endpoint: 'mac',
        workerBaseId: 'NERV-02',
        tool: 'reminders.add',
        waitBudgetMs: 2000,
      },
      ask: { prompt: 'Wait for Mac to come online' },
    });
    assert.equal(waitedJob.inference.text, 'Mac inference ready');
    assert.ok((waitedJob.provenance.waitedMs ?? 0) > 0);
    assert.equal(s2State.calls, 1);

    // 3. Transient failure before reply retries the SAME endpoint within maxAttempts and records attempts
    failNextS2 = true;
    s2State.replyText = 'Recovered on attempt 2';
    const retriedJob = await rMini.runOrchestratedJob({
      orchestration: {
        privacy: 'owner-bases',
        endpoint: 'mac',
        workerBaseId: 'NERV-02',
        tool: 'reminders.add',
        maxAttempts: 2,
        maxOutputTokens: 64,
        maxTotalTokens: 128,
      },
      ask: { prompt: 'Retry transient failure on same Mac endpoint' },
    });
    assert.equal(retriedJob.inference.text, 'Recovered on attempt 2');
    assert.equal(retriedJob.provenance.attempts, 2);
    assert.equal(s2State.calls, 3);

    // 4. Token budget exhaustion refuses without fallback
    await assert.rejects(
      () =>
        rMini!.runOrchestratedJob({
          orchestration: {
            privacy: 'owner-bases',
            endpoint: 'mac',
            workerBaseId: 'NERV-02',
            tool: 'reminders.add',
            maxTotalTokens: 10,
          },
          ask: { prompt: 'Exceeds 10 total tokens (18 + 12 = 30)' },
        }),
      /Orchestrated token budget exhausted/,
    );

    // 5. Policy-approved cloud path uses Claude and executes on mini PC
    let cloudCalls = 0;
    const cloudJob = await rMini.runOrchestratedJob({
      orchestration: {
        privacy: 'any',
        route: 'cloud',
        trust: 'trusted',
        workerBaseId: 'NERV-02',
        tool: 'reminders.add',
        maxOutputTokens: 128,
      },
      ask: { prompt: 'Cloud-approved architecture review' },
      cloudTransport: async (req) => {
        cloudCalls += 1;
        assert.equal(req.model, 'claude-opus-5-5');
        return {
          model: req.model,
          text: 'Claude cloud summary',
          stop: 'end_turn',
          truncated: false,
          usage: { inputTokens: 15, outputTokens: 9 },
          durationMs: 12,
        };
      },
      item: {
        id: '00000000-0000-4000-8000-000000000801',
        sequence: 1,
        tool: 'reminders.add',
        args: { title: 'Placeholder', due: '2031-02-01T09:00:00Z' },
      },
    });
    assert.equal(cloudCalls, 1);
    assert.equal(cloudJob.provenance.inferenceKind, 'cloud');
    assert.equal(cloudJob.provenance.inferenceModel, 'claude-opus-5-5');
    assert.equal(cloudJob.provenance.executionBaseId, 'NERV-02');

    // 6. Pi capability route executes offered sensor.read using Mac remote inference, and refuses unoffered tools
    s2State.replyText = 'Read ambient sensor on Pi';
    const piJob = await rMini.runOrchestratedJob({
      orchestration: {
        privacy: 'owner-bases',
        endpoint: 'mac',
        workerBaseId: 'NERV-PI',
        tool: 'sensor.read',
        waitBudgetMs: 2000,
      },
      ask: { prompt: 'Check ambient sensor via Pi' },
      item: {
        id: '00000000-0000-4000-8000-000000000802',
        sequence: 1,
        tool: 'sensor.read',
        args: { channel: 'ambient' },
      },
    });
    assert.equal(piJob.provenance.inferenceBaseId, 'NERV-01');
    assert.equal(piJob.provenance.executionBaseId, 'NERV-PI');
    const piExec = piJob.execution as { outcome?: string; result?: { celsius?: number; promptEcho?: string } };
    assert.equal(piExec.outcome, 'grant');
    assert.equal(piExec.result?.celsius, 21.5);
    assert.equal(piExec.result?.promptEcho, 'Read ambient sensor on Pi');

    await assert.rejects(
      () =>
        rMini!.runOrchestratedJob({
          orchestration: {
            privacy: 'owner-bases',
            endpoint: 'mac',
            workerBaseId: 'NERV-PI',
            tool: 'reminders.add',
          },
          ask: { prompt: 'Pi does not offer reminders.add over WorkerLink' },
        }),
      /Execution worker NERV-PI does not offer capability "reminders\.add"/,
    );
  } finally {
    await linkPi?.stop();
    await linkMac?.stop();
    await linkMini?.stop();
    await new Promise<void>((done) => {
      wsServer.close(() => done());
      wsServer.closeAllConnections();
    });
    await new Promise<void>((done) => {
      s2Server.close(() => done());
      s2Server.closeAllConnections();
    });
    await Promise.allSettled([rPi?.close(), rMini?.close(), rMac?.close()]);
    rmSync(homeMac, { recursive: true, force: true });
    rmSync(homeMini, { recursive: true, force: true });
    rmSync(homePi, { recursive: true, force: true });
  }
});
