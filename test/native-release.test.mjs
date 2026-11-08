import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { releaseApp, releaseOptions } from '../native/release-app.mjs';

const identity = 'a'.repeat(40), revision = 'b'.repeat(40), id = '12345678-1234-1234-1234-123456789abc';
function fixture(t, submit = true, fail = null, status = 'Accepted') {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-release-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const options = releaseOptions(['--identity', identity, '--out', join(dir, 'new release'), ...(submit ? ['--submit', '--keychain-profile', 'neutral profile'] : [])]);
  const calls = [];
  const run = (program, args) => {
    calls.push({ program, args });
    if (fail?.(program, args)) throw Error('controlled command failure');
    if (program === 'git') return args[0] === 'status' ? '' : revision;
    if (args[0] === 'notarytool' && args[1] === 'submit') return JSON.stringify({ id, status });
    if (args[0] === 'notarytool' && args[1] === 'log') return JSON.stringify({ status, issues: null });
    if (program.endsWith('/ditto')) writeFileSync(args.at(-1), 'archive');
    return '';
  };
  return { options, calls, run };
}
test('release options require explicit certificate, fresh absolute output and paired upload arguments', () => {
  for (const args of [[], ['--identity','-','--out','/tmp/x'], ['--identity',identity,'--out','relative'], ['--identity',identity,'--out','/tmp/x','--submit'], ['--identity',identity,'--out','/tmp/x','--keychain-profile','x'], ['--identity',identity,'--out','/tmp/x','--password','secret'], ['--identity',identity,'--out','/tmp/x','--submit','--submit']]) assert.throws(() => releaseOptions(args));
});
test('signed-only release never submits and retains provenance without claiming notarization', t => {
  const f = fixture(t, false), result = releaseApp(f.options, f.run);
  assert.equal(result.notarized, false); assert.equal(result.submissionId, null); assert.equal(result.revision, revision);
  assert.equal(f.calls.some(c => c.program.endsWith('/xcrun')), false);
  assert.ok(f.calls.some(c => c.program.endsWith('/codesign') && c.args.includes('runtime') && c.args.includes('--timestamp')));
  assert.equal(result.sha256.length, 64);
  if (process.platform !== 'win32') assert.equal(statSync(join(f.options.out, 'release.json')).mode & 0o777, 0o600);
  assert.throws(() => releaseApp(f.options, f.run), /already exists/);
});
test('accepted submission is logged, stapled, validated and assessed before final packaging', t => {
  const f = fixture(t), result = releaseApp(f.options, f.run);
  assert.equal(result.notarized, true); assert.equal(result.submissionId, id);
  const index = name => f.calls.findIndex(c => c.args[0] === name[0] && c.args[1] === name[1]);
  assert.ok(index(['notarytool','log']) < index(['stapler','staple']));
  assert.ok(index(['stapler','staple']) < index(['stapler','validate']));
  const final = f.calls.findIndex(c => c.args.at(-1) === join(f.options.out, 'NERV-macOS.zip'));
  assert.ok(final > f.calls.findIndex(c => c.program.endsWith('/spctl')));
  assert.ok(f.calls.some(c => c.program.endsWith('/codesign') && c.args.includes('-R')));
  assert.equal(JSON.parse(readFileSync(join(f.options.out,'notary-response.json'))).id, id);
});
test('rejected notarization retains evidence and produces no final archive or success receipt', t => {
  const f = fixture(t, true, null, 'Invalid');
  assert.throws(() => releaseApp(f.options, f.run), /not accepted/);
  assert.ok(existsSync(join(f.options.out,'notary-log.json')));
  assert.equal(existsSync(join(f.options.out,'release.json')), false);
  assert.equal(existsSync(join(f.options.out,'NERV-macOS.zip')), false);
  assert.equal(f.calls.some(c => c.args[0] === 'stapler'), false);
});
test('signature, upload, ticket and assessment failures stop publication without retry', t => {
  for (const target of ['sign', 'submit', 'validate', 'assess']) {
    const fail = (program,args) => target === 'sign' ? program.endsWith('/codesign') : target === 'assess' ? program.endsWith('/spctl') : args[1] === target;
    const f = fixture(t, true, fail);
    assert.throws(() => releaseApp(f.options, f.run), /controlled/);
    assert.equal(existsSync(join(f.options.out,'release.json')), false);
    assert.equal(existsSync(join(f.options.out,'NERV-macOS.zip')), false);
    assert.ok(f.calls.filter(c => c.args[1] === 'submit').length <= 1);
  }
});
test('dirty source or invalid submission identity cannot produce a release', t => {
  const f = fixture(t);
  assert.throws(() => releaseApp(f.options, (p,a) => p === 'git' ? ' M native/file' : f.run(p,a)), /Commit native/);
  assert.equal(f.calls.length, 0);
  const g = fixture(t);
  assert.throws(() => releaseApp(g.options, (p,a) => a[1] === 'submit' ? '{"id":"invalid","status":"Accepted"}' : g.run(p,a)), /submission ID/);
  assert.equal(existsSync(join(g.options.out,'release.json')), false);
});

test('accepted submissions with log warnings wait for review before producing an archive', t => {
  const f = fixture(t);
  assert.throws(() => releaseApp(f.options, (p,a) => a[1] === 'log' ? '{"status":"Accepted","issues":[{"severity":"warning"}]}' : f.run(p,a)), /requires review/);
  assert.equal(existsSync(join(f.options.out,'release.json')), false);
  assert.equal(existsSync(join(f.options.out,'NERV-macOS.zip')), false);
});
