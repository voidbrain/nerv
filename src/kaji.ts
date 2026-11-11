import { transaction } from './sqlite-transaction.ts';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  scryptSync,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
/**
 * The Kaji line's trust layer (F-036, phase 1a). The Key of Nebuchadnezzar is the owner's Ed25519 root key, kept in a
 * passphrase-encrypted file and used only to sign registry records (enrol, revoke). Every base has its own Ed25519 base
 * key, generated locally; the private half never leaves it. Each base keeps the full registry and verifies every record
 * against the pinned root public key, so any copy is as good as the original and no base is a single point of failure.
 */
export const REGISTRY_SCHEMA = `
 CREATE TABLE IF NOT EXISTS registry(id TEXT PRIMARY KEY, serial INTEGER NOT NULL, kind TEXT NOT NULL, base_id TEXT NOT NULL, body TEXT NOT NULL, signature TEXT NOT NULL, received TEXT NOT NULL);
 CREATE TRIGGER IF NOT EXISTS registry_no_update BEFORE UPDATE ON registry BEGIN SELECT RAISE(ABORT,'registry records are append-only'); END;
 CREATE TRIGGER IF NOT EXISTS registry_no_delete BEFORE DELETE ON registry BEGIN SELECT RAISE(ABORT,'registry records are append-only'); END;
 CREATE TABLE IF NOT EXISTS registry_roots(id TEXT PRIMARY KEY REFERENCES registry(id),root TEXT NOT NULL);
 CREATE TRIGGER IF NOT EXISTS registry_roots_no_update BEFORE UPDATE ON registry_roots BEGIN SELECT RAISE(ABORT,'registry root bindings are immutable'); END;
 CREATE TRIGGER IF NOT EXISTS registry_roots_no_delete BEFORE DELETE ON registry_roots BEGIN SELECT RAISE(ABORT,'registry root bindings are immutable'); END;
 CREATE TABLE IF NOT EXISTS registry_seen(root TEXT NOT NULL,base_id TEXT NOT NULL,last_seen TEXT NOT NULL,PRIMARY KEY(root,base_id));
 CREATE TABLE IF NOT EXISTS kaji_seen(base_id TEXT PRIMARY KEY, last_seen TEXT NOT NULL);`;
export const ROOT_KEY_FILE = 'key-of-nebuchadnezzar.enc';
const BASE_KEY_FILE = 'base-key',
  BASE_PUB_FILE = 'base.pub';
