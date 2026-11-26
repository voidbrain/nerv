import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import ts from 'typescript';

// B-102: backlog IDs (B-045, F-045) are for the repository, not for the owner. A string the code can show, send or
// prompt with never names one; comments may. Scans every string and template literal, so a new one fails here.
// B-158: the Angular workspace (web/src, inline templates included) and every script the browser loads count too.
const ID = /\b[BF]-\d{3}\b/;
const files = [...globSync('src/*.ts'), ...globSync('web/src/**/*.ts'), ...globSync('web/public/**/*.js')].map((f) =>
  f.replaceAll('\\', '/'),
);
function literalsWithIds(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)) &&
      ID.test(node.text)
    ) {
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      found.push(`${file}:${line}: ${node.text.slice(0, 100)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

test('B-102: no string shown to the owner or a model names a backlog ID', () => {
  for (const scanned of ['src/server.ts', 'web/src/dashboard/shell.ts', 'web/public/dashboard/dashboard.js'])
    assert.ok(files.includes(scanned), scanned + ' is scanned');
  assert.deepEqual(files.flatMap(literalsWithIds), []);
});
