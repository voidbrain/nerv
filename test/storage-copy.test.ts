import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { runCardCopyRule, type CopyRule } from '../src/storage-copy.ts';

const dirs: string[] = [];
const makeDir = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('F-088-T02 storage base card copy rule', () => {
  it('copies and SHA-256 verifies new files, skips on second run, flags conflicts, and never alters source', () => {
    const cardRoot = makeDir('nerv-card-');
    const archiveRoot = makeDir('nerv-archive-');
    mkdirSync(join(cardRoot, 'DCIM'), { recursive: true });
    const srcA = join(cardRoot, 'DCIM', 'IMG_0001.JPG');
    const srcB = join(cardRoot, 'DCIM', 'IMG_0002.JPG');
    writeFileSync(srcA, 'neutral-frame-a', 'utf8');
    writeFileSync(srcB, 'neutral-frame-b', 'utf8');

    const rules: CopyRule[] = [
      { label: 'DRONE_SD', sourceSubdir: 'DCIM', destinationDir: archiveRoot, approved: true },
    ];

    const first = runCardCopyRule(cardRoot, 'DRONE_SD', rules);
    assert.equal(first.matched, true);
    assert.equal(first.verified, true);
    assert.deepEqual(first.copied, ['IMG_0001.JPG', 'IMG_0002.JPG']);
    assert.deepEqual(first.skipped, []);
    assert.deepEqual(first.conflicts, []);
    assert.equal(readFileSync(join(archiveRoot, 'IMG_0001.JPG'), 'utf8'), 'neutral-frame-a');
    assert.equal(readFileSync(srcA, 'utf8'), 'neutral-frame-a');

    // Second run is idempotent
    const second = runCardCopyRule(cardRoot, 'DRONE_SD', rules);
    assert.equal(second.verified, true);
    assert.deepEqual(second.copied, []);
    assert.deepEqual(second.skipped, ['IMG_0001.JPG', 'IMG_0002.JPG']);
    assert.deepEqual(second.conflicts, []);

    // Different content at existing destination path is reported as conflict without overwriting
    writeFileSync(join(archiveRoot, 'IMG_0001.JPG'), 'different-existing-file', 'utf8');
    const conflictRun = runCardCopyRule(cardRoot, 'DRONE_SD', rules);
    assert.equal(conflictRun.verified, false);
    assert.equal(conflictRun.conflicts.length, 1);
    assert.equal(conflictRun.conflicts[0].path, 'IMG_0001.JPG');
    assert.equal(readFileSync(join(archiveRoot, 'IMG_0001.JPG'), 'utf8'), 'different-existing-file');
  });

  it('does nothing for unknown or unapproved card labels', () => {
    const cardRoot = makeDir('nerv-card-unknown-');
    const archiveRoot = makeDir('nerv-archive-unknown-');
    writeFileSync(join(cardRoot, 'note.txt'), 'fixture', 'utf8');

    const rules: CopyRule[] = [{ label: 'DRONE_SD', destinationDir: archiveRoot, approved: false }];

    const unapproved = runCardCopyRule(cardRoot, 'DRONE_SD', rules);
    assert.equal(unapproved.matched, false);
    assert.equal(existsSync(join(archiveRoot, 'note.txt')), false);

    const unknown = runCardCopyRule(cardRoot, 'RANDOM_USB', rules);
    assert.equal(unknown.matched, false);
    assert.equal(existsSync(join(archiveRoot, 'note.txt')), false);
  });
});
