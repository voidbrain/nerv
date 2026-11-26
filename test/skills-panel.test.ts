import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  activateSkillVersion,
  evaluateSkillVersion,
  stageSkillPackage,
  type SkillEvaluationSuite,
  type SkillPackage,
} from '../src/skills.ts';
import { makeServer } from '../src/server.ts';

/** A neutral, invented skill package. */
function skill(id: string, version: string): SkillPackage {
  return {
    manifest: {
      id,
      version,
      title: `Title of ${id}`,
      domain: 'Diagnostics',
      description: 'Neutral test skill package.',
      createdAt: '2026-11-26T00:00:00.000Z',
    },
    instructions: '# Secret instructions\nNever shown by the panel.\n',
  };
}
const suite = JSON.parse(readFileSync(resolve('evals/skill-evaluation-v1.json'), 'utf8')) as SkillEvaluationSuite;

/** GET /api/skills from a runtime on the given data home. */
async function getSkills(home: string) {
  const { Runtime } = await import('../src/runtime.ts');
  const runtime = new Runtime(join(home, 'nerv.sqlite'), undefined, home);
  const token = 's'.repeat(32);
  const server = makeServer(runtime, token);
  try {
    await runtime.ready();
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const port = (server.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/skills`, { headers: { authorization: 'Bearer ' + token } });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    await runtime.close();
  }
}

test(
  'F-145: GET /api/skills lists the real store by stage: seed, sprout, ripe, dropped; names and numbers only',
  { timeout: 20000 },
  async () => {
    const home = mkdtempSync(join(tmpdir(), 'nerv-skills-api-'));
    try {
      stageSkillPackage(home, skill('alpha-check', '1.0.0'));
      evaluateSkillVersion(home, 'alpha-check', '1.0.0', suite, { model: 'test-model' });
      activateSkillVersion(home, 'alpha-check', '1.0.0', { ownerApproved: true });
      stageSkillPackage(home, skill('alpha-check', '1.1.0'));
      evaluateSkillVersion(home, 'alpha-check', '1.1.0', suite, { model: 'test-model' });
      stageSkillPackage(home, skill('beta-check', '0.1.0'));
      const { status, body } = await getSkills(home);
      assert.equal(status, 200);
      assert.ok(!JSON.stringify(body).includes('Secret instructions'), 'no instructions or scripts');
      const skills = body.skills as {
        id: string;
        title: string;
        domain: string;
        stage: string;
        activeVersion?: string;
        versions: { version: string; status: string; stage: string; evaluation?: Record<string, unknown> }[];
      }[];
      assert.deepEqual(
        skills.map((s) => [s.id, s.title, s.domain, s.stage, s.activeVersion]),
        [
          ['alpha-check', 'Title of alpha-check', 'Diagnostics', 'ripe', '1.0.0'],
          ['beta-check', 'Title of beta-check', 'Diagnostics', 'seed', undefined],
        ],
      );
      assert.deepEqual(
        skills[0]!.versions.map((v) => [v.version, v.status, v.stage]),
        [
          ['1.0.0', 'active', 'ripe'],
          ['1.1.0', 'staged', 'sprout'],
        ],
      );
      assert.deepEqual(Object.keys(skills[0]!.versions[1]!.evaluation ?? {}).sort(), [
        'baselinePassed',
        'eligibleForPromotion',
        'evaluatedAt',
        'holdoutCases',
        'holdoutPassed',
        'model',
        'regressions',
        'totalCases',
        'withSkillPassed',
      ]);
      assert.equal(skills[0]!.versions[1]!.evaluation!.withSkillPassed, 6);
      assert.equal(skills[0]!.versions[1]!.evaluation!.baselinePassed, 3);
      assert.equal(skills[1]!.versions[0]!.evaluation, undefined, 'seed: not evaluated yet');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  },
);

test(
  'F-145: an empty store lists no skills; a corrupt registry is an error, not an empty list',
  { timeout: 20000 },
  async () => {
    const home = mkdtempSync(join(tmpdir(), 'nerv-skills-api-'));
    try {
      assert.deepEqual(await getSkills(home), { status: 200, body: { skills: [] } });
      mkdirSync(join(home, 'skills'), { recursive: true });
      writeFileSync(join(home, 'skills', 'registry.json'), '{"version":2}');
      const broken = await getSkills(home);
      assert.ok(broken.status >= 400, String(broken.status));
      assert.match(String(broken.body.error), /Corrupt skills registry/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  },
);
