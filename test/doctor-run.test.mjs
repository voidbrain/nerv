// @ts-check
// B-129 (owner 2026-11-24): Health → Run doctor only logged a canned "scheduler ok · brain ok · routes ok · SQLite
// integrity ok" and never asked the service. The live dashboard now calls GET /api/doctor and shows the answer next to
// the button: ok or the problems, revision and skew, the database checks, the update status; errors said plainly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('web/public/dashboard/live.js', 'utf8');
const start = source.indexOf('  // B-129: doctor run (start)');
const end = source.indexOf('  // B-129: doctor run (end)');
assert.ok(start > 0 && end > start, 'the B-129 helper is marked in live.js');
const esc = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const { doctorRunHtml, doctorProblems, doctorChatLine } = new Function(
  'esc',
  source.slice(start, end) + ';return { doctorRunHtml, doctorProblems, doctorChatLine };',
)(esc);

const C = 'c'.repeat(40);
const D = 'd'.repeat(40);
const at = '2026-11-24T10:15:00.000Z';
const healthy = {
  build: { version: '1.205', commit: C, shortCommit: 'ccccccc' },
  revisionSkew: {
    skewed: false,
    runningCommit: C,
    runningShortCommit: 'ccccccc',
    checkoutCommit: C,
    checkoutShortCommit: 'ccccccc',
  },
  processes: { nervous: 101, brain: 102, brainAlive: true },
  database: { quick_check: 'ok' },
  schema: { user_version: 42 },
  pending: { count: 3 },
  degraded: [],
  update: { status: 'up-to-date', channel: 'main', runningRevision: C },
};

test('B-129: a healthy answer says ok with the revision, the database checks and the update status', () => {
  assert.deepEqual(doctorProblems(healthy), []);
  const html = doctorRunHtml({ at, result: healthy });
  assert.match(html, /id='doctor-run'/);
  assert.match(html, /class='small ok'[\s\S]*Doctor · all checks pass/);
  assert.match(html, /Revision 1\.205 · ccccccc · matches the checkout/);
  assert.match(html, /Database: integrity ok · schema 42 · 3 pending reminders/);
  assert.match(html, /Update: up to date · ccccccc \(main\)/);
  assert.doesNotMatch(html, /style='[^']*#/, 'no literal colour');
  assert.equal(doctorChatLine({ at, result: healthy }), 'Doctor: all checks pass · details in Health.');
});

test('B-129: each problem the service reports is listed, and the line counts them', () => {
  const sick = {
    ...healthy,
    revisionSkew: {
      skewed: true,
      runningShortCommit: 'ccccccc',
      checkoutShortCommit: 'ddddddd',
      message:
        'Running service (ccccccc) differs from checkout HEAD (ddddddd); update or restart through the lifecycle flow.',
    },
    processes: { nervous: null, brain: 102, brainAlive: false },
    database: { quick_check: 'row 7 missing from index' },
    degraded: ['local route down since 10:00'],
    update: { status: 'update-available', channel: 'main', availableRevision: D, runningRevision: C },
    fleet: { error: 'fleet.json unreadable' },
  };
  const problems = doctorProblems(sick);
  assert.deepEqual(problems, [
    'Scheduler (nervous) is not running.',
    'Brain process is not alive.',
    'Database integrity: row 7 missing from index',
    'Running service (ccccccc) differs from checkout HEAD (ddddddd); update or restart through the lifecycle flow.',
    'local route down since 10:00',
    'Fleet: fleet.json unreadable',
  ]);
  const html = doctorRunHtml({ at, result: sick });
  assert.match(html, /class='small danger'[\s\S]*Doctor · 6 problems/);
  assert.match(html, /Revision 1\.205 · ccccccc · checkout is at ddddddd/);
  assert.match(html, /Database: integrity row 7 missing from index · schema 42/);
  assert.match(html, /Update: update available · ddddddd \(main\)/);
  assert.match(html, /<li>Brain process is not alive\.<\/li>/);
  assert.equal(doctorChatLine({ at, result: sick }), 'Doctor: 6 problems · details in Health.');
  assert.match(doctorRunHtml({ at, result: { ...healthy, degraded: ['one'] } }), /Doctor · 1 problem</);
});

test('B-129: the answer is escaped', () => {
  const html = doctorRunHtml({ at, result: { ...healthy, degraded: ['<img src=x onerror=alert(1)>'] } });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x/);
});

test('B-129: an unreachable service and a refused session are said plainly, not as a pass', () => {
  const down = doctorRunHtml({ at, error: { message: 'GET /api/doctor: Failed to fetch' } });
  assert.match(down, /class='small danger'[\s\S]*Doctor could not reach the service/);
  assert.match(down, /Failed to fetch/);
  assert.doesNotMatch(down, /all checks pass/);
  const refused = doctorRunHtml({ at, error: { status: 401, message: 'GET /api/doctor: Unauthorized' } });
  assert.match(refused, /Doctor refused \(401\)/);
  assert.match(refused, /nerv open dashboard/);
  assert.equal(
    doctorChatLine({ at, error: { status: 401, message: 'x' } }),
    'Doctor: refused (401) · details in Health.',
  );
  assert.equal(doctorChatLine({ at, error: { message: 'x' } }), 'Doctor: service unreachable · details in Health.');
  assert.match(doctorRunHtml({ running: true }), /Running doctor…/);
});

test('B-129: Run doctor calls the service on the live dashboard; the canned result is gone', () => {
  const dashboard = readFileSync('web/public/dashboard/dashboard.js', 'utf8');
  assert.doesNotMatch(dashboard, /Doctor: scheduler ok · brain ok/);
  assert.match(dashboard, /t\.id === "btn-doctor"\) \{ if \(LIVE\) \{ window\.liveDoctor\(\); return; \}/);
  assert.match(source, /window\.liveDoctor = async function/);
  assert.match(source, /api\("doctor"\)/);
  const html = readFileSync('web/public/dashboard/index.html', 'utf8');
  assert.match(
    html,
    /id="btn-doctor"[^\n]*\n\s*<div class="pad" id="doctor-result" role="status" aria-live="polite" hidden><\/div>/,
  );
});
