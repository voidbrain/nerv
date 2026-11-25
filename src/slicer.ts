import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

export interface SlicerProfile {
  name: string;
  machineProfile: string;
  materialProfile: string;
}

export interface SliceEstimate {
  printTimeText: string;
  filamentGrams?: number;
  filamentMeters?: number;
}

export interface SliceRequest {
  inputPath: string;
  outputPath: string;
  profileName: string;
  slicerBin?: string;
  timeoutMs?: number;
}

export interface SliceResult {
  outputPath: string;
  profile: SlicerProfile;
  estimate: SliceEstimate;
  command: string[];
}

export type SlicerExecFn = (bin: string, args: string[], timeoutMs: number) => string;
/** F-121-T04: the slicer runner on a slicing base that serves other bases; it must not block the event loop. */
export type SlicerExecAsyncFn = (bin: string, args: string[], timeoutMs: number) => string | Promise<string>;

const ALLOWED_INPUT_EXTENSIONS = new Set(['.stl', '.3mf', '.obj', '.step']);
const DEFAULT_SLICER_BIN = 'bambu-studio';
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Resolves a named material/machine profile from the base's explicit allowlist,
 * refusing unknown profiles before any slicer process runs (F-087-T02).
 */
export function resolveAllowedSlicerProfile(profileName: string, allowlist: readonly SlicerProfile[]): SlicerProfile {
  const normalized = profileName.trim().toLowerCase();
  if (!normalized) {
    throw new Error('Slicer profile name is required.');
  }
  const match = allowlist.find((entry) => entry.name.trim().toLowerCase() === normalized);
  if (!match) {
    const known = allowlist.map((entry) => entry.name).join(', ') || '(none)';
    throw new Error(`Unknown slicer profile "${profileName}". Allowed profiles: ${known}.`);
  }
  return match;
}

/**
 * F-121-T01: the base's slicer profile allowlist, `<NERV home>/slicer-profiles.json`, in the same shape
 * `nerv slice` takes. A missing file is an empty allowlist, so every profile is refused.
 */
