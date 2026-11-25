import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
  DesktopRecordingSession,
  replayDesktopRecording,
  type DesktopRecordingFile,
  type DesktopRecordingHeader,
  type DesktopReplayDriver,
} from '../src/desktop-recording.ts';
import { defaultPolicy, patternOf } from '../src/policy.ts';

const dirs: string[] = [];
const makeDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-rec-'));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const SAMPLE_HEADER: DesktopRecordingHeader = {
  version: 1,
  recordedAt: '2026-11-16T00:00:00Z',
  displayBounds: { width: 1728, height: 1117, scaleFactor: 2 },
  frontmostApp: {
    bundleId: 'com.example.App',
    appName: 'SampleApp',
    windowTitle: 'Main',
    windowFrame: { x: 0, y: 0, width: 800, height: 600 },
  },
};

describe('F-092-T02 bounded local desktop recording', () => {
  it('refuses to start without owner-granted Accessibility and Input Monitoring permissions', () => {
    assert.throws(
      () =>
        new DesktopRecordingSession({
          id: 'rec-1',
          permissions: { accessibilityGranted: false, inputMonitoringGranted: true },
          header: SAMPLE_HEADER,
        }),
      /Accessibility/,
    );
  });

  it('records bounded local events, redacts password/secure-input keystrokes, and stops at ceiling', () => {
    const dir = makeDir();
    const session = new DesktopRecordingSession({
      id: 'rec-2',
      permissions: { accessibilityGranted: true, inputMonitoringGranted: true },
      header: SAMPLE_HEADER,
      startedAtMs: 1000,
      maxDurationMs: 5000,
      maxEvents: 3,
    });

    assert.equal(session.recordEvent({ kind: 'mouseMove', x: 100, y: 200 }, 1100), true);
    assert.equal(
      session.recordEvent({ kind: 'keyDown', keyCode: 12 }, 1200, { focusedRole: 'AXSecureTextField' }),
      false,
    );
    assert.equal(session.recordEvent({ kind: 'keyDown', keyCode: 13 }, 1300, { secureInputActive: true }), false);
    assert.equal(session.recordEvent({ kind: 'mouseDown', x: 100, y: 200, button: 'left' }, 1400), true);
    assert.equal(session.recordEvent({ kind: 'mouseUp', x: 100, y: 200, button: 'left' }, 1500), true);
    // 4th recorded event hits maxEvents=3 ceiling
    assert.equal(session.recordEvent({ kind: 'mouseMove', x: 120, y: 220 }, 1600), false);

    const { recording, filePath } = session.stop(dir);
    assert.ok(filePath && existsSync(filePath));
    assert.equal(recording.events.length, 3);
    assert.equal(recording.droppedSensitiveKeyEvents, 2);
    assert.equal(recording.truncatedReason, 'max-events');
    const saved = JSON.parse(readFileSync(filePath, 'utf8'));
    assert.equal(saved.events.length, 3);
  });
});

