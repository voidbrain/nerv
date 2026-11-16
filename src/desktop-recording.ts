import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface DisplayBounds {
  width: number;
  height: number;
  scaleFactor: number;
}

export interface FrontmostAppMetadata {
  bundleId: string;
  appName: string;
  windowTitle: string;
  windowFrame: { x: number; y: number; width: number; height: number };
}

export interface DesktopRecordingHeader {
  version: 1;
  recordedAt: string;
  displayBounds: DisplayBounds;
  frontmostApp: FrontmostAppMetadata;
}

export type DesktopEventKind = 'mouseMove' | 'mouseDown' | 'mouseUp' | 'scroll' | 'keyDown' | 'keyUp';

export interface DesktopInputEvent {
  dtMs: number;
  kind: DesktopEventKind;
  x?: number;
  y?: number;
  button?: 'left' | 'right' | 'other';
  deltaX?: number;
  deltaY?: number;
  keyCode?: number;
  modifiers?: string[];
}

export interface DesktopRecordingFile {
  id: string;
  header: DesktopRecordingHeader;
  events: DesktopInputEvent[];
  droppedSensitiveKeyEvents: number;
  truncatedReason?: 'max-duration' | 'max-events';
}

export interface TccPermissions {
  accessibilityGranted: boolean;
  inputMonitoringGranted: boolean;
}

export interface RecordingContext {
  secureInputActive?: boolean;
  focusedRole?: string;
  frontmostBundleId?: string;
}

const DEFAULT_MAX_DURATION_MS = 120_000;
const DEFAULT_MAX_EVENTS = 10_000;
const SENSITIVE_BUNDLES = new Set([
  'com.apple.keychainaccess',
  'com.1password.1password',
  'com.bitwarden.desktop',
  'com.apple.SecurityAgent',
]);

/**
 * Preflight check for macOS Accessibility and Input Monitoring permissions.
 * Never prompts silently; tells the owner which System Settings panes to enable (F-092-T02).
 */
export function assertDesktopRecordingPermissions(permissions: TccPermissions): void {
  const missing: string[] = [];
  if (!permissions.accessibilityGranted) missing.push('Accessibility');
  if (!permissions.inputMonitoringGranted) missing.push('Input Monitoring');
  if (missing.length > 0) {
    throw new Error(
      `Desktop recording requires owner-granted macOS permission(s) in System Settings > Privacy & Security: ${missing.join(', ')}.`,
    );
  }
}

/**
 * Bounded, local-only desktop input recording session (F-092-T02).
 * Starts/stops on owner command, enforces duration & event ceilings, and never records keyboard events
 * in password fields or Secure Input contexts.
 */
export class DesktopRecordingSession {
  readonly id: string;
  readonly header: DesktopRecordingHeader;
  readonly maxDurationMs: number;
  readonly maxEvents: number;
  private readonly startedAtMs: number;
  private readonly events: DesktopInputEvent[] = [];
  private stopped = false;
  private droppedSensitiveKeyEvents = 0;
  private truncatedReason: 'max-duration' | 'max-events' | undefined;

  constructor(options: {
    id: string;
    permissions: TccPermissions;
    header: DesktopRecordingHeader;
    startedAtMs?: number;
    maxDurationMs?: number;
    maxEvents?: number;
  }) {
    assertDesktopRecordingPermissions(options.permissions);
    this.id = options.id.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!this.id) throw new Error('Recording id must contain alphanumeric characters.');
    this.header = options.header;
    this.startedAtMs = options.startedAtMs ?? Date.now();
    this.maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
    this.maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
  }

  recordEvent(event: Omit<DesktopInputEvent, 'dtMs'>, timestampMs: number, context: RecordingContext = {}): boolean {
    if (this.stopped) return false;
    const dtMs = Math.max(0, timestampMs - this.startedAtMs);
    if (dtMs > this.maxDurationMs) {
      this.truncatedReason = 'max-duration';
      this.stopped = true;
      return false;
    }
    if (this.events.length >= this.maxEvents) {
      this.truncatedReason = 'max-events';
      this.stopped = true;
      return false;
    }

    const isKeyEvent = event.kind === 'keyDown' || event.kind === 'keyUp';
    const isSensitive =
      context.secureInputActive === true ||
      context.focusedRole === 'AXSecureTextField' ||
      (context.frontmostBundleId !== undefined && SENSITIVE_BUNDLES.has(context.frontmostBundleId));

    if (isKeyEvent && isSensitive) {
      this.droppedSensitiveKeyEvents += 1;
      return false;
    }

    this.events.push({ dtMs, ...event });
    return true;
  }

  stop(recordingsDir?: string): { recording: DesktopRecordingFile; filePath?: string } {
    this.stopped = true;
    const recording: DesktopRecordingFile = {
      id: this.id,
      header: this.header,
      events: [...this.events],
      droppedSensitiveKeyEvents: this.droppedSensitiveKeyEvents,
      ...(this.truncatedReason ? { truncatedReason: this.truncatedReason } : {}),
    };
    if (!recordingsDir) return { recording };
    mkdirSync(recordingsDir, { recursive: true });
    const filePath = join(recordingsDir, `${this.id}.json`);
    writeFileSync(filePath, JSON.stringify(recording, null, 2), { encoding: 'utf8', mode: 0o600 });
    return { recording, filePath };
  }
}
