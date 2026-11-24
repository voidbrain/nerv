import { isAbsolute } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  computeHeadlessResumeFingerprint,
  createHeadlessResumeDeps,
  type HeadlessResumeOptions,
  type HeadlessResumeTarget,
} from './headless-resume.ts';
import {
  runResumeEngineTick,
  type ResumeEngineTickResult,
  type ResumeIntent,
  type ResumeIntentStore,
} from './resume-intent.ts';
import { transaction } from './sqlite-transaction.ts';

/**
 * F-090-T04: coding sessions that stopped at their usage limit, recorded with their reset time, so `serve` resumes each
 * once after the reset through the headless adapter (F-090-T02). The target row is durable next to its resume intent,
 * so a restart between recording and the reset loses nothing; the intent allows one attempt, so nothing runs twice.
 * Base-local: the repository path belongs to this host, so the table is not replicated.
 */
export const SESSION_LIMIT_SCHEMA = `
CREATE TABLE IF NOT EXISTS session_limit_targets (
  intent_id TEXT PRIMARY KEY REFERENCES resume_intents(id),
  agent TEXT NOT NULL,
  session_id TEXT NOT NULL,
  repo_path TEXT NOT NULL,
  branch TEXT NOT NULL,
  prompt TEXT,
  notice_id TEXT
);
`;

export interface SessionLimitInput {
  agent?: string;
  sessionId: string;
  repoPath: string;
  branch: string;
  /** Epoch milliseconds when the agent's usage limit resets. */
  resetAt: number;
  prompt?: string;
  /** How long after the reset the resume may still start; default one day. */
  windowMs?: number;
}

export interface SessionLimitRecord {
  intent: ResumeIntent;
  target: HeadlessResumeTarget;
  existing?: true;
}

interface TargetRow {
  intent_id: string;
  agent: string;
  session_id: string;
  repo_path: string;
  branch: string;
  prompt: string | null;
}

const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/;
const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_WINDOW_MS = 7 * DEFAULT_WINDOW_MS;
/** Inbox notices say this when the owner has to look: the run did not happen or did not finish. */
export const NEEDS_ATTENTION = 'Needs attention';

export class SessionLimitResumes {
  private readonly db: DatabaseSync;
  private readonly intents: ResumeIntentStore;
  constructor(db: DatabaseSync, intents: ResumeIntentStore) {
    this.db = db;
    this.intents = intents;
  }

  /** Records a session stopped at its limit. Recording it again while its resume is still waiting returns the same one. */
  record(input: SessionLimitInput, now = Date.now()): SessionLimitRecord {
    const agent = input.agent ?? 'claude';
    if (agent !== 'claude') throw new Error(`Unsupported coding agent "${agent}"; only claude resumes headless.`);
    if (typeof input.sessionId !== 'string' || !SAFE_SESSION_ID.test(input.sessionId))
      throw new Error('Invalid session ID.');
    if (typeof input.repoPath !== 'string' || !isAbsolute(input.repoPath))
      throw new Error('The repository path must be absolute.');
    if (typeof input.branch !== 'string' || !input.branch.trim() || input.branch.length > 255)
      throw new Error('A branch name is required.');
    if (!Number.isFinite(input.resetAt)) throw new Error('The reset time must be a valid time.');
    const windowMs = input.windowMs ?? DEFAULT_WINDOW_MS;
    if (!Number.isInteger(windowMs) || windowMs <= 0 || windowMs > MAX_WINDOW_MS)
      throw new Error('The resume window is between one millisecond and seven days.');
    const prompt = input.prompt?.trim() || undefined;
    if (prompt && prompt.length > 2000) throw new Error('The continuation prompt is at most 2000 characters.');
    const target: HeadlessResumeTarget = {
      agent,
      sessionId: input.sessionId,
      repoPath: input.repoPath,
      branch: input.branch.trim(),
      ...(prompt ? { prompt } : {}),
    };
    const fingerprint = computeHeadlessResumeFingerprint(target);
    const waiting = this.list().find(
      (r) =>
        (r.intent.status === 'pending' || r.intent.status === 'leased') && r.intent.targetFingerprint === fingerprint,
    );
    if (waiting) return { ...waiting, existing: true };
    const intent = this.intents.create({
      targetKind: 'cli-job',
      targetId: target.sessionId,
      targetFingerprint: fingerprint,
      permissionScope: {
        allowedAction: 'resume-named-job',
        targetId: target.sessionId,
        allowSecurityPrompts: false,
        allowLimitBypass: false,
        modelOverrideBlocked: true,
        grantedBy: 'owner',
      },
      resetAt: input.resetAt,
      expiresAt: input.resetAt + windowMs,
      maxAttempts: 1,
      now,
    });
    this.db
      .prepare(
        'INSERT INTO session_limit_targets(intent_id,agent,session_id,repo_path,branch,prompt) VALUES(?,?,?,?,?,?)',
      )
      .run(intent.id, agent, target.sessionId, target.repoPath, target.branch, prompt ?? null);
    return { intent, target };
  }

