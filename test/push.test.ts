import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createECDH, randomBytes, createVerify, createDecipheriv, hkdfSync, type ECDH } from 'node:crypto';
import { Store } from '../src/store.ts';
import { makeServer } from '../src/server.ts';
import {
  generateVapidKeys,
  buildVapidHeader,
  encryptPayload,
  sendWebPush,
  formatReminderPushPayload,
} from '../src/push.ts';

function decryptPayload(body: Buffer, clientECDH: ECDH, clientAuth: Buffer): Buffer {
  const salt = body.subarray(0, 16);
  const idlen = body[20]!;
  const serverPublicKey = body.subarray(21, 21 + idlen);
  const ciphertextWithTag = body.subarray(21 + idlen);

  const sharedSecret = clientECDH.computeSecret(serverPublicKey);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), clientECDH.getPublicKey(), serverPublicKey]);
  const ikm = Buffer.from(hkdfSync('sha256', sharedSecret, clientAuth, keyInfo, 32));

  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));

  const tag = ciphertextWithTag.subarray(ciphertextWithTag.length - 16);
  const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.length - 16);

  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  const lastIndex = decrypted.lastIndexOf(2);
  return decrypted.subarray(0, lastIndex >= 0 ? lastIndex : decrypted.length);
}

test('F-004-T05: VAPID key generation and JWT header', () => {
  const keys = generateVapidKeys();
  assert.ok(keys.publicKey, 'publicKey exists');
  assert.ok(keys.privateKey, 'privateKey exists');

  const rawPub = Buffer.from(keys.publicKey, 'base64url');
  assert.equal(rawPub.length, 65, 'uncompressed P-256 public key is 65 bytes');
  assert.equal(rawPub[0], 0x04, 'uncompressed point starts with 0x04');

  const endpoint = 'https://push.services.mozilla.com/v1/sub-123';
  const header = buildVapidHeader(endpoint, keys.publicKey, keys.privateKey, 'mailto:test@example.com', 3600);
  assert.match(header, /^vapid t=([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+), k=([a-zA-Z0-9_-]+)$/);

  const match = /^vapid t=([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+), k=([a-zA-Z0-9_-]+)$/.exec(header)!;
  const headJson = JSON.parse(Buffer.from(match[1]!, 'base64url').toString('utf8'));
  const claimJson = JSON.parse(Buffer.from(match[2]!, 'base64url').toString('utf8'));

  assert.equal(headJson.alg, 'ES256');
  assert.equal(headJson.typ, 'JWT');
  assert.equal(claimJson.aud, 'https://push.services.mozilla.com');
  assert.equal(claimJson.sub, 'mailto:test@example.com');
  assert.ok(claimJson.exp > Date.now() / 1000);

  // Verify signature
  const spkiHeader = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex');
  const spkiDer = Buffer.concat([spkiHeader, rawPub]);
  const pem = `-----BEGIN PUBLIC KEY-----\n${spkiDer
    .toString('base64')
    .match(/.{1,64}/g)!
    .join('\n')}\n-----END PUBLIC KEY-----`;

  const verifier = createVerify('SHA256');
  verifier.update(`${match[1]}.${match[2]}`);
  const valid = verifier.verify({ key: pem, dsaEncoding: 'ieee-p1363' }, Buffer.from(match[3]!, 'base64url'));
  assert.equal(valid, true, 'VAPID JWT signature is valid');
});

test('F-004-T05: RFC 8291 payload encryption and decryption', () => {
  const clientECDH = createECDH('prime256v1');
  clientECDH.generateKeys();
  const clientAuth = randomBytes(16);

  const original = JSON.stringify({ message: 'Meeting with Gendo', reminderId: 'rem-1' });
  const encrypted = encryptPayload(original, clientECDH.getPublicKey(), clientAuth);

  assert.ok(encrypted.length > original.length, 'ciphertext includes salt, header and tag');
  const decrypted = decryptPayload(encrypted, clientECDH, clientAuth).toString('utf8');
  assert.equal(decrypted, original, 'decrypted payload matches original');
});

test('F-004-T05: formatReminderPushPayload and direct sendWebPush', async () => {
  const payload = formatReminderPushPayload({
    id: 'rem-abc',
    title: 'Deploy satellite',
    due: '2030-05-01T12:00:00Z',
  });
  assert.equal(payload.notification.title, '⏰ Deploy satellite');
  assert.equal(payload.notification.data.id, 'rem-abc');
  assert.equal(payload.notification.data.onActionClick.default.operation, 'focusLastFocusedOrOpen');

  const clientECDH = createECDH('prime256v1');
  clientECDH.generateKeys();
  const vapid = generateVapidKeys();

  let receivedAuth = '';
  let receivedBodyLength = 0;
  const mockFetch = async (_input: string | Request | URL, init?: RequestInit) => {
    receivedAuth = String(init?.headers && (init.headers as Record<string, string>)['Authorization']);
    const b = init?.body as Uint8Array;
    receivedBodyLength = b.length;
    return new Response(JSON.stringify({ ok: true }), { status: 201 });
  };

  const sub = {
    endpoint: 'https://push.example.com/sub-test',
    p256dh: clientECDH.getPublicKey().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
    created: new Date().toISOString(),
  };

  const result = await sendWebPush(sub, payload, vapid, mockFetch as unknown as typeof fetch);
  assert.equal(result.ok, true);
  assert.equal(result.status, 201);
  assert.equal(result.expired, false);
  assert.match(receivedAuth, /^vapid t=/);
  assert.ok(receivedBodyLength > 0);
});

test('F-004-T05: Store push subscription CRUD and VAPID persistence', () => {
  const store = new Store(':memory:');
  try {
    const k1 = store.getOrGenerateVapidKeys();
    const k2 = store.getOrGenerateVapidKeys();
    assert.equal(k1.publicKey, k2.publicKey, 'VAPID keys are persistent in SQLite');
    assert.equal(k1.privateKey, k2.privateKey);

    const clientECDH = createECDH('prime256v1');
    clientECDH.generateKeys();
    const p256dh = clientECDH.getPublicKey().toString('base64url');
    const auth = randomBytes(16).toString('base64url');
    const endpoint = 'https://fcm.googleapis.com/fcm/send/device-a';

    // Validation
    assert.throws(() => store.savePushSubscription({ endpoint: 'invalid-url', p256dh, auth }), /endpoint/);
    assert.throws(() => store.savePushSubscription({ endpoint, p256dh: '', auth }), /p256dh/);
    assert.throws(() => store.savePushSubscription({ endpoint, p256dh, auth: '' }), /auth/);

    // Save
    store.savePushSubscription({ endpoint, p256dh, auth, userAgent: 'Chrome/Mock' });
    const list = store.listPushSubscriptions();
    assert.equal(list.length, 1);
    assert.equal(list[0]!.endpoint, endpoint);
    assert.equal(list[0]!.p256dh, p256dh);
    assert.equal(list[0]!.auth, auth);
    assert.equal(list[0]!.userAgent, 'Chrome/Mock');

    const sub = store.getPushSubscription(endpoint);
    assert.ok(sub);
    assert.equal(sub!.endpoint, endpoint);

    // Upsert on same endpoint
    store.savePushSubscription({ endpoint, p256dh, auth, userAgent: 'Chrome/Updated' });
    assert.equal(store.listPushSubscriptions().length, 1);
    assert.equal(store.getPushSubscription(endpoint)!.userAgent, 'Chrome/Updated');

    // Delete
    assert.equal(store.deletePushSubscription(endpoint), true);
    assert.equal(store.deletePushSubscription(endpoint), false);
    assert.equal(store.listPushSubscriptions().length, 0);
  } finally {
    store.close();
  }
});

test('F-004-T05: Push delivery on reminder tick reaches subscribed browser', async () => {
  const store = new Store(':memory:');
  const clientECDH = createECDH('prime256v1');
  clientECDH.generateKeys();
  const clientAuth = randomBytes(16);

  let deliveredPayload: string | null = null;
  let deliveredHeaders: Record<string, string | string[] | undefined> = {};

  const pushServer = createServer(async (req, res) => {
    deliveredHeaders = req.headers;
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    deliveredPayload = decryptPayload(body, clientECDH, clientAuth).toString('utf8');
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });

  const listen = () =>
    new Promise<number>((done) =>
      pushServer.listen(0, '127.0.0.1', () => done((pushServer.address() as { port: number }).port)),
    );
  const port = await listen();
  const endpoint = `http://127.0.0.1:${port}/push-gateway/sub-1`;

  try {
    store.savePushSubscription({
      endpoint,
      p256dh: clientECDH.getPublicKey().toString('base64url'),
      auth: clientAuth.toString('base64url'),
    });

    const reminder = store.add('Test web push reminder', '2030-01-01T10:00:00Z');
    assert.ok(reminder.id);

    // Tick at future moment
    const fired = store.tick(new Date('2030-01-01T10:01:00Z'));
    assert.equal(fired, 1, 'reminder ticked and delivered locally');

    // Wait for async push dispatch
    const end = Date.now() + 5000;
    while (!deliveredPayload && Date.now() < end) {
      await new Promise((d) => setTimeout(d, 50));
    }

    assert.ok(deliveredPayload, 'push notification arrived at push endpoint');
    assert.match(String(deliveredHeaders['authorization']), /^vapid t=/);
    assert.equal(deliveredHeaders['content-encoding'], 'aes128gcm');

    const parsed = JSON.parse(deliveredPayload);
    assert.equal(parsed.notification.title, '⏰ Test web push reminder');
    assert.equal(parsed.notification.data.id, reminder.id);
  } finally {
    await new Promise<void>((done) => pushServer.close(() => done()));
    store.close();
  }
});

test('F-004-T05: Expired 410 subscription is automatically pruned', async () => {
  const store = new Store(':memory:');
  const clientECDH = createECDH('prime256v1');
  clientECDH.generateKeys();
  const clientAuth = randomBytes(16);

  const pushServer = createServer((_req, res) => {
    res.writeHead(410, { 'Content-Type': 'text/plain' });
    res.end('Gone');
  });

  const listen = () =>
    new Promise<number>((done) =>
      pushServer.listen(0, '127.0.0.1', () => done((pushServer.address() as { port: number }).port)),
    );
  const port = await listen();
  const endpoint = `http://127.0.0.1:${port}/push-gateway/expired-sub`;

  try {
    store.savePushSubscription({
      endpoint,
      p256dh: clientECDH.getPublicKey().toString('base64url'),
      auth: clientAuth.toString('base64url'),
    });
    assert.equal(store.listPushSubscriptions().length, 1);

    store.add('Expiring reminder', '2030-01-01T10:00:00Z');
    store.tick(new Date('2030-01-01T10:01:00Z'));

    const end = Date.now() + 5000;
    while (store.listPushSubscriptions().length > 0 && Date.now() < end) {
      await new Promise((d) => setTimeout(d, 50));
    }

    assert.equal(store.listPushSubscriptions().length, 0, 'expired 410 subscription pruned');
  } finally {
    await new Promise<void>((done) => pushServer.close(() => done()));
    store.close();
  }
});

test('F-004-T05: Server HTTP API endpoints for push', async () => {
  const store = new Store(':memory:');
  const token = 's'.repeat(32);
  const server = makeServer(store, token);
  const listen = () =>
    new Promise<number>((done) =>
      server.listen(0, '127.0.0.1', () => done((server.address() as { port: number }).port)),
    );
  const port = await listen();
  const origin = `http://127.0.0.1:${port}`;

  try {
    // 1. GET /api/push/key
    const keyRes = await fetch(`${origin}/api/push/key`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(keyRes.status, 200);
    const keyJson = (await keyRes.json()) as { publicKey: string };
    assert.ok(keyJson.publicKey, 'publicKey returned');
    assert.equal(keyJson.publicKey, store.pushPublicKey());

    // 2. GET /api/push/status (empty)
    const statusRes1 = await fetch(`${origin}/api/push/status`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(statusRes1.status, 200);
    const statusJson1 = (await statusRes1.json()) as { subscribed: boolean; count: number };
    assert.equal(statusJson1.subscribed, false);
    assert.equal(statusJson1.count, 0);

    // 3. POST /api/push/subscribe (validation error)
    const badSub = await fetch(`${origin}/api/push/subscribe`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: 'bad' }),
    });
    assert.equal(badSub.status, 400);

    // 4. POST /api/push/subscribe (valid)
    const clientECDH = createECDH('prime256v1');
    clientECDH.generateKeys();
    const endpoint = 'https://fcm.googleapis.com/fcm/send/my-pwa-sub';
    const subRes = await fetch(`${origin}/api/push/subscribe`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint,
        keys: {
          p256dh: clientECDH.getPublicKey().toString('base64url'),
          auth: randomBytes(16).toString('base64url'),
        },
        userAgent: 'TestPWA/1.0',
      }),
    });
    assert.equal(subRes.status, 201);
    assert.equal(store.listPushSubscriptions().length, 1);

    // 5. GET /api/push/status (subscribed)
    const statusRes2 = await fetch(`${origin}/api/push/status`, { headers: { Authorization: `Bearer ${token}` } });
    const statusJson2 = (await statusRes2.json()) as { subscribed: boolean; count: number };
    assert.equal(statusJson2.subscribed, true);
    assert.equal(statusJson2.count, 1);

    // 6. POST /api/push/unsubscribe
    const unsubRes = await fetch(`${origin}/api/push/unsubscribe`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    });
    assert.equal(unsubRes.status, 200);
    const unsubJson = (await unsubRes.json()) as { ok: boolean; removed: boolean };
    assert.equal(unsubJson.ok, true);
    assert.equal(unsubJson.removed, true);
    assert.equal(store.listPushSubscriptions().length, 0);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    store.close();
  }
});
