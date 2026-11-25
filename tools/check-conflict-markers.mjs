// B-089: fails when a tracked file still holds merge conflict markers. On 2026-11-18 markers reached pushed branches
// twice (a backlog record, the gauntlet ledger) while every other check passed.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** A conflict block: an opening `<<<<<<< ` line, a `=======` line, then a closing `>>>>>>> ` line, in that order. */
function conflictLines(text) {
  const lines = text.split(/\r?\n/);
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^<{7}( |$)/.test(lines[i])) continue;
    const mid = lines.findIndex((l, j) => j > i && /^={7}$/.test(l));
    const end = mid > 0 ? lines.findIndex((l, j) => j > mid && /^>{7}( |$)/.test(l)) : -1;
    if (end > 0) found.push(i + 1);
  }
  return found;
}

function main() {
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const problems = [];
  for (const file of files) {
    let text;
    try {
      const buf = readFileSync(file);
      if (buf.includes(0)) continue; // binary
      text = buf.toString('utf8');
    } catch {
      continue;
    }
    for (const line of conflictLines(text)) problems.push(`${file}:${line}`);
  }
  if (problems.length) {
    console.error(`Merge conflict markers in tracked files: ${problems.join(', ')}. Resolve them before committing.`);
    return 1;
  }
  console.log(`No conflict markers in ${files.length} tracked files.`);
  return 0;
}

process.exitCode = main();
