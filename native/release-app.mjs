#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function releaseOptions(args) {
  const options = { submit: false };
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--submit' && !options.submit) { options.submit = true; continue; }
    const field = { '--identity': 'identity', '--keychain-profile': 'profile', '--out': 'out' }[key];
    if (!field || options[field] !== undefined || !args[i + 1] || args[i + 1].startsWith('--')) throw Error('Use --identity CERTIFICATE-SHA1 --out NEW-DIRECTORY [--submit --keychain-profile PROFILE].');
    options[field] = args[++i];
  }
  if (!/^[a-fA-F0-9]{40}$/.test(options.identity ?? '')) throw Error('Select an explicit Developer ID Application certificate by its 40-character SHA-1 fingerprint.');
  if (!options.out || !isAbsolute(options.out)) throw Error('--out must be an absolute, new directory.');
  if (options.submit !== Boolean(options.profile) || (options.profile && !/^[\w .-]{1,80}$/.test(options.profile))) throw Error('--submit and --keychain-profile must be supplied together; credentials stay in Keychain.');
  return options;
}
function systemRun(program, args) {
  const result = spawnSync(program, args, { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 30 * 60 * 1000 });
  if (result.error || result.status !== 0) throw Error(`${program} failed or timed out. Retain this output directory and reconcile any submission before retrying.`);
  return result.stdout;
}
/** No upload occurs without --submit. A failed/uncertain run retains evidence and never retries. */
export function releaseApp(options, run = systemRun) {
  if (existsSync(options.out)) throw Error('Output already exists; retain it for reconciliation and choose a new directory.');
  mkdirSync(options.out, { mode: 0o700 });
  const app = join(options.out, 'NERV.app'), archive = join(options.out, 'NERV-macOS.zip');
  const save = (name, data) => writeFileSync(join(options.out, name), JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  save('request.json', { version: 1, identity: options.identity, submit: options.submit });
  const dirty = run('git', ['status', '--porcelain', '--untracked-files=all', '--', 'native']).trim();
  if (dirty) throw Error('Commit native source changes before producing a release.');
  const revision = run('git', ['rev-parse', 'HEAD']).trim();
  if (!/^[a-f0-9]{40}$/.test(revision)) throw Error('Cannot establish release source revision.');
  run('sh', ['native/build-app.sh', app]);
  run('/usr/bin/codesign', ['--force', '--sign', options.identity, '--options', 'runtime', '--timestamp', app]);
  // Enforce Developer ID Application, rather than accepting another valid signing certificate.
  run('/usr/bin/codesign', ['--verify', '--strict', '-R', 'anchor apple generic and certificate leaf[field.1.2.840.113635.100.6.1.13] exists', app]);
  let submission = null;
  if (options.submit) {
    const upload = join(options.out, 'submission.zip');
    run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, upload]);
    const response = run('/usr/bin/xcrun', ['notarytool', 'submit', upload, '--keychain-profile', options.profile, '--wait', '--output-format', 'json']);
    writeFileSync(join(options.out, 'notary-response.json'), response, { mode: 0o600, flag: 'wx' });
    submission = JSON.parse(response);
    if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(submission.id ?? '')) throw Error('No valid submission ID; reconcile with notarytool history before retrying.');
    const log = run('/usr/bin/xcrun', ['notarytool', 'log', submission.id, '--keychain-profile', options.profile]);
    writeFileSync(join(options.out, 'notary-log.json'), log, { mode: 0o600, flag: 'wx' });
    if (submission.status !== 'Accepted') throw Error('Notarization was not accepted. Review the retained notary log; no distribution archive was produced.');
    const report = JSON.parse(log);
    if (report.status !== 'Accepted' || (report.issues !== null && (!Array.isArray(report.issues) || report.issues.length))) throw Error('Notary log requires review; no distribution archive was produced.');
    run('/usr/bin/xcrun', ['stapler', 'staple', app]);
    run('/usr/bin/xcrun', ['stapler', 'validate', app]);
    run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', app]);
  }
  // Package after stapling so the distributed app includes the ticket.
  run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, archive]);
  const result = { version: 1, revision, signed: true, notarized: options.submit, submissionId: submission?.id ?? null, archive: 'NERV-macOS.zip', sha256: createHash('sha256').update(readFileSync(archive)).digest('hex') };
  save('release.json', result);
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(releaseApp(releaseOptions(process.argv.slice(2))), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
