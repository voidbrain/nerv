import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  type KeyObject,
} from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

/**
 * F-062-T03: encrypted off-host copies of the nightly snapshots. The service holds only the backup *public* key, so it
 * can write copies but never read one back; the private key (passphrase-protected) stays with the owner, apart from
 * every credential the service runs with. Each copy uses a fresh X25519 key agreement and AES-256-GCM, so a changed
 * or truncated file fails to decrypt instead of restoring wrong data.
 */
export interface BackupConfig {
  /** Needed to write copies (folders or peers); a base that only receives copies has none. */
  publicKey?: string;
  copies: string[];
  /** F-062-T06: enrolled bases that receive each copy over the Kaji line. */
  peers?: string[];
  /** F-062-T06: enrolled bases whose copies this base stores (it cannot read them). */
  accept?: string[];
  keep?: number;
}

export const COPY_KEEP = 7;
const MAGIC = Buffer.from('NERVBK1\n');
const INFO = Buffer.from('nerv-backup-v1');
const COPY = /^nerv-(\d{4}-\d{2}-\d{2})\.sqlite\.nbk$/;

export const copyName = (date: string) => `nerv-${date}.sqlite.nbk`;

function publicKeyObject(text: string): KeyObject {
  let key: KeyObject;
  try {
    key = createPublicKey({ key: Buffer.from(text, 'base64'), format: 'der', type: 'spki' });
  } catch {
    throw new Error('Invalid backup public key: use the one `backup keygen` printed.');
  }
  if (key.asymmetricKeyType !== 'x25519')
    throw new Error('Invalid backup public key: use the one `backup keygen` printed.');
  return key;
}

const rawPublic = (key: KeyObject) => key.export({ format: 'der', type: 'spki' });

/** A new backup key pair. The private half is PEM, encrypted with the owner's passphrase; the public half is base64. */
export function createBackupKey(passphrase: string): { privatePem: string; publicKey: string } {
  if (passphrase.length < 12) throw new Error('The passphrase needs at least 12 characters.');
  const { publicKey, privateKey } = generateKeyPairSync('x25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase },
  });
  return { privatePem: privateKey, publicKey: publicKey.toString('base64') };
}

function aesKey(shared: Buffer, ephemeral: Buffer, recipient: Buffer) {
  return Buffer.from(hkdfSync('sha256', shared, Buffer.concat([ephemeral, recipient]), INFO, 32));
}

/** Encrypts `plain` for the holder of the private half of `publicKey`. */
export function encryptBackup(plain: Buffer, publicKey: string): Buffer {
  const recipient = publicKeyObject(publicKey);
  const eph = generateKeyPairSync('x25519');
  const ephPub = rawPublic(eph.publicKey),
    key = aesKey(diffieHellman({ privateKey: eph.privateKey, publicKey: recipient }), ephPub, rawPublic(recipient)),
    iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(MAGIC);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  const lengths = Buffer.alloc(2);
  lengths.writeUInt16BE(ephPub.length);
  return Buffer.concat([MAGIC, lengths, ephPub, iv, cipher.getAuthTag(), body]);
}

/** Decrypts a copy with the owner's private key file. Any change to the copy fails here. */
export function decryptBackup(data: Buffer, privatePem: string, passphrase: string): Buffer {
  const fail = () => new Error('This is not a NERV backup copy, or it was changed or truncated.');
  if (data.length < MAGIC.length + 2 || !data.subarray(0, MAGIC.length).equals(MAGIC)) throw fail();
  let at = MAGIC.length;
  const n = data.readUInt16BE(at);
  at += 2;
  if (data.length < at + n + 12 + 16) throw fail();
  const ephPub = data.subarray(at, (at += n)),
    iv = data.subarray(at, (at += 12)),
    tag = data.subarray(at, (at += 16)),
    body = data.subarray(at);
  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey({ key: privatePem, format: 'pem', passphrase });
  } catch {
    throw new Error('The backup key could not be opened: wrong passphrase or not a backup key file.');
  }
  let ephemeral: KeyObject;
  try {
    ephemeral = createPublicKey({ key: ephPub, format: 'der', type: 'spki' });
  } catch {
    throw fail();
  }
  const recipient = createPublicKey(privateKey);
  try {
    const key = aesKey(diffieHellman({ privateKey, publicKey: ephemeral }), ephPub, rawPublic(recipient)),
      decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(MAGIC);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new Error('Decryption failed: this copy was made for another backup key, or it was changed.');
  }
}

const BASE_ID = /^[A-Z0-9][A-Z0-9-]{1,15}$/;

function baseIds(value: unknown, what: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 8 || value.some((v) => typeof v !== 'string' || !BASE_ID.test(v)))
    throw new Error(`Invalid backup: ${what} is a list of up to 8 base IDs such as "NERV-02".`);
  if (new Set(value).size !== value.length) throw new Error(`Invalid backup: each base in ${what} once.`);
  return value.length ? (value as string[]) : undefined;
}

