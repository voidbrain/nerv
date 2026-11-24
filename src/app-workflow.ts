import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

/** One step of an app workflow (F-094): open an app, open a file in it, save it under another name. */
export type AppWorkflowStep =
  | { readonly kind: 'open-app'; readonly app: string }
  | { readonly kind: 'open-file'; readonly app: string; readonly path: string }
  | { readonly kind: 'save-as'; readonly app: string; readonly path: string };

export interface AppWorkflowPlan {
  readonly steps: readonly AppWorkflowStep[];
}

/** What the app shows after a step, read back through its scripting interface (or F-093 for menus). */
export interface AppStepReadback {
  readonly frontmostApp: string;
  /** Path of the front document, when the app has one open. */
  readonly documentPath?: string;
  /** Title of any sheet or dialog the app is showing (an unplanned dialog stops the workflow). */
  readonly dialog?: string;
}

/** The scripted-first executor of one step (F-094-T01 tier order); each call returns the readback. */
export interface AppWorkflowDriver {
  openApp(app: string): Promise<AppStepReadback>;
  openFile(app: string, path: string): Promise<AppStepReadback>;
  saveAs(app: string, path: string): Promise<AppStepReadback>;
}

export interface AppWorkflowFs {
  exists(path: string): boolean;
  realpath(path: string): string;
}

const nodeFs: AppWorkflowFs = { exists: existsSync, realpath: (p) => realpathSync(p) };

export interface RunAppWorkflowRequest {
  readonly plan: AppWorkflowPlan;
  /** The one owner approval for the whole plan: the hash shown on its card (`appWorkflowPlanHash`). */
  readonly approval: { readonly approved: boolean; readonly planHash: string };
  /** Folders the owner allowed; every input and output path must resolve inside one. */
  readonly allowedFolders: readonly string[];
  /** Asked when a save-as target already exists; anything but `true` keeps the existing file. */
  readonly confirmOverwrite: (path: string) => boolean | Promise<boolean>;
}

export interface AppWorkflowStepResult {
  readonly index: number;
  readonly step: AppWorkflowStep;
  readonly readback: AppStepReadback;
}

export interface AppWorkflowResult {
  readonly status: 'completed' | 'stopped';
  readonly completed: readonly AppWorkflowStepResult[];
  readonly stoppedAt?: number;
  readonly reason?: string;
}

const APP_NAME = /^[\p{L}\p{N} ._()+&-]{1,80}$/u;
const MAX_STEPS = 10;

