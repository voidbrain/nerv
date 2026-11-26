import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { DesktopDriver } from '../src/desktop-control.ts';
import { liveDesktopControl, openMacInputSession } from '../src/desktop-macos-driver.ts';
import {
  DesktopRecordingSession,
  type DesktopInputEvent,
  type DesktopRecordingFile,
  type FrontmostAppMetadata,
} from '../src/desktop-recording.ts';
import {
  DESKTOP_START_DELAY_MS,
  createDesktopControl,
  desktopRecordingPath,
  type DesktopInputSession,
  type MouseSample,
} from '../src/desktop-service.ts';
import { builtinTools, toolDocs } from '../src/executors.ts';
import { MISATO_SOURCE, Store, settledOutcome } from '../src/store.ts';

// Invented apps, windows and coordinates only. No test here reads or moves the real mouse: every driver, sampler and
// input session is a fake (F-092-T05).
const NODE = '/opt/example/bin/node';
const FRONT: FrontmostAppMetadata = {
  bundleId: 'com.example.notes',
  appName: 'SampleNotes',
  windowTitle: 'Scratch',
  windowFrame: { x: 100, y: 80, width: 800, height: 600 },
};
const CASPER_SURE = { seat: 'casper', vote: 'approve' as const, reason: 'Matches.', confidence: 1 };

interface FakeDesktop {
  permitted: boolean;
  front: FrontmostAppMetadata;
  samples: MouseSample[];
  sampled: number[];
  sleeps: number[];
  posted: DesktopInputEvent[];
  released: number;
  closed: number;
  opened: number;
  ownerInputAfter: number;
  frontAfter?: { posts: number; front: FrontmostAppMetadata };
}

function fakeDesktop(overrides: Partial<FakeDesktop> = {}) {
  const state: FakeDesktop = {
    permitted: true,
    front: { ...FRONT, windowFrame: { ...FRONT.windowFrame } },
    samples: [
      { tMs: 0, kind: 'mouseMove', x: 300, y: 300 },
      { tMs: 100, kind: 'mouseMove', x: 320, y: 310 },
      { tMs: 200, kind: 'mouseDown', x: 320, y: 310, button: 'left' },
      { tMs: 300, kind: 'mouseMove', x: 340, y: 320 },
      { tMs: 400, kind: 'mouseUp', x: 340, y: 320, button: 'left' },
    ],
    sampled: [],
    sleeps: [],
    posted: [],
    released: 0,
    closed: 0,
    opened: 0,
    ownerInputAfter: Infinity,
    ...overrides,
  };
  const front = () =>
    state.frontAfter && state.posted.length >= state.frontAfter.posts ? state.frontAfter.front : state.front;
  const driver: DesktopDriver = {
    checkAccessibilityPermission: () => state.permitted,
    async getWindow(appName, windowTitle) {
      return { appName, windowTitle: windowTitle ?? '', controls: [], summaryText: 'Scratch window, empty.' };
    },
    async pressControl() {
      throw new Error('not used');
    },
    async getDisplayBounds() {
      return { width: 1440, height: 900, scaleFactor: 2 };
    },
    async getFrontmostApp() {
      return front();
    },
  };
  const session = (): DesktopInputSession => {
    state.opened += 1;
    return {
      async dispatchEvent(event) {
        state.posted.push(event);
      },
      hasOwnerInput: () => state.posted.length >= state.ownerInputAfter,
      async getFrontmostApp() {
        return front();
      },
      async releaseButtons() {
        state.released += 1;
      },
      close() {
        state.closed += 1;
      },
    };
  };
  const control = createDesktopControl({
    driver,
    executable: NODE,
    async sampleMouse(durationMs) {
      state.sampled.push(durationMs);
      return state.samples;
    },
    openInputSession: session,
    async sleep(ms) {
      state.sleeps.push(ms);
    },
  });
  return { state, control };
}

