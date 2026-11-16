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
  /** Latest commit metadata captured read-only from git log, when available. */
  activity?: string;
}

export interface CitedClaim {
  summary: string;
  source: string;
}

export interface ProjectReport {
  target: string;
  tainted: true;
  whatItIs: CitedClaim;
  activity: CitedClaim;
  licence: CitedClaim;
  buildAndTest: CitedClaim;
  visibleRisks: CitedClaim[];
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
      let activity: string | undefined;
      try {
        const logOut = execFileSync('git', ['-C', repoDir, 'log', '-1', '--format=%cI %s'], {
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: timeoutMs,
          encoding: 'utf8',
        }).trim();
        if (logOut) activity = logOut;
      } catch {
        // Empty repo or no commits: leave activity undefined.
      }
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
        ...(activity ? { activity } : {}),
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

function findFile(files: QuarantinedFile[], pattern: RegExp): QuarantinedFile | undefined {
  return files.find((f) => pattern.test(f.path));
}

function parsePackageJson(
  files: QuarantinedFile[],
): { file: QuarantinedFile; data: Record<string, unknown> } | undefined {
  const file = findFile(files, /^package\.json$/i);
  if (!file) return undefined;
  try {
    const parsed = JSON.parse(file.content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { file, data: parsed as Record<string, unknown> };
    }
  } catch {
    // Ignore malformed JSON in untrusted project; static text checks still apply.
  }
  return undefined;
}

function extractFirstSummaryLine(content: string): string | undefined {
  const stripped = content.replace(/<[^>]+>/g, ' ');
  for (const rawLine of stripped.split(/\r?\n/)) {
    const line = rawLine.replace(/^#+\s*/, '').trim();
    if (line.length > 0) return line.slice(0, 200);
  }
  return undefined;
}

function extractTomlField(content: string, key: string): string | undefined {
  const match = content.match(new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']`, 'm'));
  return match?.[1]?.trim();
}

/**
 * Builds a sourced summary (what it is, activity, licence, build & test, visible risks)
 * strictly from static quarantined content without executing any project code (F-085-T02).
 */
export function buildProjectReport(fetched: QuarantinedFetchResult): ProjectReport {
  const pkg = parsePackageJson(fetched.files);
  const readme = findFile(fetched.files, /^readme(\.[a-z0-9]+)?$/i);
  const licenseFile = findFile(fetched.files, /^license(\.[a-z0-9]+)?$/i);
  const pyproject = findFile(fetched.files, /^pyproject\.toml$/i);
  const cargo = findFile(fetched.files, /^cargo\.toml$/i);
  const goMod = findFile(fetched.files, /^go\.mod$/i);

  let whatItIs: CitedClaim;
  const pkgDesc = typeof pkg?.data.description === 'string' ? pkg.data.description.trim() : '';
  const pkgName = typeof pkg?.data.name === 'string' ? pkg.data.name.trim() : '';
  if (pkg && (pkgDesc || pkgName)) {
    whatItIs = { summary: pkgDesc ? `${pkgName || 'Project'}: ${pkgDesc}` : pkgName, source: pkg.file.path };
  } else if (readme) {
    whatItIs = {
      summary: extractFirstSummaryLine(readme.content) ?? 'README present (no summary line extracted)',
      source: readme.path,
    };
  } else if (pyproject) {
    whatItIs = {
      summary:
        extractTomlField(pyproject.content, 'description') ??
        extractTomlField(pyproject.content, 'name') ??
        'Python project',
      source: pyproject.path,
    };
  } else if (cargo) {
    whatItIs = {
      summary:
        extractTomlField(cargo.content, 'description') ?? extractTomlField(cargo.content, 'name') ?? 'Rust project',
      source: cargo.path,
    };
  } else {
    whatItIs = {
      summary: extractFirstSummaryLine(fetched.text) ?? 'No summary found in static snapshot',
      source: fetched.target,
    };
  }

  const activity: CitedClaim = fetched.activity
    ? { summary: `Latest commit: ${fetched.activity}`, source: 'git log' }
    : { summary: 'No commit history available in static snapshot', source: fetched.target };

  let licence: CitedClaim;
  const pkgLicense = typeof pkg?.data.license === 'string' ? pkg.data.license.trim() : '';
  if (licenseFile) {
    licence = {
      summary: extractFirstSummaryLine(licenseFile.content) ?? 'License file present',
      source: licenseFile.path,
    };
  } else if (pkg && pkgLicense) {
    licence = { summary: pkgLicense, source: pkg.file.path };
  } else if (pyproject && extractTomlField(pyproject.content, 'license')) {
    licence = { summary: extractTomlField(pyproject.content, 'license')!, source: pyproject.path };
  } else if (cargo && extractTomlField(cargo.content, 'license')) {
    licence = { summary: extractTomlField(cargo.content, 'license')!, source: cargo.path };
  } else {
    licence = { summary: 'No licence file or manifest field found', source: fetched.target };
  }

  let buildAndTest: CitedClaim;
  const scripts =
    pkg?.data.scripts && typeof pkg.data.scripts === 'object' && !Array.isArray(pkg.data.scripts)
      ? (pkg.data.scripts as Record<string, unknown>)
      : undefined;
  if (pkg && scripts && (typeof scripts.build === 'string' || typeof scripts.test === 'string')) {
    const parts: string[] = [];
    if (typeof scripts.build === 'string') parts.push(`build: ${scripts.build}`);
    if (typeof scripts.test === 'string') parts.push(`test: ${scripts.test}`);
    buildAndTest = { summary: parts.join('; '), source: pkg.file.path };
  } else if (pyproject) {
    buildAndTest = { summary: 'Python manifest present (pyproject.toml)', source: pyproject.path };
  } else if (cargo) {
    buildAndTest = { summary: 'Rust Cargo manifest present (cargo build / cargo test)', source: cargo.path };
  } else if (goMod) {
    buildAndTest = { summary: 'Go module present (go build / go test)', source: goMod.path };
  } else if (readme) {
    buildAndTest = { summary: 'No build/test manifest scripts found; check README', source: readme.path };
  } else {
    buildAndTest = { summary: 'No build or test configuration found in static snapshot', source: fetched.target };
  }

  const visibleRisks: CitedClaim[] = [];
  if (licence.summary.startsWith('No licence')) {
    visibleRisks.push({ summary: 'Missing licence increases reuse and compliance risk', source: licence.source });
  }
  if (pkg && scripts) {
    for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) {
      if (typeof scripts[hook] === 'string' && scripts[hook].trim()) {
        visibleRisks.push({
          summary: `Package lifecycle script declared (${hook}): ${scripts[hook]}`,
          source: pkg.file.path,
        });
      }
    }
  }
  const promptInjectionPattern = /(ignore\s+(all\s+)?previous\s+instructions|disregard\s+previous|system\s+prompt)/i;
  for (const file of fetched.files) {
    if (promptInjectionPattern.test(file.content)) {
      visibleRisks.push({
        summary: 'Untrusted content contains instruction-override phrasing (treated as tainted data only)',
        source: file.path === 'page.txt' ? fetched.target : file.path,
      });
    }
  }
  if (visibleRisks.length === 0) {
    visibleRisks.push({ summary: 'No obvious static risks found in inspected metadata', source: fetched.target });
  }

  return {
    target: fetched.target,
    tainted: true,
    whatItIs,
    activity,
    licence,
    buildAndTest,
    visibleRisks,
  };
}
