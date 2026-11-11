import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:https';
import { NativeAuth, initializeNativeTLS } from '../src/native-auth.ts';
import { makeServer } from '../src/server.ts';
import { Store } from '../src/store.ts';

test('owner-issued renewal rotates one credential atomically, persists and never replays', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-renew-'));
  let auth = new NativeAuth(dir);
  try {
    const current = auth.claim(auth.issue('Mac', 1000).ticket, 1000),
      other = auth.claim(auth.issue('Other', 1000).ticket, 1000),
      ticket = auth.issue('Renewed Mac', 2000);
    assert.throws(() => auth.renew(ticket.ticket, '0'.repeat(64), 2000));
    assert.equal(auth.authenticate(current.token, 2000), true);
    const next = auth.renew(ticket.ticket, current.token, 2000);
    assert.equal(auth.authenticate(current.token, 2000), false);
    assert.equal(auth.authenticate(other.token, 2000), true);
    assert.equal(auth.authenticate(next.token, 2000), true);
    assert.notEqual(next.token, current.token);
    assert.equal(next.runtimeId, current.runtimeId);
    assert.deepEqual(next.scopes, ['read']);
    assert.throws(() => auth.renew(ticket.ticket, current.token, 2000));
    const fresh = auth.issue('Recovery', 3000);
    assert.throws(() => auth.renew(fresh.ticket, current.token, 3000));
    assert.equal(
      auth.claim(fresh.ticket, 3000).scopes[0],
      'read',
      'failed renewal does not consume the fresh invitation',
    );
    auth.close();
    auth = new NativeAuth(dir);
    assert.equal(auth.authenticate(next.token, 4000), true);
    assert.equal(auth.authenticate(current.token, 4000), false);
  } finally {
    auth.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('expired or revoked credentials cannot renew and a full roster still permits replacement', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-renew-limits-')),
    auth = new NativeAuth(dir);
  try {
    const first = auth.claim(auth.issue('First', 1000).ticket, 1000);
    for (let i = 1; i < 32; i++) auth.claim(auth.issue('Mac ' + i, 1000).ticket, 1000);
    const ticket = auth.issue('Replacement', 2000),
      next = auth.renew(ticket.ticket, first.token, 2000);
    assert.equal(auth.clients().length, 32);
    assert.equal(auth.authenticate(next.token, 2000), true);
    auth.revoke(next.clientId);
    const denied = auth.issue('Denied', 3000);
    assert.throws(() => auth.renew(denied.ticket, next.token, 3000));
    const expired = auth.claim(denied.ticket, 3000),
      later = expired.expiresAt + 1,
      renew = auth.issue('Expired', later);
    assert.throws(() => auth.renew(renew.ticket, expired.token, later));
  } finally {
    auth.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('renewal joins actual pinned HTTPS admission, owner ticket, revocation and read-only scope', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-renew-http-')),
    tls = initializeNativeTLS(dir),
    auth = new NativeAuth(dir),
    store = new Store(':memory:'),
    admin = 'neutral-fixture-admin-token-0000';
  const server = makeServer(store, admin, {
    tls,
    native: { auth, fingerprint: tls.fingerprint, port: 4319, webPort: 4317 },
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const call = (
    path: string,
    method: string,
    token?: string,
    payload?: object,
    origin?: string,
  ): Promise<{ status: number; value: Record<string, unknown> }> =>
    new Promise((resolve, reject) => {
      const req = request(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path,
          method,
          ca: tls.cert,
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: 'Bearer ' + token } : {}),
            ...(origin ? { Origin: origin } : {}),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve({ status: res.statusCode!, value: JSON.parse(data) }));
        },
      );
      req.on('error', reject);
      req.end(payload ? JSON.stringify(payload) : undefined);
    });
  try {
    const current = auth.claim(auth.issue('Mac').ticket),
      ticket = auth.issue('Renew Mac');
    assert.equal((await call('/api/pairing/tickets', 'POST', current.token, { label: 'Forbidden' })).status, 403);
    assert.equal(
      (await call('/api/pairing/renew', 'POST', current.token, { ticket: ticket.ticket }, 'https://example.invalid'))
        .status,
      403,
    );
    assert.equal((await call('/api/pairing/renew', 'POST', undefined, { ticket: ticket.ticket })).status, 400);
    assert.equal(
      (await call('/api/pairing/renew', 'POST', current.token, { ticket: ticket.ticket, extra: true })).status,
      400,
    );
    const result = await call('/api/pairing/renew', 'POST', current.token, { ticket: ticket.ticket });
    assert.equal(result.status, 201);
    const next = result.value.token as string;
    assert.equal((await call('/api/status', 'GET', current.token)).status, 401);
    assert.equal((await call('/api/status', 'GET', next)).status, 200);
    assert.equal((await call('/api/reminders', 'POST', next, { title: 'No', due: '2099-01-01' })).status, 403);
    assert.equal((await call('/api/pairing/renew', 'POST', current.token, { ticket: ticket.ticket })).status, 400);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    auth.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
