// @ts-check
// F-120-T09: nerv-planner, NERV's own model-layer Gauntlet pack. Each case is a real Misato planning turn (the planner
// prompt NERV builds over its real tool index) for an Italian or an English request, graded as exact JSON on the
// decision: the tool and its required arguments, a clarification question, or a reply without an action. These tests
// check the pack against the tool index and the gate, and run it end to end against a fake model; no real model runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validatePack, executeWithEvidence, readEvidence } from '@voidbrain/gauntlet-protocol';
import { main as gauntletMain, modelLimits } from '../tools/gauntlet.mjs';
import { buildPlannerPack, readPlannerSource, plannerPackFile } from '../tools/gauntlet-planner-pack.mjs';
import { builtinTools, toolDocs } from '../src/executors.ts';
import { patternOf, defaultPolicy } from '../src/policy.ts';
import { MODEL_TIMEOUT_MS } from '../src/model.ts';

const SLOW_HOST = { timeout: 120_000 };
const profile = '--profile=node_modules/@voidbrain/gauntlet-protocol/examples/profiles/gemma4-12b.json';
/**
 * The CLI's result, untyped like its JSON output.
 * @param {string[]} args
 * @param {any} [services]
 * @returns {Promise<any>}
 */
const main = (args, services) => gauntletMain(args, services);
const committed = () => JSON.parse(readFileSync(plannerPackFile, 'utf8'));

test('F-120-T09: the committed nerv-planner pack is the one built from its cases and the current tool index', () => {
  const pack = committed();
  assert.equal(pack.id, 'nerv-planner');
  validatePack(pack);
  // A tool-index change (a doc, a subject, a pack) changes the built prompts: the committed pack must be rebuilt
  // (`node tools/gauntlet-planner-pack.mjs`), which changes the case hashes, so the cases become pending again.
  assert.deepEqual(pack, buildPlannerPack(readPlannerSource()));
  // F-120-T18: each case constrains the reply to its decision schema (a deliberate change from format "json").
  assert.ok(
    pack.cases.every((c) => c.layer === 'model' && c.expected.kind === 'json' && c.responseFormat?.type === 'object'),
  );
  assert.ok(pack.cases.some((c) => c.split === 'regression') && pack.cases.some((c) => c.split === 'holdout'));
});

test('F-120-T09: every scenario has an Italian and an English request', () => {
  const source = readPlannerSource();
  const byScenario = new Map();
  for (const c of source.cases) byScenario.set(c.scenario, [...(byScenario.get(c.scenario) ?? []), c.language]);
  assert.ok(byScenario.size >= 12);
  for (const [scenario, languages] of byScenario) assert.deepEqual(languages.sort(), ['en', 'it'], scenario);
  const types = new Set(source.cases.map((c) => c.type));
  for (const type of ['action', 'routing', 'approval', 'mcp-read', 'clarify', 'decline', 'switched-off'])
    assert.ok(types.has(type), type);
});

test('F-120-T09: a case naming a tool the index does not register, or does not offer, fails the build', () => {
  const source = readPlannerSource();
  const action = source.cases.findIndex((c) => c.expected.decision === 'action');
  const unknown = structuredClone(source);
  unknown.cases[action].expected.tool = 'reminders.snooze';
  assert.throws(() => buildPlannerPack(unknown), /reminders\.snooze.*not registered/);
  // A switched-off pack's tool is registered but not offered: expecting it fails too.
  const off = structuredClone(source);
  const switched = off.cases.findIndex((c) => c.type === 'switched-off');
  off.cases[switched].expected = { decision: 'action', tool: 'fleet.print', args: {} };
  assert.throws(() => buildPlannerPack(off), /fleet\.print.*not offered/);
});

test('F-120-T09: expected tools are offered in the case prompt; switched-off and ungranted tools are not', () => {
  const pack = committed();
  const source = readPlannerSource();
  for (const c of source.cases) {
    const built = pack.cases.find((p) => p.id === c.id);
    const system = built.messages[0].content;
    if (c.expected.decision === 'action')
      assert.match(system, new RegExp(`^- ${c.expected.tool.replace('.', '\\.')} \\(`, 'm'), c.id);
    if (c.type === 'switched-off') {
      assert.deepEqual(c.expected, { decision: 'reply' });
      for (const tool of ['fleet.print', 'fleet.chat', 'batteries.chat'])
        assert.doesNotMatch(system, new RegExp(tool.replace('.', '\\.')), c.id);
    }
    // Only Grover's read-only tools are granted today: its switch is never offered.
    assert.doesNotMatch(system, /grover_switch/, c.id);
  }
});

