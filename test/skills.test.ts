import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  activateSkillVersion,
  listSkillPackages,
  loadSkillVersion,
  retireSkillPackage,
  rollbackSkillVersion,
  stageSkillPackage,
  type SkillPackage,
} from '../src/skills.ts';

function sampleSkill(version = '1.0.0', parentVersion?: string): SkillPackage {
  return {
    manifest: {
      id: 'local-check',
      version,
      title: 'Local Check Skill',
      domain: 'Diagnostics',
      description: 'Neutral test skill package for isolated storage and version checks.',
      entryScript: 'check.sh',
      references: ['notes.md'],
      requiredCapabilities: ['read-status'],
      ...(parentVersion ? { parentVersion } : {}),
      createdAt: '2026-11-13T00:00:00.000Z',
    },
    instructions: '# Local Check\nRun the neutral check script and report status.\n',
    scripts: { 'check.sh': '#!/usr/bin/env sh\necho ok\n' },
    references: { 'notes.md': '# Notes\nNeutral fixture reference.\n' },
  };
}

describe('skill package format, isolated storage and versions (F-007-T06)', () => {
  it('stages immutable versions privately, requires owner approval to promote, and rolls back cleanly', () => {
    const home = mkdtempSync(join(tmpdir(), 'nerv-skills-'));
    try {
      const staged = stageSkillPackage(home, sampleSkill('1.0.0'));
      assert.equal(staged.status, 'staged');

      const pkgDir = join(home, 'skills', 'packages', 'local-check', '1.0.0');
      assert.ok(existsSync(join(pkgDir, 'manifest.json')));
      assert.ok(existsSync(join(pkgDir, 'SKILL.md')));
      assert.ok(existsSync(join(pkgDir, 'scripts', 'check.sh')));
      assert.ok(existsSync(join(pkgDir, 'references', 'notes.md')));
      if (process.platform !== 'win32') {
        assert.equal(statSync(pkgDir).mode & 0o777, 0o700);
        assert.equal(statSync(join(pkgDir, 'manifest.json')).mode & 0o777, 0o600);
      }

      // Immutable: re-staging same version is refused.
      assert.throws(() => stageSkillPackage(home, sampleSkill('1.0.0')), /immutable/i);

      // No silent promotion.
      assert.throws(
        () => activateSkillVersion(home, 'local-check', '1.0.0', { ownerApproved: false }),
        /owner approval/i,
      );
      assert.equal(listSkillPackages(home)[0]?.activeVersion, undefined);

      // Explicit owner promotion activates 1.0.0.
      const promoted1 = activateSkillVersion(home, 'local-check', '1.0.0', { ownerApproved: true });
      assert.equal(promoted1.activeVersion, '1.0.0');

      // Stage and promote 1.1.0, then roll back to 1.0.0.
      stageSkillPackage(home, sampleSkill('1.1.0', '1.0.0'));
      const promoted2 = activateSkillVersion(home, 'local-check', '1.1.0', { ownerApproved: true });
      assert.equal(promoted2.activeVersion, '1.1.0');
      assert.equal(promoted2.previousActiveVersion, '1.0.0');

      const rolledBack = rollbackSkillVersion(home, 'local-check', { ownerApproved: true });
      assert.equal(rolledBack.activeVersion, '1.0.0');
      assert.equal(rolledBack.versions.find((v) => v.version === '1.1.0')?.status, 'rolled-back');

      const loaded = loadSkillVersion(home, 'local-check', '1.0.0');
      assert.equal(loaded.manifest.id, 'local-check');
      assert.equal(loaded.scripts?.['check.sh'], '#!/usr/bin/env sh\necho ok\n');

      // Retire skill package.
      const retired = retireSkillPackage(home, 'local-check', { ownerApproved: true });
      assert.equal(retired.activeVersion, undefined);
      assert.ok(retired.versions.every((v) => v.status === 'retired'));
      assert.throws(() => activateSkillVersion(home, 'local-check', '1.0.0', { ownerApproved: true }), /retired/i);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('rejects path traversal, missing declared scripts/references, and symlinks in storage', () => {
    const home = mkdtempSync(join(tmpdir(), 'nerv-skills-sec-'));
    try {
      const badPath = sampleSkill('1.0.0');
      badPath.manifest.entryScript = '../escape.sh';
      badPath.scripts = { '../escape.sh': 'echo bad' };
      assert.throws(() => stageSkillPackage(home, badPath), /safe relative path/i);

      const missingRef = sampleSkill('1.0.0');
      missingRef.references = {};
      assert.throws(() => stageSkillPackage(home, missingRef), /missing from references/i);

      stageSkillPackage(home, sampleSkill('1.0.0'));
      if (process.platform !== 'win32') {
        const outside = join(home, 'outside.md');
        writeFileSync(outside, 'secret');
        const refPath = join(home, 'skills', 'packages', 'local-check', '1.0.0', 'references', 'notes.md');
        rmSync(refPath);
        symlinkSync(outside, refPath);
        assert.throws(() => loadSkillVersion(home, 'local-check', '1.0.0'), /symlink/i);
      }
      assert.equal(readFileSync(join(home, 'skills', 'registry.json'), 'utf8').includes('local-check'), true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
