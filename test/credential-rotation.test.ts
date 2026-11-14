import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { credentialAges, initialize, readModelKey, readTelegramToken, readToken } from '../src/config.ts';
import { makeServer } from '../src/server.ts';
import { Store } from '../src/store.ts';
import { TelegramApi } from '../src/telegram.ts';

test('F-066: file-backed admin authentication changes immediately without restarting the server', async () => {
  const store = new Store(':memory:');
  let token = 'a'.repeat(32);
  const server = makeServer(store, () => token);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const status = (value: string) => fetch(base + '/api/status', { headers: { authorization: `Bearer ${value}` } });
  try {
    assert.equal((await status(token)).status, 200);
    const old = token;
    token = 'b'.repeat(32);
    assert.equal((await status(token)).status, 200);
    assert.equal((await status(old)).status, 401);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    store.close();
  }
});

test('F-066: Telegram requests read the current credential for every call', async () => {
  let token = '1:old_token',
    seen = '';
  const server = createServer((req, res) => {
    seen = req.url ?? '';
    const supplied = /^\/bot([^/]+)\//.exec(seen)?.[1];
    res.setHeader('content-type', 'application/json');
    if (supplied !== token) res.writeHead(401);
    res.end(JSON.stringify({ ok: supplied === token, result: { message_id: 1 } }));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const api = new TelegramApi(() => token, `http://127.0.0.1:${(server.address() as { port: number }).port}`);
  try {
    await api.send(1, 'first');
    assert.match(seen, /old_token/);
    token = '2:new_token';
    await api.send(1, 'second');
    assert.match(seen, /new_token/);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
});

test('F-066: rotation commands replace all three private credentials, print no values, and doctor reports ages only', () => {
  const home = mkdtempSync(join(tmpdir(), 'nerv-credentials-'));
  initialize(home);
  const originalAdmin = readToken(home);
  const telegram = '123456:abcdefghijklmnopqrstuvwxyzABCDE';
  const cloud = 'neutral-cloud-key-1234567890';
  const run = (kind: string, input = '') =>
    spawnSync(process.execPath, ['src/cli.ts', 'credentials', 'rotate', kind, ...(input ? ['--stdin'] : [])], {
      cwd: process.cwd(),
      env: { ...process.env, NERV_HOME: home, NERV_TOKEN: undefined },
      input: input ? input + '\n' : undefined,
      encoding: 'utf8',
    });
  try {
    const admin = run('admin');
    assert.equal(admin.status, 0, admin.stderr);
    assert.notEqual(readToken(home), originalAdmin);
    const telegramResult = run('telegram', telegram);
    assert.equal(telegramResult.status, 0, telegramResult.stderr);
    assert.equal(readTelegramToken(home), telegram);
    const cloudResult = run('cloud', cloud);
    assert.equal(cloudResult.status, 0, cloudResult.stderr);
    assert.equal(readModelKey(home), cloud);
    const output =
      admin.stdout +
      admin.stderr +
      telegramResult.stdout +
      telegramResult.stderr +
      cloudResult.stdout +
      cloudResult.stderr;
    for (const secret of [originalAdmin, readToken(home), telegram, cloud])
      assert.doesNotMatch(output, new RegExp(secret));

    const ages = credentialAges(home, Date.now() + 5000);
    assert.deepEqual(Object.keys(ages), ['admin', 'telegram', 'cloud']);
    for (const value of Object.values(ages)) assert.ok(value && value.ageSeconds >= 4 && value.ageSeconds <= 6);
    const store = new Store(join(home, 'nerv.sqlite'), undefined, { home });
    try {
      const doctor = JSON.stringify(store.doctor());
      assert.match(doctor, /ageSeconds/);
      for (const secret of [readToken(home), telegram, cloud]) assert.doesNotMatch(doctor, new RegExp(secret));
    } finally {
      store.close();
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
