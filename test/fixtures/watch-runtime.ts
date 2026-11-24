// Shared fixture of test/watch-runtime.test.ts: one Runtime with a scripted local model server. Kept here so the B-118
// exit probe (test/fixtures/watch-runtime-timeout.probe.ts) builds exactly what the tests build.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Runtime } from '../../src/runtime.ts';
import type { Config } from '../../src/config.ts';
import type { WatchConfig, WatchTrigger } from '../../src/watch.ts';
export const trigger: WatchTrigger = {
  id: 'fixture-check',
  request: 'Read fixture status',
  schedule: { everyMinutes: 1440 },
  maxActions: 1,
  maxSteps: 3,
};
export const quietNow = () => {
  const at = new Date(),
    m = at.getUTCHours() * 60 + at.getUTCMinutes();
  const format = (n: number) =>
    `${String(Math.floor(((n + 1440) % 1440) / 60)).padStart(2, '0')}:${String((n + 1440) % 60).padStart(2, '0')}`;
  return { from: format(m - 30), until: format(m + 30) };
};
export async function setup(script: string[], watch: WatchConfig = { triggers: [trigger] }) {
  const calls: { model: string; system: string; prompt: string }[] = [];
  let onPlan: (() => Promise<void>) | undefined;
  const server = createServer((req, res) => {
    let raw = '';
    req
      .on('data', (c) => (raw += c))
      .on('end', () => {
        void (async () => {
          const input = JSON.parse(raw) as { model: string; messages: { content: string }[] };
          const system = input.messages[0]!.content,
            prompt = input.messages.at(-1)!.content;
          calls.push({ model: input.model, system, prompt });
          const casper = system.startsWith('You are Casper');
          if (!casper) await onPlan?.();
          const content = casper
            ? '{"vote":"approve","reason":"Fixture matches","confidence":1}'
            : (script.shift() ?? '{"reply":"Fixture done."}');
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ model: input.model, choices: [{ message: { content }, finish_reason: 'stop' }] }));
        })().catch(() => {
          res.statusCode = 500;
          res.end();
        });
      });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const home = mkdtempSync(join(tmpdir(), 'nerv-watch-runtime-')),
    database = join(home, 'nerv.sqlite');
  const config: Config = {
    port: 4317,
    language: 'en',
    timeZone: 'UTC',
    base: { id: 'FIXTURE-01', name: 'Fixture' },
    models: {
      local: {
        baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
        model: 'fixture-default',
      },
      roles: { misato: { route: 'cloud', model: 'fixture-cloud-disabled' } },
    },
    watch,
  };
  const save = () => writeFileSync(join(home, 'config.json'), JSON.stringify(config));
  save();
  let runtime = new Runtime(database, undefined, home);
  await runtime.ready();
  return {
    home,
    database,
    config,
    save,
    calls,
    get runtime() {
      return runtime;
    },
    hold: (fn: () => Promise<void>) => {
      onPlan = fn;
    },
    restart: async () => {
      await runtime.close();
      runtime = new Runtime(database, undefined, home);
      await runtime.ready();
    },
    read: <T>(sql: string) => {
      const db = new DatabaseSync(database, { readOnly: true });
      try {
        return db
          .prepare(sql)
          .all()
          .map((row) => ({ ...row })) as unknown as T;
      } finally {
        db.close();
      }
    },
    close: async () => {
      await runtime.close();
      await new Promise<void>((done) => {
        server.close(() => done());
        server.closeAllConnections();
      });
      rmSync(home, { recursive: true, force: true });
    },
  };
}

