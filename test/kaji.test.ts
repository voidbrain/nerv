import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POSIX, assertPrivateFile } from './fixtures/posix.ts';
import { mkdtempSync, rmSync, readFileSync, statSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import {
  Registry,
  createRootKey,
  enrolmentArgs,
  fingerprint,
  signRecord,
  unlockRootKey,
  verifyRecord,
  type RegistryBody,
} from '../src/kaji.ts';
const pub = () => generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const enrol = (
  serial: number,
  baseId: string,
  publicKey: string,
  name = 'Base',
  address = '100.64.0.9',
): RegistryBody => ({ kind: 'enrol', serial, baseId, name, publicKey, address, issued: '2030-01-01T00:00:00.000Z' });
test('the Key of Nebuchadnezzar: passphrase-encrypted, wrong passphrases refused, records signed and verified, tampering detected', () => {
  assert.throws(() => createRootKey('short'), /12 characters/);
  const k = createRootKey('correct horse battery');
  assert.doesNotMatch(k.file, /PRIVATE KEY/);
  assert.throws(() => unlockRootKey(k.file, 'wrong passphrase!!'), /Wrong passphrase/);
  const root = unlockRootKey(k.file, 'correct horse battery');
  assert.equal(root.publicKey, k.publicKey);
  assert.match(fingerprint(k.publicKey), /^[0-9a-f]{4}(-[0-9a-f]{4}){7}$/);
  const rec = signRecord(root.privateKey, enrol(1, 'NERV-02', pub()));
  assert.equal(verifyRecord(k.publicKey, rec), true);
  assert.equal(
    verifyRecord(k.publicKey, { ...rec, body: { ...rec.body, address: '100.64.0.66' } }),
    false,
    'a changed field breaks the signature',
  );
  assert.equal(
    verifyRecord(createRootKey('another passphrase').publicKey, rec),
    false,
    'another root does not verify it',
  );
});
test('the registry: only records signed by the pinned root, append-only, newest enrolment wins, revocation always wins', () => {
  const k = createRootKey('correct horse battery');
  const root = unlockRootKey(k.file, 'correct horse battery');
  const store = new Store(':memory:');
  try {
    assert.throws(
      () => new Registry(store.db).add(signRecord(root.privateKey, enrol(1, 'NERV-01', pub()))),
      /No root key pinned/,
    );
    const reg = new Registry(store.db, k.publicKey);
    const tabgha = pub();
    assert.equal(reg.add(signRecord(root.privateKey, enrol(1, 'NERV-01', pub(), 'Neo Tokyo-3'))), 'added');
    const first = signRecord(root.privateKey, enrol(2, 'NERV-02', tabgha, 'Tabgha'));
    assert.equal(reg.add(first), 'added');
    assert.equal(reg.add(first), 'known');
    assert.equal(reg.nextSerial(), 3);
    reg.add(signRecord(root.privateKey, enrol(3, 'NERV-02', tabgha, 'Tabgha', '100.64.0.20')));
    assert.equal(reg.bases().find((b) => b.baseId === 'NERV-02')!.address, '100.64.0.20', 'newest enrolment wins');
    reg.add(
      signRecord(root.privateKey, {
        kind: 'revoke',
        serial: 4,
        baseId: 'NERV-02',
        publicKey: tabgha,
        issued: '2030-01-02T00:00:00.000Z',
      }),
    );
    reg.add(signRecord(root.privateKey, enrol(5, 'NERV-02', tabgha, 'Tabgha', '100.64.0.21')));
    assert.equal(
      reg.bases().find((b) => b.baseId === 'NERV-02')!.status,
      'revoked',
      'a revoked key stays revoked, even re-enrolled later',
    );
    reg.add(signRecord(root.privateKey, enrol(6, 'NERV-02', pub(), 'Tabgha')));
    assert.equal(reg.bases().find((b) => b.baseId === 'NERV-02')!.status, 'enrolled', 'a new base key can be enrolled');
    const forged = signRecord(
      unlockRootKey(createRootKey('attacker passphrase').file, 'attacker passphrase').privateKey,
      enrol(7, 'EVIL-01', pub()),
    );
    assert.throws(() => reg.add(forged), /not signed by your Key of Nebuchadnezzar/);
    for (const bad of [
      { ...enrol(8, 'nerv 1', pub()) },
      { ...enrol(8, 'NERV-09', pub()), address: 'not an address!' },
      { ...enrol(8, 'NERV-09', 'x') },
      { kind: 'promote', serial: 8, baseId: 'NERV-09', issued: '2030-01-01T00:00:00Z' } as unknown as RegistryBody,
    ])
      assert.throws(() => reg.add(signRecord(root.privateKey, bad)), JSON.stringify(bad).slice(0, 40));
    assert.throws(() => store.db.prepare("UPDATE registry SET kind='revoke'").run(), /append-only/);
  } finally {
    store.close();
  }
});
test('two bases from the CLI: key init, enrol both, export, import pinned by fingerprint, revoke', () => {
  const a = mkdtempSync(join(tmpdir(), 'nerv-kaji-a-')),
    b = mkdtempSync(join(tmpdir(), 'nerv-kaji-b-'));
  const cli = (home: string, args: string[], input?: string) =>
    spawnSync(process.execPath, ['src/cli.ts', ...args], {
      env: { ...process.env, NERV_HOME: home, NERV_OLLAMA: 'http://127.0.0.1:9' },
      encoding: 'utf8',
      ...(input !== undefined ? { input } : {}),
    });
  const pass = 'a long test passphrase\n';
  try {
    assert.equal(cli(a, ['init', '--base', 'NERV-01', '--name', 'Neo Tokyo-3']).status, 0);
    assert.equal(cli(b, ['init', '--base', 'NERV-02', '--name', 'Tabgha']).status, 0);
    const made = cli(a, ['key', 'init', '--passphrase-stdin'], pass);
    assert.equal(made.status, 0, made.stderr);
    const fp = /Root fingerprint: (\S+)/.exec(made.stdout)![1]!;
    const keyFile = join(a, 'key-of-nebuchadnezzar.enc');
    assertPrivateFile(keyFile);
    assert.doesNotMatch(readFileSync(keyFile, 'utf8'), /PRIVATE KEY/);
    assert.match(cli(a, ['key', 'init', '--passphrase-stdin'], pass).stderr, /never overwritten/);
    assert.equal(
      cli(a, ['kaji', 'enrol', 'NERV-01', 'Neo Tokyo-3', 'self', '100.64.0.1', '--passphrase-stdin'], pass).status,
      0,
    );
    const tabghaKey = cli(b, ['base', 'pubkey']).stdout.split('\n')[0]!;
    assert.ok(existsSync(join(b, 'base-key')));
    assertPrivateFile(join(b, 'base-key'));
    assert.match(
      cli(
        a,
        ['kaji', 'enrol', 'NERV-02', 'Tabgha', tabghaKey, '100.64.0.2', '--passphrase-stdin'],
        'wrong passphrase here\n',
      ).stderr,
      /Wrong passphrase/,
    );
    assert.equal(
      cli(a, ['kaji', 'enrol', 'NERV-02', 'Tabgha', tabghaKey, '100.64.0.2', '--passphrase-stdin'], pass).status,
      0,
    );
    const bundle = join(a, 'bundle.json');
    assert.match(cli(a, ['kaji', 'export', bundle]).stdout, /2 signed record/);
    const wrong = cli(b, ['kaji', 'import', bundle, '--root', '0000-0000-0000-0000-0000-0000-0000-0000']).stderr;
    assert.match(
      wrong,
      /does not match the one this file was signed with/,
      'no trust on first use: the fingerprint is checked',
    );
    assert.ok(!wrong.includes(fp), "the file's fingerprint is never printed");
    const own = /Fingerprint: (\S+)/.exec(cli(b, ['base', 'pubkey']).stdout)![1]!;
    assert.match(cli(b, ['kaji', 'import', bundle, '--root', own]).stderr, /That is this base's own fingerprint/);
    assert.match(
      cli(b, ['kaji', 'import', bundle]).stderr,
      /Give --root with the root fingerprint: the "Root …" line of nerv kaji list/,
    );
    assert.match(
      cli(b, ['kaji', 'import', bundle, '--root', fp]).stdout,
      /Imported 2 new record.*2 base\(s\) enrolled/,
    );
    const listed = cli(b, ['kaji', 'list']).stdout;
    assert.match(listed, new RegExp(`Root ${fp}`));
    assert.match(listed, /NERV-01\s+Neo Tokyo-3\s+100\.64\.0\.1\s+enrolled\n/);
    assert.match(listed, /NERV-02\s+Tabgha\s+100\.64\.0\.2\s+enrolled {2}\(this base\)/);
    assert.equal(cli(a, ['kaji', 'revoke', 'NERV-02', '--passphrase-stdin'], pass).status, 0);
    cli(a, ['kaji', 'export', bundle]);
    assert.match(cli(b, ['kaji', 'import', bundle]).stdout, /Imported 1 new record/);
    assert.match(cli(b, ['kaji', 'list']).stdout, /NERV-02.*revoked/);
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});
test('kaji enrol arguments: key and address in either order, each mistake named, all checked before the passphrase', () => {
  const key = pub(),
    me = pub();
  assert.deepEqual(enrolmentArgs('nerv-02', 'Tabgha', key, '100.64.44.94', me), {
    baseId: 'NERV-02',
    name: 'Tabgha',
    publicKey: key,
    address: '100.64.44.94',
  });
  assert.deepEqual(
    enrolmentArgs('NERV-02', 'Tabgha', '100.64.44.94', key, me),
    { baseId: 'NERV-02', name: 'Tabgha', publicKey: key, address: '100.64.44.94' },
    "the owner's swapped order works",
  );
  assert.equal(enrolmentArgs('NERV-01', 'Neo Tokyo-3', 'self', '100.64.0.1', me).publicKey, me);
  assert.throws(() => enrolmentArgs('NERV 2', 'Tabgha', key, '100.64.0.2', me), /must look like NERV-02/);
  assert.throws(
    () => enrolmentArgs('NERV-02', 'Tabgha', '100.64.0.2', '100.64.0.3', me),
    /is a base public key: on that base run nerv base pubkey/,
  );
  assert.throws(
    () => enrolmentArgs('NERV-02', 'Tabgha', key, 'not an address!', me),
    /is not an address: use the base's Tailscale address/,
  );
  assert.throws(() => enrolmentArgs('NERV-02', 'Tabgha', key, undefined, me), /Usage: kaji enrol/);
  const home = mkdtempSync(join(tmpdir(), 'nerv-enrol-'));
  try {
    const cli = (a: string[], input?: string) =>
      spawnSync(process.execPath, ['src/cli.ts', ...a], {
        env: { ...process.env, NERV_HOME: home, NERV_OLLAMA: 'http://127.0.0.1:9' },
        encoding: 'utf8',
        ...(input !== undefined ? { input } : {}),
      });
    cli(['init']);
    cli(['key', 'init', '--passphrase-stdin'], 'a long test passphrase\n');
    const bad = cli(['kaji', 'enrol', 'NERV-02', 'Tabgha', '100.64.0.2', 'also-not-a-key', '--passphrase-stdin'], '');
    assert.match(bad.stderr, /is a base public key/);
    assert.doesNotMatch(bad.stderr, /Wrong passphrase/, 'refused before any passphrase is read');
    assert.match(
      cli(['kaji', 'enrol', 'NERV-02', 'Tabgha', '100.64.44.94', key, '--passphrase-stdin'], 'a long test passphrase\n')
        .stdout,
      /Enrolled NERV-02 · Tabgha at 100\.64\.44\.94/,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
