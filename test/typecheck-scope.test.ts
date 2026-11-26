import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';

// B-155: Node strips the types of a test and runs it unchecked, so a wrong call in a JavaScript test ran silently.
// Every test/*.mjs and test/fixtures/*.mjs opts into checking with `// @ts-check` on its first line, which
// `npm run typecheck` reads through tsconfig.test-js.json; a file not yet clean is listed by name in its `deferred`
// (B-155 records why), and leaves the list once it is checked.

test('B-155: every JavaScript test is type-checked by npm run typecheck, or deferred by name', () => {
  const files = [...globSync('test/*.mjs'), ...globSync('test/fixtures/*.mjs')].map((f) => f.replaceAll('\\', '/'));
  assert.ok(files.length > 40, 'the JavaScript tests are found');
  const config = JSON.parse(readFileSync('tsconfig.test-js.json', 'utf8'));
  const DEFERRED: string[] = config.deferred ?? [];
  const unchecked = files.filter((f) => !/^\/\/ @ts-check\r?\n/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(unchecked.filter((f) => !DEFERRED.includes(f)).sort(), [], 'without // @ts-check');
  for (const f of DEFERRED) assert.ok(unchecked.includes(f), f + ' is deferred but already checked: remove it');
  assert.equal(config.compilerOptions.allowJs, true);
  assert.deepEqual(config.include, ['test/*.mjs', 'test/fixtures/*.mjs']);
  const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
  assert.match(scripts.typecheck, /tsc -p tsconfig\.test-js\.json/);
});