export function readSlicerProfiles(home: string): SlicerProfile[] {
  const path = join(home, 'slicer-profiles.json');
  if (!existsSync(path)) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${path} is not readable JSON: ${(error as Error).message}`);
  }
  const valid =
    Array.isArray(raw) &&
    raw.every(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        ['name', 'machineProfile', 'materialProfile'].every(
          (key) =>
            typeof (entry as Record<string, unknown>)[key] === 'string' &&
            (entry as Record<string, string>)[key]!.trim(),
        ),
    );
  if (!valid) throw new Error(`${path} must be an array of { name, machineProfile, materialProfile } strings.`);
  return raw as SlicerProfile[];
}

/**
 * Parses estimated print time and filament usage from Bambu Studio / OrcaSlicer output.
 */
export function parseSlicerEstimate(output: string): SliceEstimate {
  const timeMatch = output.match(/estimated\s+printing\s+time(?:\s*\([^)]*\))?\s*[:=]\s*([^\r\n]+)/i);
  const gramsMatch = output.match(/total\s+filament\s+used\s*\[g\]\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)/i);
  const metersMatch = output.match(/total\s+filament\s+used\s*\[m\]\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)/i);
  const mmMatch = output.match(/total\s+filament\s+used\s*\[mm\]\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)/i);

  const printTimeText = timeMatch?.[1]?.trim() || 'unknown';
  const filamentGrams = gramsMatch ? Number(gramsMatch[1]) : undefined;
  const filamentMeters = metersMatch
    ? Number(metersMatch[1])
    : mmMatch
      ? Number((Number(mmMatch[1]) / 1000).toFixed(2))
      : undefined;

  return {
    printTimeText,
    ...(filamentGrams !== undefined && Number.isFinite(filamentGrams) ? { filamentGrams } : {}),
    ...(filamentMeters !== undefined && Number.isFinite(filamentMeters) ? { filamentMeters } : {}),
  };
}

/**
 * F-121-T04: runs the slicer as a child process without blocking; at `timeoutMs` the slicer is killed (SIGKILL; on
 * Windows TerminateProcess) and the promise rejects. No shell: arguments are passed as they are.
 */
export function execSlicerAsync(bin: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((done, fail) => {
    execFile(
      bin,
      args,
      { encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL', windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => {
        if (!error) return done(stdout);
        const timedOut = (error as { killed?: boolean }).killed || (error as { signal?: string }).signal === 'SIGKILL';
        fail(
          new Error(
            timedOut
              ? `Slicer timed out after ${timeoutMs / 1000} s and was killed.`
              : `Slicer failed: ${error.message.slice(0, 300)}`,
          ),
        );
      },
    );
  });
}

function defaultExecSlicer(bin: string, args: string[], timeoutMs: number): string {
  return execFileSync(bin, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: timeoutMs,
  });
}

/**
 * Slices a model with an allowlisted material profile and reports estimated time and material (F-087-T02).
 */
export function sliceModelWithProfile(
  request: SliceRequest,
  allowlist: readonly SlicerProfile[],
  execFn: SlicerExecFn = defaultExecSlicer,
): SliceResult {
  const plan = planSlice(request, allowlist);
  return finishSlice(plan, request, execFn(plan.bin, plan.args, plan.timeoutMs));
}

/** F-121-T04: the same slice, with the slicer run asynchronously (a slicing base keeps answering meanwhile). */
export async function sliceModelWithProfileAsync(
  request: SliceRequest,
  allowlist: readonly SlicerProfile[],
  execFn: SlicerExecAsyncFn = execSlicerAsync,
): Promise<SliceResult> {
  const plan = planSlice(request, allowlist);
  return finishSlice(plan, request, await execFn(plan.bin, plan.args, plan.timeoutMs));
}

interface SlicePlan {
  profile: SlicerProfile;
  bin: string;
  args: string[];
  timeoutMs: number;
}

function planSlice(request: SliceRequest, allowlist: readonly SlicerProfile[]): SlicePlan {
  const profile = resolveAllowedSlicerProfile(request.profileName, allowlist);
  const ext = extname(request.inputPath).toLowerCase();
  if (!ALLOWED_INPUT_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported model extension "${ext || '(none)'}". Expected .stl, .3mf, .obj, or .step.`);
  }
  if (!request.outputPath.trim().endsWith('.gcode.3mf')) {
    throw new Error('Output path must end with .gcode.3mf.');
  }
  const bin = request.slicerBin?.trim() || DEFAULT_SLICER_BIN;
  const args = [
    '--slice',
    '0',
    '--load-settings',
    profile.machineProfile,
    '--load-filaments',
    profile.materialProfile,
    '--export-3mf',
    request.outputPath,
    request.inputPath,
  ];
  return { profile, bin, args, timeoutMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS };
}

function finishSlice(plan: SlicePlan, request: SliceRequest, stdout: string): SliceResult {
  if (!existsSync(request.outputPath)) {
    throw new Error(`Slicer completed without producing expected file: ${request.outputPath}`);
  }
  return {
    outputPath: request.outputPath,
    profile: plan.profile,
    estimate: parseSlicerEstimate(stdout),
    command: [plan.bin, ...plan.args],
  };
}

export interface BambuChecklistInput {
  profileName: string;
  printTimeText?: string;
  filamentGrams?: number;
  printerName?: string;
  plateType?: string;
  nozzleSize?: string;
  amsMapping?: string;
  /** F-121-T02: the library file the plate was sliced from, relative to the print library. */
  sourceFile?: string;
  /** F-121-T02: times to print this plate. */
  repeats?: number;
}

export interface BambuHandoffRequest extends BambuChecklistInput {
  gcode3mfPath: string;
}

export type BambuConnectLauncher = (importLink: string) => { opened: boolean; reason?: string };