/**
 * Validates the `backup` section of config.json. Copy folders must be absolute and outside the data home. Writing
 * copies (to folders or peers) needs the public key; a base that only accepts copies from others does not.
 */
export function validateBackup(value: unknown, home: string): BackupConfig {
  const usage =
    'Invalid backup: {"publicKey": "<from backup keygen>", "copies": ["/absolute/folder"], "peers": ["NERV-02"], "accept": ["NERV-01"], "keep": 7}.';
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(usage);
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some((k) => !['publicKey', 'copies', 'peers', 'accept', 'keep'].includes(k)))
    throw new Error(usage);
  const raw = v.copies ?? [];
  if (!Array.isArray(raw) || raw.length > 4 || raw.some((c) => typeof c !== 'string' || !isAbsolute(c)))
    throw new Error(usage);
  const copies = (raw as string[]).map((c) => resolve(c));
  if (new Set(copies).size !== copies.length) throw new Error('Invalid backup: each copy folder once.');
  for (const c of copies) {
    const r = relative(resolve(home), c);
    if (r === '' || (!r.startsWith('..') && !isAbsolute(r)))
      throw new Error('Invalid backup: a copy folder inside the NERV data home is not off host.');
  }
  const peers = baseIds(v.peers, 'peers'),
    accept = baseIds(v.accept, 'accept');
  if (!copies.length && !peers && !accept) throw new Error(usage);
  if (copies.length || peers) {
    if (typeof v.publicKey !== 'string') throw new Error(usage);
    publicKeyObject(v.publicKey);
  } else if (v.publicKey !== undefined) throw new Error(usage);
  if (v.keep !== undefined && (!Number.isInteger(v.keep) || (v.keep as number) < 1 || (v.keep as number) > 365))
    throw new Error('Invalid backup: keep is a whole number of copies from 1 to 365.');
  return {
    ...(typeof v.publicKey === 'string' ? { publicKey: v.publicKey } : {}),
    copies,
    ...(peers ? { peers } : {}),
    ...(accept ? { accept } : {}),
    ...(v.keep !== undefined ? { keep: v.keep as number } : {}),
  };
}

/** Copy dates in a folder, newest first. */
export function copyDates(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((f) => COPY.exec(f)?.[1])
    .filter((d): d is string => !!d)
    .sort()
    .reverse();
}

/**
 * Writes the encrypted copy of one snapshot into `dir`, then keeps only the newest `keep` copies there. The folder must
 * already exist: an unplugged disk is reported, never replaced by a new local folder at its mount point.
 */
export function writeCopy(snapshot: string, date: string, dir: string, publicKey: string, keep = COPY_KEEP) {
  if (!existsSync(dir) || !statSync(dir).isDirectory())
    throw Object.assign(new Error('unavailable'), { code: 'ENOENT' });
  const name = copyName(date),
    partial = join(dir, name + '.partial');
  try {
    writeFileSync(partial, encryptBackup(readFileSync(snapshot), publicKey), { mode: 0o600 });
    if (process.platform !== 'win32') chmodSync(partial, 0o600);
    const fd = openSync(partial, 'r+');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(partial, join(dir, name));
  } catch (e) {
    rmSync(partial, { force: true });
    throw e;
  }
  for (const old of copyDates(dir).slice(Math.max(1, keep))) rmSync(join(dir, copyName(old)), { force: true });
  return name;
}

/** Where this base keeps the copies `from` sent it over the Kaji line. */
export const receivedDir = (home: string, from: string) => join(home, 'kaji-backups', from);

/** Whether `data` is shaped like a copy. A receiver cannot decrypt it; this only refuses something else. */
export const looksLikeCopy = (data: Buffer) =>
  data.length > MAGIC.length + 2 && data.subarray(0, MAGIC.length).equals(MAGIC);

/**
 * F-062-T06: stores a copy another base sent over the Kaji line, when this base accepts copies from it. The copy stays
 * encrypted: the receiver never holds the backup key. Newest `keep` per sender are kept.
 */
export function storeReceived(
  home: string,
  config: BackupConfig | undefined,
  from: string,
  date: string,
  data: Buffer,
): 'stored' | 'refused' {
  if (!config?.accept?.includes(from) || !BASE_ID.test(from)) return 'refused';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !looksLikeCopy(data)) return 'refused';
  const dir = receivedDir(home, from);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') chmodSync(dir, 0o700);
  const name = copyName(date),
    partial = join(dir, name + '.partial');
  try {
    writeFileSync(partial, data, { mode: 0o600 });
    const fd = openSync(partial, 'r+');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(partial, join(dir, name));
  } catch (e) {
    rmSync(partial, { force: true });
    throw e;
  }
  for (const old of copyDates(dir).slice(Math.max(1, config.keep ?? COPY_KEEP)))
    rmSync(join(dir, copyName(old)), { force: true });
  return 'stored';
}