describe('F-092-T03 replay as a Blue action with preconditions', () => {
  const SAMPLE_RECORDING: DesktopRecordingFile = {
    id: 'rec-replay-1',
    header: SAMPLE_HEADER,
    events: [
      { dtMs: 10, kind: 'mouseMove', x: 100, y: 200 },
      { dtMs: 25, kind: 'mouseDown', x: 100, y: 200, button: 'left' },
      { dtMs: 40, kind: 'mouseUp', x: 100, y: 200, button: 'left' },
    ],
    droppedSensitiveKeyEvents: 0,
  };

  const makeDriver = (overrides: Partial<DesktopReplayDriver> = {}): DesktopReplayDriver & { dispatched: number } => {
    const driver: DesktopReplayDriver & { dispatched: number } = {
      dispatched: 0,
      checkAccessibilityPermission: () => true,
      getDisplayBounds: async () => ({ ...SAMPLE_HEADER.displayBounds }),
      getFrontmostApp: async () => ({
        ...SAMPLE_HEADER.frontmostApp,
        windowFrame: { ...SAMPLE_HEADER.frontmostApp.windowFrame },
      }),
      dispatchEvent: async () => {
        driver.dispatched += 1;
      },
      hasOwnerInput: () => false,
      readBackSummary: async () => 'Main window updated',
      ...overrides,
    };
    return driver;
  };

  it('classifies desktop.replay as Blue and refuses without confirmation or accessibility permission', async () => {
    assert.equal(patternOf('physical', 'trusted', 'desktop.replay', defaultPolicy, true), 'blue');
    await assert.rejects(
      () =>
        replayDesktopRecording(makeDriver({ checkAccessibilityPermission: () => false }), {
          recording: SAMPLE_RECORDING,
          approved: true,
        }),
      /Accessibility permission/,
    );
    await assert.rejects(
      () => replayDesktopRecording(makeDriver(), { recording: SAMPLE_RECORDING, approved: false }),
      /Blue action/,
    );
  });

  it('checks display, frontmost app, and window preconditions before replaying any event', async () => {
    const d1 = makeDriver({ getDisplayBounds: async () => ({ width: 1280, height: 720, scaleFactor: 1 }) });
    await assert.rejects(
      () => replayDesktopRecording(d1, { recording: SAMPLE_RECORDING, approved: true }),
      /expected display/,
    );
    assert.equal(d1.dispatched, 0);

    const d2 = makeDriver({
      getFrontmostApp: async () => ({ ...SAMPLE_HEADER.frontmostApp, bundleId: 'com.other.App' }),
    });
    await assert.rejects(
      () => replayDesktopRecording(d2, { recording: SAMPLE_RECORDING, approved: true }),
      /expected frontmost app/,
    );
    assert.equal(d2.dispatched, 0);

    const d3 = makeDriver({
      getFrontmostApp: async () => ({ ...SAMPLE_HEADER.frontmostApp, windowTitle: 'Other Window' }),
    });
    await assert.rejects(
      () => replayDesktopRecording(d3, { recording: SAMPLE_RECORDING, approved: true }),
      /expected window/,
    );
    assert.equal(d3.dispatched, 0);
  });

  it('stops immediately on owner input or mid-replay window change and reads back result on completion', async () => {
    let calls = 0;
    const ownerInterruptDriver = makeDriver({
      hasOwnerInput: () => {
        calls += 1;
        return calls >= 2;
      },
    });
    const interrupted = await replayDesktopRecording(ownerInterruptDriver, {
      recording: SAMPLE_RECORDING,
      approved: true,
    });
    assert.equal(interrupted.status, 'stopped');
    assert.equal(interrupted.stopReason, 'owner-input');
    assert.equal(interrupted.replayedEvents, 1);

    let checks = 0;
    const windowSwitchDriver = makeDriver({
      getFrontmostApp: async () => {
        checks += 1;
        return {
          ...SAMPLE_HEADER.frontmostApp,
          windowTitle: checks >= 3 ? 'Switched' : 'Main',
        };
      },
    });
    const switched = await replayDesktopRecording(windowSwitchDriver, {
      recording: SAMPLE_RECORDING,
      approved: true,
    });
    assert.equal(switched.status, 'stopped');
    assert.equal(switched.stopReason, 'window-changed');
    assert.equal(switched.replayedEvents, 1);

    const okDriver = makeDriver();
    const done = await replayDesktopRecording(okDriver, { recording: SAMPLE_RECORDING, approved: true });
    assert.equal(done.status, 'completed');
    assert.equal(done.replayedEvents, 3);
    assert.equal(done.totalEvents, 3);
    assert.deepEqual(done.preconditionsChecked, { displayMatched: true, appMatched: true, windowMatched: true });
    assert.equal(done.afterSummary, 'Main window updated');
  });
});
