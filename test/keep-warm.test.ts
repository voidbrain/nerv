import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { complete, validateModels, type Models } from '../src/model.ts';
import { readConfig } from '../src/config.ts';

/** Invented loopback stand-in for Ollama: answers chat completions and records every request. */
async function fakeOllama() {
  const seen: { path: string; body: Record<string, unknown> }[] = [];
  const server = createServer(async (req, res) => {
    let text = '';
    for await (const c of req) text += c;
    seen.push({ path: req.url ?? '', body: text ? JSON.parse(text) : {} });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Ciao' }, finish_reason: 'stop' }] }));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  return {
    url: `http://127.0.0.1:${addr.port}`,
    seen,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}
const home = (models: object) => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-keepwarm-'));
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ models }));
  return dir;
};

test('F-144: a local call asks Ollama to keep the model loaded 30 minutes by default, in the same request', async () => {
  const p = await fakeOllama();
  const dir = home({ local: { baseUrl: p.url + '/v1', model: 'gemma' } });
  try {
    const reply = await complete({ prompt: 'Saluta', privacy: 'local-only' }, readConfig(dir).models, undefined, {
      timeoutMs: 2000,
    });
    assert.equal(reply.text, 'Ciao');
    assert.deepEqual(
      p.seen.map((s) => s.path),
      ['/v1/chat/completions'],
      'no second request',
    );
    assert.equal(p.seen[0]!.body.keep_alive, '30m');
  } finally {
    await p.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('F-144: the configured keepAlive reaches Ollama for every role model on the local route', async () => {
  const p = await fakeOllama();
  const dir = home({ local: { baseUrl: p.url + '/v1', model: 'gemma', keepAlive: '2h' } });
  try {
    const models = readConfig(dir).models;
    await complete(
      { prompt: 'x', privacy: 'local-only' },
      { ...models, local: { ...models.local!, model: 'casper' } },
      undefined,
      { timeoutMs: 2000 },
    );
    assert.deepEqual(
      { model: p.seen[0]!.body.model, keep_alive: p.seen[0]!.body.keep_alive },
      { model: 'casper', keep_alive: '2h' },
    );
  } finally {
    await p.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('F-144: the cloud route never carries keep_alive', async () => {
  const bodies: Record<string, unknown>[] = [];
  const cloud = createServer(async (req, res) => {
    let text = '';
    for await (const c of req) text += c;
    bodies.push(JSON.parse(text));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
  });
  await new Promise<void>((done) => cloud.listen(0, '127.0.0.1', done));
  const addr = cloud.address();
  assert.ok(addr && typeof addr === 'object');
  try {
    const models: Models = {
      local: { baseUrl: 'http://127.0.0.1:9/v1', model: 'gemma', keepAlive: '2h' },
      cloud: { provider: 'anthropic', model: 'claude-opus-5-5', enabled: true },
    };
    await complete({ prompt: 'x', privacy: 'any', route: 'cloud' }, models, 'sk-test-' + 'k'.repeat(32), {
      timeoutMs: 2000,
      cloudBaseUrl: `http://127.0.0.1:${addr.port}`,
    });
    assert.equal(bodies.length, 1);
    assert.ok(!('keep_alive' in bodies[0]!));
  } finally {
    await new Promise<void>((done) => {
      cloud.closeAllConnections();
      cloud.close(() => done());
    });
  }
});

test('F-144: keepAlive is a duration from 1 minute to 24 hours, never a free string', () => {
  const local = (keepAlive: unknown) => ({
    local: { baseUrl: 'http://127.0.0.1:11434/v1', model: 'gemma', keepAlive },
  });
  assert.equal(validateModels(local('45m')).local?.keepAlive, '45m');
  assert.equal(validateModels(local('24h')).local?.keepAlive, '24h');
  assert.equal(validateModels(local('90s')).local?.keepAlive, '90s');
  for (const bad of ['forever', '25h', '0', '0m', '30s', '-1', '1d', '30 m', 30, -1, null])
    assert.throws(() => validateModels(local(bad)), /keepAlive/, String(bad));
});

test('F-144: "keep loaded always" sends keep_alive -1 and overrides the duration; it is only a boolean', async () => {
  const p = await fakeOllama();
  try {
    const models = validateModels({
      local: { baseUrl: p.url + '/v1', model: 'gemma', keepAlive: '2h', alwaysLoaded: true },
    });
    await complete({ prompt: 'x', privacy: 'local-only' }, models, undefined, { timeoutMs: 2000 });
    assert.equal(p.seen[0]!.body.keep_alive, -1);
    const local = (alwaysLoaded: unknown) => ({
      local: { baseUrl: 'http://127.0.0.1:11434/v1', model: 'gemma', alwaysLoaded },
    });
    assert.equal(validateModels(local(false)).local?.alwaysLoaded, undefined, 'off is the default and is not kept');
    for (const bad of ['true', 1, null]) assert.throws(() => validateModels(local(bad)), /alwaysLoaded/, String(bad));
  } finally {
    await p.close();
  }
});
