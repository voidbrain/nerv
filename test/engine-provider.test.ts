import assert from 'node:assert/strict';
import { createServer, type RequestListener } from 'node:http';
import { test } from 'node:test';
import {
  EngineRegistry,
  anthropicProvider,
  defaultEngineRegistry,
  ollamaProvider,
  openaiCompatibleProvider,
  validateEngineInstance,
  validateEngineInstances,
  type EngineInstance,
  type EngineProvider,
} from '../src/engine-provider.ts';
import { detectOllama } from '../src/model-setup.ts';
import { ModelError } from '../src/model.ts';

async function listen(handler: RequestListener): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

test('validateEngineInstances accepts multiple local and remote instances and rejects invalid ones', () => {
  const instances = validateEngineInstances([
    {
      id: 'ollama-main',
      provider: 'ollama',
      locality: 'local',
      baseUrl: 'http://127.0.0.1:11434/v1/',
      model: 'gemma4:12b',
    },
    {
      id: 'ollama-gpu',
      provider: 'ollama',
      locality: 'remote',
      baseUrl: 'https://gpu.example.test:11434/',
      model: 'qwen3:32b',
      label: 'Remote GPU',
    },
    {
      id: 'vllm-edge',
      provider: 'openai-compatible',
      locality: 'remote',
      baseUrl: 'https://vllm.example.test/v1',
      model: 'llama-3.3-70b',
    },
    {
      id: 'anthropic-cloud',
      provider: 'anthropic',
      locality: 'remote',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-opus-5-5',
      enabled: false,
    },
  ]);

  assert.equal(instances.length, 4);
  assert.equal(instances[0].baseUrl, 'http://127.0.0.1:11434/v1');
  assert.equal(instances[0].enabled, true);
  assert.equal(instances[3].enabled, false);

  assert.throws(
    () =>
      validateEngineInstances([
        { id: 'dup', provider: 'ollama', locality: 'local', baseUrl: 'http://127.0.0.1:11434', model: 'm1' },
        { id: 'dup', provider: 'ollama', locality: 'local', baseUrl: 'http://localhost:11434', model: 'm2' },
      ]),
    /Duplicate engine instance id/,
  );

  assert.throws(
    () =>
      validateEngineInstance({
        id: 'bad-local',
        provider: 'ollama',
        locality: 'local',
        baseUrl: 'https://remote.example.test',
        model: 'gemma4:12b',
      }),
    /loopback/,
  );

  assert.throws(
    () =>
      validateEngineInstance({
        id: 'bad-remote-http',
        provider: 'openai-compatible',
        locality: 'remote',
        baseUrl: 'http://remote.example.test/v1',
        model: 'm',
      }),
    /https/,
  );

  assert.throws(
    () =>
      validateEngineInstance({
        id: 'bad-anthropic-local',
        provider: 'anthropic',
        locality: 'local',
        baseUrl: 'http://127.0.0.1:4000',
        model: 'claude',
      }),
    /does not support "local" locality/,
  );

  assert.throws(
    () =>
      validateEngineInstance({
        id: 'creds-in-url',
        provider: 'ollama',
        locality: 'remote',
        baseUrl: 'https://user:pass@gpu.example.test',
        model: 'm',
      }),
    /credentials/,
  );
});

