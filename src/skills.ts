/**
 * Skill package format, isolated storage and immutable versions (F-007-T06).
 * Packages are staged privately under <home>/skills/packages/<id>/<version>/ and
 * never become active without explicit owner promotion.
 */
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export type SkillStatus = 'staged' | 'active' | 'rolled-back' | 'retired';

export interface SkillManifest {
  id: string;
  version: string;
  title: string;
  domain: string;
  description: string;
  entryScript?: string;
  references?: string[];
  requiredCapabilities?: string[];
  parentVersion?: string;
  createdAt: string;
}

export interface SkillPackage {
  manifest: SkillManifest;
  instructions: string;
  scripts?: Record<string, string>;
  references?: Record<string, string>;
}

export interface SkillVersionRecord {
  version: string;
  status: SkillStatus;
  stagedAt: string;
  promotedAt?: string;
  retiredAt?: string;
  parentVersion?: string;
}

export interface SkillRegistryEntry {
  id: string;
  activeVersion?: string;
  previousActiveVersion?: string;
  versions: SkillVersionRecord[];
}

export interface SkillRegistry {
  version: 1;
  skills: Record<string, SkillRegistryEntry>;
}

const SKILL_ID_RE = /^[a-z][a-z0-9-]{1,40}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const SAFE_REL_PATH_RE = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,120}$/;
const MAX_TEXT_BYTES = 65_536;
const MAX_FILES = 32;

function assertSafeRelativePath(rel: string, label: string): void {
  if (!SAFE_REL_PATH_RE.test(rel) || rel.includes('..') || rel.includes('\\') || rel.startsWith('/')) {
    throw new Error(`Invalid ${label} path "${rel}": must be a safe relative path without "..".`);
  }
}

function assertBoundedText(text: unknown, label: string): string {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error(`Invalid ${label}: expected non-empty string.`);
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) {
    throw new Error(`Invalid ${label}: exceeds ${MAX_TEXT_BYTES} bytes.`);
  }
  return text;
}

function validateFileMap(map: unknown, label: string): Record<string, string> {
  if (map === undefined) return {};
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    throw new Error(`Invalid ${label}: expected object map.`);
  }
  const entries = Object.entries(map as Record<string, unknown>);
  if (entries.length > MAX_FILES) {
    throw new Error(`Invalid ${label}: at most ${MAX_FILES} files allowed.`);
  }
  const out: Record<string, string> = {};
  for (const [rel, body] of entries) {
    assertSafeRelativePath(rel, label);
    out[rel] = assertBoundedText(body, `${label} "${rel}"`);
  }
  return out;
}

/** Validates a skill manifest and returns a normalized copy. */
export function validateSkillManifest(raw: unknown): SkillManifest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid skill manifest: expected object.');
  }
  const m = raw as Record<string, unknown>;
  if (typeof m.id !== 'string' || !SKILL_ID_RE.test(m.id)) {
    throw new Error(`Invalid skill id ${JSON.stringify(m.id)}: expected lowercase letters, digits and dashes.`);
  }
  if (typeof m.version !== 'string' || !SEMVER_RE.test(m.version)) {
    throw new Error(`Invalid skill version ${JSON.stringify(m.version)}: expected semver x.y.z.`);
  }
  const title = assertBoundedText(m.title, 'manifest.title').trim();
  const domain = assertBoundedText(m.domain, 'manifest.domain').trim();
  const description = assertBoundedText(m.description, 'manifest.description').trim();
  if (title.length > 80) throw new Error('Invalid manifest.title: max 80 characters.');
  if (domain.length > 120) throw new Error('Invalid manifest.domain: max 120 characters.');
  if (description.length > 400) throw new Error('Invalid manifest.description: max 400 characters.');

  let entryScript: string | undefined;
  if (m.entryScript !== undefined) {
    if (typeof m.entryScript !== 'string') throw new Error('Invalid manifest.entryScript.');
    assertSafeRelativePath(m.entryScript, 'manifest.entryScript');
    entryScript = m.entryScript;
  }

  let references: string[] | undefined;
  if (m.references !== undefined) {
    if (!Array.isArray(m.references) || m.references.length > MAX_FILES) {
      throw new Error('Invalid manifest.references: expected array.');
    }
    references = m.references.map((r) => {
      if (typeof r !== 'string') throw new Error('Invalid manifest.references item.');
      assertSafeRelativePath(r, 'manifest.references');
      return r;
    });
  }

  let requiredCapabilities: string[] | undefined;
  if (m.requiredCapabilities !== undefined) {
    if (
      !Array.isArray(m.requiredCapabilities) ||
      m.requiredCapabilities.some((c) => typeof c !== 'string' || !c.trim())
    ) {
      throw new Error('Invalid manifest.requiredCapabilities.');
    }
    requiredCapabilities = [...new Set(m.requiredCapabilities.map((c) => c.trim()))];
  }

  let parentVersion: string | undefined;
  if (m.parentVersion !== undefined) {
    if (typeof m.parentVersion !== 'string' || !SEMVER_RE.test(m.parentVersion)) {
      throw new Error('Invalid manifest.parentVersion: expected semver x.y.z.');
    }
    parentVersion = m.parentVersion;
  }

  const createdAt =
    typeof m.createdAt === 'string' && !Number.isNaN(Date.parse(m.createdAt)) ? m.createdAt : new Date().toISOString();
  return {
    id: m.id,
    version: m.version,
    title,
    domain,
    description,
    ...(entryScript ? { entryScript } : {}),
    ...(references ? { references } : {}),
    ...(requiredCapabilities ? { requiredCapabilities } : {}),
    ...(parentVersion ? { parentVersion } : {}),
    createdAt,
  };
}

