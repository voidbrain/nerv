// NERV desktop accessibility helper (F-093-T05). Run: osascript -l JavaScript desktop-ax.js <command> '<json>'
// Reads and presses controls through macOS Accessibility (System Events). It never changes privacy
// settings and never prompts for Accessibility (AXIsProcessTrusted, no prompt option): without the owner's
// grant it reports { granted: false }. The first window read asks macOS Automation consent for System Events.
// Output: one JSON object on stdout; errors as { "error": "..." } with exit status 1.
// F-092-T05 adds two input commands. `record` polls the pointer position and buttons for a bounded time (it never
// reads the keyboard). `session` reads one JSON request per line on stdin and answers one JSON line on stdout:
// post a mouse event, report owner input, read the front window, release held buttons. It posts mouse events only.
ObjC.import('AppKit');
ObjC.import('ApplicationServices');
ObjC.import('CoreGraphics');
ObjC.import('stdlib');

const ACTIONABLE = [
  'AXButton',
  'AXCheckBox',
  'AXRadioButton',
  'AXMenuButton',
  'AXPopUpButton',
  'AXLink',
  'AXTab',
  'AXTextField',
  'AXSecureTextField',
];
const MAX_ELEMENTS = 3000;
const MAX_SUMMARY = 4000;

function safe(read, fallback) {
  try {
    const value = read();
    return value === null || value === undefined ? fallback : value;
  } catch (_err) {
    return fallback;
  }
}

function systemEvents() {
  return Application('System Events');
}

function findWindow(appName, windowTitle) {
  const proc = systemEvents().processes.byName(appName);
  if (!safe(() => proc.exists(), false)) throw new Error('App is not running: ' + appName);
  const windows = proc.windows();
  if (windows.length === 0) throw new Error('App has no open window: ' + appName);
  if (!windowTitle) return { proc: proc, win: windows[0] };
  for (const win of windows) {
    if (safe(() => win.name(), '') === windowTitle) return { proc: proc, win: win };
  }
  throw new Error('Window not found: ' + windowTitle);
}

function describe(el) {
  const role = safe(() => el.role(), '');
  const subrole = safe(() => el.subrole(), '');
  const name = safe(() => el.name(), '') || safe(() => el.description(), '');
  return { el: el, role: subrole === 'AXSecureTextField' ? 'AXSecureTextField' : role, name: String(name) };
}

function elements(win) {
  return safe(() => win.entireContents(), []).slice(0, MAX_ELEMENTS).map(describe);
}

function snapshot(proc, win) {
  const controls = [];
  const texts = [];
  for (const item of elements(win)) {
    if (item.role === 'AXStaticText') {
      const value = safe(() => item.el.value(), '');
      if (value) texts.push(String(value));
      continue;
    }
    if (!item.name || ACTIONABLE.indexOf(item.role) < 0) continue;
    const control = { name: item.name, role: item.role };
    if (item.role === 'AXSecureTextField') control.isPassword = true;
    controls.push(control);
  }
  const bundleId = safe(() => proc.bundleIdentifier(), '');
  return {
    appName: safe(() => proc.name(), ''),
    ...(bundleId ? { bundleId: bundleId } : {}),
    windowTitle: safe(() => win.name(), ''),
    controls: controls,
    summaryText: texts.join('\n').slice(0, MAX_SUMMARY),
  };
}

function press(args) {
  const found = findWindow(args.app, args.window);
  const target = String(args.control).trim().toLowerCase();
  const match = elements(found.win).find(
    (item) => ACTIONABLE.indexOf(item.role) >= 0 && item.name.trim().toLowerCase() === target,
  );
  if (!match) throw new Error('Control not found: ' + args.control);
  match.el.actions.byName('AXPress').perform();
  delay(0.5);
  return snapshot(found.proc, findWindow(args.app, args.window).win);
}

function frontmost() {
  const proc = systemEvents().processes.whose({ frontmost: true })[0];
  const win = proc.windows[0];
  const pos = safe(() => win.position(), [0, 0]);
  const size = safe(() => win.size(), [0, 0]);
  return {
    bundleId: safe(() => proc.bundleIdentifier(), ''),
    appName: safe(() => proc.name(), ''),
    windowTitle: safe(() => win.name(), ''),
    windowFrame: { x: pos[0], y: pos[1], width: size[0], height: size[1] },
  };
}

function display() {
  const screen = $.NSScreen.mainScreen;
  const frame = screen.frame;
  return { width: frame.size.width, height: frame.size.height, scaleFactor: screen.backingScaleFactor };
}

const MAX_SAMPLES = 10000;
// CGEventType and CGMouseButton values (CGEventTypes.h).
const LEFT = { bit: 1, button: 0, down: 1, up: 2, dragged: 6 };
const RIGHT = { bit: 2, button: 1, down: 3, up: 4, dragged: 7 };
const MOUSE_MOVED = 5;
const KEY_DOWN = 10;
const HID_SYSTEM_STATE = 1;
const HID_EVENT_TAP = 0;

/** The pointer in the global top-left coordinates CGEventPost uses (NSEvent's origin is bottom-left). */
function cursor() {
  const p = $.NSEvent.mouseLocation;
  const height = $.NSScreen.screens.objectAtIndex(0).frame.size.height;
  return { x: Math.round(p.x), y: Math.round(height - p.y) };
}

function pressed() {
  return Number($.NSEvent.pressedMouseButtons) & 3;
}

