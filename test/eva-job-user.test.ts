// B-099-T02: EVA jobs as a dedicated user. A stand-in sudo runs the job as the owner (tests cannot create users) and
// never runs `kill -1`, which as the owner would end every process of theirs; it records what NERV asked for.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig } from '../src/config.ts';
import { stageRuntime, validateJobUser, type EvaJobUser } from '../src/eva-job-user.ts';
import { runEvaJob, type EvaJobEvent } from '../src/eva-runner.ts';

const isDarwinWithSandbox = process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec');
const scratch = (name: string) => realpathSync(mkdtempSync(join(tmpdir(), `nerv-jobuser-${name}-`)));

/** A stand-in sudo and ps in `dir`: sudo logs each call and runs it (kill only logged); ps prints `survivors`. */
function standIns(dir: string, survivors = '') {
  const log = join(dir, 'sudo.log');
  const sudo = join(dir, 'sudo');
  writeFileSync(
    sudo,
    `#!/bin/sh\necho "$*" >> '${log}'\n[ "$1" = -n ] && [ "$2" = -u ] && [ "$4" = -- ] || exit 9\nshift 4\n[ "$1" = /bin/kill ] && exit 0\nexec "$@"\n`,
  );
  const ps = join(dir, 'ps');
  writeFileSync(ps, survivors ? `#!/bin/sh\necho ${survivors}\n` : '#!/bin/sh\nexit 1\n');
  chmodSync(sudo, 0o755);
  chmodSync(ps, 0o755);
  return { sudo, ps, log: () => (existsSync(log) ? readFileSync(log, 'utf8') : '') };
}

