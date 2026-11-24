import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DeviceBook, DEVICE_IDLE_MS, PairingCodes, PAIRING_CODE_TTL_MS } from '../src/device-book.ts';
import { initialize, readToken } from '../src/config.ts';
import { makeServer } from '../src/server.ts';
import { Store } from '../src/store.ts';

// F-118-T01 (owner 2026-11-23): a phone pairs once with a short code typed into the installed app. The device credential
// is stored hashed, lapses after 90 days without use (sliding), is revocable per device and ends with admin-token rotation;
// it has dashboard-session powers only.
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const CODE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;

const temp = () => mkdtempSync(join(tmpdir(), 'nerv-f118-'));

test('F-118-T01: a paired device is stored hashed in a private file and survives a restart', () => {
  const dir = temp();
  const file = join(dir, 'devices.json');
  let now = 1_000_000_000_000;
  const clock = () => now;
  const token = () => 'a'.repeat(32);
  try {
    const book = new DeviceBook(token, file, { now: clock });
    const paired = book.pair('Owner phone');
    assert.ok(paired && /^[a-f0-9]{64}$/.test(paired.credential));
    assert.equal(book.use(paired.credential), true);
    const raw = readFileSync(file, 'utf8');
    assert.ok(!raw.includes(paired.credential), 'the raw credential is never written');
    if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
    now += HOUR;
    const again = new DeviceBook(token, file, { now: clock });
    assert.equal(again.use(paired.credential), true, 'after a restart');
    assert.deepEqual(
      again.list().map((d) => [d.id, d.name, d.created]),
      [[paired.id, 'Owner phone', 1_000_000_000_000]],
    );
    assert.equal(again.use('b'.repeat(64)), false, 'an unknown credential');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('F-118-T01: the 90-day limit slides with use, and use is written at most once an hour', () => {
  const dir = temp();
  const file = join(dir, 'devices.json');
  let now = 1_000_000_000_000;
  const clock = () => now;
  const token = () => 'a'.repeat(32);
  try {
    const book = new DeviceBook(token, file, { now: clock });
    const { credential } = book.pair('Phone')!;
    const written = readFileSync(file, 'utf8');
    now += 10 * 60_000;
    assert.equal(book.use(credential), true);
    assert.equal(readFileSync(file, 'utf8'), written, 'a use within the hour is not written');
    now += DEVICE_IDLE_MS - HOUR;
    assert.equal(book.use(credential), true, 'used just before the limit');
    assert.notEqual(readFileSync(file, 'utf8'), written, 'that use is written');
    now += DEVICE_IDLE_MS - HOUR;
    assert.equal(
      new DeviceBook(token, file, { now: clock }).use(credential),
      true,
      'the limit counts from the last use, also after a restart',
    );
    now += DEVICE_IDLE_MS + 1;
    assert.equal(book.use(credential), false, '90 days unused');
    assert.equal(new DeviceBook(token, file, { now: clock }).list().length, 0, 'gone after a restart too');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('F-118-T01: revoke ends one device, rotation ends all; an unsaved revoke removes the file', () => {
  const dir = temp();
  const file = join(dir, 'devices.json');
  let admin = 'a'.repeat(32);
  const token = () => admin;
  try {
    const book = new DeviceBook(token, file);
    const phone = book.pair('Phone')!;
    const tablet = book.pair('Tablet')!;
    assert.equal(book.revoke(phone.id), true);
    assert.equal(book.revoke(phone.id), false, 'already revoked');
    assert.equal(book.use(phone.credential), false);
    assert.equal(book.use(tablet.credential), true);
    assert.equal(new DeviceBook(token, file).use(phone.credential), false, 'still revoked after a restart');
    // A revoke that cannot be written must not come back after a restart: the file goes instead.
    mkdirSync(file + '.tmp');
    assert.equal(book.revoke(tablet.id), true);
    assert.equal(existsSync(file), false);
    rmSync(file + '.tmp', { recursive: true });
    assert.equal(new DeviceBook(token, file).use(tablet.credential), false);
    const laptop = book.pair('Laptop')!;
    admin = 'b'.repeat(32);
    assert.equal(book.use(laptop.credential), false, 'rotated token');
    admin = 'a'.repeat(32);
    assert.equal(new DeviceBook(token, file).use(laptop.credential), false, 'rotation is final');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('F-118-T01: names are checked, the device count is capped and a bad file starts empty', () => {
  const dir = temp();
  const file = join(dir, 'devices.json');
  try {
    const book = new DeviceBook(() => 'a'.repeat(32), file, { max: 2 });
    assert.equal(book.pair(''), undefined);
    assert.equal(book.pair('x'.repeat(41)), undefined);
    assert.equal(book.pair('bad\u0000name'), undefined);
    assert.ok(book.pair('  Phone  '));
    assert.equal(book.list()[0]!.name, 'Phone');
    assert.ok(book.pair('Tablet'));
    assert.equal(book.pair('Third'), undefined, 'full: revoke one first');
    const broken = join(dir, 'broken.json');
    writeFileSync(broken, '{not json');
    assert.equal(new DeviceBook(() => 'a'.repeat(32), broken).list().length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('F-118-T01: a pairing code is 8 unambiguous characters, single use and valid 5 minutes', () => {
  let now = 1_000_000_000_000;
  const codes = new PairingCodes({ now: () => now });
  const a = codes.mint()!;
  assert.match(a.code, CODE);
  assert.equal(a.expiresInMs, PAIRING_CODE_TTL_MS);
  assert.equal(PAIRING_CODE_TTL_MS, 5 * 60_000);
  assert.equal(codes.take(a.code.toLowerCase().replace('-', ' '), 'phone'), 'ok', 'typed loosely');
  assert.equal(codes.take(a.code, 'phone'), 'invalid', 'single use');
  const b = codes.mint()!;
  now += PAIRING_CODE_TTL_MS;
  assert.equal(codes.take(b.code, 'phone'), 'invalid', 'expired');
  const seen = new Set(Array.from({ length: 3 }, () => codes.mint()!.code));
  assert.equal(seen.size, 3);
  assert.equal(codes.mint(), undefined, 'at most three unused codes');
});

test('F-118-T01: failed attempts are limited per client, then globally with a growing lockout', () => {
  let now = 1_000_000_000_000;
  const codes = new PairingCodes({ now: () => now });
  const good = codes.mint()!.code;
  for (let i = 0; i < 5; i++) assert.equal(codes.take('AAAA-AAAA', 'one'), 'invalid');
  const limited = codes.take(good, 'one');
  assert.equal(typeof limited, 'object', 'the sixth attempt in a minute is refused, even with the right code');
  assert.ok((limited as { retryAfterMs: number }).retryAfterMs > 0);
  assert.equal(codes.take(good, 'two'), 'ok', 'another client is not limited');
  now += 60_000;
  const next = codes.mint()!.code;
  // Twenty failures in a minute from many clients lock pairing for everyone, for longer each time.
  for (let i = 0; i < 20; i++) codes.take('AAAA-AAAA', 'c' + i);
  const first = codes.take(next, 'fresh') as { retryAfterMs: number };
  assert.equal(typeof first, 'object');
  now += first.retryAfterMs;
  for (let i = 0; i < 20; i++) codes.take('AAAA-AAAA', 'd' + i);
  const second = codes.take(next, 'fresh') as { retryAfterMs: number };
  assert.ok(second.retryAfterMs > first.retryAfterMs, 'the lockout grows');
  now += second.retryAfterMs;
  assert.equal(codes.take(next, 'fresh'), 'ok');
});

async function withServer<T>(
  dir: string,
  token: string | (() => string),
  fn: (url: string) => Promise<T>,
  clock?: () => number,
): Promise<T> {
  const store = new Store(join(dir, 'nerv.sqlite'));
  const server = makeServer(store, token, {
    sessionFile: join(dir, 'sessions.json'),
    deviceFile: join(dir, 'devices.json'),
    clock,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  }
}
const post = (url: string, bearer: string | undefined, value?: unknown) =>
  fetch(url, {
    method: 'POST',
    headers: {
      ...(bearer ? { authorization: 'Bearer ' + bearer } : {}),
      ...(value ? { 'content-type': 'application/json' } : {}),
    },
    body: value ? JSON.stringify(value) : undefined,
  });
const mint = async (url: string, token: string) =>
  ((await (await post(url + '/api/device/codes', token)).json()) as { code: string }).code;
const pair = (url: string, code: string, name = 'Phone') => post(url + '/api/device/pair', undefined, { code, name });
const doctor = async (url: string, bearer: string) =>
  (await fetch(url + '/api/doctor', { headers: { authorization: 'Bearer ' + bearer } })).status;

test('F-118-T01 join: pair, use, restart, list, revoke and rotation over HTTP', async () => {
  const dir = temp();
  let admin = 'a'.repeat(32);
  const token = () => admin;
  try {
    const device = await withServer(dir, token, async (url) => {
      const code = await mint(url, admin);
      assert.match(code, CODE);
      const r = await pair(url, code, 'Owner phone');
      assert.equal(r.status, 200);
      const value = (await r.json()) as { token: string; device: { id: string; name: string }; idleLimitMs: number };
      assert.equal(value.device.name, 'Owner phone');
      assert.equal(value.idleLimitMs, DEVICE_IDLE_MS);
      assert.equal((await pair(url, code)).status, 401, 'the code is single use');
      assert.equal(await doctor(url, value.token), 200);
      return value;
    });
    assert.ok(!readFileSync(join(dir, 'devices.json'), 'utf8').includes(device.token));
    await withServer(dir, token, async (url) => {
      assert.equal(await doctor(url, device.token), 200, 'after a restart');
      const list = (await (
        await fetch(url + '/api/devices', { headers: { authorization: 'Bearer ' + admin } })
      ).json()) as {
        devices: Record<string, unknown>[];
      };
      assert.deepEqual(Object.keys(list.devices[0]!).sort(), ['created', 'expires', 'id', 'lastUse', 'name']);
      const del = await fetch(url + '/api/devices/' + device.device.id, {
        method: 'DELETE',
        headers: { authorization: 'Bearer ' + admin },
      });
      assert.equal(del.status, 200);
      assert.equal(await doctor(url, device.token), 401, 'revoked');
      const other = (await (await pair(url, await mint(url, admin))).json()) as { token: string };
      admin = 'b'.repeat(32);
      assert.equal(await doctor(url, other.token), 401, 'admin token rotated');
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('F-118-T01 join: the limit slides with use across a restart', async () => {
  const dir = temp();
  const token = 'a'.repeat(32);
  let now = Date.now();
  const clock = () => now;
  try {
    const credential = await withServer(
      dir,
      token,
      async (url) => ((await (await pair(url, await mint(url, token))).json()) as { token: string }).token,
      clock,
    );
    now += DEVICE_IDLE_MS - DAY;
    await withServer(dir, token, async (url) => assert.equal(await doctor(url, credential), 200), clock);
    now += DEVICE_IDLE_MS - DAY;
    await withServer(dir, token, async (url) => assert.equal(await doctor(url, credential), 200, 'slid'), clock);
    now += DEVICE_IDLE_MS + 1;
    await withServer(dir, token, async (url) => assert.equal(await doctor(url, credential), 401, 'lapsed'), clock);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('F-118-T01 join: wrong, expired and too many codes are refused; a device has session powers only', async () => {
  const dir = temp();
  const token = 'a'.repeat(32);
  let now = Date.now();
  try {
    await withServer(
      dir,
      token,
      async (url) => {
        assert.equal((await pair(url, 'AAAA-AAAA')).status, 401, 'wrong code');
        assert.equal((await post(url + '/api/device/pair', undefined, { code: 'AAAA-AAAA', extra: 1 })).status, 400);
        const expired = await mint(url, token);
        now += PAIRING_CODE_TTL_MS;
        assert.equal((await pair(url, expired)).status, 401, 'expired');
        const good = await mint(url, token);
        assert.equal((await pair(url, good, '')).status, 400, 'a name is required');
        // The wrong code above is older than a minute now: four more plus the expired one make five.
        for (let i = 0; i < 4; i++) await pair(url, 'AAAA-AAAA');
        const limited = await pair(url, good);
        assert.equal(limited.status, 429, 'rate limited');
        assert.ok(Number(limited.headers.get('retry-after')) > 0);
        now += 60_000;
        const r = await pair(url, good);
        assert.equal(r.status, 200);
        const device = ((await r.json()) as { token: string }).token;
        assert.equal(await doctor(url, device), 200);
        for (const path of ['/api/device/codes', '/api/session/codes', '/api/session/revoke', '/api/stop'])
          assert.equal((await post(url + path, device)).status, 403, path);
        const list = await fetch(url + '/api/devices', { headers: { authorization: 'Bearer ' + device } });
        assert.equal(list.status, 403);
        const del = await fetch(url + '/api/devices/x', {
          method: 'DELETE',
          headers: { authorization: 'Bearer ' + device },
        });
        assert.equal(del.status, 403);
        // A dashboard session cannot mint pairing codes either.
        const login = (await (await post(url + '/api/session/codes', token)).json()) as { code: string };
        const session = (
          (await (await post(url + '/api/session/exchange', undefined, { code: login.code })).json()) as {
            token: string;
          }
        ).token;
        assert.equal((await post(url + '/api/device/codes', session)).status, 403);
      },
      () => now,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('F-118-T01 join: nerv open --phone prints a code the phone pairs with', async () => {
  const dir = temp();
  const home = join(dir, 'home');
  try {
    initialize(home);
    await withServer(
      dir,
      () => readToken(home),
      async (url) => {
        const port = new URL(url).port;
        const child = spawn(process.execPath, ['src/cli.ts', 'open', '--phone'], {
          cwd: process.cwd(),
          // HOME too, so the lifecycle guard never looks at the real service.
          env: { ...process.env, NERV_HOME: home, NERV_PORT: port, NERV_TOKEN: undefined, HOME: dir, USERPROFILE: dir },
        });
        let out = '';
        let err = '';
        child.stdout.on('data', (c: Buffer) => (out += c.toString()));
        child.stderr.on('data', (c: Buffer) => (err += c.toString()));
        const status = await new Promise<number | null>((done) => child.on('close', done));
        assert.equal(status, 0, err);
        const code = /\b([A-Z2-9]{4}-[A-Z2-9]{4})\b/.exec(out)?.[1];
        assert.ok(code && CODE.test(code), out);
        assert.match(out, new RegExp(`http://127\\.0\\.0\\.1:${port}/`));
        assert.equal((await pair(url, code)).status, 200);
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Review of PR #700 (2026-11-24): codes end with a rotated admin token, the lockout level decays after a quiet
// period, and only JSON (which a cross-origin page cannot send without a preflight) may spend the failure budget.
test('F-118-T01 review: pending pairing codes end when the admin token rotates', () => {
  let admin = 'a'.repeat(32);
  const codes = new PairingCodes({ token: () => admin });
  const code = codes.mint()!.code;
  admin = 'b'.repeat(32);
  assert.equal(codes.take(code, 'phone'), 'invalid', 'minted with the old token');
  const fresh = codes.mint()!.code;
  assert.equal(codes.take(fresh, 'phone'), 'ok', 'a code minted with the new token works');
});

test('F-118-T01 review: the lockout level resets after a quiet period', () => {
  let now = 1_000_000_000_000;
  const codes = new PairingCodes({ now: () => now });
  for (let i = 0; i < 20; i++) codes.take('AAAA-AAAA', 'c' + i);
  const first = codes.take('AAAA-AAAA', 'x') as { retryAfterMs: number };
  assert.equal(first.retryAfterMs, 60_000);
  // The lockout ends, then as long again with no failure: the next lockout starts from one minute again.
  now += first.retryAfterMs + 60_000;
  for (let i = 0; i < 20; i++) codes.take('AAAA-AAAA', 'd' + i);
  assert.deepEqual(codes.take('AAAA-AAAA', 'y'), { retryAfterMs: 60_000 });
});

test('F-118-T01 review join: rotation ends pending pairing and login codes; only JSON is accepted', async () => {
  const dir = temp();
  let admin = 'a'.repeat(32);
  try {
    await withServer(
      dir,
      () => admin,
      async (url) => {
        const pairingCode = await mint(url, admin);
        const login = ((await (await post(url + '/api/session/codes', admin)).json()) as { code: string }).code;
        admin = 'b'.repeat(32);
        assert.equal((await pair(url, pairingCode)).status, 401, 'pairing code minted with the old token');
        const exchanged = await post(url + '/api/session/exchange', undefined, { code: login });
        assert.equal(exchanged.status, 401, 'login code minted with the old token');
        // A page on any origin can POST text/plain without a preflight; it is refused and spends no attempt.
        const good = await mint(url, admin);
        for (let i = 0; i < 6; i++) {
          const r = await fetch(url + '/api/device/pair', {
            method: 'POST',
            headers: { 'content-type': 'text/plain' },
            body: JSON.stringify({ code: 'AAAA-AAAA', name: 'Phone' }),
          });
          assert.equal(r.status, 415);
        }
        const plain = await fetch(url + '/api/session/exchange', {
          method: 'POST',
          headers: { 'content-type': 'text/plain' },
          body: JSON.stringify({ code: 'x' }),
        });
        assert.equal(plain.status, 415);
        assert.equal((await pair(url, good)).status, 200, 'the budget is intact');
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