/** Validates a full skill package before staging or loading. */
export function validateSkillPackage(raw: unknown): SkillPackage {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid skill package: expected object.');
  }
  const p = raw as Record<string, unknown>;
  const manifest = validateSkillManifest(p.manifest);
  const instructions = assertBoundedText(p.instructions, 'instructions');
  const scripts = validateFileMap(p.scripts, 'scripts');
  const references = validateFileMap(p.references, 'references');
  if (manifest.entryScript && !(manifest.entryScript in scripts)) {
    throw new Error(`Invalid skill package: entryScript "${manifest.entryScript}" is missing from scripts.`);
  }
  for (const ref of manifest.references ?? []) {
    if (!(ref in references)) {
      throw new Error(`Invalid skill package: declared reference "${ref}" is missing from references.`);
    }
  }
  return { manifest, instructions, scripts, references };
}

function skillsRoot(home: string): string {
  return join(home, 'skills');
}

function packagesRoot(home: string): string {
  return join(skillsRoot(home), 'packages');
}

function registryPath(home: string): string {
  return join(skillsRoot(home), 'registry.json');
}

function versionDir(home: string, id: string, version: string): string {
  if (!SKILL_ID_RE.test(id)) throw new Error(`Invalid skill id "${id}".`);
  if (!SEMVER_RE.test(version)) throw new Error(`Invalid skill version "${version}".`);
  return join(packagesRoot(home), id, version);
}

function ensurePrivateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
}

function writePrivateFile(filePath: string, content: string): void {
  ensurePrivateDir(dirname(filePath));
  writeFileSync(filePath, content, { mode: 0o600 });
  chmodSync(filePath, 0o600);
}

function assertContainedRealPath(root: string, target: string): void {
  if (lstatSync(target).isSymbolicLink()) {
    throw new Error(`Symlinks are not permitted in isolated skill storage: ${target}`);
  }
  const realRoot = realpathSync(root);
  const realTarget = realpathSync(target);
  if (realTarget !== realRoot && !realTarget.startsWith(realRoot + '/') && !realTarget.startsWith(realRoot + '\\')) {
    throw new Error(`Path escapes isolated skill storage: ${target}`);
  }
}

function readRegistry(home: string): SkillRegistry {
  const path = registryPath(home);
  if (!existsSync(path)) return { version: 1, skills: {} };
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as SkillRegistry;
  if (parsed.version !== 1 || !parsed.skills || typeof parsed.skills !== 'object') {
    throw new Error('Corrupt skills registry.');
  }
  return parsed;
}

