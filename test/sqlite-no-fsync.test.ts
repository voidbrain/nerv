// B-118-T04: the test preload (test/fixtures/sqlite-no-fsync.ts) makes each SQLite connection skip the disk flush,
// keeps a connection's own `synchronous` setting, and leaves the class the code imports usable as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const preload = join(import.meta.dirname, 'fixtures', 'sqlite-no-fsync.ts');
const script = `
import { DatabaseSync } from 'node:sqlite';
const plain = new DatabaseSync(':memory:');
const own = new DatabaseSync(':memory:');
own.exec('PRAGMA synchronous=FULL');
const later = new DatabaseSync(':memory:', { open: false });
later.open();
const read = (db) => db.prepare('PRAGMA synchronous').get().synchronous;
console.log(JSON.stringify({ plain: read(plain), own: read(own), later: read(later), same: plain instanceof DatabaseSync }));
`;
const run = (args: string[]) =>
  JSON.parse(execFileSync(process.execPath, [...args, '--input-type=module', '-e', script], { encoding: 'utf8' }));

test('B-118-T04: with the test preload a connection skips the flush; one that sets its own setting keeps it', () => {
  assert.deepEqual(run(['--import', preload]), { plain: 0, own: 2, later: 2, same: true });
});

test('B-118-T04: without the preload SQLite keeps its default (FULL), so the product is not affected', () => {
  assert.deepEqual(run([]), { plain: 2, own: 2, later: 2, same: true });
});
