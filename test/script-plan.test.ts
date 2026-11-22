import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { parsePlan } from '../src/misato.ts';

describe('F-112-T03: read-only script plans inside EVA-03', () => {
  it('parsePlan accepts a bounded { script } plan from Misato', () => {
    const p = parsePlan(JSON.stringify({ script: 'const r = tools.call("reminders.list", {}); return r;' }));
    assert.deepEqual(p, { script: 'const r = tools.call("reminders.list", {}); return r;' });
  });

  it('static validator accepts read-only subset and rejects non-read, dynamic, and result-derived calls', async () => {
    const { parseScriptPlan } = await import('../src/script-plan.ts');
    const tools = [
      { name: 'reminders.list', effect: 'read' as const, fingerprint: 'v1:read' },
      { name: 'reminders.add', effect: 'write' as const, fingerprint: 'v1:write' },
    ];
    const ok = parseScriptPlan(
      `
      const days = ["2030-01-01", "2030-01-02"];
      const out = [];
      for (const d of days) {
        const items = tools.call("reminders.list", { day: d });
        out.push(items);
      }
      return out;
      `,
      tools,
    );
    assert.equal(ok.toolNames.includes('reminders.list'), true);

    // Non-read tool rejected
    assert.throws(
      () => parseScriptPlan('const r = tools.call("reminders.add", { title: "x" }); return r;', tools),
      /read/i,
    );
    // Unknown tool rejected
    assert.throws(() => parseScriptPlan('const r = tools.call("unknown.tool", {}); return r;', tools), /unknown/i);
    // Computed tool name rejected
    assert.throws(() => parseScriptPlan('const n = "reminders.list"; return tools.call(n, {});', tools), /literal/i);
    // Excluded JS constructs rejected
    assert.throws(() => parseScriptPlan('while (true) {} return 1;', tools), /forbidden|unsupported/i);
    assert.throws(() => parseScriptPlan('const x = process.env; return x;', tools), /forbidden|unsupported/i);
    // Direct result-derived argument rejected
    assert.throws(
      () =>
        parseScriptPlan(
          'const a = tools.call("reminders.list", {}); const b = tools.call("reminders.list", { query: a }); return b;',
          tools,
        ),
      /result-derived/i,
    );
    // Indirect result-derived argument via loop over prior result rejected
    assert.throws(
      () =>
        parseScriptPlan(
          'const a = tools.call("reminders.list", {}); for (const x of a) { tools.call("reminders.list", { id: x }); } return a;',
          tools,
        ),
      /result-derived/i,
    );
    // Source over 16 KiB hard ceiling rejected
    assert.throws(() => parseScriptPlan('const a = "' + 'x'.repeat(17_000) + '"; return a;', tools), /source/i);
    // Aliasing before push rejected
    assert.throws(
      () =>
        parseScriptPlan(
          'const a = []; const b = a; a.push(tools.call("reminders.list", {})); tools.call("reminders.list", { q: b[0] }); return b;',
          tools,
        ),
      /result-derived/i,
    );
    // Tainted control-flow gating tools.call rejected
    assert.throws(
      () =>
        parseScriptPlan(
          'const r = tools.call("reminders.list", {}); if (r[0]) { tools.call("reminders.list", {}); } return r;',
          tools,
        ),
      /control flow/i,
    );
    // Prototype property keys & non-object args rejected
    assert.throws(() => parseScriptPlan('const o = { "__proto__": 1 }; return o;', tools), /forbidden/i);
    assert.throws(() => parseScriptPlan('const x = {}; return x["constructor"];', tools), /forbidden/i);
    assert.throws(() => parseScriptPlan('return tools.call("reminders.list", "bad");', tools), /object literal/i);
  });

  it(
    'executes inside EVA-03 with a MAGI gate decision per call, fails closed on denial/fingerprint change/missing sandbox',
    { skip: process.platform !== 'darwin' && process.platform !== 'linux' },
    async () => {
      const { runScriptPlanInEva03 } = await import('../src/script-plan.ts');
      const { EvaSandboxUnavailableError } = await import('../src/eva-runner.ts');
      const tools = [{ name: 'reminders.list', effect: 'read' as const, fingerprint: 'fp1' }];
      const source = `
      const a = tools.call("reminders.list", { filter: "today" });
      const b = tools.call("reminders.list", { filter: "tomorrow" });
      return { today: a, tomorrow: b };
    `;

      // 1) Fails closed when EVA-03 sandbox binary is missing
      await assert.rejects(
        () =>
          runScriptPlanInEva03({
            jobId: 'script-missing-sandbox',
            source,
            tools,
            sandboxExecPath: '/nonexistent/sandbox-exec',
            bwrapPath: '/nonexistent/bwrap',
            gate: async () => ({ outcome: 'grant' }),
            execute: async () => [],
          }),
        (err: unknown) => err instanceof EvaSandboxUnavailableError,
      );

      // 2) Runs with real sandbox (or test fixture if unsupported) and gates each call individually
      const gatedCalls: Array<{ tool: string; args: Record<string, unknown> }> = [];
      const executedCalls: Array<{ tool: string; args: Record<string, unknown> }> = [];
      const receipts: unknown[] = [];
      const useFixture =
        process.platform === 'linux' ? join(import.meta.dirname, 'fixtures', 'eva', 'unconfined-bwrap') : undefined;
      const res = await runScriptPlanInEva03({
        jobId: 'script-ok-1',
        source,
        tools,
        bwrapPath: useFixture,
        gate: async (tool, args) => {
          gatedCalls.push({ tool, args });
          return { outcome: 'grant', grantId: `g-${gatedCalls.length}` };
        },
        execute: async (tool, args) => {
          executedCalls.push({ tool, args });
          return [{ title: String(args.filter) }];
        },
        onReceipt: (r) => receipts.push(r),
      });
      assert.equal(res.status, 'completed');
      assert.equal(gatedCalls.length, 2);
      assert.equal(executedCalls.length, 2);
      assert.equal(receipts.length, 2);
      assert.deepEqual(res.result, { today: [{ title: 'today' }], tomorrow: [{ title: 'tomorrow' }] });

      // 3) Gate denial on second call terminates job without executing second call, keeping first receipt
      const exec2: string[] = [];
      const denied = await runScriptPlanInEva03({
        jobId: 'script-deny-2',
        source,
        tools,
        bwrapPath: useFixture,
        gate: async (_tool, args) =>
          args.filter === 'tomorrow' ? { outcome: 'reject', reason: 'policy' } : { outcome: 'grant' },
        execute: async (_tool, args) => {
          exec2.push(String(args.filter));
          return [];
        },
      });
      assert.equal(denied.status, 'terminated');
      assert.deepEqual(exec2, ['today']);
      assert.match(denied.reason ?? '', /policy|reject|denied/i);

      // 4) Fingerprint/effect change mid-job rejects next call
      let fp = 'fp1';
      const changed = await runScriptPlanInEva03({
        jobId: 'script-fp-change',
        source,
        tools: () => [{ name: 'reminders.list', effect: 'read' as const, fingerprint: fp }],
        bwrapPath: useFixture,
        gate: async () => ({ outcome: 'grant' }),
        execute: async () => {
          fp = 'fp2';
          return [];
        },
      });
      assert.equal(changed.status, 'terminated');
      assert.match(changed.reason ?? '', /fingerprint|changed/i);

      // 5) Call-count budget stops before exceeding maxCalls
      const overCalls = await runScriptPlanInEva03({
        jobId: 'script-max-calls',
        source,
        tools,
        limits: { maxCalls: 1 },
        bwrapPath: useFixture,
        gate: async () => ({ outcome: 'grant' }),
        execute: async () => [],
      });
      assert.equal(overCalls.status, 'terminated');
      assert.match(overCalls.reason ?? '', /budget|call/i);

      // 6) Loop iteration budget stops over-iteration
      const overIter = await runScriptPlanInEva03({
        jobId: 'script-max-iter',
        source: 'const a = [1, 2, 3, 4]; for (const x of a) { const y = x; } return a;',
        tools,
        limits: { maxIterations: 2 },
        bwrapPath: useFixture,
        gate: async () => ({ outcome: 'grant' }),
        execute: async () => [],
      });
      assert.equal(overIter.status, 'terminated');
      assert.match(overIter.reason ?? '', /iteration/i);

      // 7) Bridge frame budget & aggregate output budget
      const overFrame = await runScriptPlanInEva03({
        jobId: 'script-max-frame',
        source: 'return tools.call("reminders.list", {});',
        tools,
        limits: { maxFrameBytes: 128 },
        bwrapPath: useFixture,
        gate: async () => ({ outcome: 'grant' }),
        execute: async () => ({ big: 'z'.repeat(500) }),
      });
      assert.equal(overFrame.status, 'terminated');
      assert.match(overFrame.reason ?? '', /frame budget/i);

      // 8) Wall-time timeout marks late execute resolution as completed_late
      const lateReceipts: Array<{ outcome: string }> = [];
      const timedOut = await runScriptPlanInEva03({
        jobId: 'script-timeout-late',
        source: 'return tools.call("reminders.list", {});',
        tools,
        limits: { timeoutMs: 120 },
        bwrapPath: useFixture,
        gate: async () => ({ outcome: 'grant', grantId: 'g-late' }),
        execute: async () => {
          await new Promise((r) => setTimeout(r, 200));
          return { ok: true };
        },
        onReceipt: (r) => lateReceipts.push(r),
      });
      assert.equal(timedOut.status, 'terminated');
      assert.match(timedOut.reason ?? '', /wall-time/i);
      assert.equal(lateReceipts[0]?.outcome, 'completed_late');
    },
  );

  function createNeutralPlanningHost(
    modelTurns: ReadonlyArray<{ readonly plan: Record<string, unknown> }>,
    onGateResult?: (req: { tool: string; args: Record<string, unknown> }) => unknown,
  ) {
    const gated: string[] = [];
    const recorded: unknown[] = [];
    const turnMetrics: Array<{ turn: number; promptTokens: number; toolSchemaTokens: number; outputTokens: number }> =
      [];
    let turnIdx = 0;
    const host = {
      home: undefined,
      reminderPage: async () => ({ items: [] }),
      baseNames: async () => [],
      pilots: () => [],
      externalTools: async () => ({ docs: [], byName: new Map() }),
      getRemoteConsultant: () => undefined,
      proposePilot: async () => ({}),
      remoteOffers: async () => [],
      remotePilots: async () => [],
      revokedBases: async () => [],
      resolveOperator: async () => undefined,
      spear: async () => ({}),
      chatOnce: async () => ({ sortieId: 'S-TEST', steps: [], waiting: [] }),
      modelCall: async (_method: string, input: unknown) => {
        const { misatoAsk } = await import('../src/misato.ts');
        const { toolDocs } = await import('../src/executors.ts');
        const { estimateTokens, measureMisatoPrompt } = await import('../src/prompt-samples.ts');
        const turn = modelTurns[turnIdx++] ?? { plan: { reply: 'fallback' } };
        const ask = misatoAsk({ ...(input as Parameters<typeof misatoAsk>[0]), tools: toolDocs }, 'local');
        const pm = measureMisatoPrompt(ask, toolDocs);
        turnMetrics.push({
          turn: turnIdx,
          promptTokens: pm.promptTokens,
          toolSchemaTokens: pm.toolSchemaTokens,
          outputTokens: estimateTokens(JSON.stringify(turn.plan)),
        });
        return turn;
      },
      gate: async (_sid: string, req: { tool: string; args: Record<string, unknown> }) => {
        gated.push(req.tool);
        const result = onGateResult ? onGateResult(req) : [{ title: 'ok' }];
        return { outcome: 'grant' as const, actionId: `act-${gated.length}`, result };
      },
      record: async (_sid: string, steps: unknown[], step: unknown) => {
        steps.push(step);
        recorded.push(step);
      },
      note: async () => {},
      nervous: { call: async (m: string) => (m === 'memory.recall' ? [] : {}) },
      toolsProcess: () => ({ call: async () => ({}) }),
    };
    return { host, gated, recorded, turnMetrics };
  }

  it(
    'join: RuntimePlanning executes { script } through host gate and records per-call + script.plan steps',
    { skip: process.platform !== 'darwin' && process.platform !== 'linux' },
    async () => {
      const { RuntimePlanning } = await import('../src/runtime-planning.ts');
      const { host, gated, recorded } = createNeutralPlanningHost([
        {
          plan: {
            script:
              'const a = tools.call("reminders.list", { q: "a" }); const b = tools.call("reminders.list", { q: "b" }); return [a, b];',
          },
        },
        { plan: { reply: 'Done reading both.' } },
      ]);
      const planning = new RuntimePlanning(host as unknown as ConstructorParameters<typeof RuntimePlanning>[0]);
      const out = await planning.loop('S-TEST', 'check reminders', [], [], { consult: false });
      assert.equal(out.reply, 'Done reading both.');
      assert.deepEqual(gated, ['reminders.list', 'reminders.list']);
      assert.equal(
        recorded.some((s) => (s as { tool?: string }).tool === 'script.plan'),
        true,
      );
    },
  );

  it(
    'F-112-T04: compares planner steps and tokens with and without scripts on a neutral 4-read request',
    { skip: process.platform !== 'darwin' && process.platform !== 'linux' },
    async (t) => {
      const { RuntimePlanning } = await import('../src/runtime-planning.ts');
      const request = 'List my reminders for day-1, day-2, day-3, and day-4.';
      const filters = ['day-1', 'day-2', 'day-3', 'day-4'];

      // Baseline without script mode: 4 sequential tool turns + 1 reply turn
      const withoutTurns = [
        ...filters.map((filter) => ({ plan: { action: { tool: 'reminders.list', args: { filter } } } })),
        { plan: { reply: 'Checked reminders for day-1 through day-4.' } },
      ];
      const withoutRun = createNeutralPlanningHost(withoutTurns, (req) => [
        { title: `Reminder for ${String(req.args.filter)}`, due: String(req.args.filter) },
      ]);
      const withoutPlanning = new RuntimePlanning(
        withoutRun.host as unknown as ConstructorParameters<typeof RuntimePlanning>[0],
      );
      const withoutOut = await withoutPlanning.loop('S-CMP-NO', request, [], [], { consult: false });

      // Script mode: 1 { script } turn for all 4 reads + 1 reply turn
      const withTurns = [
        {
          plan: {
            script: [
              'const d1 = tools.call("reminders.list", { filter: "day-1" });',
              'const d2 = tools.call("reminders.list", { filter: "day-2" });',
              'const d3 = tools.call("reminders.list", { filter: "day-3" });',
              'const d4 = tools.call("reminders.list", { filter: "day-4" });',
              'return { d1: d1, d2: d2, d3: d3, d4: d4 };',
            ].join(' '),
          },
        },
        { plan: { reply: 'Checked reminders for day-1 through day-4.' } },
      ];
      const withRun = createNeutralPlanningHost(withTurns, (req) => [
        { title: `Reminder for ${String(req.args.filter)}`, due: String(req.args.filter) },
      ]);
      const withPlanning = new RuntimePlanning(
        withRun.host as unknown as ConstructorParameters<typeof RuntimePlanning>[0],
      );
      const withOut = await withPlanning.loop('S-CMP-YES', request, [], [], { consult: false });

      const sum = (rows: typeof withoutRun.turnMetrics) => ({
        plannerSteps: rows.length,
        promptTokens: rows.reduce((s, r) => s + r.promptTokens, 0),
        toolSchemaTokens: rows.reduce((s, r) => s + r.toolSchemaTokens, 0),
        outputTokens: rows.reduce((s, r) => s + r.outputTokens, 0),
        totalTokens: rows.reduce((s, r) => s + r.promptTokens + r.outputTokens, 0),
      });
      const baseline = sum(withoutRun.turnMetrics);
      const scripted = sum(withRun.turnMetrics);

      t.diagnostic(`F-112-T04 comparison: baseline=${JSON.stringify(baseline)} scripted=${JSON.stringify(scripted)}`);

      assert.equal(withoutOut.reply, withOut.reply);
      assert.equal(withoutRun.gated.length, 4);
      assert.equal(withRun.gated.length, 4);
      assert.equal(baseline.plannerSteps, 5);
      assert.equal(scripted.plannerSteps, 2);
      assert.ok(scripted.promptTokens < baseline.promptTokens);
      assert.ok(scripted.totalTokens < baseline.totalTokens);
    },
  );
});