/** Canonical hash of a plan: the one approval card shows it and the run checks it before any step. */
export function appWorkflowPlanHash(plan: AppWorkflowPlan): string {
  const canonical = plan.steps.map((s) => (s.kind === 'open-app' ? [s.kind, s.app] : [s.kind, s.app, s.path]));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function inside(folder: string, path: string): boolean {
  const rel = relative(folder, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Resolves a path through symlinks (the parent for a file that does not exist yet) and checks the allowlist. */
function allowedPath(path: string, folders: readonly string[], fs: AppWorkflowFs): string {
  if (!isAbsolute(path)) throw new Error(`Path must be absolute: ${path}`);
  const absolute = resolve(path);
  const real = fs.exists(absolute) ? fs.realpath(absolute) : join(fs.realpath(dirname(absolute)), basename(absolute));
  const roots = folders.map((f) => (fs.exists(f) ? fs.realpath(resolve(f)) : resolve(f)));
  if (!roots.some((root) => inside(root, real))) throw new Error(`Path is outside the allowed folders: ${path}`);
  return real;
}

function validatePlan(plan: AppWorkflowPlan): void {
  if (!Array.isArray(plan.steps) || plan.steps.length === 0 || plan.steps.length > MAX_STEPS) {
    throw new Error(`An app workflow has 1 to ${MAX_STEPS} steps.`);
  }
  for (const step of plan.steps) {
    if (!['open-app', 'open-file', 'save-as'].includes(step.kind)) throw new Error('Unknown app workflow step.');
    if (typeof step.app !== 'string' || !APP_NAME.test(step.app)) throw new Error(`Invalid app name: ${step.app}`);
  }
}

/** The state each step must leave behind; anything else is a step outside the plan. */
function readbackMismatch(step: AppWorkflowStep, path: string | undefined, rb: AppStepReadback): string | undefined {
  if (rb.dialog) return `unplanned dialog "${rb.dialog}"`;
  if (rb.frontmostApp !== step.app) return `expected ${step.app} in front, found ${rb.frontmostApp}`;
  if (path !== undefined && rb.documentPath !== path) {
    return `expected document ${path}, found ${rb.documentPath ?? 'none'}`;
  }
  return undefined;
}

/**
 * F-094-T02: runs a planned app workflow step by step after one owner approval for the whole plan.
 * Each step is read back before the next; a readback that does not match the plan (another app in
 * front, an unexpected dialog, another document) stops the workflow. Save as never replaces an
 * existing file unless the owner confirms that path.
 */
export async function runAppWorkflow(
  driver: AppWorkflowDriver,
  request: RunAppWorkflowRequest,
  fs: AppWorkflowFs = nodeFs,
): Promise<AppWorkflowResult> {
  const { plan } = request;
  validatePlan(plan);
  if (!request.approval.approved) {
    throw new Error('An app workflow is an Orange action: the owner approves the whole plan first.');
  }
  if (request.approval.planHash !== appWorkflowPlanHash(plan)) {
    throw new Error('The plan differs from the one the owner approved; nothing was run.');
  }
  // Every path is checked before any app is touched.
  const paths = plan.steps.map((s) =>
    s.kind === 'open-app' ? undefined : allowedPath(s.path, request.allowedFolders, fs),
  );

  const completed: AppWorkflowStepResult[] = [];
  const stop = (index: number, reason: string): AppWorkflowResult => ({
    status: 'stopped',
    completed,
    stoppedAt: index,
    reason,
  });
  for (const [index, step] of plan.steps.entries()) {
    const path = paths[index];
    let readback: AppStepReadback;
    try {
      if (step.kind === 'open-app') readback = await driver.openApp(step.app);
      else if (step.kind === 'open-file') {
        if (!fs.exists(path!)) return stop(index, `file not found: ${step.path}`);
        readback = await driver.openFile(step.app, path!);
      } else {
        if (fs.exists(path!) && (await request.confirmOverwrite(path!)) !== true) {
          return stop(index, `not overwriting existing file: ${step.path}`);
        }
        readback = await driver.saveAs(step.app, path!);
      }
    } catch (err) {
      return stop(index, err instanceof Error ? err.message : String(err));
    }
    const mismatch = readbackMismatch(step, path, readback);
    if (mismatch) return stop(index, `step outside the plan: ${mismatch}`);
    if (step.kind === 'save-as' && !fs.exists(path!)) return stop(index, `saved file not found: ${step.path}`);
    completed.push({ index, step, readback });
  }
  return { status: 'completed', completed };
}

/** config.json `appWorkflow`: the folders the owner allows app workflows to open from and save to. */
export interface AppWorkflowConfig {
  allowedFolders: string[];
}

export function validateAppWorkflowConfig(value: unknown): AppWorkflowConfig {
  const v = value as Record<string, unknown>;
  const folders = v?.allowedFolders;
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => k !== 'allowedFolders') ||
    !Array.isArray(folders) ||
    folders.length > 20 ||
    folders.some((f) => typeof f !== 'string' || !isAbsolute(f))
  )
    throw new Error('Invalid appWorkflow: {"allowedFolders": [absolute folder paths, at most 20]}.');
  return { allowedFolders: [...(folders as string[])] };
}

/** Reads a plan file's steps as data (owner-written JSON); unknown fields are refused. */
export function parseAppWorkflowPlan(value: unknown): AppWorkflowPlan {
  const v = value as { steps?: unknown };
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some((k) => k !== 'steps'))
    throw new Error('Invalid app workflow plan: {"steps": [...]}.');
  if (!Array.isArray(v.steps)) throw new Error('Invalid app workflow plan: steps must be a list.');
  const steps = v.steps.map((raw): AppWorkflowStep => {
    const s = raw as Record<string, unknown>;
    const keys = s && typeof s === 'object' ? Object.keys(s) : [];
    if (s?.kind === 'open-app' && keys.every((k) => ['kind', 'app'].includes(k)))
      return { kind: 'open-app', app: String(s.app) };
    if (
      (s?.kind === 'open-file' || s?.kind === 'save-as') &&
      typeof s.path === 'string' &&
      keys.every((k) => ['kind', 'app', 'path'].includes(k))
    )
      return { kind: s.kind, app: String(s.app), path: s.path };
    throw new Error('Invalid app workflow step: {"kind": "open-app"|"open-file"|"save-as", "app", "path"?}.');
  });
  validatePlan({ steps });
  return { steps };
}