/** Key order never changes the bytes that are signed. */
export const canonical = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.keys(v)
          .sort()
          .map((k) => JSON.stringify(k) + ':' + canonical((v as Record<string, unknown>)[k]))
          .join(',')}}`
      : JSON.stringify(v);
const spki = (key: KeyObject) => key.export({ type: 'spki', format: 'der' }).toString('base64');
/** A short, readable fingerprint of a public key: compare it by eye between bases (8 groups of 4 hex digits). */
export function fingerprint(publicKey: string): string {
  return createHash('sha256')
    .update(Buffer.from(publicKey, 'base64'))
    .digest('hex')
    .slice(0, 32)
    .match(/.{4}/g)!
    .join('-');
}
export function publicKeyFrom(text: string): KeyObject {
  let key: KeyObject;
  try {
    key = createPublicKey({ key: Buffer.from(text, 'base64'), format: 'der', type: 'spki' });
  } catch {
    throw new Error('Not a public key: paste the base64 text that `base pubkey` printed.');
  }
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Kaji keys are Ed25519.');
  return key;
}
/** Canonical cryptographic identity; signed/stored spellings are never rewritten. */
export function keyIdentity(value: string): string {
  return publicKeyFrom(value).export({ type: 'spki', format: 'der' }).toString('base64');
}
/** The root key, encrypted with a key derived from the passphrase (scrypt) using AES-256-GCM. */
export function createRootKey(passphrase: string): { file: string; publicKey: string } {
  if (passphrase.length < 12) throw new Error('Use a passphrase of at least 12 characters.');
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const salt = randomBytes(16),
    iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const secret = Buffer.concat([cipher.update(privateKey.export({ type: 'pkcs8', format: 'der' })), cipher.final()]);
  const pub = spki(publicKey);
  return {
    publicKey: pub,
    file:
      JSON.stringify(
        {
          version: 1,
          kdf: 'scrypt',
          n: 1 << 15,
          salt: salt.toString('base64'),
          iv: iv.toString('base64'),
          tag: cipher.getAuthTag().toString('base64'),
          secret: secret.toString('base64'),
          publicKey: pub,
        },
        null,
        2,
      ) + '\n',
  };
}
export function unlockRootKey(file: string, passphrase: string): { privateKey: KeyObject; publicKey: string } {
  let f: { version: number; n: number; salt: string; iv: string; tag: string; secret: string; publicKey: string };
  try {
    f = JSON.parse(file);
  } catch {
    throw new Error('Not a Key of Nebuchadnezzar file.');
  }
  if (f.version !== 1) throw new Error('Unknown key file version.');
  try {
    const key = scryptSync(passphrase, Buffer.from(f.salt, 'base64'), 32, {
      N: f.n,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    });
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(f.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(f.tag, 'base64'));
    const der = Buffer.concat([decipher.update(Buffer.from(f.secret, 'base64')), decipher.final()]);
    return { privateKey: createPrivateKey({ key: der, format: 'der', type: 'pkcs8' }), publicKey: f.publicKey };
  } catch {
    throw new Error('Wrong passphrase, or the key file is damaged.');
  }
}
/** This base's own key pair, created on first use; the private half stays in the data home. */
export function baseKey(home: string): { privateKey: KeyObject; publicKey: string } {
  const priv = join(home, BASE_KEY_FILE),
    pub = join(home, BASE_PUB_FILE);
  if (!existsSync(priv)) {
    const k = generateKeyPairSync('ed25519');
    writeFileSync(priv, k.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    chmodSync(priv, 0o600);
    writeFileSync(pub, spki(k.publicKey) + '\n', { mode: 0o644 });
  }
  return { privateKey: createPrivateKey(readFileSync(priv, 'utf8')), publicKey: readFileSync(pub, 'utf8').trim() };
}
/** enrol and revoke a base; main names the owner's main base (F-036 phase 2: Aoba there is the one channel). */
export type RecordKind = 'enrol' | 'revoke' | 'main';
export interface RegistryBody {
  kind: RecordKind;
  serial: number;
  baseId: string;
  name?: string;
  publicKey?: string;
  address?: string;
  issued: string;
}
export interface SignedRecord {
  body: RegistryBody;
  signature: string;
}
export function signRecord(root: KeyObject, body: RegistryBody): SignedRecord {
  return { body, signature: sign(null, Buffer.from(canonical(body)), root).toString('base64') };
}
export function verifyRecord(rootPublicKey: string, record: SignedRecord): boolean {
  try {
    return verify(
      null,
      Buffer.from(canonical(record.body)),
      publicKeyFrom(rootPublicKey),
      Buffer.from(record.signature, 'base64'),
    );
  } catch {
    return false;
  }
}
const BASE_ID = /^[A-Z0-9][A-Z0-9-]{1,15}$/;
const ADDRESS = /^[a-z0-9.:-]{1,253}$/i;
const isKey = (v: string) => {
  try {
    publicKeyFrom(v);
    return true;
  } catch {
    return false;
  }
};
/**
 * Reads `kaji enrol` arguments before any passphrase is asked: the key and the address may come in either order (a
 * base64 Ed25519 key and an address cannot be confused), and each problem is named precisely.
 */
export function enrolmentArgs(
  id: string | undefined,
  name: string | undefined,
  first: string | undefined,
  second: string | undefined,
  selfKey: string,
): { baseId: string; name: string; publicKey: string; address: string } {
  if (!id || !name || !first || !second)
    throw new Error(
      'Usage: kaji enrol BASE-ID "Name" PUBKEY|self ADDRESS — e.g. kaji enrol NERV-02 "Tabgha" <key from base pubkey> 100.64.0.2',
    );
  const baseId = id.toUpperCase();
  if (!BASE_ID.test(baseId))
    throw new Error(`Base ID "${id}" must look like NERV-02: capitals, digits and dashes, up to 16.`);
  if (!name.trim() || name.length > 40) throw new Error('The base name is 1–40 characters.');
  const keyFirst = first === 'self' || isKey(first),
    keySecond = second === 'self' || isKey(second);
  const [key, address] =
    keyFirst && !keySecond ? [first, second] : keySecond && !keyFirst ? [second, first] : [first, second];
  if (key !== 'self' && !isKey(key))
    throw new Error(
      `Neither "${first.slice(0, 24)}" nor "${second.slice(0, 24)}" is a base public key: on that base run nerv base pubkey and copy its first line (or use self for this base).`,
    );
  if (address === 'self' || isKey(address) || !ADDRESS.test(address))
    throw new Error(
      `"${address.slice(0, 40)}" is not an address: use the base's Tailscale address (tailscale ip -4 on that base, 100.x.y.z).`,
    );
  return { baseId, name: name.trim(), publicKey: key === 'self' ? selfKey : key, address };
}
function checkBody(b: RegistryBody): void {
  if (
    !b ||
    !['enrol', 'revoke', 'main'].includes(b.kind) ||
    !Number.isSafeInteger(b.serial) ||
    b.serial < 1 ||
    !BASE_ID.test(b.baseId) ||
    !Number.isFinite(Date.parse(b.issued))
  )
    throw new Error('Malformed registry record.');
  if (b.kind === 'enrol') {
    if (
      typeof b.name !== 'string' ||
      !b.name.trim() ||
      b.name.length > 40 ||
      typeof b.address !== 'string' ||
      !/^[a-z0-9.:-]{1,253}$/i.test(b.address) ||
      typeof b.publicKey !== 'string'
    )
      throw new Error('An enrolment needs a name, an address and a public key.');
    publicKeyFrom(b.publicKey);
  }
}
export interface BaseEntry {
  baseId: string;
  name: string;
  publicKey: string;
  address: string;
  fingerprint: string;
  status: 'enrolled' | 'revoked';
  serial: number;
}
/** The Gehirn registry (the owner's bases) on this base: append-only signed records, all verified against the pinned root key. */
export class Registry {
  readonly db: DatabaseSync;
  readonly root: string | undefined;
  constructor(db: DatabaseSync, rootPublicKey?: string) {
    this.db = db;
    this.root = rootPublicKey;
  }
  /** Adds a record after checking its shape and signature; a record already held is a no-op. */
  add(record: SignedRecord, now = new Date()): 'added' | 'known' {
    if (!this.root)
      throw new Error(
        'No root key pinned on this base: run kaji import --root FINGERPRINT, or key init on the main base.',
      );
    checkBody(record.body);
    if (!verifyRecord(this.root, record))
      throw new Error(`Registry record for ${record.body.baseId} is not signed by your Key of Nebuchadnezzar.`);
    const id = createHash('sha256').update(canonical(record)).digest('hex');
    return transaction(this.db, () => {
      if (this.db.prepare('SELECT 1 FROM registry WHERE id=?').get(id)) return 'known';
      this.db
        .prepare('INSERT INTO registry VALUES(?,?,?,?,?,?,?)')
        .run(
          id,
          record.body.serial,
          record.body.kind,
          record.body.baseId,
          canonical(record.body),
          record.signature,
          now.toISOString(),
        );
      this.db.prepare('INSERT INTO registry_roots VALUES(?,?)').run(id, keyIdentity(this.root!));
      return 'added';
    });
  }
  /** Merges last-seen times: per base, the newest time wins (so every base learns what any base heard). */
  private scopedSeen(): boolean {
    return (
      Number((this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version) >= 6 &&
      !!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='registry_seen'").get()
    );
  }
  private rootLabels(table: 'registry_roots' | 'registry_seen'): string[] {
    const selected = keyIdentity(this.root!);
    return (this.db.prepare('SELECT DISTINCT root FROM ' + table).all() as { root: string }[])
      .map((r) => r.root)
      .filter((root) => keyIdentity(root) === selected);
  }
  seen(updates: Record<string, string>): void {
    if (!this.root) return;
    for (const [id, at] of Object.entries(updates))
      if (BASE_ID.test(id) && Number.isFinite(Date.parse(at))) {
        const time = new Date(Date.parse(at)).toISOString();
        if (this.scopedSeen())
          this.db
            .prepare(
              'INSERT INTO registry_seen VALUES(?,?,?) ON CONFLICT(root,base_id) DO UPDATE SET last_seen=excluded.last_seen WHERE excluded.last_seen>registry_seen.last_seen',
            )
            .run(keyIdentity(this.root), id, time);
        else
          this.db
            .prepare(
              'INSERT INTO kaji_seen VALUES(?,?) ON CONFLICT(base_id) DO UPDATE SET last_seen=excluded.last_seen WHERE excluded.last_seen>kaji_seen.last_seen',
            )
            .run(id, time);
      }
  }
  lastSeen(): Record<string, string> {
    if (!this.root) return {};
    const labels = this.scopedSeen() ? this.rootLabels('registry_seen') : [];
    const rows = this.scopedSeen()
      ? labels.length
        ? this.db
            .prepare(
              'SELECT base_id,last_seen FROM registry_seen WHERE root IN (' +
                labels.map(() => '?').join(',') +
                ') ORDER BY last_seen',
            )
            .all(...labels)
        : []
      : this.db.prepare('SELECT base_id,last_seen FROM kaji_seen').all();
    return Object.fromEntries((rows as { base_id: string; last_seen: string }[]).map((r) => [r.base_id, r.last_seen]));
  }
  records(): SignedRecord[] {
    if (!this.root) return [];
    const scoped = !!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='registry_roots'").get();
    const labels = scoped ? this.rootLabels('registry_roots') : [];
    const rows = (
      scoped
        ? this.db
            .prepare(
              'SELECT r.body,r.signature FROM registry r LEFT JOIN registry_roots g ON g.id=r.id WHERE ' +
                (labels.length ? 'g.root IN (' + labels.map(() => '?').join(',') + ') OR ' : '') +
                'g.root IS NULL ORDER BY r.serial,r.id',
            )
            .all(...labels)
        : this.db.prepare('SELECT body,signature FROM registry ORDER BY serial,id').all()
    ) as { body: string; signature: string }[];
    return rows.map((r) => {
      const record = { body: JSON.parse(r.body) as RegistryBody, signature: r.signature };
      if (!verifyRecord(this.root!, record)) throw Error('Stored registry signature does not match the selected root.');
      return record;
    });
  }
  nextSerial(): number {
    return ((this.db.prepare('SELECT max(serial) AS s FROM registry').get() as { s: number | null }).s ?? 0) + 1;
  }
  /** Current bases: the newest enrolment per base, unless a revocation of that key exists (revoke always wins). */
  bases(): BaseEntry[] {
    const out = new Map<string, BaseEntry>();
    const revoked = new Set<string>();
    for (const { body: b } of this.records()) {
      if (b.kind === 'revoke') revoked.add(b.baseId + ':' + (b.publicKey ?? '*'));
      else if (b.kind === 'enrol') {
        const cur = out.get(b.baseId);
        if (!cur || b.serial > cur.serial)
          out.set(b.baseId, {
            baseId: b.baseId,
            name: b.name!,
            publicKey: b.publicKey!,
            address: b.address!,
            fingerprint: fingerprint(b.publicKey!),
            status: 'enrolled',
            serial: b.serial,
          });
      }
    }
    for (const e of out.values())
      if (revoked.has(e.baseId + ':*') || revoked.has(e.baseId + ':' + e.publicKey)) e.status = 'revoked';
    return [...out.values()].sort((a, b) => a.baseId.localeCompare(b.baseId));
  }
  /** The owner's main base: the newest main record, while that base is enrolled and not revoked. No election: unset until the owner names one. */
  main(): string | undefined {
    const latest = this.records()
      .filter((r) => r.body.kind === 'main')
      .sort((a, b) => b.body.serial - a.body.serial)[0]?.body.baseId;
    return latest && this.bases().some((b) => b.baseId === latest && b.status === 'enrolled') ? latest : undefined;
  }
}
