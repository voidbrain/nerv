import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { runResumeEngineTick } from '../src/resume-intent.ts';
import {
  ClaudeCodeResumeAdapter,
  VSCODE_CLAUDE_INFEASIBILITY_NOTE,
  computeClaudeSessionFingerprint,
} from '../src/claude-resume-adapter.ts';

describe('F-012-T03: Claude Code resume adapter feasibility and CLI adapter', () => {
  it('resumes a verified CLI-backed session once via claude --resume and refuses UI-only VS Code targets', async () => {
    const store = new Store(':memory:');
    try {
      const now = 1_700_000_000_000;
      const sessionContent = '{"id":"sess-abc-123","task":"neutral-refactor"}\n';
      const expectedFingerprint = computeClaudeSessionFingerprint('sess-abc-123', sessionContent, '/tmp/neutral-repo');

      store.resumeIntents.create({
        id: 'intent-cli-1',
        targetKind: 'cli-job',
        targetId: 'sess-abc-123',
        targetFingerprint: expectedFingerprint,
        permissionScope: {
          allowedAction: 'resume-named-job',
          targetId: 'sess-abc-123',
          allowSecurityPrompts: false,
          allowLimitBypass: false,
          modelOverrideBlocked: true,
          grantedBy: 'owner',
        },
        resetAt: now - 1000,
        expiresAt: now + 60_000,
        now: now - 5000,
      });

      const calls: Array<{ bin: string; args: readonly string[] }> = [];
      const adapter = new ClaudeCodeResumeAdapter({
        runner: async (bin, args) => {
          calls.push({ bin, args });
          if (args[0] === '--version') {
            return { exitCode: 0, stdout: '2.1.312 (Claude Code)\n', stderr: '' };
          }
          return { exitCode: 0, stdout: '{"result":"ok"}', stderr: '' };
        },
        readSessionFile: () => sessionContent,
        resolveTarget: () => ({
          sessionId: 'sess-abc-123',
          sessionFile: '/tmp/neutral/sess-abc-123.jsonl',
          cwd: '/tmp/neutral-repo',
        }),
      });

      const res = await runResumeEngineTick(store.resumeIntents, adapter.toEngineDeps('mac-local', { now }));
      assert.equal(res.processed.length, 1);
      assert.equal(res.processed[0]?.status, 'resumed');
      assert.equal(calls.length, 2);
      assert.deepEqual(calls[1]?.args, [
        '--resume',
        'sess-abc-123',
        '-p',
        'Continue the paused task.',
        '--output-format',
        'json',
      ]);

      // UI-only VS Code extension target is rejected with documented infeasibility.
      const uiIntent = store.resumeIntents.create({
        id: 'intent-ui-1',
        targetKind: 'vscode-claude',
        targetId: 'vscode-tab-only',
        targetFingerprint: 'fp-ui',
        permissionScope: {
          allowedAction: 'resume-named-job',
          targetId: 'vscode-tab-only',
          allowSecurityPrompts: false,
          allowLimitBypass: false,
          modelOverrideBlocked: true,
          grantedBy: 'owner',
        },
        resetAt: now - 1000,
        expiresAt: now + 60_000,
        now: now - 5000,
      });
      const uiAdapter = new ClaudeCodeResumeAdapter({
        resolveTarget: () => ({ uiOnly: true }),
      });
      const check = await uiAdapter.checkAvailability(uiIntent);
      assert.equal(check.available, false);
      assert.equal(check.reason, VSCODE_CLAUDE_INFEASIBILITY_NOTE);
    } finally {
      store.close();
    }
  });

  it('defers when provider limit is still active and rejects changed session fingerprint', async () => {
    const store = new Store(':memory:');
    try {
      const now = 1_700_000_000_000;
      const intent = store.resumeIntents.create({
        id: 'intent-limit-1',
        targetKind: 'cli-job',
        targetId: 'sess-xyz-999',
        targetFingerprint: computeClaudeSessionFingerprint('sess-xyz-999', 'original'),
        permissionScope: {
          allowedAction: 'resume-named-job',
          targetId: 'sess-xyz-999',
          allowSecurityPrompts: false,
          allowLimitBypass: false,
          modelOverrideBlocked: true,
          grantedBy: 'owner',
        },
        resetAt: now - 1000,
        expiresAt: now + 600_000,
        now: now - 5000,
      });

      const limitAdapter = new ClaudeCodeResumeAdapter({
        runner: async (_bin, args) => {
          if (args[0] === '--version') return { exitCode: 0, stdout: '2.1.312', stderr: '' };
          return { exitCode: 1, stdout: '', stderr: 'API rate limit reached, try again later.' };
        },
        readSessionFile: () => 'original',
        resolveTarget: () => ({ sessionId: 'sess-xyz-999', sessionFile: '/tmp/sess-xyz-999.jsonl' }),
      });

      const r1 = await runResumeEngineTick(store.resumeIntents, limitAdapter.toEngineDeps('mac-local', { now }));
      assert.equal(r1.processed[0]?.status, 'pending');
      assert.match(r1.processed[0]?.lastError ?? '', /rate limit/i);

      // Changed session content -> fingerprint mismatch -> failed without invoking claude --resume.
      const changedAdapter = new ClaudeCodeResumeAdapter({
        runner: async () => ({ exitCode: 0, stdout: '2.1.312', stderr: '' }),
        readSessionFile: () => 'modified-different-task',
        resolveTarget: () => ({ sessionId: 'sess-xyz-999', sessionFile: '/tmp/sess-xyz-999.jsonl' }),
      });
      const r2 = await runResumeEngineTick(
        store.resumeIntents,
        changedAdapter.toEngineDeps('mac-local', { now: now + 120_000 }),
      );
      assert.equal(r2.processed[0]?.status, 'failed');
      assert.match(r2.processed[0]?.lastError ?? '', /fingerprint mismatch/i);
      assert.equal(intent.id, 'intent-limit-1');
    } finally {
      store.close();
    }
  });
});