test('F-120-T09: approval cases expect a tool the gate always sends to the owner; MCP cases a granted read', () => {
  const source = readPlannerSource();
  const approvals = source.cases.filter((c) => c.type === 'approval');
  assert.ok(approvals.length >= 4);
  for (const c of approvals) {
    const tool = builtinTools.find((t) => t.name === c.expected.tool);
    assert.ok(tool, c.id);
    const pattern = patternOf(tool.effect, 'trusted', tool.name, { ...defaultPolicy, blue: [] }, tool.owner === true);
    assert.ok(pattern === 'blue' || tool.card === true, `${c.id}: ${tool.name} would run without the owner's card`);
  }
  const reads = source.cases.filter((c) => c.type === 'mcp-read');
  assert.ok(reads.length >= 2);
  for (const c of reads) {
    const grant = source.mcp.find((m) => `${m.server}.${m.tool}` === c.expected.tool);
    assert.equal(grant?.effect, 'read', c.id);
    assert.equal(
      toolDocs.some((d) => d.name === c.expected.tool),
      false,
    );
  }
});

test('F-120-T09: gauntlet consumes nerv-planner as a NERV model pack and plans it', async () => {
  const listed = (await main(['packs'])).packs.find((p) => p.id === 'nerv-planner');
  assert.deepEqual(listed, {
    id: 'nerv-planner',
    version: committed().version,
    cases: committed().cases.length,
    source: 'nerv',
  });
  const planned = await main(['model-plan', profile, '--pack=nerv-planner']);
  assert.equal(planned.cases.length, committed().cases.length);
  assert.match(readFileSync('docs/test-capability-index.md', 'utf8'), /\[nerv-planner@/);
});

test('F-120-T09: a fake model run grades the decision exactly and never needs a real model', SLOW_HOST, async () => {
  const pack = committed();
  const answers = new Map(pack.cases.map((c) => [JSON.stringify(c.messages), c.expected.value]));
  const formats = new Map(pack.cases.map((c) => [JSON.stringify(c.messages), c.responseFormat]));
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'nerv-planner-'));
  const model = 'gemma4:12b';
  const fakeModel = (wrong) => async (url, init) => {
    const path = new URL(String(url)).pathname;
    let value;
    if (path === '/api/version') value = { version: 'neutral-test-runtime' };
    else if (path === '/api/show') value = { details: { quantization_level: 'Q4_K_M' }, capabilities: ['thinking'] };
    else if (path === '/api/tags') value = { models: [{ name: model, size: 100, digest: 'c'.repeat(64) }] };
    else if (path === '/api/ps') value = { models: [] };
    else if (path === '/api/generate') value = { done: true };
    else if (path === '/api/chat') {
      const body = JSON.parse(init.body);
      assert.equal(Object.hasOwn(body, 'expected'), false);
      const expected = answers.get(JSON.stringify(body.messages));
      assert.ok(expected, 'the fake model knows every case prompt');
      // F-120-T18: the case's decision schema reaches the model request as Ollama's structured-output format.
      assert.deepEqual(body.format, formats.get(JSON.stringify(body.messages)));
      const answer = wrong(expected) ?? expected;
      return new Response(
        [
          { model, message: { content: JSON.stringify(answer) }, done: false },
          { model, message: { content: '' }, done: true, eval_count: 12, eval_duration: 1000000 },
        ]
          .map((x) => JSON.stringify(x))
          .join('\n') + '\n',
      );
    } else throw Error('Unexpected fixture endpoint');
    return new Response(JSON.stringify(value));
  };
  const run = (name, wrong) =>
    main(
      [
        'model-run',
        profile,
        '--pack=nerv-planner',
        '--execute',
        '--allow-models',
        '--fresh',
        '--out=' + join(root, name),
        '--cache-dir=' + join(root, 'cache'),
      ],
      { execute: (p, m, l, o) => executeWithEvidence(p, m, l, { ...o, fetch: fakeModel(wrong) }) },
    );
  try {
    const right = await run('right.json', () => undefined);
    assert.equal(right.passed, true);
    assert.equal(readEvidence(join(root, 'right.json')).results.length, pack.cases.length);
    // Replying where an action was expected, or acting where a reply or a question was expected, fails.
    const wrong = await run('wrong.json', (e) =>
      e.decision === 'action' ? { decision: 'reply' } : { decision: 'action', tool: 'reminders.list', args: {} },
    );
    assert.equal(wrong.passed, false);
    const results = readEvidence(join(root, 'wrong.json')).results;
    assert.ok(results.every((r) => r.status === 'failed'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// F-120-T18: a JSON Schema check for the keywords the decision schemas use (type, const, enum, anyOf, properties,
// required, additionalProperties), so the tests see what Ollama's structured output lets the model write.
/**
 * @param {any} schema
 * @param {any} value
 * @returns {boolean}
 */
const fits = (schema, value) => {
  /** @param {any} v */
  const kind = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
  if (schema.anyOf && !schema.anyOf.some((/** @type {any} */ s) => fits(s, value))) return false;
  if (schema.type && ![schema.type].flat().includes(kind(value))) return false;
  if (Object.hasOwn(schema, 'const') && value !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (kind(value) !== 'object') return true;
  const props = schema.properties ?? {};
  if ((schema.required ?? []).some((/** @type {string} */ k) => !Object.hasOwn(value, k))) return false;
  if (schema.additionalProperties === false && Object.keys(value).some((k) => !Object.hasOwn(props, k))) return false;
  return Object.entries(value).every(([k, v]) => !props[k] || fits(props[k], v));
};

test('F-120-T18: the decision schema admits the expected decision and refuses free text and optional arguments', () => {
  const pack = committed();
  const byId = new Map(pack.cases.map((/** @type {any} */ c) => [c.id, c]));
  for (const c of pack.cases) assert.ok(fits(c.responseFormat, c.expected.value), c.id);
  // What gemma4:26b and gemma4:12b wrote on the night of 2026-11-27 (matched to the reports' responseHash): the
  // owner's words as memory.remember's text, although the contract says to leave free text out.
  const memory = byId.get('memory-fact-it').responseFormat;
  const fact = { decision: 'action', tool: 'memory.remember', args: { text: 'Sono allergico alle noci' } };
  assert.equal(fits(memory, fact), false);
  assert.ok(fits(memory, { decision: 'action', tool: 'memory.remember', args: {} }));
  const reminder = byId.get('reminder-in-minutes-it').responseFormat;
  const due = '2026-08-03T10:05:00+02:00';
  assert.equal(
    fits(reminder, { decision: 'action', tool: 'reminders.add', args: { title: 'bere acqua', due } }),
    false,
  );
  assert.equal(fits(reminder, { decision: 'action', tool: 'reminders.add', args: { due, kind: 'at' } }), false);
  // A wrong decision still fits: the schema shapes the reply, the model still decides.
  assert.ok(fits(reminder, { decision: 'action', tool: 'reminders.list', args: {} }));
  const ask = byId.get('reminder-no-subject-it').responseFormat;
  assert.equal(fits(ask, { decision: 'ask', question: 'Di cosa vuoi che ti ricordi?' }), false);
  assert.equal(fits(ask, { decision: 'ask', tool: 'reminders.add', args: {} }), false);
  assert.ok(fits(ask, { decision: 'ask' }) && fits(ask, { decision: 'reply' }));
  for (const c of pack.cases)
    for (const name of ['title', 'text', 'texts', 'body', 'phrase', 'query', 'notes'])
      assert.equal(fits(c.responseFormat, { decision: 'action', tool: 'x.y', args: { [name]: 'words' } }), false, c.id);
});

test('F-120-T18: a nerv-planner case gets the planner turn time NERV gives Misato, not the 30 s day limit', () => {
  // On 2026-11-27 pilot-promote-it hit the 30 s case limit on both models; a timeout leaves the model's consumption
  // unverified, so Gauntlet skipped the 19 cases after it. NERV gives a planner step MODEL_TIMEOUT_MS.
  const limits = modelLimits(committed());
  assert.equal(limits.caseMs, MODEL_TIMEOUT_MS);
  assert.equal(limits.maxCases, committed().cases.length);
});
