import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PairingCodes, PAIRING_CODE_TTL_MS, QR_PAIRING_CODE_TTL_MS } from '../src/device-book.ts';
import { initialize, readToken } from '../src/config.ts';
import { pairingBase, pairingLink, qrRows, tailscaleBase, terminalQr, type QrEncoder } from '../src/pairing-qr.ts';
import { makeServer } from '../src/server.ts';
import { Store } from '../src/store.ts';

// F-118-T05 (owner 2026-11-24): `nerv open --phone --qr` and Settings → Pair a device show a QR of the dashboard's
// address with the pairing code in the URL fragment. Safari shows the code and never pairs; the installed app takes it.
const MINUTE = 60_000;
const CODE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;
const temp = () => mkdtempSync(join(tmpdir(), 'nerv-f118-t05-'));

/** A test double for the vendored encoder: a 21×21 matrix derived from the text, and the texts it was given. */
export function fakeEncoder(): QrEncoder & { texts: string[] } {
  const texts: string[] = [];
  const encode = ((text: string) => {
    texts.push(text);
    return Array.from({ length: 21 }, (_, y) =>
      Array.from({ length: 21 }, (_, x) => (text.charCodeAt((x + y * 21) % text.length) + x + y) % 3 === 0),
    );
  }) as QrEncoder & { texts: string[] };
  encode.texts = texts;
  return encode;
}

test('F-118-T05: the link carries the code and its expiry only in the fragment', () => {
  const link = pairingLink('https://base.tailnet-fixture.ts.net/some/path?x=1', 'ABCD-EFGH', 1_700_000_600_000);
  assert.equal(link, 'https://base.tailnet-fixture.ts.net/dashboard/#pair=ABCD-EFGH&until=1700000600000');
  const url = new URL(link);
  assert.equal(url.search, '', 'nothing in the query');
  assert.ok(!url.pathname.includes('ABCD'), 'nothing in the path');
  assert.equal(pairingBase('javascript:alert(1)'), undefined);
  assert.equal(pairingBase('https://user:pw@host.example'), undefined);
  assert.equal(pairingBase(42), undefined);
  assert.throws(() => pairingLink('ftp://host.example', 'ABCD-EFGH', 1));
});

test('F-118-T05: a terminal QR draws the matrix with a light quiet zone, two rows per line', () => {
  const rows = qrRows([
    [true, false],
    [false, true],
  ]);
  assert.deepEqual(rows, ['10', '01']);
  const lines = terminalQr(rows).split('\n');
  // 2 modules + 2 × 2 quiet = 6 rows → 3 lines of 6 columns.
  assert.equal(lines.length, 3);
  assert.ok(lines.every((l) => [...l].length === 6));
  assert.equal(lines[0], '██████', 'quiet zone is light');
  assert.equal(lines[1], '██▄▀██', 'matrix row 1 (dark, light) over row 2 (light, dark)');
  assert.equal(lines[2], '██████', 'quiet zone below');
  assert.throws(() => qrRows([[true], [false, true]]));
});

test('F-118-T05: the tailnet address comes from tailscale status', () => {
  assert.equal(
    tailscaleBase({ Self: { DNSName: 'Base-One.tailnet-fixture.ts.net.' } }),
    'https://base-one.tailnet-fixture.ts.net',
  );
  assert.equal(tailscaleBase({ Self: { DNSName: '' } }), undefined);
  assert.equal(tailscaleBase(null), undefined);
});

test('F-118-T05: a QR code lasts 10 minutes, a typed one 5; both single use', () => {
  let now = 1_000_000_000_000;
  const codes = new PairingCodes({ now: () => now });
  assert.equal(QR_PAIRING_CODE_TTL_MS, 10 * MINUTE);
  const typed = codes.mint()!;
  const scanned = codes.mint(QR_PAIRING_CODE_TTL_MS)!;
  assert.equal(typed.expiresInMs, PAIRING_CODE_TTL_MS);
  assert.equal(scanned.expiresInMs, 10 * MINUTE);
  assert.equal(scanned.expiresAt, now + 10 * MINUTE);
  now += 9 * MINUTE;
  assert.equal(codes.take(typed.code, 'a'), 'invalid', 'the 5-minute code expired');
  assert.equal(codes.take(scanned.code, 'a'), 'ok', 'the QR code still works after 9 minutes');
  assert.equal(codes.take(scanned.code, 'a'), 'invalid', 'once');
  const late = codes.mint(QR_PAIRING_CODE_TTL_MS)!;
  now += 10 * MINUTE;
  assert.equal(codes.take(late.code, 'b'), 'invalid', 'not after 10 minutes');
});

