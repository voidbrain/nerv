import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

export interface CopyRule {
  label: string;
  sourceSubdir?: string;
  destinationDir: string;
  approved: boolean;
}

export interface CopyConflict {
  path: string;
  reason: string;
}

export interface CopyReport {
  matched: boolean;
  label: string;
  copied: string[];
  skipped: string[];
  conflicts: CopyConflict[];
  verified: boolean;
}

function hashFileSha256(filePath: string): { size: number; sha256: string } {
  const bytes = readFileSync(filePath);
  return {
    size: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function collectFiles(rootDir: string, currentDir: string, out: string[]): void {
  const entries = readdirSync(currentDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(rootDir, full, out);
    } else if (entry.isFile()) {
      out.push(relative(rootDir, full));
    }
  }
}

/**
 * Executes an owner-approved removable-card copy rule (F-088-T02):
 * - Unknown or unapproved labels do nothing.
 * - Never modifies or deletes source files.
 * - Verifies every copied file by byte size and SHA-256 hash.
 * - Safe to run twice: identical files are skipped; differing files at the same path are reported as conflicts.
 */
export function runCardCopyRule(mountRoot: string, label: string, rules: readonly CopyRule[]): CopyReport {
  const normalizedLabel = label.trim();
  const rule = rules.find((r) => r.approved && r.label.trim() === normalizedLabel);
  if (!rule) {
    return { matched: false, label: normalizedLabel, copied: [], skipped: [], conflicts: [], verified: false };
  }

  const baseRoot = resolve(mountRoot);
  const sourceDir = rule.sourceSubdir ? resolve(baseRoot, rule.sourceSubdir) : baseRoot;
  if (sourceDir !== baseRoot && !sourceDir.startsWith(`${baseRoot}/`) && !sourceDir.startsWith(`${baseRoot}\\`)) {
    throw new Error(`Invalid sourceSubdir outside mount root: ${rule.sourceSubdir}`);
  }
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    return { matched: true, label: normalizedLabel, copied: [], skipped: [], conflicts: [], verified: true };
  }

  const relFiles: string[] = [];
  collectFiles(sourceDir, sourceDir, relFiles);

  const copied: string[] = [];
  const skipped: string[] = [];
  const conflicts: CopyConflict[] = [];

  for (const rel of relFiles) {
    const srcFile = join(sourceDir, rel);
    const dstFile = join(rule.destinationDir, rel);
    const srcDigest = hashFileSha256(srcFile);

    if (existsSync(dstFile)) {
      const dstDigest = hashFileSha256(dstFile);
      if (dstDigest.size === srcDigest.size && dstDigest.sha256 === srcDigest.sha256) {
        skipped.push(rel);
      } else {
        conflicts.push({ path: rel, reason: 'Destination file exists with different content' });
      }
      continue;
    }

    mkdirSync(dirname(dstFile), { recursive: true });
    copyFileSync(srcFile, dstFile);
    const verifyDigest = hashFileSha256(dstFile);
    if (verifyDigest.size !== srcDigest.size || verifyDigest.sha256 !== srcDigest.sha256) {
      conflicts.push({ path: rel, reason: 'Post-copy SHA-256 verification failed' });
    } else {
      copied.push(rel);
    }
  }

  return {
    matched: true,
    label: normalizedLabel,
    copied,
    skipped,
    conflicts,
    verified: conflicts.length === 0,
  };
}
