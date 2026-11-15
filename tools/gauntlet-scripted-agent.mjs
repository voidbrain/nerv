import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, writeEvidence } from '@voidbrain/gauntlet-protocol';

const adapter = fileURLToPath(import.meta.url);

export function scriptedEvidence(configuration, budget, current) {
  if (
    !current?.requirements?.includes('scripted-environment') ||
    !current.requirements.includes('step-limit-4') ||
    !Number.isSafeInteger(budget?.outputTokens) ||
    budget.outputTokens < 1
  )
    throw Error('Unsupported scripted-agent case or exhausted budget');
  const sequence = ['plan', 'act', 'observe'];
  return {
    schemaVersion: 1,
    layer: 'end-to-end',
    caseHash: hash(current),
    fixtureHash: hash({ case: current.id, sequence, stepLimit: 4 }),
    configurationHash: hash(configuration),
    runtimeIdentity: 'nerv-scripted-agent-v1',
    sourceStable: true,
    complete: true,
    outputTokens: 0,
    results: [{ id: current.id, status: 'passed', checks: sequence.length }],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === adapter) {
  try {
    const [out, configurationFile, budgetFile, caseFile] = process.argv.slice(2);
    if (!out || !configurationFile || !budgetFile || !caseFile) throw Error('Missing registered-runner inputs');
    writeEvidence(
      out,
      scriptedEvidence(
        JSON.parse(readFileSync(configurationFile, 'utf8')),
        JSON.parse(readFileSync(budgetFile, 'utf8')),
        JSON.parse(readFileSync(caseFile, 'utf8')),
      ),
    );
  } catch {
    console.error('NERV scripted-agent adapter failed.');
    process.exitCode = 1;
  }
}
