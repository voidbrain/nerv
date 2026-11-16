import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { DesktopRecordingSession, type DesktopRecordingHeader } from '../src/desktop-recording.ts';

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