test('EngineRegistry probes multiple instances and Ollama adapter matches detectOllama', async () => {
  const digest = 'a'.repeat(64);
  const ollama = await listen((req, res) => {
    if (req.url === '/api/tags') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          models: [{ name: 'gemma4:12b', digest: `sha256:${digest}`, size: 42, details: { parameter_size: '12B' } }],
        }),
      );
      return;
    }
    if (req.url === '/v1/chat/completions' && req.method === 'POST') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          model: 'gemma4:12b',
          usage: { prompt_tokens: 10, completion_tokens: 5 },
          choices: [{ message: { content: 'hello from ollama adapter' }, finish_reason: 'stop' }],
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });

  const oai = await listen((req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'custom-model-1' }] }));
      return;
    }
    if (req.url === '/v1/chat/completions' && req.method === 'POST') {
      assert.equal(req.headers.authorization, 'Bearer secret-token');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          model: 'custom-model-1',
          choices: [{ message: { content: 'hello from openai-compatible' }, finish_reason: 'stop' }],
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });

  try {
    const instances: EngineInstance[] = [
      { id: 'ollama-1', provider: 'ollama', locality: 'local', baseUrl: ollama.url, model: 'gemma4:12b' },
      {
        id: 'oai-1',
        provider: 'openai-compatible',
        locality: 'local',
        baseUrl: `${oai.url}/v1`,
        model: 'custom-model-1',
        apiKey: 'secret-token',
      },
      {
        id: 'anthropic-1',
        provider: 'anthropic',
        locality: 'remote',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-opus-5-5',
      },
    ];

    const probed = await defaultEngineRegistry.probeAll(instances, { timeoutMs: 2000 });
    assert.equal(probed.length, 3);
    assert.deepEqual(probed[0], {
      id: 'ollama-1',
      provider: 'ollama',
      locality: 'local',
      url: ollama.url,
      reachable: true,
      models: [{ name: 'gemma4:12b', digest, size: 42, parameters: '12B' }],
    });
    assert.deepEqual(probed[1], {
      id: 'oai-1',
      provider: 'openai-compatible',
      locality: 'local',
      url: `${oai.url}/v1`,
      reachable: true,
      models: [{ name: 'custom-model-1' }],
    });
    assert.equal(probed[2].reachable, false);
    assert.match(probed[2].error ?? '', /missing/);

    const detected = await detectOllama(ollama.url);
    assert.deepEqual(detected, {
      reachable: true,
      url: ollama.url,
      models: [{ name: 'gemma4:12b', digest, size: 42, parameters: '12B' }],
    });

    const ollamaReply = await defaultEngineRegistry.complete({ prompt: 'hi', privacy: 'local-only' }, instances[0], {
      timeoutMs: 2000,
    });
    assert.equal(ollamaReply.text, 'hello from ollama adapter');

    const oaiReply = await defaultEngineRegistry.complete({ prompt: 'hi', privacy: 'local-only' }, instances[1], {
      timeoutMs: 2000,
    });
    assert.equal(oaiReply.text, 'hello from openai-compatible');
  } finally {
    await Promise.all([ollama.close(), oai.close()]);
  }
});

test('EngineRegistry enforces local-only privacy and supports custom adapters', async () => {
  const custom: EngineProvider = {
    kind: 'mock-engine',
    supportedLocalities: ['local', 'remote'],
    validateInstance: (i) => i,
    probe: async (i) => ({
      id: i.id,
      provider: 'mock-engine',
      locality: i.locality,
      url: i.baseUrl,
      reachable: true,
      models: [{ name: i.model }],
    }),
    complete: async (_ask, i) => ({
      text: `answered by ${i.id}`,
      route: i.locality === 'local' ? 'local' : 'cloud',
      model: i.model,
      stop: 'stop',
      truncated: false,
    }),
  };

  const registry = new EngineRegistry([ollamaProvider, openaiCompatibleProvider, anthropicProvider, custom]);
  assert.throws(() => registry.register(custom), /already registered/);

  const instances: EngineInstance[] = [
    { id: 'remote-gpu', provider: 'mock-engine', locality: 'remote', baseUrl: 'https://gpu.example.test', model: 'm1' },
    { id: 'local-cpu', provider: 'mock-engine', locality: 'local', baseUrl: 'http://127.0.0.1:9000', model: 'm2' },
    {
      id: 'disabled-local',
      provider: 'mock-engine',
      locality: 'local',
      baseUrl: 'http://127.0.0.1:9001',
      model: 'm3',
      enabled: false,
    },
  ];

  // local-only privacy skips remote-gpu and disabled-local, picking local-cpu
  const picked = registry.selectInstance(instances, { privacy: 'local-only' });
  assert.equal(picked.id, 'local-cpu');

  // requesting a remote instance under local-only privacy throws ModelError
  assert.throws(
    () => registry.selectInstance(instances, { id: 'remote-gpu', privacy: 'local-only' }),
    (e) => e instanceof ModelError && /Local-only/.test(e.message),
  );
  await assert.rejects(
    registry.complete({ prompt: 'secret', privacy: 'local-only' }, instances[0], { timeoutMs: 1000 }),
    (e) => e instanceof ModelError && /Local-only/.test(e.message),
  );
  await assert.rejects(
    registry.complete({ prompt: 'hi', privacy: 'any' }, instances[2], { timeoutMs: 1000 }),
    (e) => e instanceof ModelError && /disabled/.test(e.message),
  );

  const reply = await registry.complete({ prompt: 'hi', privacy: 'local-only' }, picked, { timeoutMs: 1000 });
  assert.equal(reply.text, 'answered by local-cpu');
});
