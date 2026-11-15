import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_EXT = /\.(ts|tsx|js|mjs|cjs|css|html)$/;
export const DEFAULT_MAX_LINES = 600;

export function findLongSourceFiles(
  roots,
  { maxLines = DEFAULT_MAX_LINES, cwd = process.cwd() } = {},
) {
  const results = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && SOURCE_EXT.test(entry.name)) {
        const text = readFileSync(full, 'utf8');
        const lines = text.length === 0 ? 0 : text.split('\n').length;
        if (lines > maxLines) {
          results.push({
            path: relative(cwd, full).replace(/\\/g, '/'),
            lines,
            bytes: statSync(full).size,
          });
        }
      }
    }
  };
  for (const root of roots) walk(root);
  return results.sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cwd = process.cwd();
  const longFiles = findLongSourceFiles([join(cwd, 'src'), join(cwd, 'web', 'src')], {
    maxLines: DEFAULT_MAX_LINES,
    cwd,
  });
  if (longFiles.length) {
    console.log(`! ${longFiles.length} source file(s) over ${DEFAULT_MAX_LINES} lines (warn only):`);
    for (const file of longFiles) {
      console.log(`  - ${file.path}: ${file.lines} lines (${file.bytes} bytes)`);
    }
  } else {
    console.log(`All source files in src/ and web/src are <= ${DEFAULT_MAX_LINES} lines.`);
  }
}