export interface BambuHandoffResult {
  status: 'handed-off' | 'staged-waiting-login';
  opened: boolean;
  printStarted: false;
  importLink: string;
  checklist: string[];
  reason?: string;
  message: string;
}

export function buildBambuImportLink(gcode3mfPath: string): string {
  const trimmed = gcode3mfPath.trim();
  if (!trimmed.endsWith('.gcode.3mf')) {
    throw new Error('Bambu Connect hand-off requires a .gcode.3mf file.');
  }
  if (!existsSync(trimmed)) {
    throw new Error(`Sliced file does not exist: ${trimmed}`);
  }
  return `bambu-connect://import-file?path=${encodeURIComponent(resolve(trimmed))}`;
}

export function buildBambuOwnerChecklist(input: BambuChecklistInput): string[] {
  const materialDetail = [
    input.amsMapping ?? input.profileName,
    input.filamentGrams !== undefined ? `${input.filamentGrams} g` : undefined,
    input.printTimeText ? `est. ${input.printTimeText}` : undefined,
  ]
    .filter(Boolean)
    .join(', ');

  return [
    ...(input.sourceFile ? [`Model file: ${input.sourceFile}`] : []),
    ...(input.repeats && input.repeats > 1
      ? [`Repeat: print this plate ${input.repeats} times (one plate per print)`]
      : []),
    `Printer: ${input.printerName?.trim() || 'confirm target printer'}`,
    `Build plate: ${input.plateType?.trim() || 'confirm clean, matching build plate'}`,
    `Nozzle: ${input.nozzleSize?.trim() || 'confirm installed nozzle matches profile'}`,
    `Filament & AMS mapping: ${materialDetail}`,
    'Clear plate: verify the build plate is empty before starting',
    'First layer: have someone nearby to watch the first layer',
    'Press Print in Bambu Connect (NERV has not started the print)',
  ];
}

/** Set by the test runner (NODE_TEST_CONTEXT) and passed to NERV's child processes under it (NERV_TEST_RUNNER). */
export function underTestRunner(): boolean {
  return Boolean(process.env.NODE_TEST_CONTEXT || process.env.NERV_TEST_RUNNER);
}

function defaultBambuLauncher(importLink: string): { opened: boolean; reason?: string } {
  // F-121-T02: a test never opens the real app on the developer's desktop.
  if (underTestRunner()) {
    throw new Error('A test must inject a bambuLauncher: the default launcher opens Bambu Connect on this desktop.');
  }
  if (process.platform === 'win32') {
    execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Start-Process', importLink], { stdio: 'ignore' });
    return { opened: true };
  }
  if (process.platform === 'darwin') {
    execFileSync('open', [importLink], { stdio: 'ignore' });
    return { opened: true };
  }
  execFileSync('xdg-open', [importLink], { stdio: 'ignore' });
  return { opened: true };
}

/**
 * Hands off a sliced .gcode.3mf job to Bambu Connect via its import link with the owner pre-print checklist (F-087-T03).
 * Never reports the print as started; when no desktop session is active, stages the link for login.
 */
export function handOffToBambuConnect(
  request: BambuHandoffRequest,
  launcher: BambuConnectLauncher = defaultBambuLauncher,
): BambuHandoffResult {
  const importLink = buildBambuImportLink(request.gcode3mfPath);
  const checklist = buildBambuOwnerChecklist(request);
  const launch = launcher(importLink);
  if (!launch.opened) {
    return {
      status: 'staged-waiting-login',
      opened: false,
      printStarted: false,
      importLink,
      checklist,
      ...(launch.reason ? { reason: launch.reason } : {}),
      message:
        'Sliced file is staged for Bambu Connect and waiting for an active desktop login. Print has not started.',
    };
  }
  return {
    status: 'handed-off',
    opened: true,
    printStarted: false,
    importLink,
    checklist,
    message:
      'Opened in Bambu Connect for owner review. Review the checklist and press Print in Bambu Connect; print has not started.',
  };
}
