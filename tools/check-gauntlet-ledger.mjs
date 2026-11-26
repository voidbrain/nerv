// B-165: fails when the working tree's Gauntlet run ledger lacks an entry its base had. On 2026-11-26 a full local
// test run rewrote evals/gauntlet/ledger.json (122 -> 104 entries) and a docs PR (#806) committed it while every
// check passed. An entry may leave only with its case: a pack/case no longer in the catalogue is not a drop.
// Base: the merge base of HEAD and origin/main (a branch behind main is not blamed for entries main gained since), or
// --base=<ref>. Run from the repository root. Limit: an entry rewritten in place (same pack, case and profile, a newer
// run) is not a drop, so a fixture run recorded over a real one passes; the test-runner guard in gauntlet.mjs covers
// that path.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { commonPacks, systemPacks } from './gauntlet.mjs';

const ledgerFile = 'evals/gauntlet/ledger.json';
const key = (e) => `${e.pack}/${e.case} (profile ${e.profileHash ?? 'none'})`;

/** Entries of `base` missing from `current`, except those whose pack/case is no longer in `catalogue`. */
export function droppedEntries(base, current, catalogue) {
  const kept = new Set(current.entries.map(key));
  return base.entries.filter((e) => !kept.has(key(e)) && catalogue.has(`${e.pack}/${e.case}`)).map(key);
}

function main(args) {
  const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const named = args.find((a) => a.startsWith('--base='))?.slice('--base='.length);
  let base;
  try {
    base = named ?? git('merge-base', 'HEAD', 'origin/main');
  } catch {
    console.log('Gauntlet ledger check skipped: no origin/main to compare with (fetch it, or pass --base=<ref>).');
    return 0;
  }
  let before;
  try {
    before = JSON.parse(git('show', `${base}:${ledgerFile}`));
  } catch {
    // A base the caller named must hold a readable ledger; the default base merely may not have one yet.
    if (named) {
      console.error(`Cannot read ${ledgerFile} at --base=${named}.`);
      return 2;
    }
    console.log(`Gauntlet ledger check skipped: ${ledgerFile} is not in ${base}.`);
    return 0;
  }
  const now = JSON.parse(readFileSync(ledgerFile, 'utf8'));
  const catalogue = new Set([...commonPacks(), ...systemPacks()].flatMap(({ pack }) => pack.cases.map((c) => `${pack.id}/${c.id}`)));
  const dropped = droppedEntries(before, now, catalogue);
  if (dropped.length) {
    console.error(
      `${ledgerFile} lost ${dropped.length} of ${before.entries.length} entries its base ${base.slice(0, 12)} had ` +
        `(B-165: a local test run may have rewritten it; restore it with git checkout origin/main -- ${ledgerFile}):\n` +
        dropped.map((d) => '  ' + d).join('\n'),
    );
    return 1;
  }
  console.log(`${ledgerFile} keeps all ${before.entries.length} entries of ${base.slice(0, 12)} (${now.entries.length} now).`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = main(process.argv.slice(2));