describe('B-099-T02: EVA jobs as a dedicated job user', () => {
  it('config takes a plain user name and an absolute plain folder, nothing else', () => {
    assert.deepEqual(validateJobUser({ name: '_nervjob', sharedRoot: '/Users/Shared/nerv-eva' }), {
      name: '_nervjob',
      sharedRoot: '/Users/Shared/nerv-eva',
    });
    assert.equal(validateJobUser(undefined), undefined);
    for (const bad of [
      { name: 'root; rm', sharedRoot: '/Users/Shared/x' },
      { name: '_nervjob', sharedRoot: 'relative/path' },
      { name: '_nervjob', sharedRoot: '/Users/Shared/../etc' },
      { name: '_nervjob', sharedRoot: '/x', extra: 1 },
    ])
      assert.throws(() => validateJobUser(bad), /Invalid eva\.jobUser/, JSON.stringify(bad));
  });

  it('nerv eva job-user sets it, shows it and turns it off', () => {
    const home = scratch('home');
    try {
      const cli = (...a: string[]) =>
        spawnSync(process.execPath, ['src/cli.ts', 'eva', 'job-user', ...a], {
          env: { ...process.env, NERV_HOME: home, NERV_OLLAMA: 'http://127.0.0.1:9' },
          encoding: 'utf8',
        });
      assert.match(
        cli('_nervjob', '/Users/Shared/nerv-eva').stdout,
        /EVA jobs run as _nervjob in \/Users\/Shared\/nerv-eva\./,
      );
      assert.deepEqual(readConfig(home).eva?.jobUser, { name: '_nervjob', sharedRoot: '/Users/Shared/nerv-eva' });
      assert.match(cli().stdout, /EVA jobs run as _nervjob/);
      assert.match(cli('off').stdout, /EVA jobs run as you again/);
      assert.equal(readConfig(home).eva?.jobUser, undefined);
      assert.notEqual(cli('root; rm -rf /', '/x').status, 0);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it(
    'a job runs through sudo as the job user in the shared folder; at the end everything of that user is killed and checked',
    { skip: !isDarwinWithSandbox },
    async () => {
      const shared = scratch('shared'),
        bin = scratch('bin');
      const fake = standIns(bin);
      const user: EvaJobUser = { name: '_testjob', sharedRoot: shared, sudoPath: fake.sudo, psPath: fake.ps };
      const events: EvaJobEvent[] = [];
      try {
        const r = await runEvaJob({
          jobId: 'as-user',
          evaClass: 'eva-03',
          command: process.execPath,
          args: ['-e', 'require("fs").writeFileSync("out.txt","x"); console.log(process.cwd())'],
          jobUser: user,
          onEvent: (e) => events.push(e),
        });
        assert.equal(r.exitCode, 0, r.stderr);
        assert.ok(r.stdout.trim().startsWith(shared), 'the instance lives in the shared folder');
        const calls = fake.log().trim().split('\n');
        assert.match(calls[0]!, /^-n -u _testjob -- \/usr\/bin\/sandbox-exec -f \S+eva03\.sb /);
        assert.ok(calls.includes('-n -u _testjob -- /bin/kill -KILL -1'), 'everything of the job user is killed');
        assert.equal(r.tracked, true);
        assert.deepEqual(r.survivors, []);
        assert.equal(events.at(-1)?.uncertainExternalEffect, false);
        assert.equal(r.workspaceDiscarded, true);
        assert.deepEqual(readdirSync(shared), [], 'nothing is left in the shared folder');
      } finally {
        rmSync(shared, { recursive: true, force: true });
        rmSync(bin, { recursive: true, force: true });
      }
    },
  );

  it(
    'a process of the job user still there after kill -1 makes the end uncertain, never clean',
    { skip: !isDarwinWithSandbox },
    async () => {
      const shared = scratch('shared'),
        bin = scratch('bin');
      const fake = standIns(bin, '4242');
      const events: EvaJobEvent[] = [];
      try {
        const r = await runEvaJob({
          jobId: 'survivor',
          evaClass: 'eva-03',
          command: process.execPath,
          args: ['-e', 'console.log(1)'],
          jobUser: { name: '_testjob', sharedRoot: shared, sudoPath: fake.sudo, psPath: fake.ps },
          onEvent: (e) => events.push(e),
        });
        assert.ok(r.survivors.includes(4242));
        assert.equal(events.at(-1)?.uncertainExternalEffect, true);
        assert.match(events.at(-1)?.detail ?? '', /still running after the job ended: .*4242/);
      } finally {
        rmSync(shared, { recursive: true, force: true });
        rmSync(bin, { recursive: true, force: true });
      }
    },
  );

  it(
    'the runtime copy is made once per revision, readable and never writable',
    { skip: process.platform !== 'darwin' },
    () => {
      const shared = scratch('shared'),
        repo = scratch('repo');
      mkdirSync(join(repo, 'src'));
      mkdirSync(join(repo, 'node_modules', 'pkg'), { recursive: true });
      writeFileSync(join(repo, 'src', 'tools-process.ts'), 'console.log(1)');
      writeFileSync(join(repo, 'node_modules', 'pkg', 'index.js'), 'module.exports=1');
      writeFileSync(join(repo, 'package.json'), '{"name":"fixture"}');
      try {
        const user: EvaJobUser = { name: '_testjob', sharedRoot: shared };
        const a = stageRuntime(user, repo);
        assert.equal(readFileSync(join(a.src, 'tools-process.ts'), 'utf8'), 'console.log(1)');
        assert.ok(
          existsSync(a.node) && existsSync(join(a.nodeModules, 'pkg', 'index.js')) && existsSync(a.packageJson),
        );
        assert.throws(() => writeFileSync(join(a.src, 'tools-process.ts'), 'tampered'), /EACCES|EPERM/);
        assert.deepEqual(stageRuntime(user, repo), a, 'the same revision is not copied again');
        assert.equal(spawnSync(a.node, ['-e', 'console.log(2)'], { encoding: 'utf8' }).stdout.trim(), '2');
      } finally {
        spawnSync('/bin/chmod', ['-R', 'u+w', shared]);
        rmSync(shared, { recursive: true, force: true });
        rmSync(repo, { recursive: true, force: true });
      }
    },
  );
});