function withHome(work: (home: string) => Promise<void>) {
  const home = mkdtempSync(join(tmpdir(), 'nerv-desktop-'));
  return work(home).finally(() => rmSync(home, { recursive: true, force: true }));
}

describe('F-092-T05: the service binds the macOS desktop driver for recording and replay', () => {
  it('reports clearly when Accessibility is missing, naming the exact binary to grant', () => {
    const { control } = fakeDesktop({ permitted: false });
    const status = control.status();
    assert.equal(status.available, false);
    assert.match(status.detail, /^desktop control not available: grant Accessibility to \/opt\/example\/bin\/node /);
    assert.match(status.detail, /System Settings > Privacy & Security > Accessibility/);
    assert.equal(fakeDesktop().control.status().available, true);
  });

  it('records mouse input only, bounded and local (mode 600), after the start delay', async () => {
    await withHome(async (home) => {
      const { state, control } = fakeDesktop();
      const summary = await control.record(home, { id: 'wiggle', seconds: 5 });
      assert.deepEqual(state.sleeps, [DESKTOP_START_DELAY_MS]);
      assert.deepEqual(state.sampled, [5000]);
      const path = desktopRecordingPath(home, 'wiggle');
      if (process.platform !== 'win32') assert.equal(statSync(path).mode & 0o777, 0o600);
      const file = JSON.parse(readFileSync(path, 'utf8')) as DesktopRecordingFile;
      assert.equal(file.events.length, 5);
      assert.ok(file.events.every((e) => e.kind.startsWith('mouse')));
      assert.deepEqual(file.header.frontmostApp, FRONT);
      assert.equal(summary.events, 5);
      assert.equal(summary.app, 'SampleNotes');
      assert.equal(summary.window, 'Scratch');
      assert.equal(JSON.stringify(summary).includes('"x"'), false, 'the result carries no coordinates');
    });
  });

  it('refuses a recording without Accessibility, over the bound, with a bad name or over an existing one', async () => {
    await withHome(async (home) => {
      const denied = fakeDesktop({ permitted: false });
      await assert.rejects(() => denied.control.record(home, { id: 'a', seconds: 5 }), /grant Accessibility to/);
      assert.deepEqual(denied.state.sampled, [], 'nothing is sampled without the grant');
      const { state, control } = fakeDesktop();
      await assert.rejects(() => control.record(home, { id: 'a', seconds: 61 }), /1 to 60 seconds/);
      await assert.rejects(() => control.record(home, { id: '../escape', seconds: 5 }), /letters, digits/);
      await control.record(home, { id: 'a', seconds: 2 });
      await assert.rejects(() => control.record(home, { id: 'a', seconds: 2 }), /already exists/);
      assert.deepEqual(state.sampled, [2000]);
    });
  });

  it('closes a button the owner still held at the end and drops a release whose press came before the start', async () => {
    await withHome(async (home) => {
      const { control } = fakeDesktop({
        samples: [
          { tMs: 0, kind: 'mouseUp', x: 10, y: 10, button: 'left' },
          { tMs: 50, kind: 'mouseDown', x: 12, y: 10, button: 'right' },
          { tMs: 90, kind: 'mouseMove', x: 14, y: 12 },
        ],
      });
      await control.record(home, { id: 'held', seconds: 1 });
      const file = JSON.parse(readFileSync(desktopRecordingPath(home, 'held'), 'utf8')) as DesktopRecordingFile;
      assert.deepEqual(
        file.events.map((e) => `${e.kind}:${e.button ?? ''}`),
        ['mouseDown:right', 'mouseMove:', 'mouseUp:right'],
      );
    });
  });

  it('binds a replay to the recording on disk (hash, app, window, display) and refuses keys or a changed file', async () => {
    await withHome(async (home) => {
      const { state, control } = fakeDesktop();
      await control.record(home, { id: 'wiggle', seconds: 5 });
      const bound = control.bindReplay(home, 'wiggle');
      assert.equal(bound.id, 'wiggle');
      assert.equal(bound.app, 'SampleNotes');
      assert.equal(bound.window, 'Scratch');
      assert.equal(bound.display, '1440x900@2x');
      assert.equal(bound.events, 5);
      assert.match(bound.sha256, /^[0-9a-f]{64}$/);
      assert.throws(() => control.bindReplay(home, 'missing'), /No desktop recording named "missing"/);

      // A file edited after the card was shown no longer matches the hash the owner approved.
      const path = desktopRecordingPath(home, 'wiggle');
      const file = JSON.parse(readFileSync(path, 'utf8')) as DesktopRecordingFile;
      file.events.push({ dtMs: 450, kind: 'mouseMove', x: 301, y: 301 });
      writeFileSync(path, JSON.stringify(file));
      await assert.rejects(() => control.replay(home, bound, true), /changed since the approval card/);
      assert.equal(state.opened, 0);

      // A key event (typed text) is never replayed, whoever wrote the file.
      file.events.push({ dtMs: 500, kind: 'keyDown', keyCode: 0 });
      writeFileSync(path, JSON.stringify(file));
      assert.throws(() => control.bindReplay(home, 'wiggle'), /only mouse events/);
    });
  });

  it('replays only with the owner approval, paced, then releases buttons and closes the input session', async () => {
    await withHome(async (home) => {
      const { state, control } = fakeDesktop();
      await control.record(home, { id: 'wiggle', seconds: 5 });
      const bound = control.bindReplay(home, 'wiggle');
      await assert.rejects(() => control.replay(home, bound, false), /Blue action/);
      assert.equal(state.opened, 0, 'no input session opens without the approval');

      state.sleeps.length = 0;
      const report = await control.replay(home, bound, true);
      assert.equal(report.status, 'completed');
      assert.equal(report.replayedEvents, 5);
      assert.equal(state.posted.length, 5);
      assert.equal(state.sleeps[0], DESKTOP_START_DELAY_MS);
      assert.ok(state.sleeps.length > 1, 'events are paced as recorded');
      assert.equal(state.released, 1);
      assert.equal(state.closed, 1);
      assert.equal(report.afterSummary, 'Scratch window, empty.');
      assert.deepEqual(report.after, { app: 'SampleNotes', window: 'Scratch' });
      assert.equal(JSON.stringify(report).includes('windowFrame'), false, 'no window frame in the result');
    });
  });

  it('stops on owner input or a focus change, and refuses before any input when the front window differs', async () => {
    await withHome(async (home) => {
      const { state, control } = fakeDesktop();
      await control.record(home, { id: 'wiggle', seconds: 5 });
      const bound = control.bindReplay(home, 'wiggle');

      state.ownerInputAfter = 2;
      const interrupted = await control.replay(home, bound, true);
      assert.equal(interrupted.status, 'stopped');
      assert.equal(interrupted.stopReason, 'owner-input');
      assert.equal(state.posted.length, 2);
      assert.equal(state.released, 1, 'a button held by the replay is released when it stops');

      state.posted.length = 0;
      state.ownerInputAfter = Infinity;
      state.frontAfter = { posts: 3, front: { ...FRONT, windowTitle: 'Other' } };
      const switched = await control.replay(home, bound, true);
      assert.equal(switched.stopReason, 'window-changed');
      assert.equal(state.posted.length, 3);

      state.posted.length = 0;
      state.frontAfter = undefined;
      state.front = { ...FRONT, bundleId: 'com.example.other', appName: 'Other' };
      await assert.rejects(() => control.replay(home, bound, true), /expected frontmost app/);
      assert.equal(state.posted.length, 0);
      assert.equal(state.closed, 3, 'the session closes on every path');
    });
  });
});

