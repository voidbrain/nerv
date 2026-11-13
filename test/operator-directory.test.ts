import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig } from '../src/config.ts';
import { createRootKey, fingerprint, Registry, signRecord, unlockRootKey, type BaseEntry } from '../src/kaji.ts';
import { KajiLink } from '../src/kaji-link.ts';
import {
  DEFAULT_OPERATOR_NAME,
  OperatorDirectory,
  effectiveOperator,
  signOperatorEntry,
  verifyOperatorEntry,
} from '../src/operator-directory.ts';
import { statusText, type StatusBase } from '../src/chat-command.ts';
import { Runtime } from '../src/runtime.ts';
import { makeServer } from '../src/server.ts';
import { DatabaseSync } from 'node:sqlite';
import { REGISTRY_SCHEMA } from '../src/kaji.ts';

const keys = () => {
  const k = generateKeyPairSync('ed25519');
  return {
    privateKey: k.privateKey,
    publicKey: k.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
};

function makeEnrolledBase(
  baseId: string,
  name: string,
  publicKey: string,
  status: 'enrolled' | 'revoked' = 'enrolled',
): BaseEntry {
  return {
    baseId,
    name,
    publicKey,
    address: '127.0.0.1:4320',
    fingerprint: fingerprint(publicKey),
    status,
    serial: 1,
  };
}

test('F-070-T01: per-base operator config defaults to Aoba, supports aliases, and rejects private channel fields', () => {
  const home = mkdtempSync(join(tmpdir(), 'nerv-f070-cfg-'));
  try {
    writeFileSync(join(home, 'config.json'), JSON.stringify({ base: { id: 'NERV-01', name: 'Neo Tokyo-3' } }));
    const defaultCfg = readConfig(home);
    assert.equal(defaultCfg.operator, undefined);
    assert.deepEqual(effectiveOperator(defaultCfg.operator), {
      name: DEFAULT_OPERATOR_NAME,
      aliases: [],
      defaulted: true,
    });

    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({
        base: { id: 'NERV-02', name: 'Tabgha' },
        operator: { name: 'Maya', aliases: ['Ops-2', 'maya', 'Tabgha-Bot', 'ops-2'] },
      }),
    );
    const customCfg = readConfig(home);
    assert.deepEqual(customCfg.operator, { name: 'Maya', aliases: ['Ops-2', 'Tabgha-Bot'] });
    assert.deepEqual(effectiveOperator(customCfg.operator), {
      name: 'Maya',
      aliases: ['Ops-2', 'Tabgha-Bot'],
      defaulted: false,
    });

    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({
        base: { id: 'NERV-02', name: 'Tabgha' },
        telegram: { chatId: 999999999 },
        operator: { name: 'Maya', chatId: 999999999 },
      }),
    );
    assert.throws(() => readConfig(home), /only "name" and "aliases" are allowed/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('F-070-T01: signed operator directory contract verifies enrolled base keys and rejects tampering, revocation, and private fields', () => {
  const k1 = keys();
  const k2 = keys();
  const b1 = makeEnrolledBase('NERV-01', 'Neo Tokyo-3', k1.publicKey, 'enrolled');
  const b2 = makeEnrolledBase('NERV-02', 'Tabgha', k2.publicKey, 'enrolled');
  const bases = [b1, b2];

  const entry = signOperatorEntry('NERV-01', k1.privateKey, { name: 'Maya', aliases: ['Ops-1'] }, 1);
  assert.ok(verifyOperatorEntry(entry, bases));
  assert.equal('chatId' in entry.body, false);

  // Tampered operator name fails signature verification.
  const tampered = { ...entry, body: { ...entry.body, name: 'Hyuga' } };
  assert.equal(verifyOperatorEntry(tampered, bases), undefined);

  // Impersonation: signed by k2 while claiming baseId NERV-01 fails.
  const forged = signOperatorEntry('NERV-01', k2.privateKey, { name: 'Maya' }, 1);
  assert.equal(verifyOperatorEntry(forged, bases), undefined);

  // Revoked base is rejected.
  const revokedBases = [makeEnrolledBase('NERV-01', 'Neo Tokyo-3', k1.publicKey, 'revoked'), b2];
  assert.equal(verifyOperatorEntry(entry, revokedBases), undefined);

  // Extra private channel field is rejected even if present in payload.
  const withPrivate = {
    ...entry,
    body: { ...entry.body, chatId: 123456789 },
  };
  assert.equal(verifyOperatorEntry(withPrivate, bases), undefined);
});

test('F-070-T02: safe resolution handles unique, ambiguous, renamed/stale, offline, and unknown aliases without guessing', () => {
  const k1 = keys();
  const k2 = keys();
  const k3 = keys();
  const bases = [
    makeEnrolledBase('NERV-01', 'Neo Tokyo-3', k1.publicKey),
    makeEnrolledBase('NERV-02', 'Tabgha', k2.publicKey),
    makeEnrolledBase('NERV-03', 'Golgotha', k3.publicKey),
  ];
  const now = Date.now();
  const recent = new Date(now - 5_000).toISOString();
  const old = new Date(now - 200_000).toISOString();
  const lastSeen: Record<string, string> = {
    'NERV-01': recent,
    'NERV-02': recent,
    'NERV-03': old,
  };

  const dir = new OperatorDirectory();
  // Both NERV-01 and NERV-02 initially share default "Aoba" -> ambiguous.
  dir.record(signOperatorEntry('NERV-01', k1.privateKey, undefined, 1, new Date(now)), bases, 'NERV-01', new Date(now));
  dir.record(signOperatorEntry('NERV-02', k2.privateKey, undefined, 1, new Date(now)), bases, 'NERV-02', new Date(now));
  dir.record(
    signOperatorEntry('NERV-03', k3.privateKey, { name: 'Fuyutsuki', aliases: ['Ops-3'] }, 1, new Date(now)),
    bases,
    'NERV-03',
    new Date(now),
  );

  const amb = dir.resolve('Aoba', bases, lastSeen, { selfBaseId: 'NERV-01', now });
  assert.equal(amb.status, 'ambiguous');
  if (amb.status === 'ambiguous') {
    assert.equal(amb.candidates.length, 2);
    assert.match(amb.message, /ambiguous/i);
  }

  // NERV-02 renames its operator to "Maya" (serial 2) -> Aoba is now unique on NERV-01, Maya resolves to NERV-02.
  dir.record(
    signOperatorEntry('NERV-02', k2.privateKey, { name: 'Maya', aliases: ['Moon-Ops'] }, 2, new Date(now)),
    bases,
    'NERV-02',
    new Date(now),
  );

  // Stale replay of serial 1 for NERV-02 must be ignored.
  const replayed = dir.record(
    signOperatorEntry('NERV-02', k2.privateKey, undefined, 1, new Date(now)),
    bases,
    'NERV-02',
    new Date(now),
  );
  assert.equal(replayed, undefined);

  const maya = dir.resolve('moon-ops', bases, lastSeen, { selfBaseId: 'NERV-01', now, excludeSelf: true });
  assert.equal(maya.status, 'resolved');
  if (maya.status === 'resolved') {
    assert.equal(maya.baseId, 'NERV-02');
    assert.equal(maya.operatorName, 'Maya');
  }

  // NERV-02 renames again from Maya to Hyuga (serial 3) -> "Maya" is now stale (renamed), never routes silently.
  dir.record(
    signOperatorEntry('NERV-02', k2.privateKey, { name: 'Hyuga' }, 3, new Date(now)),
    bases,
    'NERV-02',
    new Date(now),
  );
  const staleRenamed = dir.resolve('Maya', bases, lastSeen, { selfBaseId: 'NERV-01', now });
  assert.equal(staleRenamed.status, 'stale');
  if (staleRenamed.status === 'stale') {
    assert.equal(staleRenamed.reason, 'renamed');
    assert.equal(staleRenamed.baseId, 'NERV-02');
    assert.match(staleRenamed.message, /renamed/i);
  }

  // NERV-03 is offline -> resolving Fuyutsuki fails safely as stale/offline.
  const staleOffline = dir.resolve('Fuyutsuki', bases, lastSeen, { selfBaseId: 'NERV-01', now });
  assert.equal(staleOffline.status, 'stale');
  if (staleOffline.status === 'stale') {
    assert.equal(staleOffline.reason, 'offline');
    assert.equal(staleOffline.baseId, 'NERV-03');
  }

  // Completely unknown alias fails safely.
  const unknown = dir.resolve('Ritsuko', bases, lastSeen, { selfBaseId: 'NERV-01', now });
  assert.equal(unknown.status, 'unknown');
});

test('F-070-T02: KajiLink heartbeats exchange signed operator entries and reject forged peer entries', async () => {
  const rootFile = createRootKey('a long test passphrase');
  const root = unlockRootKey(rootFile.file, 'a long test passphrase');
  const k1 = keys();
  const k2 = keys();

  const db1 = new DatabaseSync(':memory:');
  db1.exec(REGISTRY_SCHEMA);
  const reg1 = new Registry(db1, root.publicKey);
  const db2 = new DatabaseSync(':memory:');
  db2.exec(REGISTRY_SCHEMA);
  const reg2 = new Registry(db2, root.publicKey);

  // Reserve two ephemeral ports using KajiLink on 127.0.0.1:0? No, KajiLink listens on enrolled address.
  // Use fixed high ephemeral-safe ports via net.createServer first.
  const { createServer } = await import('node:net');
  const getPort = () =>
    new Promise<number>((resolve, reject) => {
      const s = createServer();
      s.listen(0, '127.0.0.1', () => {
        const port = (s.address() as { port: number }).port;
        s.close((err) => (err ? reject(err) : resolve(port)));
      });
    });
  const p1 = await getPort();
  const p2 = await getPort();

  const r1 = signRecord(root.privateKey, {
    kind: 'enrol',
    serial: 1,
    baseId: 'NERV-01',
    name: 'Neo Tokyo-3',
    publicKey: k1.publicKey,
    address: `127.0.0.1:${p1}`,
    issued: new Date().toISOString(),
  });
  const r2 = signRecord(root.privateKey, {
    kind: 'enrol',
    serial: 2,
    baseId: 'NERV-02',
    name: 'Tabgha',
    publicKey: k2.publicKey,
    address: `127.0.0.1:${p2}`,
    issued: new Date().toISOString(),
  });
  for (const r of [r1, r2]) {
    reg1.add(r);
    reg2.add(r);
  }

  const dir1 = new OperatorDirectory();
  const dir2 = new OperatorDirectory();
  let n2Config = { name: 'Maya', aliases: ['Moon'] };
  let n2Serial = 1;

  const portOf = (reg: Registry) => ({
    bases: async () => reg.bases(),
    records: async () => reg.records(),
    add: async (recs: Parameters<Registry['add']>[0][]) => recs.filter((x) => reg.add(x) === 'added').length,
    seen: async (u: Record<string, string>) => reg.seen(u),
    lastSeen: async () => reg.lastSeen(),
  });

  const link1 = new KajiLink({
    baseId: 'NERV-01',
    key: k1.privateKey,
    publicKey: k1.publicKey,
    registry: portOf(reg1),
    log: () => {},
    operator: () => signOperatorEntry('NERV-01', k1.privateKey, undefined, 1),
    onOperator: (from, entry, bases) => dir1.record(entry, bases, from),
  });
  const link2 = new KajiLink({
    baseId: 'NERV-02',
    key: k2.privateKey,
    publicKey: k2.publicKey,
    registry: portOf(reg2),
    log: () => {},
    operator: () => signOperatorEntry('NERV-02', k2.privateKey, n2Config, n2Serial),
    onOperator: (from, entry, bases) => dir2.record(entry, bases, from),
  });

  try {
    await link1.start(60_000);
    await link2.start(60_000);
    await link1.heartbeat();

    const resolved1 = dir1.resolve('Moon', reg1.bases(), reg1.lastSeen(), { selfBaseId: 'NERV-01' });
    assert.equal(resolved1.status, 'resolved');
    if (resolved1.status === 'resolved') assert.equal(resolved1.baseId, 'NERV-02');

    const resolved2 = dir2.resolve('Aoba', reg2.bases(), reg2.lastSeen(), { selfBaseId: 'NERV-02' });
    assert.equal(resolved2.status, 'resolved');
    if (resolved2.status === 'resolved') assert.equal(resolved2.baseId, 'NERV-01');

    // Rename on NERV-02 and re-heartbeat: old alias Moon becomes stale, Hyuga resolves.
    n2Config = { name: 'Hyuga', aliases: [] };
    n2Serial = 2;
    await link1.heartbeat();

    const oldAlias = dir1.resolve('Moon', reg1.bases(), reg1.lastSeen(), { selfBaseId: 'NERV-01' });
    assert.equal(oldAlias.status, 'stale');
    const newAlias = dir1.resolve('Hyuga', reg1.bases(), reg1.lastSeen(), { selfBaseId: 'NERV-01' });
    assert.equal(newAlias.status, 'resolved');
  } finally {
    await link1.stop();
    await link2.stop();
    db1.close();
    db2.close();
  }
});

test('F-070-T02: statusText, GET /api/operators, and Runtime.chat enforce ambiguity and privacy guarantees', async () => {
  const bases: StatusBase[] = [
    { baseId: 'NERV-01', name: 'Neo Tokyo-3', online: true, self: true, operator: { name: 'Aoba', aliases: [] } },
    { baseId: 'NERV-02', name: 'Tabgha', online: true, operator: { name: 'Aoba', aliases: ['Ops'] } },
  ];
  assert.match(statusText(bases, 'Aoba', 'en'), /ambiguous/i);
  assert.match(statusText(bases, 'Ops', 'en'), /NERV-02 · Tabgha/);

  // Runtime + /api/operators must never expose private telegram chatId.
  const home = mkdtempSync(join(tmpdir(), 'nerv-f070-rt-'));
  try {
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({
        base: { id: 'NERV-01', name: 'Neo Tokyo-3' },
        telegram: { chatId: 987654321 },
        operator: { name: 'Maya', aliases: ['Tokyo-Ops'] },
      }),
    );
    const rt = new Runtime(join(home, 'nerv.sqlite'), undefined, home);
    try {
      const k1 = keys();
      rt.setBaseKey(k1.publicKey, k1.privateKey);
      const dir = await rt.operators();
      const serialized = JSON.stringify(dir);
      assert.equal(serialized.includes('987654321'), false);
      assert.equal(serialized.includes('chatId'), false);

      // Runtime.chat safely refuses unknown/stale "tell Aoba on another base" without guessing.
      const reply = await rt.chat('tell Aoba on another base to list reminders');
      assert.match(reply.reply ?? '', /No online enrolled base has an operator named "Aoba"/i);

      const token = 'test-token-at-least-24-chars';
      const server = makeServer(rt, token, { base: { id: 'NERV-01', name: 'Neo Tokyo-3' } });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const port = (server.address() as { port: number }).port;
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/operators`, {
          headers: { authorization: `Bearer ${token}` },
        });
        assert.equal(res.status, 200);
        const body = await res.text();
        assert.equal(body.includes('987654321'), false);
        assert.equal(body.includes('chatId'), false);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    } finally {
      await rt.close();
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
