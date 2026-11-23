import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import {
  desktopReplayDriver,
  type DesktopDriver,
  type DesktopInputSource,
  type DesktopWindowSnapshot,
} from '../src/desktop-control.ts';
import { createDesktopEditorResumeDeps, desktopWindowFingerprint } from '../src/desktop-editor-resume-adapter.ts';
import { replayDesktopRecording, type DesktopRecordingFile } from '../src/desktop-recording.ts';
import { RESUME_INTENT_SCHEMA, ResumeIntentStore, runResumeEngineTick } from '../src/resume-intent.ts';

const NOW = 1_000_000;
const EDITOR_TITLE = 'notes.md — sample-workspace';

/** One fake desktop: the single driver both F-012 (editor resume) and F-092 (replay) must use. */
function makeDesktop(initial: DesktopWindowSnapshot, afterPress: DesktopWindowSnapshot, permitted = true) {
  let window = initial;
  const calls: string[] = [];
  const driver: DesktopDriver = {
    checkAccessibilityPermission: () => {
      calls.push('permission');
      return permitted;
    },
    async getWindow(appName, windowTitle) {
      calls.push(`getWindow:${appName}:${windowTitle ?? ''}`);
      return window;
    },
    async pressControl(_app, _title, controlName) {
      calls.push(`press:${controlName}`);
      window = afterPress;
      return window;
    },
    async getDisplayBounds() {
      calls.push('display');
      return { width: 1440, height: 900, scaleFactor: 2 };
    },
    async getFrontmostApp() {
      calls.push('frontmost');
      return {
        bundleId: 'com.example.editor',
        appName: window.appName,
        windowTitle: window.windowTitle,
        windowFrame: { x: 0, y: 25, width: 1440, height: 875 },
      };
    },
  };
  return { driver, calls, current: () => window };
}

function makeIntentStore(window: DesktopWindowSnapshot) {
  const db = new DatabaseSync(':memory:');
  db.exec(RESUME_INTENT_SCHEMA);
  const store = new ResumeIntentStore(db);
  store.create({
    targetKind: 'vscode-claude',
    targetId: window.windowTitle,
    targetFingerprint: desktopWindowFingerprint(window),
    permissionScope: {
      allowedAction: 'resume-named-job',
      targetId: window.windowTitle,
      allowSecurityPrompts: false,
      allowLimitBypass: false,
      modelOverrideBlocked: true,
      grantedBy: 'owner',
    },
    resetAt: NOW - 1000,
    expiresAt: NOW + 600_000,
    maxAttempts: 2,
    now: NOW - 5000,
  });
  return { store, close: () => db.close() };
}

const PAUSED: DesktopWindowSnapshot = {
  appName: 'SampleEditor',
  windowTitle: EDITOR_TITLE,
  controls: [
    { name: 'Continue', role: 'AXButton' },
    { name: 'Token', role: 'AXSecureTextField' },
  ],
  summaryText: 'Session paused. Press Continue to resume.',
};
const RUNNING: DesktopWindowSnapshot = { ...PAUSED, summaryText: 'Working on the paused task.' };