function writeRegistry(home: string, registry: SkillRegistry): void {
  ensurePrivateDir(skillsRoot(home));
  const path = registryPath(home);
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(registry, null, 2) + '\n', { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

/** Stages an immutable skill package version into isolated storage without activating it. */
export function stageSkillPackage(home: string, rawPkg: SkillPackage): SkillVersionRecord {
  const pkg = validateSkillPackage(rawPkg);
  const { id, version, parentVersion } = pkg.manifest;
  const dir = versionDir(home, id, version);
  if (existsSync(dir)) {
    throw new Error(`Skill ${id}@${version} already exists; versions are immutable.`);
  }

  ensurePrivateDir(packagesRoot(home));
  ensurePrivateDir(dir);
  writePrivateFile(join(dir, 'manifest.json'), JSON.stringify(pkg.manifest, null, 2) + '\n');
  writePrivateFile(join(dir, 'SKILL.md'), pkg.instructions);

  for (const [rel, body] of Object.entries(pkg.scripts ?? {})) {
    const dest = resolve(join(dir, 'scripts'), rel);
    writePrivateFile(dest, body);
  }
  for (const [rel, body] of Object.entries(pkg.references ?? {})) {
    const dest = resolve(join(dir, 'references'), rel);
    writePrivateFile(dest, body);
  }

  const registry = readRegistry(home);
  const entry: SkillRegistryEntry = registry.skills[id] ?? { id, versions: [] };
  const record: SkillVersionRecord = {
    version,
    status: 'staged',
    stagedAt: new Date().toISOString(),
    ...(parentVersion ? { parentVersion } : {}),
  };
  entry.versions.push(record);
  registry.skills[id] = entry;
  writeRegistry(home, registry);
  return record;
}

/** Loads and validates a stored skill package version from isolated storage. */
export function loadSkillVersion(home: string, id: string, version: string): SkillPackage {
  const root = packagesRoot(home);
  const dir = versionDir(home, id, version);
  if (!existsSync(dir)) {
    throw new Error(`Skill ${id}@${version} is not installed in isolated storage.`);
  }
  assertContainedRealPath(root, dir);
  const manifestPath = join(dir, 'manifest.json');
  const instructionsPath = join(dir, 'SKILL.md');
  assertContainedRealPath(dir, manifestPath);
  assertContainedRealPath(dir, instructionsPath);

  const manifest = validateSkillManifest(JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown);
  const instructions = readFileSync(instructionsPath, 'utf8');

  const scripts: Record<string, string> = {};
  if (manifest.entryScript) {
    const p = join(dir, 'scripts', manifest.entryScript);
    assertContainedRealPath(dir, p);
    scripts[manifest.entryScript] = readFileSync(p, 'utf8');
  }

  const references: Record<string, string> = {};
  for (const rel of manifest.references ?? []) {
    const p = join(dir, 'references', rel);
    assertContainedRealPath(dir, p);
    references[rel] = readFileSync(p, 'utf8');
  }

  return validateSkillPackage({ manifest, instructions, scripts, references });
}

/** Lists all skill packages and version states in isolated storage. */
export function listSkillPackages(home: string): SkillRegistryEntry[] {
  return Object.values(readRegistry(home).skills).sort((a, b) => a.id.localeCompare(b.id));
}

/** Promotes a staged skill version to active. Requires explicit owner approval. */
export function activateSkillVersion(
  home: string,
  id: string,
  version: string,
  options: { ownerApproved: boolean },
): SkillRegistryEntry {
  if (!options.ownerApproved) {
    throw new Error('Skill promotion requires explicit owner approval.');
  }
  loadSkillVersion(home, id, version);
  const registry = readRegistry(home);
  const entry = registry.skills[id];
  const target = entry?.versions.find((v) => v.version === version);
  if (!entry || !target) {
    throw new Error(`Skill ${id}@${version} not found in registry.`);
  }
  if (target.status === 'retired') {
    throw new Error(`Skill ${id}@${version} is retired and cannot be activated.`);
  }
  const now = new Date().toISOString();
  if (entry.activeVersion && entry.activeVersion !== version) {
    entry.previousActiveVersion = entry.activeVersion;
    const prev = entry.versions.find((v) => v.version === entry.activeVersion);
    if (prev && prev.status === 'active') prev.status = 'staged';
  }
  target.status = 'active';
  target.promotedAt = now;
  entry.activeVersion = version;
  writeRegistry(home, registry);
  return entry;
}

/** Rolls back an active skill to its previous active version (or deactivates if none). */
export function rollbackSkillVersion(
  home: string,
  id: string,
  options: { ownerApproved: boolean },
): SkillRegistryEntry {
  if (!options.ownerApproved) {
    throw new Error('Skill rollback requires explicit owner approval.');
  }
  const registry = readRegistry(home);
  const entry = registry.skills[id];
  if (!entry || !entry.activeVersion) {
    throw new Error(`Skill ${id} has no active version to roll back.`);
  }
  const current = entry.versions.find((v) => v.version === entry.activeVersion);
  if (current) current.status = 'rolled-back';

  if (entry.previousActiveVersion) {
    const prev = entry.versions.find((v) => v.version === entry.previousActiveVersion);
    if (prev && prev.status !== 'retired') {
      prev.status = 'active';
      entry.activeVersion = prev.version;
      entry.previousActiveVersion = undefined;
    } else {
      entry.activeVersion = undefined;
      entry.previousActiveVersion = undefined;
    }
  } else {
    entry.activeVersion = undefined;
  }
  writeRegistry(home, registry);
  return entry;
}

/** Retires a skill package (for instance when it stops beating baseline after a model change). */
export function retireSkillPackage(home: string, id: string, options: { ownerApproved: boolean }): SkillRegistryEntry {
  if (!options.ownerApproved) {
    throw new Error('Skill retirement requires explicit owner approval.');
  }
  const registry = readRegistry(home);
  const entry = registry.skills[id];
  if (!entry) {
    throw new Error(`Skill ${id} not found in registry.`);
  }
  const now = new Date().toISOString();
  for (const v of entry.versions) {
    v.status = 'retired';
    v.retiredAt = now;
  }
  entry.activeVersion = undefined;
  entry.previousActiveVersion = undefined;
  writeRegistry(home, registry);
  return entry;
}
