// B-118-T04: the test preload (test/fixtures/sqlite-no-fsync.ts) makes each SQLite connection skip the disk flush,
// keeps a connection's own `synchronous` setting, and leaves the class the code imports usable as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// A URL: `--import` reads a Windows path (D:\...) as a URL scheme.
const preload = pathToFileURL(join(import.meta.dirname, 'fixtures', 'sqlite-no-fsync.ts')).href;
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
const notADatabase = `
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'nerv-nofsync-'));
const file = join(dir, 'bad.sqlite');
writeFileSync(file, 'not a database '.repeat(20));
const db = new DatabaseSync(file);
let read = 'read';
try { db.prepare('PRAGMA user_version').get(); } catch (err) { read = err.message; }
db.close();
rmSync(dir, { recursive: true });
console.log(JSON.stringify({ read }));
`;

test('B-118-T04: with the test preload a connection skips the flush; one that sets its own setting keeps it', () => {
  assert.deepEqual(run(['--import', preload]), { plain: 0, own: 2, later: 2, same: true });
});

test('B-118-T04: without the preload SQLite keeps its default (FULL), so the product is not affected', () => {
  assert.deepEqual(run([]), { plain: 2, own: 2, later: 2, same: true });
});

// Windows run 45566852563 (PR #741): the preload threw on a damaged store, so the code under test never got the
// connection to close, and the temp folder could not be removed (EPERM in coordinator-shipping and snapshots).
test('B-118-T04: a file that is not a database still opens; the first read reports it and the file can be removed', () => {
  const out = execFileSync(process.execPath, ['--import', preload, '--input-type=module', '-e', notADatabase], {
    encoding: 'utf8',
  });
  assert.deepEqual(JSON.parse(out), { read: 'file is not a database' });
});
