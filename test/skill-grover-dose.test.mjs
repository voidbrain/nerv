// @ts-check
// F-153-T01, F-153-T02: the Grover dose skill package, its evaluation suite and the runner that fills the suite.
// No real model, Grover hub or owner data: a fake fetch stands in for Ollama and the tool results are invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { misatoAsk } from '../src/misato.ts';
import {
  activateSkillVersion,
  checkSkillPermissionEscalation,
  chooseActiveSkill,
  evaluateSkillVersion,
  stageSkillPackage,
  validateSkillPackage,
} from '../src/skills.ts';
import { runSkillEvaluation } from '../evals/skill-evaluation-run.mjs';

const PACKAGE = 'skills/grover-dose.json',
  SUITE = 'evals/skill-evaluation-grover-dose-v1.json',
  FIXTURES = 'evals/skill-fixtures-grover-dose-v1.json';
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const READS = ['grover.grover_overview', 'grover.grover_readings', 'grover.grover_feed_preview'];

function withHome(fn) {
  const home = mkdtempSync(join(tmpdir(), 'nerv-grover-dose-'));
  try {
    return fn(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test('F-153-T01: the package validates, stages, and asks only for the three Grover read tools', () => {
  const pkg = validateSkillPackage(read(PACKAGE));
  assert.equal(pkg.manifest.id, 'grover-dose');
  assert.deepEqual(pkg.manifest.requiredCapabilities, READS);
  assert.deepEqual(checkSkillPermissionEscalation(pkg, read(SUITE).allowedCapabilities), { ok: true, reasons: [] });
  withHome((home) => assert.equal(stageSkillPackage(home, pkg).status, 'staged'));
});

test('F-153-T01: a version that asks for the feed tool is refused by the escalation check', () => {
  const pkg = read(PACKAGE);
  pkg.manifest.requiredCapabilities = [...READS, 'grover.grover_feed'];
  const check = checkSkillPermissionEscalation(validateSkillPackage(pkg), read(SUITE).allowedCapabilities);
  assert.equal(check.ok, false);
  assert.match(check.reasons.join(' '), /grover\.grover_feed/);
});

test("F-153-T01: the instructions are Italian first, carry Grover's feed rule and stay read-only", () => {
  const { instructions } = read(PACKAGE);
  for (const text of ["controlla se è richiesta un'altra dose", 'waterLevel.min', 'ec.min', 'ph.max', 'flushing'])
    assert.ok(instructions.includes(text), text);
  for (const tool of READS) assert.ok(instructions.includes(tool), tool);
  assert.match(instructions, /Non avviare mai una dose/);
  assert.match(instructions, /I cannot start a feed/);
});

test('F-153-T01: the suite has Italian and English cases, holdouts, an escalation case and a fixture each', () => {
  const suite = read(SUITE),
    fixtures = read(FIXTURES);
  const ids = suite.cases.map((c) => c.id);
  assert.ok(ids.filter((id) => id.startsWith('it-')).length >= 6);
  assert.ok(ids.filter((id) => id.startsWith('en-')).length >= 3);
  assert.ok(suite.cases.filter((c) => c.split === 'holdout').length >= 4);
  assert.ok(suite.cases.some((c) => c.family === 'permission-escalation'));
  for (const c of suite.cases) {
    assert.ok(fixtures.cases[c.id], `fixture for ${c.id}`);
    assert.equal(c.withSkillOutput, undefined, `${c.id} carries no output: the runner fills it`);
  }
});

test('F-153-T01: graded outputs make a rule-following skill eligible and a feed-starting one not', () => {
  const suite = read(SUITE);
  const good = Object.fromEntries(suite.cases.map((c) => [c.id, c.expectedTokens.join(' ')]));
  const vague = Object.fromEntries(suite.cases.map((c) => [c.id, 'Il vaso 2 sembra a posto.']));
  withHome((home) => {
    stageSkillPackage(home, validateSkillPackage(read(PACKAGE)));
    const pass = evaluateSkillVersion(home, 'grover-dose', read(PACKAGE).manifest.version, suite, {
      model: 'fake',
      baselineOutputs: vague,
      withSkillOutputs: good,
    });
    assert.equal(pass.eligibleForPromotion, true, pass.reason);
    const started = { ...good, 'it-refused-holdout': `${good['it-refused-holdout']} ho avviato la dose` };
    const fail = evaluateSkillVersion(home, 'grover-dose', read(PACKAGE).manifest.version, suite, {
      model: 'fake-2',
      baselineOutputs: vague,
      withSkillOutputs: started,
    });
    assert.equal(fail.eligibleForPromotion, false);
    assert.match(fail.reason, /Holdout pass count \(5\/6\)/);
  });
});

const args = (out) => [
  `--package=${PACKAGE}`,
  `--suite=${SUITE}`,
  `--fixtures=${FIXTURES}`,
  '--model=fake-model',
  ...(out ? ['--allow-models', '--execute', `--out=${out}`] : []),
];

test('F-153-T02: the runner plans without calling the model', async () => {
  const result = await runSkillEvaluation(args(), {
    fetch: () => {
      throw Error('no call in plan mode');
    },
  });
  assert.equal(result.mode, 'plan');
  assert.equal(result.calls, read(SUITE).cases.length * 2);
});

test('F-153-T02: the runner asks with and without the skill and writes both replies to a new suite file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-grover-dose-run-'));
  try {
    const out = join(dir, 'filled.json'),
      bodies = [];
    const fetch = async (url, init) => {
      assert.equal(String(url), 'http://127.0.0.1:11434/api/chat');
      const body = JSON.parse(init.body);
      bodies.push(body);
      const skilled = body.messages[0].content.includes('Serve una dose? (Grover)');
      return Response.json({ message: { content: skilled ? 'con skill' : 'senza skill' } });
    };
    const result = await runSkillEvaluation(args(out), { fetch });
    assert.equal(result.mode, 'run');
    const filled = read(out),
      n = read(SUITE).cases.length;
    assert.equal(bodies.length, n * 2);
    assert.ok(bodies.every((b) => b.model === 'fake-model' && b.messages[1].content.includes('"grover_overview"')));
    assert.ok(filled.cases.every((c) => c.baselineOutput === 'senza skill' && c.withSkillOutput === 'con skill'));
    await assert.rejects(runSkillEvaluation(args(out), { fetch }), /EEXIST/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('F-153-T02: the runner refuses a remote endpoint, a run without --out and a case without a fixture', async () => {
  await assert.rejects(runSkillEvaluation([...args(), '--endpoint=http://example.invalid:11434']), /loopback/);
  await assert.rejects(runSkillEvaluation([...args(), '--allow-models', '--execute']), /--out/);
  const dir = mkdtempSync(join(tmpdir(), 'nerv-grover-dose-fx-'));
  try {
    const fixtures = join(dir, 'fixtures.json');
    const all = read(FIXTURES);
    delete all.cases['it-flushing-holdout'];
    writeFileSync(fixtures, JSON.stringify(all));
    await assert.rejects(
      runSkillEvaluation([`--package=${PACKAGE}`, `--suite=${SUITE}`, `--fixtures=${fixtures}`, '--model=m']),
      /it-flushing-holdout/,
    );
    assert.equal(existsSync(join(dir, 'filled.json')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// F-153-T04: the join across the package, the skill store, the run-time matcher and the planner prompt (fake model:
// no model runs; the offered tools are the three granted reads plus an invented feed tool that must never be used).
const OFFERED = [
  ...READS.map((name) => ({ name, effect: 'read' })),
  { name: 'grover.grover_feed', effect: 'write-external' },
  { name: 'reminders.list', effect: 'read' },
];

test('F-153-T04: 1.1.0 follows 1.0.0 and carries Italian and English trigger phrases', () => {
  const { manifest } = validateSkillPackage(read(PACKAGE));
  assert.equal(manifest.version, '1.1.0');
  assert.equal(manifest.parentVersion, '1.0.0');
  for (const phrase of ["controlla se è richiesta un'altra dose", 'serve una dose', 'need a dose', 'need another dose'])
    assert.ok(manifest.triggers?.includes(phrase), phrase);
});

test('F-153-T04: a promoted 1.1.0 applies to Italian and English triggers with only the three reads; staged does not', () =>
  withHome((home) => {
    const pkg = validateSkillPackage(read(PACKAGE)),
      { version } = pkg.manifest;
    const requests = [
      "Controlla se è richiesta un'altra dose",
      'serve una dose al vaso 2?',
      'Does pot 2 need another dose?',
      'does the tent pot need a dose today',
    ];
    stageSkillPackage(home, pkg);
    for (const request of requests)
      assert.equal(chooseActiveSkill(home, request, OFFERED), undefined, `staged: ${request}`);
    activateSkillVersion(home, 'grover-dose', version, { ownerApproved: true });
    for (const request of requests) {
      const choice = chooseActiveSkill(home, request, OFFERED);
      assert.ok(choice && 'applied' in choice, request);
      assert.equal(choice.applied.version, '1.1.0');
      assert.deepEqual(choice.applied.tools, READS, 'only the three granted reads');
      const input = {
        request,
        history: [],
        tools: OFFERED.filter((t) => choice.applied.tools.includes(t.name)).map((t) => ({
          ...t,
          args: '{}',
          about: 'Invented.',
        })),
        now: '2030-01-01T08:00:00.000Z',
        timeZone: 'Europe/Rome',
        language: /** @type {'it'} */ ('it'),
        skill: choice.applied,
      };
      const system = misatoAsk(input, 'local').system ?? '';
      assert.match(system, /Serve una dose\? \(Grover\)/);
      assert.doesNotMatch(system, /^- grover\.grover_feed \(/m, 'the feed tool is not offered');
    }
    assert.equal(chooseActiveSkill(home, 'che tempo fa domani?', OFFERED), undefined);
    assert.equal(chooseActiveSkill(home, 'dose', OFFERED), undefined, 'a bare word is not a trigger');
  }));

test('F-153-T04: without the three reads granted the matching skill is refused, never applied', () =>
  withHome((home) => {
    const pkg = validateSkillPackage(read(PACKAGE));
    stageSkillPackage(home, pkg);
    activateSkillVersion(home, 'grover-dose', pkg.manifest.version, { ownerApproved: true });
    const choice = chooseActiveSkill(home, 'serve una dose?', OFFERED.slice(0, 2));
    assert.ok(choice && 'refused' in choice);
    assert.match(choice.refused.reason, /grover_feed_preview.*not granted/);
  }));
