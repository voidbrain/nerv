import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Default install folder under the user's home (F-117): the service runs from here, never from a development checkout. */
export const DEFAULT_INSTALL_DIR = '.nerv-app';

/** The install folder: `NERV_INSTALL` when it is an absolute path, otherwise `~/.nerv-app`. */
export function installFolder(userHome: string, env: Record<string, string | undefined> = process.env): string {
  const chosen = env.NERV_INSTALL?.trim();
  if (chosen) {
    if (!isAbsolute(chosen) || /[\r\n\0]/.test(chosen)) throw Error('NERV_INSTALL must be an absolute path.');
    return resolve(chosen);
  }
  return join(userHome, DEFAULT_INSTALL_DIR);
}

/** True when the folder holds a NERV checkout the service can run (its CLI entry point exists). */
export const holdsNerv = (folder: string, exists: (path: string) => boolean = existsSync): boolean =>
  exists(join(folder, 'src/cli.ts')) && exists(join(folder, 'package.json'));

/** The checkout this code runs from. */
export const runningCheckout = (): string => realpathSync(fileURLToPath(new URL('..', import.meta.url)));

/**
 * The checkout a lifecycle operation manages (F-117): the install folder once it holds NERV, otherwise the running
 * checkout (a base that has not moved yet). Run from the install folder itself, both are the same path.
 */
export function serviceSource(options: {
  userHome: string;
  running?: string;
  env?: Record<string, string | undefined>;
  exists?: (path: string) => boolean;
  real?: (path: string) => string;
}): string {
  const folder = installFolder(options.userHome, options.env);
  const real = options.real ?? realpathSync;
  if (holdsNerv(folder, options.exists)) return real(folder);
  return options.running ?? runningCheckout();
}
