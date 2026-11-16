import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { extname } from 'node:path';

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
  const stdout = execFn(bin, args, request.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  if (!existsSync(request.outputPath)) {
    throw new Error(`Slicer completed without producing expected file: ${request.outputPath}`);
  }

  return {
    outputPath: request.outputPath,
    profile,
    estimate: parseSlicerEstimate(stdout),
    command: [bin, ...args],
  };
}
