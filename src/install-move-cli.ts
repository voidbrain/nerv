import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { readConfig } from './config.ts';
import { installFolder, runningCheckout } from './install-source.ts';
import { moveInstall } from './install-move.ts';
import { applyService } from './node-lifecycle-apply.ts';
import { command, planService, type ServiceHost } from './node-lifecycle-execution.ts';
import { linuxServiceHost } from './node-lifecycle-linux.ts';
import { macServiceHost } from './node-lifecycle-mac.ts';
import { windowsServiceHost } from './node-lifecycle-windows.ts';

const occupied = (path: string): boolean =>
  existsSync(path) && (!statSync(path).isDirectory() || readdirSync(path).length > 0);

const hostFor =
  (home: string) =>
  (source: string): ServiceHost => {
    if (process.platform === 'win32') return windowsServiceHost(home, source);
    if (process.platform === 'linux') return linuxServiceHost(home, source);
    return macServiceHost(home, source);
  };

/** `nerv service move [--to PATH] [--yes]` (F-117-T01): without --yes it only prints what it would do. */
export async function serviceMove(args: string[], home: string): Promise<void> {
  const at = args.indexOf('--to');
  const chosen = at >= 0 ? args[at + 1] : undefined;
  if (at >= 0 && (!chosen || !isAbsolute(chosen))) throw Error('Use --to with an absolute path.');
  const from = runningCheckout();
  const to = chosen ? resolve(chosen) : installFolder(homedir());
  if (!args.includes('--yes')) {
    console.log(
      [
        `Move the NERV service from ${from}`,
        `                         to ${to}`,
        '',
        '1. Clone this checkout into the install folder at the same revision, install dependencies and build.',
        '2. Stop the service, remove its definition (data in ~/.nerv stays), install it from the new folder and start it.',
        '3. Check that the dashboard answers. On any failure the old definition is put back and started.',
        '',
        'Run again with --yes to do it.' + (chosen ? '' : ' Set NERV_INSTALL or --to for another folder.'),
      ].join('\n'),
    );
    return;
  }
  const port = readConfig(home).port;
  const result = await moveInstall({
    from,
    to,
    exec: async (program, programArgs, cwd) => {
      const r = await command(program, programArgs, cwd, 900000);
      return { status: r.status ?? 1, out: r.out };
    },
    occupied,
    host: hostFor(home),
    plan: (host, action) => planService(host, action),
    apply: (host, plan, confirm) => applyService(host, plan, confirm),
    probe: async () => {
      for (let i = 0; i < 30; i++) {
        try {
          if ((await fetch(`http://127.0.0.1:${port}/dashboard/`)).ok) return true;
        } catch {
          // not up yet
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      return false;
    },
    log: (line) => console.log(line),
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.outcome !== 'moved') process.exitCode = 1;
}
