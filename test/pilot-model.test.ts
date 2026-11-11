import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Runtime } from '../src/runtime.ts';
import { readConfig } from '../src/config.ts';
import { makeServer } from '../src/server.ts';

test(
  'pilot model API changes one specialist, validates discovery and preserves the other pilots and roles',
  { timeout: 30000 },
  async () => {
    let available = true;
    const advised: string[] = [];
    const ollama = createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/tags') {
        res.writeHead(available ? 200 : 503);
        res.end(JSON.stringify({ models: [{ name: 'first' }, { name: 'second' }] }));
        return;
      }
      let body = '';
      req
        .on('data', (chunk) => (body += chunk))
        .on('end', () => {
          const r = JSON.parse(body) as { model: string; messages: { content: string }[] };
          const pilot = r.messages[0]!.content.includes("the owner's pilot for");
          if (pilot) advised.push(r.model);
          res.end(
            JSON.stringify({
              choices: [
                {
                  message: { content: pilot ? 'Use the specialist advice.' : '{"reply":"Done"}' },
                  finish_reason: 'stop',
                },
              ],
            }),
          );
        });
    });
    await new Promise<void>((d) => ollama.listen(0, '127.0.0.1', d));
    const url = `http://127.0.0.1:${(ollama.address() as { port: number }).port}`;
    const home = mkdtempSync(join(tmpdir(), 'nerv-pilot-model-'));
    const pilot = (id: string, keyword: string) => ({
      id,
      name: id,
      domain: keyword,
      keywords: [keyword],
      model: 'first',
      stage: 'prototype',
    });
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({
        models: { local: { baseUrl: url + '/v1', model: 'first' }, roles: { consultant: { model: 'first' } } },
        pilots: [pilot('printer', 'filament'), pilot('woodworker', 'wood')],
      }),
    );
    const r = new Runtime(join(home, 'nerv.sqlite'), undefined, home);
    r.setPilots(() => readConfig(home).pilots ?? []);
    const server = makeServer(r, 'p'.repeat(32));
    await new Promise<void>((d) => server.listen(0, '127.0.0.1', d));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const headers = { Authorization: 'Bearer ' + 'p'.repeat(32), 'Content-Type': 'application/json' };
    const update = (id: string, body: unknown, auth = true) =>
      fetch(base + '/api/pilots/' + id + '/model', {
        method: 'PATCH',
        headers: auth ? headers : { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    try {
      await r.ready();
      const roles = readConfig(home).models;
      assert.equal((await update('printer', { model: 'second' }, false)).status, 401);
      for (const body of [
        { model: 'missing' },
        { model: 'second', stage: 'production' },
        { model: '' },
        { model: null },
      ])
        assert.equal((await update('printer', body)).status, 400);
      assert.equal((await update('unknown', { model: 'second' })).status, 400);
      assert.equal((await update('printer', { model: 'second' })).status, 200);
      assert.deepEqual(
        readConfig(home).pilots!.map((p) => [p.id, p.model]),
        [
          ['printer', 'second'],
          ['woodworker', 'first'],
        ],
      );
      assert.deepEqual(readConfig(home).models, roles);
      await r.chat('Which filament should I use?');
      assert.equal(advised.at(-1), 'second', 'next request uses the new specialist model without restarting');
      const before = readFileSync(join(home, 'config.json'), 'utf8');
      available = false;
      assert.equal((await update('woodworker', { model: 'second' })).status, 400);
      assert.equal(readFileSync(join(home, 'config.json'), 'utf8'), before, 'failed discovery writes nothing');
      available = true;
      await Promise.all([update('printer', { model: 'first' }), update('woodworker', { model: 'second' })]);
      assert.deepEqual(
        readConfig(home).pilots!.map((p) => [p.id, p.model]),
        [
          ['printer', 'first'],
          ['woodworker', 'second'],
        ],
        'concurrent updates retain each other',
      );
    } finally {
      await new Promise<void>((d) => {
        server.close(() => d());
        server.closeAllConnections();
      });
      await r.close();
      await new Promise<void>((d) => {
        ollama.close(() => d());
        ollama.closeAllConnections();
      });
      rmSync(home, { recursive: true, force: true });
    }
  },
);
