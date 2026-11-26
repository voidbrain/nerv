import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { desktopReplayDriver, type DesktopDriver, type DesktopInputSource } from './desktop-control.ts';
import {
  DesktopRecordingSession,
  replayDesktopRecording,
  type DesktopInputEvent,
  type DesktopRecordingFile,
  type FrontmostAppMetadata,
  type ReplayRecordingResult,
} from './desktop-recording.ts';

/**
 * F-092-T05: the service's desktop control. It joins the shared desktop driver (F-093) to the recording session and
 * the Blue replay (F-092-T02/T03): recordings are mouse-only, bounded and stored in the data home with mode 600;
 * a replay is bound to the file's hash when proposed, runs only with the owner's approval of that card, and checks
 * the display, front app and window before and during the replay. Keys are never recorded, replayed or logged.
 */

/** Time the owner has after approving a card to bring the window to the front before recording or replay starts. */
export const DESKTOP_START_DELAY_MS = 3000;
export const MAX_DESKTOP_RECORDING_SECONDS = 60;
/** A replay never runs longer than this wall-clock time, however slow the per-event checks are. */
export const DESKTOP_REPLAY_DEADLINE_MS = 90_000;
const SAMPLE_MS = 20;
const STATUS_CACHE_MS = 30_000;
const WINDOW_MARGIN_PX = 4;
const MAX_EVENTS = 10_000;
const MAX_COORDINATE = 20_000;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const MOUSE_KINDS = new Set(['mouseMove', 'mouseDown', 'mouseUp']);
const EVENT_KEYS = new Set(['dtMs', 'kind', 'x', 'y', 'button']);

/** One pointer observation from the sampler: a move, or a button pressed or released at a position. */
export interface MouseSample {
  tMs: number;
  kind: 'mouseMove' | 'mouseDown' | 'mouseUp';
  x: number;
  y: number;
  button?: 'left' | 'right';
}

/** A live input session for one replay: posts mouse events, watches for the owner's input, reads the front window. */
export interface DesktopInputSession extends DesktopInputSource {
  getFrontmostApp(): Promise<FrontmostAppMetadata>;
  /** Releases any button the replay still holds down (a replay that stops mid-drag leaves nothing pressed). */
  releaseButtons(): Promise<void>;
  close(): void;
}

export interface DesktopControlDeps {
  readonly driver: DesktopDriver;
  /** The binary macOS attributes the permission to (the service's node), named in every "not available" answer. */
  readonly executable: string;
  sampleMouse(durationMs: number, sampleMs: number): Promise<MouseSample[]>;
  openInputSession(): DesktopInputSession;
  sleep?(ms: number): Promise<void>;
  now?(): number;
}

export interface DesktopControlStatus {
  available: boolean;
  detail: string;
}

/** What the replay card shows; the grant's argument hash binds every field, the hash binds the events. */
export interface BoundDesktopReplay {
  id: string;
  sha256: string;
  app: string;
  window: string;
  display: string;
  events: number;
  seconds: number;
}

export interface DesktopRecordingSummary {
  id: string;
  events: number;
  seconds: number;
  app: string;
  window: string;
  display: string;
  truncated?: 'max-duration' | 'max-events';
}

export type DesktopReplayReport = Omit<ReplayRecordingResult, 'beforeFrontmost' | 'afterFrontmost'> & {
  id: string;
  before: { app: string; window: string };
  after: { app: string; window: string };
};

export interface DesktopControl {
  status(): DesktopControlStatus;
  record(home: string, request: { id: string; seconds: number }): Promise<DesktopRecordingSummary>;
  bindReplay(home: string, id: string): BoundDesktopReplay;
  replay(home: string, bound: BoundDesktopReplay, ownerApproved: boolean): Promise<DesktopReplayReport>;
}

export function desktopNotAvailable(executable: string): string {
  return `desktop control not available: grant Accessibility to ${executable} in System Settings > Privacy & Security > Accessibility, then try again. NERV never changes this setting itself.`;
}

export function desktopRecordingsDir(home: string): string {
  return join(home, 'recordings');
}

export function desktopRecordingPath(home: string, id: string): string {
  return join(desktopRecordingsDir(home), `${checkedId(id)}.json`);
}

function checkedId(id: string): string {
  if (!ID_PATTERN.test(id)) {
    throw new Error('A recording name is 1–64 letters, digits, "-" or "_", starting with a letter or digit.');
  }
  return id;
}

