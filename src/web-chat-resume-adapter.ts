import { createHash } from 'node:crypto';
import { clickNamedControl, type BrowserAdapterDriver, type BrowserTabSnapshot } from './browser-control.ts';
import type {
  ResumeAttemptOutcome,
  ResumeAvailabilityCheck,
  ResumeEngineDeps,
  ResumeIntent,
  ResumeJobIdentity,
} from './resume-intent.ts';

export interface WebChatResumeAdapterOptions {
  readonly driver: BrowserAdapterDriver;
  readonly allowedOrigins: readonly string[];
  readonly controlName?: string;
  readonly owner?: string;
  readonly leaseMs?: number;
  readonly notifyOutcome?: ResumeEngineDeps['notifyOutcome'];
}

const DEFAULT_CONTROL_NAME = 'Continue';
const SESSION_EXPIRED_RE = /\b(sign in|log in|session expired|authenticate)\b/i;
const ALREADY_RUNNING_RE = /\b(stop generating|generating|already running)\b/i;
const LIMIT_ACTIVE_RE = /\b(usage limit|limit reached|try again|rate limit)\b/i;

/** Computes a deterministic identity fingerprint for a web-chat tab snapshot (origin + pathname + title + summary). */
export function webChatTabFingerprint(
  tab: Pick<BrowserTabSnapshot, 'tabId' | 'url' | 'title' | 'textSummary'>,
): string {
  const parsed = new URL(tab.url);
  return createHash('sha256')
    .update(JSON.stringify([tab.tabId, parsed.origin + parsed.pathname, tab.title.trim(), tab.textSummary.trim()]))
    .digest('hex');
}

function isOriginAllowed(rawUrl: string, allowedOrigins: readonly string[]): boolean {
  try {
    const parsed = new URL(rawUrl);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && allowedOrigins.includes(parsed.origin);
  } catch {
    return false;
  }
}

/**
 * F-012-T04: Narrow browser-worker web-chat resume adapter.
 * Re-reads the live active tab on every phase (availability, identity recheck after sleep, and click),
 * never caches coordinates across sleep, refuses credential/payment controls and expired sessions,
 * and treats unacknowledged clicks as uncertain non-retryable failures.
 */
export function createWebChatResumeDeps(
  options: WebChatResumeAdapterOptions,
): Pick<
  ResumeEngineDeps,
  'owner' | 'leaseMs' | 'checkAvailability' | 'verifyIdentity' | 'executeResume' | 'notifyOutcome'
> {
  const controlName = options.controlName ?? DEFAULT_CONTROL_NAME;
  const owner = options.owner ?? 'web-chat-adapter';

  return {
    owner,
    ...(options.leaseMs !== undefined ? { leaseMs: options.leaseMs } : {}),
    ...(options.notifyOutcome ? { notifyOutcome: options.notifyOutcome } : {}),

    async checkAvailability(intent: ResumeIntent): Promise<ResumeAvailabilityCheck> {
      let tab: BrowserTabSnapshot;
      try {
        tab = await options.driver.getActiveTab();
      } catch (err) {
        return {
          available: false,
          reason: `browser-unavailable: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      if (!tab.active || tab.tabId !== intent.targetId || !isOriginAllowed(tab.url, options.allowedOrigins)) {
        return { available: false, reason: 'target-tab-unavailable' };
      }
      const surface = `${tab.title}\n${tab.textSummary}`;
      if (SESSION_EXPIRED_RE.test(surface)) {
        return { available: false, reason: 'session-expired' };
      }
      if (ALREADY_RUNNING_RE.test(surface)) {
        return { available: false, reason: 'already-running' };
      }
      if (LIMIT_ACTIVE_RE.test(surface)) {
        return { available: false, reason: 'limit-still-active' };
      }
      const hasControl = tab.controls.some((c) => c.name.trim().toLowerCase() === controlName.trim().toLowerCase());
      if (!hasControl) {
        return { available: false, reason: 'resume-control-missing' };
      }
      return { available: true };
    },

    async verifyIdentity(_intent: ResumeIntent): Promise<ResumeJobIdentity | null> {
      const tab = await options.driver.getActiveTab().catch(() => null);
      if (!tab || !tab.active || !isOriginAllowed(tab.url, options.allowedOrigins)) return null;
      return {
        targetId: tab.tabId,
        targetFingerprint: webChatTabFingerprint(tab),
        stillActive: true,
      };
    },

    async executeResume(intent: ResumeIntent): Promise<ResumeAttemptOutcome> {
      // Fresh re-read immediately before clicking: prevents stale clicks after host sleep or tab switches.
      const before = await options.driver.getActiveTab().catch(() => null);
      if (!before || !before.active || before.tabId !== intent.targetId) {
        return { kind: 'failed', reason: 'tab-changed-before-click', retryable: true };
      }
      if (webChatTabFingerprint(before) !== intent.targetFingerprint) {
        return { kind: 'failed', reason: 'target-content-changed-before-click', retryable: false };
      }
      try {
        const clicked = await clickNamedControl(options.driver, {
          controlName,
          allowedOrigins: options.allowedOrigins,
          expectedTabId: intent.targetId,
          approved: true,
        });
        const changed =
          clicked.after.textSummary.trim() !== clicked.before.textSummary.trim() ||
          ALREADY_RUNNING_RE.test(`${clicked.after.title}\n${clicked.after.textSummary}`);
        if (!changed) {
          return {
            kind: 'failed',
            reason: 'uncertain-click-acknowledgement',
            retryable: false,
          };
        }
        return {
          kind: 'resumed',
          detail: {
            tabId: clicked.tabId,
            clicked: clicked.clicked,
            tainted: clicked.tainted,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const nonRetryable = /credential or payment|not in browser\.allowedOrigins/i.test(message);
        return { kind: 'failed', reason: message, retryable: !nonRetryable };
      }
    },
  };
}
