import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RouteWatch, isOutage, describeChange, degradedReasons } from '../src/route-health.ts';
test('a route goes down only on an outage, comes back on any answer, and says for how long', () => {
  const w = new RouteWatch();
  const t = (m: number) => new Date(Date.UTC(2030, 0, 1, 9, m));
  assert.deepEqual(
    w.configure({ local: true, cloud: false }, t(0)).map((c) => [c.route, c.to]),
    [['cloud', 'off']],
  );
  assert.equal(
    w.record('cloud', false, 'Cloud route (Umbilical) unreachable.', t(0)),
    undefined,
    'an unconfigured route is not tracked',
  );
  assert.equal(
    w.record('local', false, 'Local route (S²) returned invalid JSON.', t(1))?.to,
    'ok',
    'a bad reply means the route answered',
  );
  const down = w.record('local', false, 'Local route (S²) unreachable.', t(2))!;
  assert.deepEqual([down.from, down.to], ['ok', 'down']);
  assert.equal(
    w.record('local', false, 'Local route (S²) timed out.', t(3)),
    undefined,
    'still down: no new change, newest reason kept',
  );
  assert.match(
    degradedReasons(w.snapshot())[0]!,
    /^S² local route down since 2030-01-01T09:02:00.000Z: Local route \(S²\) timed out\./,
  );
  const back = w.record('local', true, undefined, t(9))!;
  assert.deepEqual([back.from, back.to, back.downFor], ['down', 'ok', 7 * 60000]);
  assert.equal(describeChange(back), 'NERV: S² local route back after 7 min.');
  assert.match(
    describeChange(down)!,
    /down: Local route \(S²\) unreachable\. Reminders and deterministic actions continue/,
  );
  assert.deepEqual(degradedReasons(w.snapshot()), []);
  for (const m of [
    'Local route (S²) failed with HTTP 503.',
    'Cloud route (Umbilical) rejected the API key.',
    'Cloud route (Umbilical) is rate limited; try later.',
  ])
    assert.ok(isOutage(m), m);
  for (const m of [
    'Local route (S²) failed with HTTP 404.',
    'Cloud route (Umbilical) declined the request.',
    'Local route (S²) returned no text.',
  ])
    assert.ok(!isOutage(m), m);
});
test(
  'Dummy Plug through the brain process: the local route is reported down with its reason, reminders keep working, Misato fails with that reason, and the route recovers on its own',
  { timeout: 20000 },
  async () => {
    const { Runtime } = await import('../src/runtime.ts');
    const reserve = createServer();
    await new Promise<void>((done) => reserve.listen(0, '127.0.0.1', done));
    const port = (reserve.address() as { port: number }).port;
    await new Promise<void>((done) => reserve.close(() => done()));
    const home = mkdtempSync(join(tmpdir(), 'nerv-dummy-'));
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({ models: { local: { baseUrl: `http://127.0.0.1:${port}/v1`, model: 'm' } } }),
    );
    const runtime = new Runtime(join(home, 'nerv.sqlite'), undefined, home);
    let model: Server | undefined;
    const until = async (what: string, check: () => Promise<boolean>) => {
      for (let i = 0; i < 60; i++) {
        if (await check()) return;
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.fail('timed out waiting for ' + what);
    };
    type Doc = { routes?: { local: { state: string; error?: string } }; degraded: string[] };
    try {
      await runtime.ready();
      await until(
        'the probe to mark the route down',
        async () => ((await runtime.doctor()) as unknown as Doc).routes?.local.state === 'down',
      );
      const health = (await runtime.health()) as unknown as Doc;
      assert.equal(health.degraded.length, 1);
      assert.match(health.degraded[0]!, /S² local route down since .*: Local route \(S²\) unreachable\./);
      const r = await runtime.add('Call Ada', '2031-01-01T09:00:00Z');
      assert.ok(
        (await runtime.list()).some((x) => x.id === r.id),
        'reminders do not depend on a model',
      );
      const chat = await runtime.chat('What is on today?');
      assert.match(chat.error ?? '', /Local route \(S²\) unreachable\./, 'the request fails with the visible reason');
      assert.equal((await runtime.sortie(chat.sortieId))!.status, 'failed');
      model = createServer((req, res) => {
        res.setHeader('content-type', 'application/json');
        res.end(
          req.url?.endsWith('/models')
            ? '{"data":[]}'
            : JSON.stringify({ choices: [{ message: { content: '{"reply":"ok"}' }, finish_reason: 'stop' }] }),
        );
      });
      await new Promise<void>((done) => model!.listen(port, '127.0.0.1', done));
      await runtime.reloadModels();
      await until(
        'the route to come back',
        async () => ((await runtime.doctor()) as unknown as Doc).routes?.local.state === 'ok',
      );
      assert.deepEqual(((await runtime.health()) as unknown as Doc).degraded, []);
    } finally {
      await runtime.close();
      if (model) await new Promise<void>((done) => model!.close(() => done()));
      rmSync(home, { recursive: true, force: true });
    }
  },
);
