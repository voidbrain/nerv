import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { makeServer } from '../src/server.ts';
import { Store } from '../src/store.ts';

// B-113 (owner 2026-11-23): an update restarts the service, and dashboard sessions lived only in memory, so every open
// dashboard was signed out mid-update. Sessions now survive a restart, stored hashed and bound to the admin token.
async function withServer<T>(dir: string, token: string, fn: (url: string) => Promise<T>): Promise<T> {
  const db = new DatabaseSync(join(dir, 'nerv.sqlite'));
  db.close();
  const store = new Store(join(dir, 'nerv.sqlite'));
  const server = makeServer(store, token, { sessionFile: join(dir, 'sessions.json') });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  }
}
const login = async (url: string, token: string) => {
  const code = (await (
    await fetch(url + '/api/session/codes', { method: 'POST', headers: { authorization: 'Bearer ' + token } })
  ).json()) as { code: string };
  const r = await fetch(url + '/api/session/exchange', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: code.code }),
  });
  return ((await r.json()) as { token: string }).token;
};
const status = async (url: string, session: string) =>
  (await fetch(url + '/api/doctor', { headers: { authorization: 'Bearer ' + session } })).status;

test('B-113: a dashboard session survives a restart, stored only as a hash in a private file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-b113-'));
  const token = 'a'.repeat(32);
  try {
    const session = await withServer(dir, token, async (url) => {
      const s = await login(url, token);
      assert.equal(await status(url, s), 200);
      return s;
    });
    const file = readFileSync(join(dir, 'sessions.json'), 'utf8');
    assert.ok(!file.includes(session), 'the raw session is never written');
    if (process.platform !== 'win32') assert.equal(statSync(join(dir, 'sessions.json')).mode & 0o777, 0o600);
    await withServer(dir, token, async (url) => assert.equal(await status(url, session), 200, 'after the restart'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('B-113: rotating the admin token or revoking ends stored sessions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-b113-'));
  const token = 'a'.repeat(32);
  try {
    const session = await withServer(dir, token, (url) => login(url, token));
    await withServer(dir, 'b'.repeat(32), async (url) => assert.equal(await status(url, session), 401, 'new token'));
    const again = await withServer(dir, token, (url) => login(url, token));
    await withServer(dir, token, async (url) => {
      await fetch(url + '/api/session/revoke', { method: 'POST', headers: { authorization: 'Bearer ' + token } });
      assert.equal(await status(url, again), 401, 'revoked');
    });
    await withServer(dir, token, async (url) =>
      assert.equal(await status(url, again), 401, 'still revoked after a restart'),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('B-113: after Update started the dashboard waits for the new revision before offering the button again', () => {
  const live = readFileSync(join('web', 'public', 'dashboard', 'live.js'), 'utf8');
  assert.match(live, /outcome === "started"\) void awaitRestart\(/);
  const fn = /async function awaitRestart\(revision\) \{[\s\S]*?\n {2}\}/.exec(live);
  assert.ok(fn, 'awaitRestart exists');
  assert.match(fn![0], /runningRevision === revision && !u\.restartRequired/);
  assert.match(fn![0], /state\.manualUpdateBusy = false/);
});

// B-113 review findings: persistence is best-effort and fails closed; loaded entries are clamped; the temp file is
// recreated private.
test('B-113: a failed write never throws, and a revoke it cannot save deletes the file instead', async () => {
  const { SessionBook } = await import('../src/session-book.ts');
  const { mkdirSync, existsSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'nerv-b113r-'));
  try {
    const file = join(dir, 'sessions.json');
    const token = () => 'c'.repeat(32);
    const book = new SessionBook(token, file, 60_000, 4);
    book.add('s1', Date.now() + 60_000, 4);
    mkdirSync(file + '.tmp'); // every later write fails (EISDIR)
    assert.doesNotThrow(() => book.add('s2', Date.now() + 60_000, 4));
    assert.doesNotThrow(() => book.dropExpired());
    assert.doesNotThrow(() => book.clear());
    assert.equal(existsSync(file), false, 'the unsaved revoke removed the file');
    assert.equal(new SessionBook(token, file, 60_000, 4).has('s1'), false, 'nothing comes back after a restart');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('B-113: loaded sessions are clamped to the lifetime and cap; a stale temp file never loosens permissions', async () => {
  const { SessionBook } = await import('../src/session-book.ts');
  const { writeFileSync } = await import('node:fs');
  const { createHash } = await import('node:crypto');
  const dir = mkdtempSync(join(tmpdir(), 'nerv-b113r-'));
  try {
    const file = join(dir, 'sessions.json');
    const tok = 'd'.repeat(32);
    const h = (s: string) => createHash('sha256').update(s).digest('hex');
    const far = Date.now() + 365 * 24 * 3600_000;
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        token: h(tok),
        sessions: [
          [h('a'), far],
          [h('b'), far],
          [h('c'), far],
        ],
      }),
    );
    writeFileSync(file + '.tmp', 'stale', { mode: 0o644 });
    const book = new SessionBook(() => tok, file, 50, 2);
    assert.equal(book.size, 2, 'trimmed to the cap');
    if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600, 'recreated private');
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(book.has('b') || book.has('c'), false, 'clamped to the lifetime, not a year');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
