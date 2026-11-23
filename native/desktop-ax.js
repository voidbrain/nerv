// NERV desktop accessibility helper (F-093-T05). Run: osascript -l JavaScript desktop-ax.js <command> '<json>'
// Reads and presses controls through macOS Accessibility (System Events). It never changes privacy
// settings and never prompts for Accessibility (AXIsProcessTrusted, no prompt option): without the owner's
// grant it reports { granted: false }. The first window read asks macOS Automation consent for System Events.
// Output: one JSON object on stdout; errors as { "error": "..." } with exit status 1.
ObjC.import('AppKit');
ObjC.import('ApplicationServices');
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
