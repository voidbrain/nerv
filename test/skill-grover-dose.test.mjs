// @ts-check
// F-153-T01, F-153-T02: the Grover dose skill package, its evaluation suite and the runner that fills the suite.
// No real model, Grover hub or owner data: a fake fetch stands in for Ollama and the tool results are invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkSkillPermissionEscalation,
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
    const pass = evaluateSkillVersion(home, 'grover-dose', '1.0.0', suite, {
      model: 'fake',
      baselineOutputs: vague,
      withSkillOutputs: good,
    });
    assert.equal(pass.eligibleForPromotion, true, pass.reason);
    const started = { ...good, 'it-refused-holdout': `${good['it-refused-holdout']} ho avviato la dose` };
    const fail = evaluateSkillVersion(home, 'grover-dose', '1.0.0', suite, {
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
