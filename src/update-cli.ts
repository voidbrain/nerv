import type { ServiceHost } from './node-lifecycle-execution.ts';
import { linuxServiceHost } from './node-lifecycle-linux.ts';
import { macServiceHost } from './node-lifecycle-mac.ts';
import { windowsServiceHost } from './node-lifecycle-windows.ts';
import { lifecycleGit, nervUpdate } from './nerv-update.ts';
import { writeUpdaterResult } from './updater-result.ts';

const USAGE = 'Usage: nerv update [--check]';

/** `nerv update [--check]` (F-117-T02): wiring only; the logic is in nerv-update.ts. */
export async function updateCommand(args: string[], home: string): Promise<void> {
  if (args.some((a) => a !== '--check')) throw Error(USAGE);
  if (!['darwin', 'linux', 'win32'].includes(process.platform))
    throw Error('nerv update supports macOS, Linux and Windows only; nothing was changed.');
  // The host resolves the install folder (~/.nerv-app, or NERV_INSTALL), not the checkout this command runs from.
  const host: ServiceHost =
    process.platform === 'win32'
      ? windowsServiceHost(home)
      : process.platform === 'linux'
        ? linuxServiceHost(home)
        : macServiceHost(home);
  const report = await nervUpdate(
    {
      host,
      git: lifecycleGit,
      writeResult: (result) => writeUpdaterResult(home, result),
    },
    { check: args.includes('--check') },
  );
  console.log(report.lines.join('\n'));
  if (!report.ok) process.exitCode = 1;
}
