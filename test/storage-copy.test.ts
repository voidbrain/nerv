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

describe('F-088-T03 copy report and resuming a partial copy', () => {
  const setup = () => {
    const card = makeDir('nerv-card-');
    const archive = makeDir('nerv-archive-');
    mkdirSync(join(card, 'DCIM'), { recursive: true });
    writeFileSync(join(card, 'DCIM', 'a.jpg'), 'image-a');
    writeFileSync(join(card, 'DCIM', 'b.jpg'), 'image-b');
    writeFileSync(join(card, 'DCIM', 'c.jpg'), 'image-c');
    const rules: CopyRule[] = [{ label: 'CAM_01', sourceSubdir: 'DCIM', destinationDir: archive, approved: true }];
    return { card, archive, rules };
  };

  it('a copy cut off mid-file leaves no partial file under its name, is reported as interrupted, and resumes next insert', () => {
    const { card, archive, rules } = setup();
    // The card is pulled while b.jpg is being copied: the copy dies after writing part of it.
    let calls = 0;
    const pulled = (src: string, dst: string) => {
      calls++;
      if (calls === 2) {
        writeFileSync(dst, 'ima');
        throw Object.assign(new Error('EIO: card removed'), { code: 'EIO' });
      }
      writeFileSync(dst, readFileSync(src));
    };
    const first = runCardCopyRule(card, 'CAM_01', rules, { copyFile: pulled });
    assert.deepEqual(first.copied, ['a.jpg']);
    assert.deepEqual(first.interrupted, ['b.jpg', 'c.jpg']);
    assert.deepEqual(first.conflicts, []);
    assert.equal(first.verified, false);
    assert.equal(existsSync(join(archive, 'b.jpg')), false, 'never a partial file under its real name');
    assert.match(first.summary, /Copied 1, skipped 0, interrupted 2 \(they resume on the next insert\), conflicts 0\./);

    const second = runCardCopyRule(card, 'CAM_01', rules);
    assert.deepEqual(second.copied, ['b.jpg', 'c.jpg'], 'the next insert resumes');
    assert.deepEqual(second.skipped, ['a.jpg']);
    assert.deepEqual(second.conflicts, []);
    assert.equal(second.verified, true);
    assert.equal(readFileSync(join(archive, 'b.jpg'), 'utf8'), 'image-b');
    assert.equal(existsSync(join(archive, 'b.jpg.nerv-partial')), false, 'the leftover partial file is gone');
  });

  it('the report names copied, skipped and conflicting files in one line the owner can read', () => {
    const { card, archive, rules } = setup();
    writeFileSync(join(archive, 'c.jpg'), 'a different picture');
    const r = runCardCopyRule(card, 'CAM_01', rules);
    assert.deepEqual(r.conflicts, [{ path: 'c.jpg', reason: 'Destination file exists with different content' }]);
    assert.equal(
      r.summary,
      'CAM_01: Copied 2, skipped 0, interrupted 0, conflicts 1 (c.jpg: Destination file exists with different content).',
    );
    assert.equal(
      readFileSync(join(archive, 'c.jpg'), 'utf8'),
      'a different picture',
      'a conflict is never overwritten',
    );
    assert.equal(
      runCardCopyRule(card, 'NOPE', rules).summary,
      'NOPE: no approved copy rule for this card; nothing copied.',
    );
  });
});