function record(args) {
  const durationMs = Math.min(Math.max(Number(args.durationMs) || 0, 100), 120000);
  const sampleMs = Math.min(Math.max(Number(args.sampleMs) || 50, 20), 1000);
  const start = Date.now();
  let last = cursor();
  let buttons = pressed();
  const samples = [{ tMs: 0, kind: 'mouseMove', x: last.x, y: last.y }];
  while (Date.now() - start < durationMs && samples.length < MAX_SAMPLES) {
    delay(sampleMs / 1000);
    const tMs = Math.min(Date.now() - start, durationMs);
    const p = cursor();
    const now = pressed();
    if (p.x !== last.x || p.y !== last.y) samples.push({ tMs: tMs, kind: 'mouseMove', x: p.x, y: p.y });
    for (const b of [LEFT, RIGHT]) {
      if ((buttons & b.bit) === (now & b.bit)) continue;
      const kind = now & b.bit ? 'mouseDown' : 'mouseUp';
      samples.push({ tMs: tMs, kind: kind, x: p.x, y: p.y, button: b === LEFT ? 'left' : 'right' });
    }
    last = p;
    buttons = now;
  }
  return { samples: samples.slice(0, MAX_SAMPLES) };
}

function session() {
  const out = $.NSFileHandle.fileHandleWithStandardOutput;
  const input = $.NSFileHandle.fileHandleWithStandardInput;
  const startedAt = Date.now();
  let expected = cursor();
  let held = 0;
  const write = (value) =>
    out.writeData($(JSON.stringify(value) + '\n').dataUsingEncoding($.NSUTF8StringEncoding));
  const postRaw = (type, x, y, button) => {
    $.CGEventPost(HID_EVENT_TAP, $.CGEventCreateMouseEvent(null, type, $.CGPointMake(x, y), button));
  };
  const post = (ev) => {
    const x = Number(ev && ev.x);
    const y = Number(ev && ev.y);
    if (!isFinite(x) || !isFinite(y) || Math.abs(x) > 20000 || Math.abs(y) > 20000) {
      throw new Error('Event coordinates are out of bounds.');
    }
    if (ev.kind === 'mouseMove') {
      const b = held & LEFT.bit ? LEFT : held & RIGHT.bit ? RIGHT : undefined;
      postRaw(b ? b.dragged : MOUSE_MOVED, x, y, b ? b.button : 0);
    } else if (ev.kind === 'mouseDown' || ev.kind === 'mouseUp') {
      const b = ev.button === 'left' ? LEFT : ev.button === 'right' ? RIGHT : undefined;
      if (!b) throw new Error('A mouse button is left or right.');
      postRaw(ev.kind === 'mouseDown' ? b.down : b.up, x, y, b.button);
      held = ev.kind === 'mouseDown' ? held | b.bit : held & ~b.bit;
    } else {
      throw new Error('The session posts only mouse events.');
    }
    expected = { x: Math.round(x), y: Math.round(y) };
  };
  const moved = (p) => Math.abs(p.x - expected.x) > 3 || Math.abs(p.y - expected.y) > 3;
  const ownerInput = () => {
    if (moved(cursor())) {
      delay(0.05);
      if (moved(cursor())) return 'mouse moved';
    }
    if ((pressed() & ~held) !== 0) {
      // The window server may still show a button the replay has just released.
      delay(0.05);
      if ((pressed() & ~held) !== 0) return 'mouse button pressed';
    }
    if ($.CGEventSourceSecondsSinceLastEventType(HID_SYSTEM_STATE, KEY_DOWN) * 1000 < Date.now() - startedAt) {
      return 'key pressed';
    }
    return '';
  };
  const release = () => {
    for (const b of [LEFT, RIGHT]) if (held & b.bit) postRaw(b.up, expected.x, expected.y, b.button);
    held = 0;
  };
  let buffer = '';
  for (;;) {
    const data = input.availableData;
    if (!data || Number(data.length) === 0) break;
    buffer += $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding).js;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      let request;
      try {
        request = JSON.parse(line);
      } catch (_err) {
        write({ error: 'Unreadable request.' });
        continue;
      }
      try {
        if (request.cmd === 'post') {
          post(request.event);
          write({ id: request.id, ok: true });
        } else if (request.cmd === 'owner') {
          const reason = ownerInput();
          write(reason ? { id: request.id, input: true, reason: reason } : { id: request.id, input: false });
        } else if (request.cmd === 'frontmost') {
          write({ id: request.id, frontmost: frontmost() });
        } else if (request.cmd === 'release') {
          release();
          write({ id: request.id, ok: true });
        } else {
          throw new Error('Unknown session command: ' + request.cmd);
        }
      } catch (err) {
        write({ id: request.id, error: String(err && err.message ? err.message : err) });
      }
    }
  }
  release();
  return '';
}

// osascript calls run(argv); nothing in this file does.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function run(argv) {
  const command = argv[0];
  const args = argv[1] ? JSON.parse(argv[1]) : {};
  try {
    if (command === 'permission') return JSON.stringify({ granted: $.AXIsProcessTrusted() === true });
    if (command === 'window') {
      const found = findWindow(args.app, args.window);
      return JSON.stringify(snapshot(found.proc, found.win));
    }
    if (command === 'press') return JSON.stringify(press(args));
    if (command === 'frontmost') return JSON.stringify(frontmost());
    if (command === 'display') return JSON.stringify(display());
    if (command === 'record') return JSON.stringify(record(args));
    if (command === 'session') return session();
    throw new Error('Unknown command: ' + command);
  } catch (err) {
    $.NSFileHandle.fileHandleWithStandardError.writeData(
      $(JSON.stringify({ error: String(err && err.message ? err.message : err) })).dataUsingEncoding(
        $.NSUTF8StringEncoding,
      ),
    );
    $.exit(1);
  }
}