describe('F-092-T05: review fixes (window confinement, no overwrite, card fields)', () => {
  it('refuses a recording with any event outside the recorded window', async () => {
    await withHome(async (home) => {
      const { control } = fakeDesktop({
        samples: [
          { tMs: 0, kind: 'mouseMove', x: 300, y: 300 },
          { tMs: 50, kind: 'mouseDown', x: 5, y: 890, button: 'left' },
          { tMs: 90, kind: 'mouseUp', x: 5, y: 890, button: 'left' },
        ],
      });
      await control.record(home, { id: 'stray', seconds: 1 });
      assert.throws(() => control.bindReplay(home, 'stray'), /2 event\(s\) outside the recorded window "Scratch"/);
    });
  });

  it('stops when the window moves during the replay', async () => {
    await withHome(async (home) => {
      const { state, control } = fakeDesktop();
      await control.record(home, { id: 'wiggle', seconds: 5 });
      const bound = control.bindReplay(home, 'wiggle');
      state.frontAfter = { posts: 2, front: { ...FRONT, windowFrame: { ...FRONT.windowFrame, x: 400 } } };
      const moved = await control.replay(home, bound, true);
      assert.equal(moved.stopReason, 'window-changed');
      assert.equal(state.posted.length, 2);
    });
  });

  it('refuses a card whose shown fields differ from the file, and never overwrites a recording', async () => {
    await withHome(async (home) => {
      const { state, control } = fakeDesktop();
      await control.record(home, { id: 'wiggle', seconds: 5 });
      const bound = control.bindReplay(home, 'wiggle');
      await assert.rejects(
        () => control.replay(home, { ...bound, window: 'Other' }, true),
        /changed since the approval card/,
      );
      assert.equal(state.opened, 0);
      // Two approved recordings with one name: the later write fails rather than replacing the first.
      writeFileSync(desktopRecordingPath(home, 'race'), '{}');
      const session = new DesktopRecordingSession({
        id: 'race',
        inputs: 'mouse',
        permissions: { accessibilityGranted: true },
        header: {
          version: 1,
          recordedAt: '2026-11-26T00:00:00Z',
          displayBounds: { width: 1, height: 1, scaleFactor: 1 },
          frontmostApp: FRONT,
        },
      });
      assert.throws(() => session.stop(join(home, 'recordings')), /EEXIST/);
      assert.equal(readFileSync(desktopRecordingPath(home, 'race'), 'utf8'), '{}');
    });
  });
});

