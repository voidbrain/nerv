import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
  appWorkflowPlanHash,
  parseAppWorkflowPlan,
  runAppWorkflow,
  validateAppWorkflowConfig,
  type AppStepReadback,
  type AppWorkflowDriver,
  type AppWorkflowPlan,
} from '../src/app-workflow.ts';
import { createMacAppWorkflowDriver } from '../src/app-workflow-macos.ts';
import type { HelperResult } from '../src/desktop-macos-driver.ts';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});
function workspace() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nerv-appwf-')));
  dirs.push(root);
  const allowed = join(root, 'documents');
  mkdirSync(allowed);
  const source = join(allowed, 'notes.txt');
  writeFileSync(source, 'sample notes');
  return { root, allowed, source, target: join(allowed, 'notes copy.txt') };
}

/** A fake scriptable app: tracks the front document and writes it out on save-as. */
function fakeApp(
  app = 'SampleEditor',
  overrides: Partial<Record<'openApp' | 'openFile' | 'saveAs', AppStepReadback>> = {},
) {
  const calls: string[] = [];
  let doc: string | undefined;
  let content = '';
  const driver: AppWorkflowDriver = {
    async openApp(name) {
      calls.push(`openApp:${name}`);
      return overrides.openApp ?? { frontmostApp: name };
    },
    async openFile(name, path) {
      calls.push(`openFile:${path}`);
      doc = path;
      content = readFileSync(path, 'utf8');
      return overrides.openFile ?? { frontmostApp: name, documentPath: doc };
    },
    async saveAs(name, path) {
      calls.push(`saveAs:${path}`);
      writeFileSync(path, content);
      doc = path;
      return overrides.saveAs ?? { frontmostApp: name, documentPath: doc };
    },
  };
  return { driver, calls, app };
}

function planFor(ws: ReturnType<typeof workspace>, app = 'SampleEditor'): AppWorkflowPlan {
  return {
    steps: [
      { kind: 'open-app', app },
      { kind: 'open-file', app, path: ws.source },
      { kind: 'save-as', app, path: ws.target },
    ],
  };
}

const approve = (plan: AppWorkflowPlan) => ({ approved: true, planHash: appWorkflowPlanHash(plan) });
const never = () => false;

