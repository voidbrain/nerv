// A code map (F-077-T06): each source file's exports with their line ranges, so an agent reads the lines it needs
// instead of a whole file. On demand only; nothing is written.
// Usage: npm run code:map [-- <file or folder>…]   (default: codeMap.folders in .harness.json, else src)
// Ranges assume formatted code (Prettier): a top-level declaration starts at column 0 and runs until the next one.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const EXTENSIONS = new Set(['.ts', '.mts', '.cts', '.tsx', '.js', '.mjs', '.cjs', '.jsx']);
const SKIP = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.angular']);
const EXPORT =
  /^export\s+(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(function\*?|class|const\s+enum|const|let|var|interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/;
const DEFAULT = /^export\s+default\b/;
const LIST = /^export\s*(?:type\s*)?\{([^}]*)\}(?:\s*from\s*['"]([^'"]+)['"])?/;
const STAR = /^export\s*\*\s*(?:as\s+([\w$]+)\s*)?from\s*['"]([^'"]+)['"]/;

// A line that starts a new top-level statement: column 0, not a closing bracket, not a comment.
const starts = (line) => /^[^\s})\]/*]/.test(line) || /^\/\*\*?|^\/\//.test(line);
const ticks = (line) => (line.match(/(?<!\\)`/g) ?? []).length;
const comment = (line) => /^\s*(\/\/|\/\*|\*)/.test(line);

export function mapFile(text) {
  const lines = text.split('\n');
  const entries = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('export')) continue;
    let name,
      head = line,
      last = i;
    // a list Prettier wraps (export {\n  a,\n} from './x';) is read up to its closing brace
    if (/^export\s*(?:type\s*)?\{[^}]*$/.test(line))
      while (last + 1 < lines.length && !head.includes('}')) head += ' ' + lines[++last].trim();
    const decl = EXPORT.exec(head),
      list = LIST.exec(head),
      star = STAR.exec(head);
    if (decl)
      name = `${decl[1].replace('function*', 'function').replace(/^const\s+enum$/, 'const enum')} ${decl[2]}${DEFAULT.test(line) ? ' (default)' : ''}`;
    else if (list)
      name = `{ ${list[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .join(', ')} }${list[2] ? ` from ${list[2]}` : ''}`;
    else if (star) name = `* ${star[1] ? `as ${star[1]} ` : ''}from ${star[2]}`;
    else if (DEFAULT.test(line)) name = 'default';
    else continue;
    // the declaration runs until the next top-level statement; trailing blanks and the next one's comments are not its
    // a line inside a template literal (an odd count of unescaped backticks so far) never starts a statement
    // and a stray backtick (in a regular expression or a string) never hides the next export: a column-0 export ends it
    let end = last,
      open = ticks(head) % 2 === 1;
    for (let j = last + 1; j < lines.length && (open || !starts(lines[j])) && !/^export\b/.test(lines[j]); j++) {
      end = j;
      if (ticks(lines[j]) % 2) open = !open;
    }
    while (end > last && (!lines[end].trim() || comment(lines[end]))) end--;
    // decorators directly above (@Component({...})) belong to the declaration
    let start = i;
    for (let j = i - 1; j >= 0 && lines[j].trim() && !/^(export|import)\b/.test(lines[j]); j--)
      if (lines[j].startsWith('@')) start = j;
      else if (starts(lines[j]) && !comment(lines[j])) break;
    entries.push({ start: start + 1, end: end + 1, name });
    i = end;
  }
  return { lines: lines.length - (text.endsWith('\n') ? 1 : 0), entries };
}

function files(path, out = []) {
  if (!existsSync(path)) return out;
  if (statSync(path).isFile()) {
    if (EXTENSIONS.has(extname(path)) && !/\.d\.ts$/.test(path)) out.push(path);
    return out;
  }
  for (const entry of readdirSync(path).sort())
    if (!SKIP.has(entry) && !entry.startsWith('.')) files(join(path, entry), out);
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = process.cwd();
  let config = {};
  try {
    config = JSON.parse(readFileSync(join(root, '.harness.json'), 'utf8')).codeMap ?? {};
  } catch {
    /* no stamp: defaults */
  }
  const targets = process.argv.slice(2).length ? process.argv.slice(2) : (config.folders ?? ['src']);
  const found = targets.flatMap((t) => files(resolve(root, t)));
  if (!found.length) {
    console.error(`No source files under ${targets.join(', ')} (codeMap.folders in .harness.json, or name a path).`);
    process.exitCode = 1;
  }
  for (const file of found) {
    const { lines, entries } = mapFile(readFileSync(file, 'utf8'));
    console.log(`${relative(root, file)} (${lines} lines)`);
    for (const e of entries) console.log(`  ${e.start === e.end ? e.start : `${e.start}-${e.end}`} ${e.name}`);
  }
}
