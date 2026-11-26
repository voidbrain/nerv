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
    res.end(
      JSON.stringify(
        req.url === '/api/generate'
          ? { model: 'gemma', response: '', done: true }
          : { choices: [{ message: { role: 'assistant', content: 'Ciao' }, finish_reason: 'stop' }] },
      ),
    );
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
/** The keep-warm request follows the reply without delaying it: wait for it to arrive. */
async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
}

test('F-144: a local reply is followed by a prompt-less keep_alive load at Ollama, 30 minutes by default', async () => {
  const p = await fakeOllama();
  const home = mkdtempSync(join(tmpdir(), 'nerv-keepwarm-'));
  try {
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({ models: { local: { baseUrl: p.url + '/v1', model: 'gemma' } } }),
    );
    const reply = await complete({ prompt: 'Saluta', privacy: 'local-only' }, readConfig(home).models, undefined, {
      timeoutMs: 2000,
    });
    assert.equal(reply.text, 'Ciao');
    await until(() => p.seen.some((s) => s.path === '/api/generate'));
    assert.deepEqual(
      p.seen.map((s) => s.path),
      ['/v1/chat/completions', '/api/generate'],
    );
    assert.deepEqual(p.seen[1]!.body, { model: 'gemma', keep_alive: '30m' }, 'no prompt: it loads, never generates');
  } finally {
    await p.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('F-144: the configured keepAlive reaches Ollama for every role model on the local route', async () => {
  const p = await fakeOllama();
  const home = mkdtempSync(join(tmpdir(), 'nerv-keepwarm-'));
  try {
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({ models: { local: { baseUrl: p.url + '/v1', model: 'gemma', keepAlive: '2h' } } }),
    );
    const models = readConfig(home).models;
    await complete(
      { prompt: 'x', privacy: 'local-only' },
      { ...models, local: { ...models.local!, model: 'casper' } },
      undefined,
      {
        timeoutMs: 2000,
      },
    );
    await until(() => p.seen.some((s) => s.path === '/api/generate'));
    assert.deepEqual(p.seen.find((s) => s.path === '/api/generate')!.body, { model: 'casper', keep_alive: '2h' });
  } finally {
    await p.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('F-144: a failed local reply sends no keep_alive, and the cloud route never does', async () => {
  const local = createServer((_req, res) => {
    res.writeHead(500);
    res.end();
  });
  const paths: string[] = [];
  local.on('request', (req) => paths.push(req.url ?? ''));
  await new Promise<void>((done) => local.listen(0, '127.0.0.1', done));
  const addr = local.address();
  assert.ok(addr && typeof addr === 'object');
  try {
    const models: Models = { local: { baseUrl: `http://127.0.0.1:${addr.port}/v1`, model: 'gemma' } };
    await assert.rejects(complete({ prompt: 'x', privacy: 'local-only' }, models, undefined, { timeoutMs: 2000 }));
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(paths, ['/v1/chat/completions']);
    const cloud = createServer((req, res) => {
      paths.push(`cloud ${req.url}`);
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
    const cloudAddr = cloud.address();
    assert.ok(cloudAddr && typeof cloudAddr === 'object');
    try {
      await complete(
        { prompt: 'x', privacy: 'any', route: 'cloud' },
        { ...models, cloud: { provider: 'anthropic', model: 'claude-opus-5-5', enabled: true } },
        'sk-test-' + 'k'.repeat(32),
        { timeoutMs: 2000, cloudBaseUrl: `http://127.0.0.1:${cloudAddr.port}` },
      );
      await new Promise((r) => setTimeout(r, 100));
      assert.deepEqual(paths, ['/v1/chat/completions', 'cloud /v1/messages']);
    } finally {
      await new Promise<void>((done) => {
        cloud.closeAllConnections();
        cloud.close(() => done());
      });
    }
  } finally {
    await new Promise<void>((done) => {
      local.closeAllConnections();
      local.close(() => done());
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
