import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
// F-037: the real Task Scheduler, on the Windows CI runner only (the job builds first: install needs dist/).
test(
  'Windows: service install registers the logon task, status reads it, stop ends NERV, uninstall removes the task and its files',
  { skip: process.platform !== 'win32', timeout: 180000 },
  async () => {
    const home = mkdtempSync(join(tmpdir(), 'nerv-winsvc-'));
    const env = { ...process.env, NERV_HOME: home, NERV_OLLAMA: 'http://127.0.0.1:9' };
    const reserve = createServer();
    await new Promise<void>((d) => reserve.listen(0, '127.0.0.1', d));
    const port = (reserve.address() as { port: number }).port;
    await new Promise<void>((d) => reserve.close(() => d()));
    const cli = (...a: string[]) => spawnSync(process.execPath, ['src/cli.ts', ...a], { env, encoding: 'utf8' });
    const query = () => spawnSync('schtasks', ['/Query', '/TN', 'NERV Agency'], { encoding: 'utf8' }).status === 0;
    const up = async () => {
      try {
        await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) });
        return true;
      } catch {
        return false;
      }
    };
    // Node, cmd and wscript processes with their command lines: the candidates for holding the data folder.
    const holders = () =>
      spawnSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          "Get-CimInstance Win32_Process -Filter \"Name='node.exe' or Name='cmd.exe' or Name='wscript.exe'\" | Select-Object ProcessId,ParentProcessId,Name,CommandLine | Format-List | Out-String -Width 400",
        ],
        { encoding: 'utf8' },
      ).stdout;
    let failure: unknown;
    try {
      assert.equal(cli('init').status, 0);
      const c = JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'));
      writeFileSync(join(home, 'config.json'), JSON.stringify({ ...c, port }));
      const installed = cli('service', 'install');
      assert.equal(installed.status, 0, installed.stderr + installed.stdout);
      assert.match(installed.stdout, /Service installed: the "NERV Agency" task starts NERV Agency at your logon/);
      assert.ok(query(), 'the task exists');
      assert.ok(existsSync(join(home, 'nerv-service.vbs')) && existsSync(join(home, 'nerv-task.xml')));
      assert.match(cli('service', 'install').stderr, /task exists\. Uninstall it explicitly/, 'never a second task');
      const status = cli('service', 'status');
      assert.equal(status.status, 0, status.stderr + status.stdout);
      // The task started at install: wait for the service, then stop it as service stop does.
      let started = false;
      for (let i = 0; i < 60 && !(started = await up()); i++) await new Promise((r) => setTimeout(r, 500));
      if (started) {
        assert.equal(cli('service', 'stop').status, 0);
        assert.equal(await up(), false, 'service stop ends NERV itself, not only the launcher');
      } else
        console.log(
          'The runner did not start the logon task in this session; install, status and uninstall are still checked.',
        );
      const removed = cli('service', 'uninstall');
      assert.equal(removed.status, 0, removed.stderr);
      assert.equal(query(), false, 'the task is gone');
      assert.ok(
        !existsSync(join(home, 'nerv-service.vbs')) && !existsSync(join(home, 'nerv-task.xml')),
        'its files are gone',
      );
      assert.match(cli('service', 'status').stderr, /not installed/);
    } catch (e) {
      failure = e;
    }
    // B-048: an early failure leaves NERV running, so stop it before removing the task, and never let a cleanup
    // error replace the failure that caused it: report both, with what still holds the data folder.
    if (query()) cli('service', 'stop');
    spawnSync('schtasks', ['/Delete', '/TN', 'NERV Agency', '/F']);
    try {
      rmSync(home, { recursive: true, force: true });
    } catch (cleanup) {
      throw new Error(
        [
          `Cleanup could not remove ${home}: ${(cleanup as Error).message}`,
          failure === undefined ? 'The test steps passed.' : `The test failed first: ${(failure as Error).stack}`,
          `Left in the folder: ${JSON.stringify(readdirSync(home, { recursive: true }))}`,
          `Processes: ${holders()}`,
        ].join('\n'),
        { cause: failure },
      );
    }
    if (failure !== undefined) throw failure;
  },
);