  targets(): Map<string, HeadlessResumeTarget> {
    const rows = this.db.prepare('SELECT * FROM session_limit_targets').all() as unknown as TargetRow[];
    return new Map(
      rows.map((r) => [
        r.intent_id,
        {
          agent: r.agent,
          sessionId: r.session_id,
          repoPath: r.repo_path,
          branch: r.branch,
          ...(r.prompt ? { prompt: r.prompt } : {}),
        },
      ]),
    );
  }

  list(): SessionLimitRecord[] {
    const out: SessionLimitRecord[] = [];
    for (const [id, target] of this.targets()) {
      const intent = this.intents.get(id);
      if (intent) out.push({ intent, target });
    }
    return out;
  }

  /**
   * Tells the owner an intent's outcome once: the notice is written and marked in one transaction, so a second tick or a
   * restart never repeats it. Returns false when it was already told.
   */
  noticeOnce(intentId: string, write: () => string): boolean {
    return transaction(this.db, () => {
      const row = this.db.prepare('SELECT notice_id FROM session_limit_targets WHERE intent_id=?').get(intentId) as
        { notice_id: string | null } | undefined;
      if (!row || row.notice_id !== null) return false;
      this.db.prepare('UPDATE session_limit_targets SET notice_id=? WHERE intent_id=?').run(write(), intentId);
      return true;
    });
  }
}

export interface SessionLimitTickOptions extends Pick<
  HeadlessResumeOptions,
  'execFn' | 'getBranch' | 'sessionExists' | 'timeoutMs'
> {
  owner: string;
  now?: number;
  /** Writes one owner-facing notice (the inbox during `serve`) and returns its ID. */
  notify: (message: string) => string;
}

const describe = (intent: ResumeIntent, target: HeadlessResumeTarget | undefined): string =>
  target ? `${target.sessionId} on ${target.branch} in ${target.repoPath}` : intent.targetId;

/** The owner-facing notice for a finished resume intent. */
export function sessionLimitNotice(intent: ResumeIntent, target: HeadlessResumeTarget | undefined): string {
  const what = describe(intent, target);
  if (intent.status === 'resumed') {
    const output = typeof intent.outcome?.output === 'string' ? intent.outcome.output : '';
    const tail = output.length > 1500 ? `…${output.slice(-1500)}` : output;
    return `Resumed coding session ${what} after its limit reset.${tail ? `\n\n${tail}` : ''}`;
  }
  if (intent.status === 'expired')
    return `${NEEDS_ATTENTION}: coding session ${what} was not resumed before its window closed (${intent.lastError ?? 'no run finished'}).`;
  return `${NEEDS_ATTENTION}: coding session ${what} was not resumed: ${intent.lastError ?? 'unknown failure'}. Nothing ran a second time.`;
}

/**
 * One pass of the live binding: resumes every recorded session whose reset time has passed, once, through the headless
 * adapter with its identity recheck (worktree, branch, session), then tells the owner each outcome exactly once,
 * including a resume a restart cut off (its single attempt is spent, so it expires instead of running again).
 */
export async function runSessionLimitTick(
  resumes: SessionLimitResumes,
  intents: ResumeIntentStore,
  options: SessionLimitTickOptions,
): Promise<ResumeEngineTickResult> {
  const now = options.now ?? Date.now();
  const targets = resumes.targets();
  const timeoutMs = options.timeoutMs ?? 300_000;
  // A resume a restart cut off has spent its one attempt: it may or may not have run, so the owner decides, never a rerun.
  for (const { intent } of resumes.list())
    if (intent.status === 'leased' && intent.leaseExpiresAt !== null && intent.leaseExpiresAt <= now)
      intents.recordAttemptOutcome(
        intent.id,
        {
          kind: 'failed',
          reason: 'the service stopped while it ran; it may or may not have finished',
          retryable: false,
        },
        now,
      );
  const result = await runResumeEngineTick(intents, {
    // The lease outlasts the run, so a slow resume is never taken for an abandoned one.
    leaseMs: timeoutMs + 60_000,
    ...createHeadlessResumeDeps(targets, {
      owner: options.owner,
      now,
      timeoutMs,
      ...(options.execFn ? { execFn: options.execFn } : {}),
      ...(options.getBranch ? { getBranch: options.getBranch } : {}),
      ...(options.sessionExists ? { sessionExists: options.sessionExists } : {}),
    }),
  });
  for (const { intent, target } of resumes.list()) {
    if (intent.status === 'pending' || intent.status === 'leased' || intent.status === 'cancelled') continue;
    resumes.noticeOnce(intent.id, () => options.notify(sessionLimitNotice(intent, target)));
  }
  return result;
}
