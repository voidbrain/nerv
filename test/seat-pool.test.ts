import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canLeaveMachine, defaultPolicy, validatePolicy } from '../src/policy.ts';
import { readConfig, readSeatKey, seatKeyPath, writeSeatKey } from '../src/config.ts';
import { checkSeat, SeatPool, validateSeatPool, type SeatPoolEntry } from '../src/seat-pool.ts';
import { Runtime } from '../src/runtime.ts';

function fakeOpenAI(
  handler: (url: string, auth: string | undefined, body: unknown) => { status?: number; body: unknown },
) {
  const requests: { url: string; auth: string | undefined; body: unknown }[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req
      .on('data', (c) => (raw += c))
      .on('end', () => {
        const parsed = raw ? JSON.parse(raw) : undefined;
        const auth = req.headers.authorization;
        requests.push({ url: req.url ?? '', auth, body: parsed });
        const out = handler(req.url ?? '', auth, parsed);
        res.statusCode = out.status ?? 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(out.body));
      });
  });
  return {
    requests,
    start: async () => {
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      return `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
    },
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r());
        server.closeAllConnections();
      }),
  };
}

test('validateSeatPool enforces one seat per provider/model and private per-seat keys', () => {
  assert.throws(
    () =>
      validateSeatPool([
        { id: 's1', provider: 'groq', baseUrl: 'https://api.example.com/v1', model: 'llama-3' },
        { id: 's2', provider: 'Groq', baseUrl: 'https://api.example.com/v1', model: 'llama-3' },
      ]),
    /Duplicate seat for provider\/model/,
  );

  const home = mkdtempSync(join(tmpdir(), 'nerv-seat-keys-'));
  try {
    writeSeatKey(home, 'groq:llama-3', 'secret-key-1');
    assert.equal(readSeatKey(home, 'groq:llama-3'), 'secret-key-1');
    assert.equal(readSeatKey(home, 'missing'), undefined);
    if (process.platform !== 'win32') {
      chmodSync(seatKeyPath(home, 'groq:llama-3'), 0o644);
      assert.throws(() => readSeatKey(home, 'groq:llama-3'), /chmod 600/);
    }
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({
        seats: [{ id: 'groq:llama-3', provider: 'groq', baseUrl: 'https://api.example.com/v1', model: 'llama-3' }],
      }),
    );
    assert.equal(readConfig(home).seats?.length, 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('SeatPool rotates across actions, checks availability, and skips rate-limited seats with reason', async () => {
  const s1 = fakeOpenAI((url) =>
    url === '/v1/models' ? { body: { data: [{ id: 'm1' }] } } : { status: 429, body: { error: 'rate limit' } },
  );
  const s2 = fakeOpenAI((url) =>
    url === '/v1/models'
      ? { body: { data: [{ id: 'other-model' }] } }
      : { body: { choices: [{ message: { content: '{"vote":"approve","reason":"ok","confidence":0.9}' } }] } },
  );
  const s3 = fakeOpenAI((url) =>
    url === '/v1/models'
      ? { body: { data: [{ id: 'm3' }] } }
      : { body: { choices: [{ message: { content: '{"vote":"approve","reason":"ok","confidence":0.9}' } }] } },
  );
  const [u1, u2, u3] = await Promise.all([s1.start(), s2.start(), s3.start()]);
  try {
    const entries: SeatPoolEntry[] = [
      { id: 'seat-1', provider: 'p1', baseUrl: u1, model: 'm1', cooldownMs: 5000 },
      { id: 'seat-2', provider: 'p2', baseUrl: u2, model: 'm2' },
      { id: 'seat-3', provider: 'p3', baseUrl: u3, model: 'm3' },
      { id: 'seat-nokey', provider: 'p4', baseUrl: u3, model: 'm4' },
    ];
    const keys: Record<string, string> = { 'seat-1': 'k1', 'seat-2': 'k2', 'seat-3': 'k3' };

    // checkSeat detects model not listed and missing key
    assert.equal((await checkSeat(entries[1]!, keys['seat-2'])).reason, 'model not listed');
    assert.equal((await checkSeat(entries[3]!, undefined)).status, 'missing-key');

    // Pool with 2 ready seats (seat-1 and seat-3): checkAll marks seat-2 unavailable ('model not listed')
    const pool = new SeatPool(entries, (id) => keys[id], { maxPerAction: 1 });
    const states = await pool.checkAll();
    assert.equal(states.find((s) => s.id === 'seat-2')?.reason, 'model not listed');

    // Rotation: action 1 picks seat-1, action 2 picks seat-3, action 3 picks seat-1
    const action = { tool: 'mail.send', effect: 'write-external' as const, cloudAllowed: true };
    const p1 = pool.pick(action, 1000);
    assert.deepEqual(
      p1.picked.map((e) => e.id),
      ['seat-1'],
    );
    assert.ok(p1.skipped.some((s) => s.id === 'seat-2' && s.reason === 'model not listed'));
    assert.ok(p1.skipped.some((s) => s.id === 'seat-nokey' && s.reason === 'missing key'));

    const p2 = pool.pick(action, 1001);
    assert.deepEqual(
      p2.picked.map((e) => e.id),
      ['seat-3'],
    );

    // seat-1 hits 429 -> abstains and enters cooldown
    const res1 = await pool.ask(
      entries[0]!,
      { request: 'Send email', tool: 'mail.send', args: {}, effect: 'write-external' },
      new AbortController().signal,
      2000,
    );
    assert.equal(res1.vote, 'abstain');
    assert.equal(res1.reason, 'rate limited');

    // Now pick skips seat-1 with 'rate limited' and picks seat-3 until cooldown expires
    const p3 = pool.pick(action, 3000);
    assert.deepEqual(
      p3.picked.map((e) => e.id),
      ['seat-3'],
    );
    assert.ok(p3.skipped.some((s) => s.id === 'seat-1' && s.reason === 'rate limited'));

    // After cooldown expires (2000 + 5000 = 7000), seat-1 is eligible again
    const p4 = pool.pick(action, 8000);
    assert.deepEqual(
      p4.picked.map((e) => e.id),
      ['seat-1'],
    );
  } finally {
    await Promise.all([s1.close(), s2.close(), s3.close()]);
  }
});

test('canLeaveMachine and Runtime.useSeatPool block local-only and tainted data from cloud seats', async () => {
  const policy = validatePolicy({ ...defaultPolicy, localOnly: ['custom.private'] });
  assert.equal(canLeaveMachine({ tool: 'reminders.list', effect: 'read', trust: 'trusted' }, policy), false);
  assert.equal(canLeaveMachine({ tool: 'reminders.add', effect: 'write-local', trust: 'trusted' }, policy), false);
  assert.equal(canLeaveMachine({ tool: 'custom.private', effect: 'irreversible', trust: 'trusted' }, policy), false);
  assert.equal(canLeaveMachine({ tool: 'custom.external', effect: 'irreversible', trust: 'tainted' }, policy), false);
  assert.equal(canLeaveMachine({ tool: 'custom.external', effect: 'irreversible', trust: 'trusted' }, policy), true);

  const cloud = fakeOpenAI(() => ({
    body: { choices: [{ message: { content: '{"vote":"reject","reason":"cloud veto","confidence":0.95}' } }] },
  }));
  const cloudUrl = await cloud.start();
  const home = mkdtempSync(join(tmpdir(), 'nerv-pool-runtime-'));
  writeFileSync(join(home, 'config.json'), JSON.stringify({}));
  writeFileSync(join(home, 'scrolls.json'), JSON.stringify(policy), { mode: 0o600 });
  writeSeatKey(home, 'cloud-1', 'key-1234567890');
  const runtime = new Runtime(join(home, 'nerv.sqlite'), undefined, home);
  try {
    await runtime.ready();
    const pool = new SeatPool(
      [{ id: 'cloud-1', provider: 'openrouter', baseUrl: cloudUrl, model: 'qwen', shadow: false }],
      (id) => readSeatKey(home, id),
    );
    runtime.useSeatPool(pool, 2000);

    // 1. Local-only action never leaves machine
    await runtime.act({
      request: 'Add reminder',
      tool: 'reminders.add',
      args: { title: 'Secret', due: '2030-01-01T09:00:00Z' },
    });
    assert.equal(cloud.requests.length, 0);

    // 2. Tool marked localOnly in Scrolls never leaves machine
    await runtime.act({ request: 'Private tool', tool: 'custom.private', args: { x: 1 } });
    assert.equal(cloud.requests.length, 0);

    // 3. Tainted sortie never leaves machine
    const taintedSortie = (await runtime.nervous.call('sorties.open', {
      title: 'Tainted',
      source: 'owner',
    })) as string;
    await runtime.nervous.call('context.intake', { sortieId: taintedSortie, source: 'test', trust: 'tainted' });
    const taintedPreview = (await runtime.nervous.call('actions.preview', {
      sortieId: taintedSortie,
      tool: 'custom.external',
    })) as { cloudAllowed: boolean };
    assert.equal(taintedPreview.cloudAllowed, false);
    assert.equal(cloud.requests.length, 0);

    // 4. Trusted external tool allowed by Scrolls reaches the cloud seat and can veto
    const res = await runtime.act({ request: 'External action', tool: 'custom.external', args: { target: 'ok' } });
    assert.equal(cloud.requests.length, 1);
    assert.equal(cloud.requests[0]!.auth, 'Bearer key-1234567890');
    assert.equal(res.outcome, 'reject');
    assert.equal(res.reason, 'extra:cloud-1: cloud veto');
  } finally {
    await runtime.close();
    await cloud.close();
    rmSync(home, { recursive: true, force: true });
  }
});
