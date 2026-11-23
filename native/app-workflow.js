// NERV app workflow helper (F-094-T02). Run: osascript -l JavaScript app-workflow.js <command> '<json>'
// Fixed templates only (F-094-T01): the app name and paths arrive as JSON data, never as script text.
// Commands: open-app {app}, open-file {app, path}, save-as {app, path}. Each prints the readback:
// { frontmostApp, documentPath? }. Errors print { "error": "..." } on stderr with exit status 1.
ObjC.import('AppKit');
ObjC.import('stdlib');

function safe(read, fallback) {
  try {
    const value = read();
    return value === null || value === undefined ? fallback : value;
  } catch (_err) {
    return fallback;
  }
}

function frontDocumentPath(app) {
  const docs = safe(() => app.documents(), []);
  if (docs.length === 0) return undefined;
  const path = safe(() => docs[0].path(), '') || safe(() => String(docs[0].file()), '');
  return path ? String(path) : undefined;
}

function readback(app) {
  delay(0.5);
  const front = $.NSWorkspace.sharedWorkspace.frontmostApplication;
  const documentPath = frontDocumentPath(app);
  return {
    frontmostApp: front ? ObjC.unwrap(front.localizedName) : '',
    ...(documentPath ? { documentPath: documentPath } : {}),
  };
}

// osascript calls run(argv); nothing in this file does.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function run(argv) {
  try {
    const command = argv[0];
    const args = JSON.parse(argv[1] || '{}');
    const app = Application(String(args.app));
    if (command === 'open-app') {
      app.activate();
      return JSON.stringify(readback(app));
    }
    if (command === 'open-file') {
      app.activate();
      app.open(Path(String(args.path)));
      return JSON.stringify(readback(app));
    }
    if (command === 'save-as') {
      const docs = app.documents();
      if (docs.length === 0) throw new Error('No open document to save.');
      docs[0].save({ in: Path(String(args.path)) });
      return JSON.stringify(readback(app));
    }
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