function displayText(d: { width: number; height: number; scaleFactor: number }): string {
  return `${d.width}x${d.height}@${d.scaleFactor}x`;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Keeps the sampled events a replay can repeat safely: no release without its press, no button left held. */
function balanced(samples: readonly MouseSample[], durationMs: number): MouseSample[] {
  const held = new Set<string>();
  const out: MouseSample[] = [];
  let last: MouseSample | undefined;
  for (const s of samples) {
    if (!MOUSE_KINDS.has(s.kind) || !finite(s.tMs) || !finite(s.x) || !finite(s.y)) continue;
    if (s.tMs < 0 || s.tMs > durationMs || (last && s.tMs < last.tMs)) continue;
    if (s.kind !== 'mouseMove') {
      if (s.button !== 'left' && s.button !== 'right') continue;
      if (s.kind === 'mouseDown') {
        if (held.has(s.button)) continue;
        held.add(s.button);
      } else {
        if (!held.has(s.button)) continue;
        held.delete(s.button);
      }
    }
    out.push(s);
    last = s;
  }
  for (const button of held) {
    out.push({ tMs: last!.tMs, kind: 'mouseUp', x: last!.x, y: last!.y, button: button as 'left' | 'right' });
  }
  return out;
}

/** Reads a recording and refuses anything this binding would not have written: keys, scrolls, unknown fields. */
function readRecording(home: string, id: string): { recording: DesktopRecordingFile; sha256: string } {
  const path = desktopRecordingPath(home, id);
  if (!existsSync(path)) throw new Error(`No desktop recording named "${id}".`);
  const raw = readFileSync(path);
  const sha256 = createHash('sha256').update(raw).digest('hex');
  let recording: DesktopRecordingFile;
  try {
    recording = JSON.parse(raw.toString('utf8')) as DesktopRecordingFile;
  } catch {
    throw new Error(`Desktop recording "${id}" is unreadable.`);
  }
  const h = recording?.header;
  const front = h?.frontmostApp;
  const disp = h?.displayBounds;
  if (
    recording.id !== id ||
    h?.version !== 1 ||
    !disp ||
    !finite(disp.width) ||
    !finite(disp.height) ||
    !finite(disp.scaleFactor) ||
    !front ||
    typeof front.bundleId !== 'string' ||
    typeof front.appName !== 'string' ||
    typeof front.windowTitle !== 'string' ||
    !front.windowFrame ||
    !Array.isArray(recording.events)
  ) {
    throw new Error(`Desktop recording "${id}" is not a recording NERV made.`);
  }
  if (recording.events.length > MAX_EVENTS) throw new Error(`Desktop recording "${id}" has too many events.`);
  let previous = 0;
  for (const ev of recording.events) {
    if (!MOUSE_KINDS.has(ev?.kind) || Object.keys(ev).some((k) => !EVENT_KEYS.has(k))) {
      throw new Error(`Desktop recording "${id}" holds more than mouse events: NERV replays only mouse events.`);
    }
    if (
      !finite(ev.dtMs) ||
      ev.dtMs < previous ||
      ev.dtMs > MAX_DESKTOP_RECORDING_SECONDS * 1000 ||
      !finite(ev.x) ||
      !finite(ev.y) ||
      Math.abs(ev.x) > MAX_COORDINATE ||
      Math.abs(ev.y) > MAX_COORDINATE ||
      (ev.kind !== 'mouseMove' && ev.button !== 'left' && ev.button !== 'right')
    ) {
      throw new Error(`Desktop recording "${id}" has an event out of bounds.`);
    }
    previous = ev.dtMs;
  }
  // Replay acts only inside the recorded window: an event outside its frame (a stray to the Dock or the menu bar,
  // or an edited file) refuses the whole recording.
  const f = front.windowFrame;
  const outside = recording.events.filter(
    (ev) =>
      ev.x! < f.x - WINDOW_MARGIN_PX ||
      ev.y! < f.y - WINDOW_MARGIN_PX ||
      ev.x! > f.x + f.width + WINDOW_MARGIN_PX ||
      ev.y! > f.y + f.height + WINDOW_MARGIN_PX,
  ).length;
  if (outside > 0) {
    throw new Error(
      `Desktop recording "${id}" has ${outside} event(s) outside the recorded window "${front.windowTitle}": NERV replays only inside that window. Record again keeping the pointer over it.`,
    );
  }
  return { recording, sha256 };
}

export function createDesktopControl(deps: DesktopControlDeps): DesktopControl {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const now = deps.now ?? (() => Date.now());
  let cached: { at: number; status: DesktopControlStatus } | undefined;
  const requirePermission = () => {
    if (!deps.driver.checkAccessibilityPermission()) throw new Error(desktopNotAvailable(deps.executable));
  };

  const bind = (home: string, id: string): { bound: BoundDesktopReplay; recording: DesktopRecordingFile } => {
    const { recording, sha256 } = readRecording(home, checkedId(id));
    const last = recording.events.at(-1);
    const bound = {
      id,
      sha256,
      app: recording.header.frontmostApp.appName,
      window: recording.header.frontmostApp.windowTitle,
      display: displayText(recording.header.displayBounds),
      events: recording.events.length,
      seconds: Math.ceil((last?.dtMs ?? 0) / 1000),
    };
    return { bound, recording };
  };

  return {
    status() {
      // Doctor may be polled; the permission check starts a helper process, so its answer is kept for a while.
      if (cached && now() - cached.at < STATUS_CACHE_MS) return cached.status;
      const status = deps.driver.checkAccessibilityPermission()
        ? { available: true, detail: `desktop control available: Accessibility is granted to ${deps.executable}.` }
        : { available: false, detail: desktopNotAvailable(deps.executable) };
      cached = { at: now(), status };
      return status;
    },

    async record(home, request) {
      const id = checkedId(request.id);
      const seconds = request.seconds;
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_DESKTOP_RECORDING_SECONDS) {
        throw new Error(`A desktop recording lasts 1 to ${MAX_DESKTOP_RECORDING_SECONDS} seconds.`);
      }
      const path = desktopRecordingPath(home, id);
      if (existsSync(path)) throw new Error(`A desktop recording named "${id}" already exists; choose another name.`);
      requirePermission();
      await sleep(DESKTOP_START_DELAY_MS);
      const displayBounds = await deps.driver.getDisplayBounds();
      const frontmostApp = await deps.driver.getFrontmostApp();
      const durationMs = seconds * 1000;
      const samples = balanced(await deps.sampleMouse(durationMs, SAMPLE_MS), durationMs);
      const session = new DesktopRecordingSession({
        id,
        inputs: 'mouse',
        permissions: { accessibilityGranted: true },
        header: { version: 1, recordedAt: new Date(now()).toISOString(), displayBounds, frontmostApp },
        startedAtMs: 0,
        maxDurationMs: durationMs,
        maxEvents: MAX_EVENTS,
      });
      for (const s of samples) {
        const event: Omit<DesktopInputEvent, 'dtMs'> = {
          kind: s.kind,
          x: s.x,
          y: s.y,
          ...(s.kind === 'mouseMove' ? {} : { button: s.button! }),
        };
        if (!session.recordEvent(event, s.tMs)) break;
      }
      mkdirSync(desktopRecordingsDir(home), { recursive: true, mode: 0o700 });
      const { recording } = session.stop(desktopRecordingsDir(home));
      return {
        id,
        events: recording.events.length,
        seconds,
        app: frontmostApp.appName,
        window: frontmostApp.windowTitle,
        display: displayText(displayBounds),
        ...(recording.truncatedReason ? { truncated: recording.truncatedReason } : {}),
      };
    },

    bindReplay(home, id) {
      return bind(home, id).bound;
    },

    async replay(home, bound, ownerApproved) {
      if (!ownerApproved) {
        throw new Error('Replaying desktop input is a Blue action and runs only after the owner approves its card.');
      }
      const { bound: fresh, recording } = bind(home, bound.id);
      const fields = Object.keys(fresh) as (keyof BoundDesktopReplay)[];
      if (fields.some((k) => fresh[k] !== bound[k])) {
        throw new Error(`Desktop recording "${bound.id}" changed since the approval card; propose the replay again.`);
      }
      requirePermission();
      await sleep(DESKTOP_START_DELAY_MS);
      const session = deps.openInputSession();
      try {
        const startedAt = now();
        let next = 0;
        const events = recording.events;
        // Paced as recorded: after each event, wait until the next one is due; never past the wall-clock deadline.
        const input: DesktopInputSource = {
          hasOwnerInput: () => session.hasOwnerInput(),
          async dispatchEvent(event) {
            if (now() - startedAt > DESKTOP_REPLAY_DEADLINE_MS) {
              throw new Error(`Desktop replay stopped: it ran past ${DESKTOP_REPLAY_DEADLINE_MS / 1000} seconds.`);
            }
            await session.dispatchEvent(event);
            next += 1;
            const due = events[next] ? startedAt + events[next]!.dtMs - now() : 0;
            if (due > 0) await sleep(due);
          },
        };
        const driver = desktopReplayDriver({ ...deps.driver, getFrontmostApp: () => session.getFrontmostApp() }, input);
        const readBack = driver.readBackSummary!;
        driver.readBackSummary = () => readBack().catch(() => 'The front window could not be read back.');
        const result = await replayDesktopRecording(driver, {
          recording,
          approved: true,
          maxDurationMs: MAX_DESKTOP_RECORDING_SECONDS * 1000,
        });
        // Window frames stay out of the result (and so out of the ledger): app and title say what was in front.
        const { beforeFrontmost, afterFrontmost, ...rest } = result;
        return {
          id: bound.id,
          ...rest,
          before: { app: beforeFrontmost.appName, window: beforeFrontmost.windowTitle },
          after: { app: afterFrontmost.appName, window: afterFrontmost.windowTitle },
        };
      } finally {
        await session.releaseButtons().catch(() => undefined);
        session.close();
      }
    },
  };
}

export const DESKTOP_SERVICE_ONLY =
  'it runs only in the NERV service, whose node holds the Accessibility grant: approve the card from the dashboard or chat.';

/** A desktop control that refuses every use with one reason (no live driver on this platform, or under tests). */
export function refusingDesktopControl(reason: string): DesktopControl {
  const refuse = (): never => {
    throw new Error(reason);
  };
  return {
    status: () => ({
      available: false,
      detail: `desktop control not available: ${reason}`,
    }),
    record: async () => refuse(),
    bindReplay: () => refuse(),
    replay: async () => refuse(),
  };
}
