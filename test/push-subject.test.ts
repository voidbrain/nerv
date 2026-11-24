import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import { Store } from '../src/store.ts';
import { generateVapidKeys, buildVapidHeader, sendWebPush, validateVapidSubject } from '../src/push.ts';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig } from '../src/config.ts';

function claimsOf(header: string): { sub: string; aud: string } {
  const token = /t=([^,]+)/.exec(header)![1]!;
  return JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString());
}

function sub() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    p256dh: ecdh.getPublicKey().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  };
}

test('B-134: the default VAPID subject is a real https URL, not a .local mailto Apple rejects', () => {
  const keys = generateVapidKeys();
  const claims = claimsOf(buildVapidHeader('https://web.push.apple.com/x', keys.publicKey, keys.privateKey));
  assert.equal(claims.sub, 'https://github.com/voidbrain/nerv');
  assert.doesNotThrow(() => validateVapidSubject(claims.sub));
});

test('B-134: sendWebPush uses the default subject and reports the push service reason', async () => {
  const keys = generateVapidKeys();
  let seen = '';
  const fetchFn = (async (_url: string, init: { headers: Record<string, string> }) => {
    seen = claimsOf(init.headers.Authorization!).sub;
    return new Response('{"reason":"BadJwtToken"}', { status: 403 });
  }) as unknown as typeof fetch;
  const res = await sendWebPush(
    { endpoint: 'https://web.push.apple.com/x', ...sub(), created: '' },
    { a: 1 },
    keys,
    fetchFn,
  );
  assert.equal(seen, 'https://github.com/voidbrain/nerv');
  assert.equal(res.ok, false);
  assert.equal(res.status, 403);
  assert.equal(res.reason, 'BadJwtToken');
});

test('B-134: the subject is validated: https URL or mailto with a dotted public domain', () => {
  for (const ok of ['https://github.com/voidbrain/nerv', 'mailto:owner@example.org'])
    assert.doesNotThrow(() => validateVapidSubject(ok), ok);
  for (const bad of [
    'mailto:nerv@agency.local',
    'mailto:me@localhost',
    'mailto:me@host',
    'http://example.org',
    'https://localhost/x',
    'https://printer.local/x',
    'nerv',
    '',
  ])
    assert.throws(() => validateVapidSubject(bad), /push\.subject/, bad);
});

test('B-134: config push.subject is validated', () => {
  const read = (subject: string) => {
    const home = mkdtempSync(join(tmpdir(), 'nerv-push-'));
    writeFileSync(join(home, 'config.json'), JSON.stringify({ push: { subject } }));
    return readConfig(home);
  };
  assert.equal(read('mailto:o@example.org').push?.subject, 'mailto:o@example.org');
  assert.throws(() => read('mailto:o@x.local'), /push\.subject/);
});

test('B-134: a failed dispatch is logged (host, status, reason only) and stored for the Health line', async () => {
  const store = new Store(':memory:');
  const errors = mock.method(console, 'error', () => {});
  try {
    store.pushFetch = (async () => new Response('{"reason":"BadJwtToken"}', { status: 403 })) as typeof fetch;
    const endpoint = 'https://web.push.apple.com/SECRET-TOKEN-123';
    store.savePushSubscription({ endpoint, ...sub() });
    assert.deepEqual(store.pushHealth(), { devices: 1, last: null });
    store.add('Phone push test', '2030-01-01T10:00:00Z');
    store.tick(new Date('2030-01-01T10:01:00Z'));
    const end = Date.now() + 3000;
    while (!store.pushHealth().last && Date.now() < end) await new Promise((d) => setTimeout(d, 20));
    const last = store.pushHealth().last!;
    assert.equal(last.ok, false);
    assert.equal(last.status, 403);
    assert.equal(last.reason, 'BadJwtToken');
    assert.equal(store.listPushSubscriptions().length, 1, 'a 403 keeps the subscription');
    const logged = errors.mock.calls.map((c) => c.arguments.join(' ')).join('\n');
    assert.match(logged, /web\.push\.apple\.com/);
    assert.match(logged, /403/);
    assert.match(logged, /BadJwtToken/);
    assert.doesNotMatch(logged, /SECRET-TOKEN/);
    assert.equal((store.doctor() as { push: { devices: number } }).push.devices, 1);
  } finally {
    errors.mock.restore();
    store.close();
  }
});

test('B-134: a successful dispatch stores an ok result', async () => {
  const store = new Store(':memory:');
  try {
    store.pushFetch = (async () => new Response('', { status: 201 })) as typeof fetch;
    store.savePushSubscription({ endpoint: 'https://web.push.apple.com/x', ...sub() });
    store.add('ok', '2030-01-01T10:00:00Z');
    store.tick(new Date('2030-01-01T10:01:00Z'));
    const end = Date.now() + 3000;
    while (!store.pushHealth().last && Date.now() < end) await new Promise((d) => setTimeout(d, 20));
    assert.equal(store.pushHealth().last?.ok, true);
    assert.equal(store.pushHealth().last?.status, 201);
  } finally {
    store.close();
  }
});
