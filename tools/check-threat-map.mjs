import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_DOC_PATH = 'docs/security/agentic-threats.md';
const RISK_ROW_RE = /^\|\s*((?:ASI|LLM|MCP)\d+)\s*\|/;
const TEST_PATH_RE = /`(test\/[^`]+)`/g;
const NAMED_GAP_RE = /\bgap\b[^|]*\bF-\d{3}\b/i;

/**
 * Validates that every risk row in the threat map cites an existing test file
 * or a named backlog gap (`gap, \`F-xxx\``), and that every cited test exists.
 *
 * @param {object} [options]
 * @param {string} [options.rootDir]
 * @param {string} [options.docPath]
 * @returns {{ ok: boolean, checkedRows: number, errors: string[] }}
 */
export function checkThreatMap(options = {}) {
  const rootDir = resolve(options.rootDir ?? process.cwd());
  const docPath = resolve(rootDir, options.docPath ?? DEFAULT_DOC_PATH);

  if (!existsSync(docPath)) {
    return {
      ok: false,
      checkedRows: 0,
      errors: [`Threat map not found: ${docPath}`],
    };
  }

  const content = readFileSync(docPath, 'utf8');
  const lines = content.split(/\r?\n/);
  const errors = [];
  let checkedRows = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const rowMatch = RISK_ROW_RE.exec(line);
    if (!rowMatch) continue;

    checkedRows += 1;
    const riskId = rowMatch[1];
    const lineNumber = i + 1;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());

    if (cells.length < 5) {
      errors.push(
        `Line ${lineNumber} (${riskId}): expected at least 5 table columns, found ${cells.length}`,
      );
      continue;
    }

    const testOrGap = cells[4];
    const citedTests = Array.from(testOrGap.matchAll(TEST_PATH_RE), (m) => m[1]);
    const hasGap = NAMED_GAP_RE.test(testOrGap);

    if (citedTests.length === 0 && !hasGap) {
      errors.push(
        `Line ${lineNumber} (${riskId}): row has neither a cited test nor a named gap`,
      );
      continue;
    }

    for (const testPath of citedTests) {
      const fullPath = resolve(rootDir, testPath);
      if (!existsSync(fullPath)) {
        errors.push(
          `Line ${lineNumber} (${riskId}): cited test does not exist: ${testPath}`,
        );
      }
    }
  }

  if (checkedRows === 0) {
    errors.push(`No risk rows found in ${docPath}`);
  }

  return {
    ok: errors.length === 0,
    checkedRows,
    errors,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const result = checkThreatMap();
  if (!result.ok) {
    console.error('Threat map check failed:');
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }
  console.log(`Threat map check passed (${result.checkedRows} risk rows).`);
}
