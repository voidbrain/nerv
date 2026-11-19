import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
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
  /** F-088-T03: files a pulled card or a failed copy left unfinished; they resume on the next insert. */
  interrupted: string[];
  verified: boolean;
  /** F-088-T03: the report in one line the owner can read. */
  summary: string;
}

/** F-088-T03: a file being copied lives under this suffix until it is verified, so a cut-off copy never looks done. */
export const PARTIAL_SUFFIX = '.nerv-partial';

function summarize(r: Omit<CopyReport, 'summary'>): string {
  if (!r.matched) return `${r.label}: no approved copy rule for this card; nothing copied.`;
  const conflicts = r.conflicts.length
    ? `${r.conflicts.length} (${r.conflicts.map((c) => `${c.path}: ${c.reason}`).join('; ')})`
    : '0';
  const interrupted = r.interrupted.length ? `${r.interrupted.length} (they resume on the next insert)` : '0';
  return `${r.label}: Copied ${r.copied.length}, skipped ${r.skipped.length}, interrupted ${interrupted}, conflicts ${conflicts}.`;
}

function report(r: Omit<CopyReport, 'summary'>): CopyReport {
  return { ...r, summary: summarize(r) };
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
    } else if (entry.isFile() && !entry.name.endsWith(PARTIAL_SUFFIX)) {
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
 * - F-088-T03: each file is copied under a partial name, verified, then renamed into place; a copy cut off (card pulled,
 *   I/O error) leaves no file under its real name, is reported as interrupted, and resumes on the next insert.
 */
export function runCardCopyRule(
  mountRoot: string,
  label: string,
  rules: readonly CopyRule[],
  options: { copyFile?: (src: string, dst: string) => void } = {},
): CopyReport {
  const copyFile = options.copyFile ?? copyFileSync;
  const normalizedLabel = label.trim();
  const rule = rules.find((r) => r.approved && r.label.trim() === normalizedLabel);
  if (!rule) {
    return report({
      matched: false,
      label: normalizedLabel,
      copied: [],
      skipped: [],
      conflicts: [],
      interrupted: [],
      verified: false,
    });
  }

  const baseRoot = resolve(mountRoot);
  const sourceDir = rule.sourceSubdir ? resolve(baseRoot, rule.sourceSubdir) : baseRoot;
  if (sourceDir !== baseRoot && !sourceDir.startsWith(`${baseRoot}/`) && !sourceDir.startsWith(`${baseRoot}\\`)) {
    throw new Error(`Invalid sourceSubdir outside mount root: ${rule.sourceSubdir}`);
  }
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    return report({
      matched: true,
      label: normalizedLabel,
      copied: [],
      skipped: [],
      conflicts: [],
      interrupted: [],
      verified: true,
    });
  }

  const relFiles: string[] = [];
  collectFiles(sourceDir, sourceDir, relFiles);

  const copied: string[] = [];
  const skipped: string[] = [];
  const conflicts: CopyConflict[] = [];
  const interrupted: string[] = [];
  let cutOff = false;

  for (const rel of relFiles) {
    // Once the card is gone, every file left is interrupted: the next insert picks them up.
    if (cutOff) {
      interrupted.push(rel);
      continue;
    }
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
    const partial = dstFile + PARTIAL_SUFFIX;
    // A leftover partial file from an earlier cut-off copy is replaced, never trusted.
    rmSync(partial, { force: true });
    try {
      copyFile(srcFile, partial);
    } catch {
      rmSync(partial, { force: true });
      interrupted.push(rel);
      cutOff = true;
      continue;
    }
    const verifyDigest = hashFileSha256(partial);
    if (verifyDigest.size !== srcDigest.size || verifyDigest.sha256 !== srcDigest.sha256) {
      rmSync(partial, { force: true });
      conflicts.push({ path: rel, reason: 'Post-copy SHA-256 verification failed' });
    } else {
      renameSync(partial, dstFile);
      copied.push(rel);
    }
  }

  return report({
    matched: true,
    label: normalizedLabel,
    copied,
    skipped,
    conflicts,
    interrupted,
    verified: conflicts.length === 0 && interrupted.length === 0,
  });
}