describe('F-093-T03 one desktop adapter for F-012 editor resume and F-092 replay preconditions', () => {
  it('serves the editor resume and the replay preconditions from the same driver instance', async () => {
    const desktop = makeDesktop(PAUSED, RUNNING);
    const { store, close } = makeIntentStore(PAUSED);
    try {
      const deps = createDesktopEditorResumeDeps({ driver: desktop.driver, appName: 'SampleEditor' });
      const tick = await runResumeEngineTick(store, { ...deps, now: NOW });
      assert.equal(tick.processed.length, 1);
      assert.equal(tick.processed[0]!.status, 'resumed');
      assert.deepEqual(
        desktop.calls.filter((c) => c.startsWith('press:')),
        ['press:Continue'],
      );

      const recording: DesktopRecordingFile = {
        id: 'rec-shared-1',
        header: {
          version: 1,
          recordedAt: '2026-11-23T00:00:00Z',
          displayBounds: { width: 1440, height: 900, scaleFactor: 2 },
          frontmostApp: {
            bundleId: 'com.example.editor',
            appName: 'SampleEditor',
            windowTitle: EDITOR_TITLE,
            windowFrame: { x: 0, y: 25, width: 1440, height: 875 },
          },
        },
        events: [{ dtMs: 5, kind: 'mouseMove', x: 10, y: 10 }],
        droppedSensitiveKeyEvents: 0,
      };
      const dispatched: string[] = [];
      const input: DesktopInputSource = {
        async dispatchEvent(event) {
          dispatched.push(event.kind);
        },
        hasOwnerInput: () => false,
      };
      desktop.calls.length = 0;
      const replay = await replayDesktopRecording(desktopReplayDriver(desktop.driver, input), {
        recording,
        approved: true,
      });
      assert.equal(replay.status, 'completed');
      assert.deepEqual(dispatched, ['mouseMove']);
      assert.equal(replay.afterSummary, RUNNING.summaryText);
      // Preconditions and readback came from the shared accessibility driver, not a second path.
      assert.ok(desktop.calls.includes('permission'));
      assert.ok(desktop.calls.includes('display'));
      assert.ok(desktop.calls.includes('frontmost'));
      assert.ok(desktop.calls.includes(`getWindow:SampleEditor:${EDITOR_TITLE}`));
    } finally {
      close();
    }
  });

  it('replay preconditions through the shared driver still stop on permission and window mismatch', async () => {
    const input: DesktopInputSource = { dispatchEvent: async () => {}, hasOwnerInput: () => false };
    const recording: DesktopRecordingFile = {
      id: 'rec-shared-2',
      header: {
        version: 1,
        recordedAt: '2026-11-23T00:00:00Z',
        displayBounds: { width: 1440, height: 900, scaleFactor: 2 },
        frontmostApp: {
          bundleId: 'com.example.editor',
          appName: 'SampleEditor',
          windowTitle: 'other.md — sample-workspace',
          windowFrame: { x: 0, y: 25, width: 1440, height: 875 },
        },
      },
      events: [],
      droppedSensitiveKeyEvents: 0,
    };
    const denied = makeDesktop(PAUSED, PAUSED, false);
    await assert.rejects(
      () => replayDesktopRecording(desktopReplayDriver(denied.driver, input), { recording, approved: true }),
      /Accessibility permission/,
    );
    const allowed = makeDesktop(PAUSED, PAUSED);
    await assert.rejects(
      () => replayDesktopRecording(desktopReplayDriver(allowed.driver, input), { recording, approved: true }),
      /precondition mismatch: expected window/,
    );
  });

  it('editor resume refuses missing permission, changed windows, missing controls and unacknowledged clicks', async () => {
    const noPerm = makeDesktop(PAUSED, RUNNING, false);
    const intentFor = (window: DesktopWindowSnapshot) => {
      const { store, close } = makeIntentStore(window);
      const intent = store.due(NOW)[0]!;
      close();
      return intent;
    };
    const intent = intentFor(PAUSED);
    const depsNoPerm = createDesktopEditorResumeDeps({ driver: noPerm.driver, appName: 'SampleEditor' });
    assert.deepEqual(await depsNoPerm.checkAvailability(intent), {
      available: false,
      reason: 'accessibility-permission-missing',
    });

    const missing = makeDesktop({ ...PAUSED, controls: [] }, RUNNING);
    const depsMissing = createDesktopEditorResumeDeps({ driver: missing.driver, appName: 'SampleEditor' });
    assert.deepEqual(await depsMissing.checkAvailability(intent), {
      available: false,
      reason: 'resume-control-missing',
    });

    const changed = makeDesktop({ ...PAUSED, summaryText: 'Different content after sleep.' }, RUNNING);
    const depsChanged = createDesktopEditorResumeDeps({ driver: changed.driver, appName: 'SampleEditor' });
    const changedOutcome = await depsChanged.executeResume(intent);
    assert.equal(changedOutcome.kind, 'failed');
    assert.ok(changedOutcome.kind === 'failed' && /content-changed/.test(changedOutcome.reason));
    assert.equal(changed.calls.filter((c) => c.startsWith('press:')).length, 0);

    const silent = makeDesktop(PAUSED, PAUSED);
    const depsSilent = createDesktopEditorResumeDeps({ driver: silent.driver, appName: 'SampleEditor' });
    const silentOutcome = await depsSilent.executeResume(intent);
    assert.deepEqual(silentOutcome, { kind: 'failed', reason: 'uncertain-click-acknowledgement', retryable: false });

    const secret = makeDesktop(PAUSED, RUNNING);
    const depsSecret = createDesktopEditorResumeDeps({
      driver: secret.driver,
      appName: 'SampleEditor',
      controlName: 'Token',
    });
    const secretOutcome = await depsSecret.executeResume(intent);
    assert.ok(secretOutcome.kind === 'failed' && /password\/credential/.test(secretOutcome.reason));
    assert.equal(secret.calls.filter((c) => c.startsWith('press:')).length, 0);
  });
});
