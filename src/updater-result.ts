import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ManualUpdateResult } from './manual-update.ts';
import { resultText } from './update-scheduler.ts';
import { markUpdaterFinished } from './updater-status.ts';

/**
 * B-108-T02: the updater runs outside the service, and a completed update starts the new service before the updater
 * finishes, so the updater leaves its result here and the running service reports it once, then removes it.
 */
export const UPDATER_RESULT = 'updater-result.json';

export function writeUpdaterResult(home: string, result: ManualUpdateResult): void {
  const path = join(home, UPDATER_RESULT);
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify({ version: 1, at: new Date().toISOString(), result }) + '\n', { mode: 0o600 });
  renameSync(tmp, path);
  // B-123: the dashboard's copy, which the inbox report never consumes. Display only: it never fails the report.
  try {
    markUpdaterFinished(home, result);
  } catch {
    /* display only */
  }
}

/** Reports a pending updater result through `notify`; true when something was reported. Never throws on a bad file. */
export async function reportUpdaterResult(
  home: string,
  notify: (message: string) => void | Promise<void>,
  language: 'en' | 'it',
  timeZone: string,
): Promise<boolean> {
  const path = join(home, UPDATER_RESULT);
  if (!existsSync(path)) return false;
  // Claim the file first, so two ticks never report it twice.
  const claimed = path + '.reporting';
  try {
    renameSync(path, claimed);
  } catch {
    return false;
  }
  let message: string;
  try {
    const { result, at } = JSON.parse(readFileSync(claimed, 'utf8')) as { result: ManualUpdateResult; at: string };
    if (!result || typeof result.outcome !== 'string') throw Error('no outcome');
    message = resultText(
      {
        outcome: result.outcome,
        enabled: true,
        target: 'local',
        channel: result.channel,
        revision: result.revision,
        ...(result.planDigest ? { planDigest: result.planDigest } : {}),
        reasons: result.reasons ?? [],
        recovery: result.recovery ?? [],
        ...(result.receipt ? { receipt: result.receipt } : {}),
      },
      { revision: result.revision ?? '', channel: result.channel, applyAt: at },
      undefined,
      timeZone,
      language,
    );
  } catch {
    message =
      language === 'it'
        ? '⚠️ Il risultato dell’aggiornamento non si è potuto leggere: controlla ~/.nerv/updater.log.'
        : '⚠️ The updater result could not be read: check ~/.nerv/updater.log.';
  }
  await notify(message);
  rmSync(claimed, { force: true });
  return true;
}