async function withServer(
  dir: string,
  token: string,
  encoder: QrEncoder,
  fn: (url: string) => Promise<void>,
  clock?: () => number,
) {
  const store = new Store(join(dir, 'nerv.sqlite'));
  const server = makeServer(store, token, { deviceFile: join(dir, 'devices.json'), clock, qrEncoder: encoder });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await fn(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
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
const pair = (url: string, code: string) => post(url + '/api/device/pair', undefined, { code, name: 'Fixture phone' });

test('F-118-T05 join: nerv open --phone --qr prints a QR of the fragment link and the code; the code pairs', async () => {
  const dir = temp();
  const home = join(dir, 'home');
  let now = Date.now();
  const encoder = fakeEncoder();
  try {
    initialize(home);
    await withServer(
      dir,
      readToken(home),
      encoder,
      async (url) => {
        const port = new URL(url).port;
        const child = spawn(
          process.execPath,
          ['src/cli.ts', 'open', '--phone', '--qr', '--url', 'https://base.tailnet-fixture.ts.net'],
          {
            cwd: process.cwd(),
            env: {
              ...process.env,
              NERV_HOME: home,
              NERV_PORT: port,
              NERV_TOKEN: undefined,
              HOME: dir,
              USERPROFILE: dir,
            },
          },
        );
        let out = '';
        let err = '';
        child.stdout.on('data', (c: Buffer) => (out += c.toString()));
        child.stderr.on('data', (c: Buffer) => (err += c.toString()));
        const status = await new Promise<number | null>((done) => child.on('close', done));
        assert.equal(status, 0, err);
        const code = /Pairing code: ([A-Z2-9]{4}-[A-Z2-9]{4})/.exec(out)?.[1];
        assert.ok(code && CODE.test(code), out);
        assert.match(out, /valid 10 minutes/);
        assert.equal(encoder.texts.length, 1, 'the server encoded one link');
        const link = encoder.texts[0]!;
        assert.match(
          link,
          new RegExp(`^https://base\\.tailnet-fixture\\.ts\\.net/dashboard/#pair=${code}&until=\\d+$`),
        );
        assert.ok(out.includes(link), 'the link is printed too');
        // The QR block: 21 modules + quiet zone = 25 columns, 13 lines of half blocks.
        const block = out.split('\n').filter((l) => /^[█▀▄ ]{25}$/.test(l));
        assert.equal(block.length, 13, out);
        assert.match(out, /Home Screen/);
        // The code is not spent by minting or printing; it pairs once, still after 9 minutes.
        now += 9 * MINUTE;
        assert.equal((await pair(url, code)).status, 200);
        assert.equal((await pair(url, code)).status, 401);
      },
      () => now,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('F-118-T05 join: Settings (a dashboard session) mints a QR code; a paired device cannot; no encoder, no QR', async () => {
  const dir = temp();
  const admin = 'a'.repeat(32);
  const encoder = fakeEncoder();
  try {
    await withServer(dir, admin, encoder, async (url) => {
      const login = (await (await post(url + '/api/session/codes', admin)).json()) as { code: string };
      const session = (
        (await (await post(url + '/api/session/exchange', undefined, { code: login.code })).json()) as { token: string }
      ).token;
      const r = await post(url + '/api/device/codes', session, { base: 'https://base.tailnet-fixture.ts.net' });
      assert.equal(r.status, 201);
      const minted = (await r.json()) as {
        code: string;
        expiresInMs: number;
        expiresAt: number;
        link: string;
        qr: string[];
      };
      assert.match(minted.code, CODE);
      assert.equal(minted.expiresInMs, 10 * MINUTE);
      assert.equal(
        minted.link,
        `https://base.tailnet-fixture.ts.net/dashboard/#pair=${minted.code}&until=${minted.expiresAt}`,
      );
      assert.equal(minted.qr.length, 21);
      assert.ok(minted.qr.every((row) => /^[01]{21}$/.test(row)));
      // A bad address is refused before a code is minted.
      assert.equal((await post(url + '/api/device/codes', session, { base: 'javascript:alert(1)' })).status, 400);
      assert.equal((await post(url + '/api/device/codes', session, { base: 'https://x.test', extra: 1 })).status, 400);
      // A paired device cannot mint (a stolen phone cannot pair more devices).
      const device = ((await (await pair(url, minted.code)).json()) as { token: string }).token;
      assert.equal((await post(url + '/api/device/codes', device, { base: 'https://x.test' })).status, 403);
    });
    // Without an encoder the code and link still come back, with the reason there is no QR.
    await withServer(
      dir,
      admin,
      () => {
        throw new Error('No QR encoder.');
      },
      async (url) => {
        const r = await post(url + '/api/device/codes', admin, { base: 'https://base.tailnet-fixture.ts.net' });
        assert.equal(r.status, 201);
        const minted = (await r.json()) as { code: string; link: string; qr?: string[]; qrError?: string };
        assert.match(minted.code, CODE);
        assert.ok(minted.link.includes('#pair='));
        assert.equal(minted.qr, undefined);
        assert.match(minted.qrError ?? '', /encoder/);
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
