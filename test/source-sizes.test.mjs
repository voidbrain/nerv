// @ts-check
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { findLongSourceFiles } from '../tools/check-source-sizes.mjs';

const dirs = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

describe('F-095-T02 source file size warning', () => {
  it('lists files over 600 lines with line and byte counts and skips shorter files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nerv-sizes-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'src'), { recursive: true });
    mkdirSync(join(dir, 'web', 'src'), { recursive: true });

    writeFileSync(join(dir, 'src', 'short.ts'), 'export const ok = 1;\n'.repeat(100), 'utf8');
    writeFileSync(join(dir, 'web', 'src', 'long.ts'), 'export const big = 1;\n'.repeat(650), 'utf8');

    const found = findLongSourceFiles([join(dir, 'src'), join(dir, 'web', 'src')], {
      maxLines: 600,
      cwd: dir,
    });
    assert.equal(found.length, 1);
    assert.equal(found[0].path, 'web/src/long.ts');
    assert.ok(found[0].lines > 600);
    assert.ok(found[0].bytes > 0);
  });

  it('runs check-source-sizes.mjs as warn-only (exit 0)', () => {
    const out = execFileSync(process.execPath, ['tools/check-source-sizes.mjs'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    assert.match(out, /source file\(s\) over 600 lines|All source files/);
  });
});
