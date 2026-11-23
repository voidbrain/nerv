import { createHash } from 'node:crypto';
import { clickDesktopControl, type DesktopAccessibilityDriver, type DesktopWindowSnapshot } from './desktop-control.ts';
import type {
  ResumeAttemptOutcome,
  ResumeAvailabilityCheck,
  ResumeEngineDeps,
  ResumeIntent,
  ResumeJobIdentity,
} from './resume-intent.ts';

export interface DesktopEditorResumeOptions {
  /** The shared desktop driver (F-093-T03); the same instance serves clicks and replay preconditions. */
  readonly driver: DesktopAccessibilityDriver;
  /** Editor application name as the accessibility tree reports it (for example `Code`). */
  readonly appName: string;
  readonly controlName?: string;
  readonly owner?: string;
  readonly leaseMs?: number;
  readonly notifyOutcome?: ResumeEngineDeps['notifyOutcome'];
}

const DEFAULT_CONTROL_NAME = 'Continue';
const ALREADY_RUNNING_RE = /\b(stop generating|generating|already running)\b/i;
const LIMIT_ACTIVE_RE = /\b(usage limit|limit reached|try again|rate limit)\b/i;

/** Deterministic identity of an editor window (app + title + visible summary) for the resume recheck. */
export function desktopWindowFingerprint(
  window: Pick<DesktopWindowSnapshot, 'appName' | 'windowTitle' | 'summaryText'>,
): string {
  return createHash('sha256')
    .update(JSON.stringify([window.appName.trim(), window.windowTitle.trim(), window.summaryText.trim()]))
    .digest('hex');
}

function scopeAllows(intent: ResumeIntent): boolean {
  const scope = intent.permissionScope;
  return (
    scope.allowedAction === 'resume-named-job' &&
    scope.targetId === intent.targetId &&
    !scope.allowSecurityPrompts &&
    !scope.allowLimitBypass &&
    scope.modelOverrideBlocked
  );
}

/**
 * F-093-T03: editor resume (F-012 `vscode-claude` targets that expose only UI controls) through the
 * shared desktop click adapter. The intent's targetId is the editor window title. Every phase re-reads
 * the live window; a changed window never gets a stale click; refusals of the click adapter
 * (password fields, system dialogs, payment controls) still hold.
 */
export function createDesktopEditorResumeDeps(
  options: DesktopEditorResumeOptions,
): Pick<
  ResumeEngineDeps,
  'owner' | 'leaseMs' | 'checkAvailability' | 'verifyIdentity' | 'executeResume' | 'notifyOutcome'
> {
  const controlName = options.controlName ?? DEFAULT_CONTROL_NAME;
  const readWindow = (intent: ResumeIntent) =>
    options.driver.getWindow(options.appName, intent.targetId).catch(() => null);

  return {
    owner: options.owner ?? 'desktop-editor-adapter',
    ...(options.leaseMs !== undefined ? { leaseMs: options.leaseMs } : {}),
    ...(options.notifyOutcome ? { notifyOutcome: options.notifyOutcome } : {}),

    async checkAvailability(intent: ResumeIntent): Promise<ResumeAvailabilityCheck> {
      if (intent.targetKind !== 'vscode-claude') {
        return { available: false, reason: `Unsupported targetKind for desktop editor adapter: ${intent.targetKind}` };
      }
      if (!options.driver.checkAccessibilityPermission()) {
        return { available: false, reason: 'accessibility-permission-missing' };
      }
      const window = await readWindow(intent);
      if (!window || window.windowTitle !== intent.targetId) {
        return { available: false, reason: 'editor-window-unavailable' };
      }
      if (ALREADY_RUNNING_RE.test(window.summaryText)) return { available: false, reason: 'already-running' };
      if (LIMIT_ACTIVE_RE.test(window.summaryText)) return { available: false, reason: 'limit-still-active' };
      const hasControl = window.controls.some((c) => c.name.trim().toLowerCase() === controlName.toLowerCase());
      if (!hasControl) return { available: false, reason: 'resume-control-missing' };
      return { available: true };
    },

    async verifyIdentity(intent: ResumeIntent): Promise<ResumeJobIdentity | null> {
      const window = await readWindow(intent);
      if (!window || window.windowTitle !== intent.targetId) return null;
      return { targetId: window.windowTitle, targetFingerprint: desktopWindowFingerprint(window), stillActive: true };
    },

    async executeResume(intent: ResumeIntent): Promise<ResumeAttemptOutcome> {
      if (!scopeAllows(intent)) {
        return { kind: 'failed', reason: 'Resume permission scope violated.', retryable: false };
      }
      const before = await readWindow(intent);
      if (!before || before.windowTitle !== intent.targetId) {
        return { kind: 'failed', reason: 'window-changed-before-click', retryable: true };
      }
      if (desktopWindowFingerprint(before) !== intent.targetFingerprint) {
        return { kind: 'failed', reason: 'target-content-changed-before-click', retryable: false };
      }
      try {
        // The owner's resume intent is the approval for this one named click (F-012 permission scope).
        const clicked = await clickDesktopControl(options.driver, {
          appName: options.appName,
          windowTitle: intent.targetId,
          controlName,
          approved: true,
        });
        if (clicked.afterSummary.trim() === clicked.beforeSummary.trim()) {
          return { kind: 'failed', reason: 'uncertain-click-acknowledgement', retryable: false };
        }
        return {
          kind: 'resumed',
          detail: { adapter: 'desktop-editor', window: clicked.windowTitle, clicked: clicked.clicked, tainted: true },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { kind: 'failed', reason: message, retryable: false };
      }
    },
  };
}