describe('F-094-T02 app workflow: open app and file, save as, step by step', () => {
  it('runs the approved plan with a readback after every step', async () => {
    const ws = workspace();
    const plan = planFor(ws);
    const app = fakeApp();
    const res = await runAppWorkflow(app.driver, {
      plan,
      approval: approve(plan),
      allowedFolders: [ws.allowed],
      confirmOverwrite: never,
    });
    assert.equal(res.status, 'completed');
    assert.deepEqual(app.calls, ['openApp:SampleEditor', `openFile:${ws.source}`, `saveAs:${ws.target}`]);
    assert.deepEqual(
      res.completed.map((s) => s.readback.documentPath),
      [undefined, ws.source, ws.target],
    );
    assert.equal(readFileSync(ws.target, 'utf8'), 'sample notes');
  });

  it('needs one approval of exactly this plan, and checks every path before touching an app', async () => {
    const ws = workspace();
    const plan = planFor(ws);
    const app = fakeApp();
    const base = { plan, allowedFolders: [ws.allowed], confirmOverwrite: never };
    await assert.rejects(
      () => runAppWorkflow(app.driver, { ...base, approval: { approved: false, planHash: appWorkflowPlanHash(plan) } }),
      /Orange action/,
    );
    const changed: AppWorkflowPlan = {
      steps: [...plan.steps.slice(0, 2), { kind: 'save-as', app: 'SampleEditor', path: join(ws.allowed, 'other.txt') }],
    };
    await assert.rejects(
      () => runAppWorkflow(app.driver, { ...base, plan: changed, approval: approve(plan) }),
      /differs from the one the owner approved/,
    );
    const outside: AppWorkflowPlan = {
      steps: [{ kind: 'save-as', app: 'SampleEditor', path: join(ws.root, 'escape.txt') }],
    };
    await assert.rejects(
      () => runAppWorkflow(app.driver, { ...base, plan: outside, approval: approve(outside) }),
      /outside the allowed folders/,
    );
    const dotdot: AppWorkflowPlan = {
      steps: [{ kind: 'open-file', app: 'SampleEditor', path: join(ws.allowed, '..', 'x.txt') }],
    };
    await assert.rejects(
      () => runAppWorkflow(app.driver, { ...base, plan: dotdot, approval: approve(dotdot) }),
      /outside the allowed folders/,
    );
    assert.deepEqual(app.calls, []);
  });

  it('save as never overwrites an existing file unless the owner confirms that path', async () => {
    const ws = workspace();
    writeFileSync(ws.target, 'keep me');
    const plan = planFor(ws);
    const asked: string[] = [];
    const refused = fakeApp();
    const res = await runAppWorkflow(refused.driver, {
      plan,
      approval: approve(plan),
      allowedFolders: [ws.allowed],
      confirmOverwrite: (path) => {
        asked.push(path);
        return false;
      },
    });
    assert.equal(res.status, 'stopped');
    assert.equal(res.stoppedAt, 2);
    assert.match(res.reason!, /not overwriting existing file/);
    assert.deepEqual(asked, [ws.target]);
    assert.equal(readFileSync(ws.target, 'utf8'), 'keep me');
    assert.ok(!refused.calls.some((c) => c.startsWith('saveAs')));

    const confirmed = fakeApp();
    const ok = await runAppWorkflow(confirmed.driver, {
      plan,
      approval: approve(plan),
      allowedFolders: [ws.allowed],
      confirmOverwrite: async (path) => path === ws.target,
    });
    assert.equal(ok.status, 'completed');
    assert.equal(readFileSync(ws.target, 'utf8'), 'sample notes');
  });

  it('stops on a step outside the plan: an unplanned dialog, another app in front, another document', async () => {
    const ws = workspace();
    const plan = planFor(ws);
    const cases: [Partial<Record<'openApp' | 'openFile' | 'saveAs', AppStepReadback>>, number, RegExp][] = [
      [{ openFile: { frontmostApp: 'SampleEditor', dialog: 'Convert document?' } }, 1, /unplanned dialog/],
      [{ openApp: { frontmostApp: 'OtherApp' } }, 0, /expected SampleEditor in front, found OtherApp/],
      [
        { openFile: { frontmostApp: 'SampleEditor', documentPath: join(ws.allowed, 'else.txt') } },
        1,
        /expected document/,
      ],
    ];
    for (const [override, index, reason] of cases) {
      const app = fakeApp('SampleEditor', override);
      const res = await runAppWorkflow(app.driver, {
        plan,
        approval: approve(plan),
        allowedFolders: [ws.allowed],
        confirmOverwrite: never,
      });
      assert.equal(res.status, 'stopped');
      assert.equal(res.stoppedAt, index);
      assert.match(res.reason!, reason);
      assert.equal(res.completed.length, index);
      assert.equal(app.calls.length, index + 1, 'no step runs after the mismatch');
      assert.ok(!existsSync(ws.target));
    }
  });

  it('a missing source file or a failing step stops with where it stopped', async () => {
    const ws = workspace();
    rmSync(ws.source);
    const plan = planFor(ws);
    const res = await runAppWorkflow(fakeApp().driver, {
      plan,
      approval: approve(plan),
      allowedFolders: [ws.allowed],
      confirmOverwrite: never,
    });
    assert.deepEqual([res.status, res.stoppedAt], ['stopped', 1]);
    assert.match(res.reason!, /file not found/);
  });

  it('the macOS scripting driver sends app and paths as JSON data and the workflow reads its readback', async () => {
    const ws = workspace();
    const plan = planFor(ws, 'TextEdit');
    const sent: { command: string; args: Record<string, string> }[] = [];
    let doc: string | undefined;
    const runner = (argv: readonly string[]): HelperResult => {
      const args = JSON.parse(argv[1]!) as Record<string, string>;
      sent.push({ command: argv[0]!, args });
      if (argv[0] === 'open-file') doc = args.path;
      if (argv[0] === 'save-as') {
        writeFileSync(args.path!, 'sample notes');
        doc = args.path;
      }
      return {
        status: 0,
        stdout: JSON.stringify({ frontmostApp: 'TextEdit', ...(doc ? { documentPath: doc } : {}) }),
        stderr: '',
      };
    };
    const res = await runAppWorkflow(createMacAppWorkflowDriver({ runner }), {
      plan,
      approval: approve(plan),
      allowedFolders: [ws.allowed],
      confirmOverwrite: never,
    });
    assert.equal(res.status, 'completed');
    assert.deepEqual(sent, [
      { command: 'open-app', args: { app: 'TextEdit' } },
      { command: 'open-file', args: { app: 'TextEdit', path: ws.source } },
      { command: 'save-as', args: { app: 'TextEdit', path: ws.target } },
    ]);

    const failing = createMacAppWorkflowDriver({
      runner: () => ({ status: 1, stdout: '', stderr: JSON.stringify({ error: 'No open document to save.' }) }),
    });
    await assert.rejects(
      () => failing.saveAs('TextEdit', ws.target),
      /App workflow helper save-as failed: No open document/,
    );
  });

  it('plan files and the allowed-folder config are validated as data', () => {
    const folder = join(tmpdir(), 'nerv-sample');
    assert.deepEqual(validateAppWorkflowConfig({ allowedFolders: [folder] }), { allowedFolders: [folder] });
    assert.throws(() => validateAppWorkflowConfig({ allowedFolders: ['relative/folder'] }), /Invalid appWorkflow/);
    assert.throws(() => validateAppWorkflowConfig({ allowedFolders: [folder], extra: 1 }), /Invalid appWorkflow/);
    const plan = parseAppWorkflowPlan({ steps: [{ kind: 'open-app', app: 'TextEdit' }] });
    assert.equal(plan.steps.length, 1);
    assert.throws(
      () => parseAppWorkflowPlan({ steps: [{ kind: 'run-script', app: 'TextEdit' }] }),
      /Invalid app workflow step/,
    );
    assert.throws(
      () => parseAppWorkflowPlan({ steps: [{ kind: 'open-app', app: 'Text"; do shell script "x' }] }),
      /Invalid app name/,
    );
    assert.throws(() => parseAppWorkflowPlan({ steps: [] }), /1 to 10 steps/);
  });
});