describe('F-092-T05: desktop.record and desktop.replay through the gate (service, driver, approval card)', () => {
  it('both tools are Blue owner tools documented for Misato', () => {
    for (const name of ['desktop.record', 'desktop.replay']) {
      assert.equal(builtinTools.find((t) => t.name === name)?.owner, true, name);
      assert.equal(toolDocs.find((d) => d.name === name)?.subject, 'agency', name);
    }
    assert.match(toolDocs.find((d) => d.name === 'desktop.replay')!.args, /"id": recording name}/);
  });

  it('nothing records or replays before the owner approves its card; the replay card names the recording', async () => {
    await withHome(async (home) => {
      const store = new Store(join(home, 'nerv.sqlite'), undefined, { home });
      const { state, control } = fakeDesktop();
      store.desktop = control;
      try {
        const sortie = store.ledger.openSortie(MISATO_SOURCE, 'record my mouse for 5 seconds', 'trusted');
        const rec = store.runAction(sortie, {
          tool: 'desktop.record',
          stage: 'production',
          args: { id: 'wiggle', seconds: 5 },
          casper: CASPER_SURE,
        });
        assert.equal(rec.outcome, 'approval');
        assert.equal(rec.pattern, 'blue');
        assert.deepEqual(state.sampled, [], 'no recording before the card is approved');
        const recorded = await settledOutcome(store.decide(rec.approvalId!, 'approve', 'owner'));
        assert.equal(recorded.error, undefined);
        assert.ok(existsSync(desktopRecordingPath(home, 'wiggle')));

        const sortie2 = store.ledger.openSortie(MISATO_SOURCE, 'replay wiggle', 'trusted');
        // The planner cannot hand over its own events or its own approval.
        for (const args of [{ id: 'wiggle', approved: true }, { recording: { events: [] } }]) {
          await assert.rejects(
            () => store.prepareProposal({ tool: 'desktop.replay', stage: 'production', args }),
            /Arguments allowed: id\./,
          );
        }
        const proposal = await store.prepareProposal({
          tool: 'desktop.replay',
          stage: 'production',
          args: { id: 'wiggle' },
        });
        const card = store.runAction(sortie2, { ...proposal, casper: CASPER_SURE });
        assert.equal(card.outcome, 'approval');
        assert.equal(card.pattern, 'blue');
        const shown = store.approvals()[0]!.card.args as Record<string, unknown>;
        assert.equal(shown.id, 'wiggle');
        assert.equal(shown.app, 'SampleNotes');
        assert.equal(shown.window, 'Scratch');
        assert.equal(shown.display, '1440x900@2x');
        assert.deepEqual(state.posted, [], 'nothing replays before the card is approved');

        const decided = await settledOutcome(store.decide(card.approvalId!, 'approve', 'owner'));
        assert.equal(decided.error, undefined);
        assert.equal((decided.result as { status: string }).status, 'completed');
        assert.equal(state.posted.length, 5);
        assert.equal(store.ledger.trust(sortie2), 'tainted', 'the read-back window text taints the sortie');
      } finally {
        store.close();
      }
    });
  });

  it('a replay proposed without the binding is refused after approval, and a declined card never replays', async () => {
    await withHome(async (home) => {
      const store = new Store(join(home, 'nerv.sqlite'), undefined, { home });
      const { state, control } = fakeDesktop();
      store.desktop = control;
      try {
        await control.record(home, { id: 'wiggle', seconds: 5 });
        const sortie = store.ledger.openSortie(MISATO_SOURCE, 'replay wiggle', 'trusted');
        const unbound = store.runAction(sortie, {
          tool: 'desktop.replay',
          stage: 'production',
          args: { id: 'wiggle' },
        });
        const failed = await settledOutcome(store.decide(unbound.approvalId!, 'approve', 'owner'));
        assert.match(String(failed.error), /Argument sha256 must be a string/);

        const proposal = await store.prepareProposal({
          tool: 'desktop.replay',
          stage: 'production',
          args: { id: 'wiggle' },
        });
        const sortie2 = store.ledger.openSortie(MISATO_SOURCE, 'replay wiggle', 'trusted');
        const card = store.runAction(sortie2, proposal);
        await settledOutcome(store.decide(card.approvalId!, 'reject', 'owner'));
        assert.deepEqual(state.posted, []);
        assert.equal(state.opened, 0);

        // A file swapped after the card was shown: the approved replay refuses before any input.
        const sortie3 = store.ledger.openSortie(MISATO_SOURCE, 'replay wiggle', 'trusted');
        const card3 = store.runAction(sortie3, proposal);
        const path = desktopRecordingPath(home, 'wiggle');
        const file = JSON.parse(readFileSync(path, 'utf8')) as DesktopRecordingFile;
        file.events.push({ dtMs: 450, kind: 'mouseDown', x: 320, y: 310, button: 'left' });
        writeFileSync(path, JSON.stringify(file));
        const swapped = await settledOutcome(store.decide(card3.approvalId!, 'approve', 'owner'));
        assert.match(String(swapped.error), /changed since the approval card/);
        assert.deepEqual(state.posted, []);
      } finally {
        store.close();
      }
    });
  });

  it('under the test runner the default desktop control refuses, and doctor says why', async () => {
    await withHome(async (home) => {
      const store = new Store(join(home, 'nerv.sqlite'), undefined, { home });
      try {
        const doctor = store.serviceDoctor();
        assert.equal(doctor.desktopControl?.available, false);
        assert.match(doctor.desktopControl!.detail, /desktop control not available/);
        const sortie = store.ledger.openSortie(MISATO_SOURCE, 'record', 'trusted');
        const rec = store.runAction(sortie, { tool: 'desktop.record', stage: 'production', args: { id: 'x' } });
        const decided = await settledOutcome(store.decide(rec.approvalId!, 'approve', 'owner'));
        assert.match(String(decided.error), /runs only in the NERV service/);
        // The service's own live control refuses under the test runner too.
        assert.match(liveDesktopControl('darwin').status().detail, /A test must inject a desktop control/);
      } finally {
        store.close();
      }
    });
  });
});

