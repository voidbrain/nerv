import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

export interface QuarantinedFile {
  path: string;
  content: string;
}

export interface QuarantinedFetchResult {
  target: string;
  kind: 'repo' | 'page';
  tainted: true;
  trust: 'tainted';
  /** The temporary per-job directory path (always removed before returning). */
  jobDir: string;
  discarded: boolean;
  /** Non-executable static files or page text extracted read-only. */
  files: QuarantinedFile[];
  text: string;
}

export interface QuarantineFetchOptions {
  kind?: 'repo' | 'page';
  baseDir?: string;
  maxBytes?: number;
  allowFileUrl?: boolean;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_MAX_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 20_000;
const INTERESTING_FILES =
  /^(readme(\.[a-z0-9]+)?|license(\.[a-z0-9]+)?|package\.json|pyproject\.toml|cargo\.toml|go\.mod)$/i;

function assertSafeTarget(target: string, allowFileUrl: boolean): URL {
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    throw new Error(`Invalid URL: ${target}`);
  }
  const allowed = allowFileUrl ? ['http:', 'https:', 'file:'] : ['http:', 'https:'];
  if (!allowed.includes(parsed.protocol)) {
    throw new Error(`Disallowed URL protocol for quarantine fetch: ${parsed.protocol}`);
  }
  return parsed;
}

function collectStaticRepoFiles(repoDir: string, maxBytes: number): QuarantinedFile[] {
  const files: QuarantinedFile[] = [];
  let total = 0;
  const entries = readdirSync(repoDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.name === '.git' || !entry.isFile() || !INTERESTING_FILES.test(entry.name)) continue;
    const full = join(repoDir, entry.name);
    const size = statSync(full).size;
    if (total + size > maxBytes) continue;
    const content = readFileSync(full, 'utf8');
    total += Buffer.byteLength(content, 'utf8');
    files.push({ path: relative(repoDir, full), content });
  }
  return files;
}

/**
 * Fetches a web page or shallow-clones a repository read-only into an isolated per-job directory,
 * reads only static text/metadata without executing any project code, marks the result `tainted`,
 * and always discards the per-job directory before returning (F-085-T01).
 */
export async function fetchIntoQuarantine(
  target: string,
  options: QuarantineFetchOptions = {},
): Promise<QuarantinedFetchResult> {
  const allowFileUrl = options.allowFileUrl === true;
  const url = assertSafeTarget(target, allowFileUrl);
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const kind: 'repo' | 'page' =
    options.kind ?? (url.protocol === 'file:' || url.pathname.endsWith('.git') ? 'repo' : 'page');

  const jobDir = mkdtempSync(join(options.baseDir ?? tmpdir(), 'nerv-quarantine-'));
  try {
    if (kind === 'repo') {
      const repoDir = join(jobDir, 'repo');
      // Disable git hooks, submodules, and ext:: helpers so no fetched code or hook can execute.
      execFileSync(
        'git',
        [
          'clone',
          '--depth',
          '1',
          '--no-tags',
          '-c',
          'core.hooksPath=/dev/null',
          '-c',
          'submodule.recurse=false',
          '-c',
          'protocol.ext.allow=never',
          '--',
          target,
          repoDir,
        ],
        { stdio: 'pipe', timeout: timeoutMs },
      );
      const files = collectStaticRepoFiles(repoDir, maxBytes);
      const text = files.map((f) => `--- ${f.path} ---\n${f.content}`).join('\n\n');
      return {
        target,
        kind: 'repo',
        tainted: true,
        trust: 'tainted',
        jobDir,
        discarded: true,
        files,
        text,
      };
    }

    const fetchImpl = options.fetchFn ?? fetch;
    const response = await fetchImpl(url.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`Quarantine page fetch failed with HTTP ${response.status}.`);
    }
    const raw = await response.text();
    const bounded = Buffer.byteLength(raw, 'utf8') > maxBytes ? raw.slice(0, maxBytes) : raw;
    const pagePath = join(jobDir, 'page.txt');
    writeFileSync(pagePath, bounded, 'utf8');
    const stored = readFileSync(pagePath, 'utf8');
    return {
      target,
      kind: 'page',
      tainted: true,
      trust: 'tainted',
      jobDir,
      discarded: true,
      files: [{ path: 'page.txt', content: stored }],
      text: stored,
    };
  } finally {
    rmSync(jobDir, { recursive: true, force: true });
  }
}
