import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ServiceContext } from './node-lifecycle-execution.ts';
import { NODE_FLAGS } from './process-client.ts';

/**
 * B-108: the updater runs as its own OS job, never as a child of the service it stops. A child of the launchd or
 * systemd service would be stopped with it, and the lifecycle counts the service's descendants as part of it.
 */
export const UPDATER_LABEL = 'io.nerv.updater';
export const UPDATER_UNIT = 'nerv-updater';

export interface UpdaterRequest {
  channel: string;
  revision: string;
}

/** The command the updater job runs: `nerv nodes self-update` from the install folder. */
export function updaterCommand(c: ServiceContext, r: UpdaterRequest): string[] {
  if (!/^[a-f0-9]{40}$/.test(r.revision)) throw Error('Invalid target revision.');
  if (!/^[a-z0-9][a-z0-9._/-]*$/i.test(r.channel)) throw Error('Invalid update channel.');
  return [
    c.node,
    ...NODE_FLAGS,
    join(c.source, 'src/cli.ts'),
    'nodes',
    'self-update',
    '--revision',
    r.revision,
    '--channel',
    r.channel,
  ];
}

const xml = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A one-shot launchd job: runs at load, never kept alive, logs next to the service logs. */
export function updaterPlist(c: ServiceContext, r: UpdaterRequest): string {
  const args = updaterCommand(c, r)
    .map((a) => `    <string>${xml(a)}</string>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${UPDATER_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>WorkingDirectory</key><string>${xml(c.source)}</string>
  <key>EnvironmentVariables</key>
  <dict><key>NERV_HOME</key><string>${xml(c.home)}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
  <key>StandardOutPath</key><string>${xml(join(c.home, 'updater.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(join(c.home, 'updater.log'))}</string>
</dict>
</plist>
`;
}

export type Run = (program: string, args: string[]) => Promise<{ status: number | null; err?: string }>;

/** Start the updater job for this platform; throws when it cannot be started. */
export async function startUpdaterJob(
  c: ServiceContext,
  r: UpdaterRequest,
  run: Run,
  platform: NodeJS.Platform = process.platform,
  write: (path: string, body: string) => void = (path, body) => {
    mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 });
    writeFileSync(path, body, { mode: 0o600 });
  },
): Promise<void> {
  if (platform === 'darwin') {
    const domain = 'gui/' + c.uid;
    const plist = join(c.userHome, '.nerv-lifecycle', 'updater', UPDATER_LABEL + '.plist');
    // A finished earlier run stays loaded; remove it first (absent is fine).
    await run('launchctl', ['bootout', domain + '/' + UPDATER_LABEL]);
    write(plist, updaterPlist(c, r));
    const loaded = await run('launchctl', ['bootstrap', domain, plist]);
    if (loaded.status !== 0) throw Error('launchctl bootstrap of the updater failed: ' + (loaded.err ?? '').trim());
    return;
  }
  if (platform === 'linux') {
    const started = await run('systemd-run', [
      '--user',
      '--unit=' + UPDATER_UNIT,
      '--collect',
      '--setenv=NERV_HOME=' + c.home,
      '--working-directory=' + c.source,
      ...updaterCommand(c, r),
    ]);
    if (started.status !== 0) throw Error('systemd-run of the updater failed: ' + (started.err ?? '').trim());
    return;
  }
  throw Error('No updater outside the service is available on this platform.');
}