/** Speaks the helper's line protocol like `desktop-ax.js session`, without touching any real input. */
const FAKE_SESSION = `
let buf = '';
const posted = [];
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\\n')) >= 0) {
    const req = JSON.parse(buf.slice(0, i));
    buf = buf.slice(i + 1);
    if (req.cmd === 'post' && req.event.x === 999) process.exit(3);
    if (req.cmd === 'post') { posted.push(req.event.kind); process.stdout.write(JSON.stringify({ id: req.id, ok: true }) + '\\n'); }
    else if (req.cmd === 'owner') process.stdout.write(JSON.stringify({ id: req.id, input: posted.length >= 2 }) + '\\n');
    else if (req.cmd === 'frontmost') process.stdout.write(JSON.stringify({ id: req.id, frontmost: ${JSON.stringify(FRONT)} }) + '\\n');
    else if (req.cmd === 'release') process.stdout.write(JSON.stringify({ id: req.id, ok: true, posted }) + '\\n');
    else process.stdout.write(JSON.stringify({ id: req.id, error: 'Unknown session command: ' + req.cmd }) + '\\n');
  }
});
`;

describe('F-092-T05: the macOS input session speaks one JSON line per request', () => {
  it('posts, answers owner input and the front window, and refuses a key event before it reaches the helper', async () => {
    const session = openMacInputSession({ spawn: () => spawn(process.execPath, ['-e', FAKE_SESSION]) });
    try {
      assert.equal(await session.hasOwnerInput(), false);
      await session.dispatchEvent({ dtMs: 0, kind: 'mouseMove', x: 1, y: 2 });
      await session.dispatchEvent({ dtMs: 10, kind: 'mouseDown', x: 1, y: 2, button: 'left' });
      assert.equal(await session.hasOwnerInput(), true);
      assert.deepEqual(await session.getFrontmostApp(), FRONT);
      await assert.rejects(() => session.dispatchEvent({ dtMs: 20, kind: 'keyDown', keyCode: 0 }), /only mouse/);
      await session.releaseButtons();
    } finally {
      session.close();
    }
  });

  it('a helper that closes its input fails the replay, not the service (no unhandled EPIPE)', async () => {
    const closer = `require("node:fs").closeSync(0); setTimeout(() => {}, 2000);`;
    const session = openMacInputSession({
      spawn: () => spawn(process.execPath, ['-e', closer]),
      requestTimeoutMs: 1500,
    });
    try {
      await new Promise((done) => setTimeout(done, 200));
      for (let i = 0; i < 3; i++) {
        await assert.rejects(() => session.dispatchEvent({ dtMs: 0, kind: 'mouseMove', x: 1, y: 1 }));
      }
    } finally {
      session.close();
    }
  });

  it('a helper that stops fails the pending request instead of hanging', async () => {
    const session = openMacInputSession({ spawn: () => spawn(process.execPath, ['-e', FAKE_SESSION]) });
    try {
      await assert.rejects(
        () => session.dispatchEvent({ dtMs: 0, kind: 'mouseMove', x: 999, y: 1 }),
        /desktop input helper stopped/,
      );
    } finally {
      session.close();
    }
  });
});
