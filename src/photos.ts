import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

/** Maximum accepted photo payload size (5 MiB). */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const ALLOWED_PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type PhotoMimeType = (typeof ALLOWED_PHOTO_MIME_TYPES)[number];
export type PhotoOwnerKind = 'recipe' | 'crash' | 'part' | 'battery';

export const PHOTOS_SCHEMA = `
 CREATE TABLE IF NOT EXISTS saved_photos(
   id TEXT PRIMARY KEY,
   owner_kind TEXT NOT NULL,
   owner_id TEXT NOT NULL,
   step_index INTEGER,
   mime_type TEXT NOT NULL,
   byte_size INTEGER NOT NULL,
   sha256 TEXT NOT NULL,
   rel_path TEXT NOT NULL,
   caption TEXT NOT NULL DEFAULT '',
   created TEXT NOT NULL
 );
 CREATE INDEX IF NOT EXISTS saved_photos_owner ON saved_photos(owner_kind, owner_id, step_index);`;

export interface SavedPhoto {
  id: string;
  ownerKind: PhotoOwnerKind;
  ownerId: string;
  stepIndex: number | null;
  mimeType: PhotoMimeType;
  byteSize: number;
  sha256: string;
  caption: string;
  created: string;
  url: string;
}

const MIME_EXT: Record<PhotoMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Inspects magic bytes and returns the detected photo MIME type, or `null` when unrecognized. */
export function detectPhotoMime(bytes: Buffer): PhotoMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

function normalizeDeclaredMime(declared: string | undefined): PhotoMimeType | undefined {
  if (!declared) return undefined;
  const clean = declared.split(';')[0]!.trim().toLowerCase();
  if (clean === 'image/jpg') return 'image/jpeg';
  if ((ALLOWED_PHOTO_MIME_TYPES as readonly string[]).includes(clean)) return clean as PhotoMimeType;
  throw new Error(`Unsupported photo type: ${declared}. Allowed: ${ALLOWED_PHOTO_MIME_TYPES.join(', ')}.`);
}

/** Validates photo size, magic bytes, and optional declared MIME type. */
export function validatePhotoBuffer(bytes: Buffer, declaredMime?: string): PhotoMimeType {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error('Photo cannot be empty.');
  if (bytes.length > MAX_PHOTO_BYTES) {
    throw new Error(`Photo exceeds ${MAX_PHOTO_BYTES} byte limit (${bytes.length} bytes).`);
  }
  const normalized = normalizeDeclaredMime(declaredMime);
  const detected = detectPhotoMime(bytes);
  if (!detected) {
    throw new Error('Unsupported or invalid photo bytes: expected JPEG, PNG, or WebP.');
  }
  if (normalized && normalized !== detected) {
    throw new Error(`Photo bytes (${detected}) do not match declared type (${normalized}).`);
  }
  return detected;
}

function rowToPhoto(row: Record<string, unknown>): SavedPhoto {
  const id = String(row.id);
  return {
    id,
    ownerKind: row.owner_kind as PhotoOwnerKind,
    ownerId: String(row.owner_id),
    stepIndex: row.step_index === null || row.step_index === undefined ? null : Number(row.step_index),
    mimeType: String(row.mime_type) as PhotoMimeType,
    byteSize: Number(row.byte_size),
    sha256: String(row.sha256),
    caption: String(row.caption ?? ''),
    created: String(row.created),
    url: `/api/photos/${id}`,
  };
}

/** Local-only photo attachment store backed by SQLite metadata and mode-0600 files under `<home>/photos`. */
export class PhotoStore {
  private readonly db: DatabaseSync;
  readonly photosDir: string;

  constructor(db: DatabaseSync, photosDir?: string) {
    this.db = db;
    this.photosDir = photosDir ?? mkdtempSync(join(tmpdir(), 'nerv-photos-'));
  }

  attach(input: {
    ownerKind: PhotoOwnerKind;
    ownerId: string;
    stepIndex?: number | null;
    bytes: Buffer;
    mimeType?: string;
    caption?: string;
  }): SavedPhoto {
    if (!['recipe', 'crash', 'part', 'battery'].includes(input.ownerKind)) {
      throw new Error(`Invalid photo ownerKind: ${input.ownerKind}`);
    }
    const ownerId = input.ownerId.trim();
    if (!ownerId) throw new Error('Photo ownerId is required.');
    const stepIndex = input.stepIndex ?? null;
    if (stepIndex !== null && (!Number.isInteger(stepIndex) || stepIndex < 0)) {
      throw new Error('stepIndex must be a non-negative integer or null.');
    }
    const mimeType = validatePhotoBuffer(input.bytes, input.mimeType);
    const caption = (input.caption ?? '').trim().slice(0, 200);
    const id = randomUUID();
    const ext = MIME_EXT[mimeType];
    const relPath = `${id}.${ext}`;
    const sha256 = createHash('sha256').update(input.bytes).digest('hex');
    const created = new Date().toISOString();

    mkdirSync(this.photosDir, { recursive: true, mode: 0o700 });
    const fullPath = join(this.photosDir, relPath);
    writeFileSync(fullPath, input.bytes, { mode: 0o600 });
    chmodSync(fullPath, 0o600);

    this.db
      .prepare(
        'INSERT INTO saved_photos(id, owner_kind, owner_id, step_index, mime_type, byte_size, sha256, rel_path, caption, created) VALUES(?,?,?,?,?,?,?,?,?,?)',
      )
      .run(id, input.ownerKind, ownerId, stepIndex, mimeType, input.bytes.length, sha256, relPath, caption, created);

    return {
      id,
      ownerKind: input.ownerKind,
      ownerId,
      stepIndex,
      mimeType,
      byteSize: input.bytes.length,
      sha256,
      caption,
      created,
      url: `/api/photos/${id}`,
    };
  }

  list(ownerKind: PhotoOwnerKind, ownerId: string): SavedPhoto[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM saved_photos WHERE owner_kind = ? AND owner_id = ? ORDER BY step_index IS NOT NULL, step_index ASC, created ASC',
      )
      .all(ownerKind, ownerId) as Record<string, unknown>[];
    return rows.map(rowToPhoto);
  }

  get(id: string): { photo: SavedPhoto; bytes: Buffer } | undefined {
    const row = this.db.prepare('SELECT * FROM saved_photos WHERE id = ?').get(id) as
      Record<string, unknown> | undefined;
    if (!row) return undefined;
    const rel = String(row.rel_path);
    const rootReal = existsSync(this.photosDir) ? realpathSync(this.photosDir) : resolve(this.photosDir);
    const candidate = resolve(rootReal, rel);
    const relCheck = relative(rootReal, candidate);
    if (!relCheck || relCheck.startsWith('..') || isAbsolute(relCheck) || !existsSync(candidate)) {
      return undefined;
    }
    const candidateReal = realpathSync(candidate);
    const realRel = relative(rootReal, candidateReal);
    if (!realRel || realRel.startsWith('..') || isAbsolute(realRel)) return undefined;
    return { photo: rowToPhoto(row), bytes: readFileSync(candidateReal) };
  }

  remove(id: string): boolean {
    const row = this.db.prepare('SELECT rel_path FROM saved_photos WHERE id = ?').get(id) as
      { rel_path: string } | undefined;
    if (!row) return false;
    this.db.prepare('DELETE FROM saved_photos WHERE id = ?').run(id);
    const full = join(this.photosDir, row.rel_path);
    if (existsSync(full)) rmSync(full, { force: true });
    return true;
  }
}
