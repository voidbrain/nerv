import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error a plain ES module tool without types
import { parseLcov, toSummary } from '../tools/lcov-summary.mjs';
test('LCOV from the node test runner becomes the json-summary the coverage table reads; untested sources show at zero', () => {
  const root = mkdtempSync(join(tmpdir(), 'nerv-cov-'));
  try {
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'a.ts'), 'x\ny\n');
    writeFileSync(join(root, 'src', 'b.ts'), '// a comment\nconst b=1;\nexport {b};\n');
    const lcov = `SF:${join(root, 'src', 'a.ts')}\nFNF:2\nFNH:1\nBRF:4\nBRH:3\nLF:10\nLH:8\nend_of_record\nSF:${join(root, 'test', 't.ts')}\nLF:5\nLH:5\nend_of_record\n`;
    const files = parseLcov(lcov) as Record<string, { LF: number; LH: number }>;
    assert.deepEqual(Object.keys(files).length, 2);
    const s = toSummary(files, { rootDir: root }) as Record<
      string,
      {
        lines: { total: number; covered: number; pct: number };
        branches: { pct: number };
        functions: { pct: number };
        statements: { pct: number };
      }
    >;
    const a = s[join(root, 'src', 'a.ts')]!;
    assert.deepEqual(
      [a.lines.covered, a.lines.total, a.lines.pct, a.branches.pct, a.functions.pct, a.statements.pct],
      [8, 10, 80, 75, 50, 80],
    );
    assert.equal(s[join(root, 'test', 't.ts')], undefined, 'only files under src/');
    const b = s[join(root, 'src', 'b.ts')]!;
    assert.deepEqual(
      [b.lines.covered, b.lines.total],
      [0, 2],
      'a source no test loaded counts as untested (comments not counted)',
    );
    assert.deepEqual([s.total!.lines.covered, s.total!.lines.total], [8, 12]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
