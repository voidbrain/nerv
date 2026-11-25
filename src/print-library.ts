import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { validatePrintPath } from './fleet.ts';

/**
 * F-121-T01: the Mac's print library (`<NERV home>/prints`, normally ~/.nerv/prints). The fleet stores each
 * part file relative to it; a path is resolved here, refusing anything that ends up outside it.
 */
export function printLibraryRoot(home: string): string {
  return join(home, 'prints');
}

export type PrintFileResolution =
  { status: 'ok'; path: string } | { status: 'missing'; reason: string } | { status: 'refused'; reason: string };

/**
 * Resolve a stored part file inside the library. Absolute paths and `..` are refused by validatePrintPath;
 * a link (the file or any folder on the way) whose real target lies outside the library is refused too.
 */
export function resolvePrintFile(root: string, file: string): PrintFileResolution {
  let path: string;
  try {
    path = validatePrintPath(file);
  } catch (error) {
    return { status: 'refused', reason: (error as Error).message };
  }
  const expected = `prints/${path}`;
  let realRoot: string;
  let realFile: string;
  try {
    realRoot = realpathSync(root);
    realFile = realpathSync(join(root, ...path.split('/')));
  } catch {
    return { status: 'missing', reason: `Part file not found: ${expected} (print library ${root}).` };
  }
  const inside = relative(realRoot, realFile);
  if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    return {
      status: 'refused',
      reason: `Part file ${expected} is a link to ${realFile}, outside the print library; links must stay inside it.`,
    };
  }
  if (!statSync(realFile).isFile()) return { status: 'refused', reason: `Part file ${expected} is not a file.` };
  return { status: 'ok', path: realFile };
}
