// NERV's adapter to the pinned Gauntlet release: system (NERV) packs and every common pack the release ships, the
// generated capability index, and the run ledger that says which cases still need a run (F-074-T06..T08).
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, existsSync, readdirSync, renameSync, mkdirSync } from 'node:fs';
import {
  readJSON,
  readEvidence,
  validatePack,
  validateProfile,
  validateRegistry,
  validateLimits,
  plan,
  executeWithEvidence,
  defaultEvidenceDirectory,
  compare,
  exportProfile,
  writeEvidence,
  catalog,
  catalogMarkdown,
  hash,
  inspectMachine,
  validateExecutionEnvironment,
  inspectFailures,
  emptyLedger,
  recordRun,
  pendingCases,
  validateLedger,
} from '@voidbrain/gauntlet-protocol';
import { sourceInputs } from './evaluate.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const here = (path) => resolve(root, path);
const examples = here('node_modules/@voidbrain/gauntlet-protocol/examples');
const systemFile = 'evals/gauntlet/system-v1.json';
const ledgerFile = 'evals/gauntlet/ledger.json';
const consumptionFile = 'evals/gauntlet/consumption.json';
// Tests point these at temporary copies; production uses the committed files.
const ledgerPath = () => resolve(process.env.NERV_GAUNTLET_LEDGER ?? here(ledgerFile));
const consumptionPath = () => resolve(process.env.NERV_GAUNTLET_CONSUMPTION ?? here(consumptionFile));
const releaseTag = () => readJSON(here('vendor/gauntlet-protocol.json')).releaseTag;

export function systemSourceKey(pack) {
  return hash({
    inputs: sourceInputs(
      root,
      pack.cases.some((c) => c.id === 'browser'),
    ),
    adapter: hash(readFileSync(here('tools/gauntlet-adapter.mjs'), 'utf8')),
    wrapper: hash(readFileSync(here('tools/gauntlet.mjs'), 'utf8')),
    dependency: hash(readFileSync(here('vendor/gauntlet-protocol.json'), 'utf8')),
  });
}

// Every pack the pinned release ships, unless evals/gauntlet/consumption.json excludes it with a reason. A new pack in a
// new pin is consumed without a code change; an exclusion that names no shipped pack is an error, so it cannot go stale.
export function commonPacks() {
  const config = readJSON(consumptionPath());
  const exclude = config?.exclude ?? {};
  if (config?.schemaVersion !== 1 || typeof exclude !== 'object' || Array.isArray(exclude))
    throw Error('Invalid ' + consumptionFile);
  for (const [id, reason] of Object.entries(exclude))
    if (typeof reason !== 'string' || !reason.trim()) throw Error('Exclusion of ' + id + ' needs a reason');
  const shipped = readdirSync(examples)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .flatMap((file) => {
      const raw = readJSON(join(examples, file));
      return raw && typeof raw === 'object' && Array.isArray(raw.cases)
        ? [{ file, pack: validatePack(raw) }]
        : [];
    });
  for (const id of Object.keys(exclude))
    if (!shipped.some((p) => p.pack.id === id)) throw Error('Excluded pack ' + id + ' is not in the pinned release');
  return shipped.filter((p) => !Object.hasOwn(exclude, p.pack.id));
}
export function systemPacks() {
  return [{ file: systemFile, pack: validatePack(readJSON(here(systemFile))) }];
}
const allPacks = () => [...commonPacks(), ...systemPacks()];
// Model limits scale Gauntlet's day limits per case, so a 10-case pack gets exactly the day limits (cache reuse keeps
// working) and a larger pack gets the same per-case budget: time, output tokens and case count grow with the pack.
export function modelLimits(pack) {
  const day = validateLimits(readJSON(join(examples, 'limits-day.json')));
  const n = pack.cases.length;
  return {
    caseMs: day.caseMs,
    suiteMs: Math.round((day.suiteMs / day.maxCases) * n),
    maxCases: n,
    repeat: day.repeat,
    outputTokens: Math.round((day.outputTokens / day.maxCases) * n),
    maxBytes: day.maxBytes,
  };
}
const isModelPack = (pack) => pack.cases.some((c) => c.layer !== 'system');

export function testIndex(reports = []) {
  const packs = allPacks();
  const links = Object.fromEntries(
    packs.map((p) => [
      p.pack.id,
      p.file === systemFile
        ? '../' + systemFile
        : `https://github.com/voidbrain/gauntlet-protocol/blob/${releaseTag()}/examples/${p.file}`,
    ]),
  );
  return catalogMarkdown(
    catalog(
      packs.map((p) => p.pack),
      reports,
    ),
    links,
  );
}

// -------------------------------------------------------------------------------------------------- run ledger
const readLedger = () => (existsSync(ledgerPath()) ? validateLedger(readJSON(ledgerPath())) : emptyLedger());
function writeLedger(ledger) {
  const temporary = ledgerPath() + '.' + process.pid + '.tmp';
  writeFileSync(temporary, JSON.stringify(validateLedger(ledger), null, 2) + '\n', { flag: 'wx' });
  renameSync(temporary, ledgerPath());
}
const entryKey = (e) => JSON.stringify([e.pack, e.case, e.profileHash]);
// A selected run (one system case, or a model pack's pending cases) ran the same case definitions as the full pack:
// Gauntlet checks the report against the selected pack it actually ran, and the entries are kept under the full pack.
export function recordSelected(ledger, report, full, selected) {
  const entries = new Map(ledger.entries.map((e) => [entryKey(e), e]));
  for (const e of recordRun(emptyLedger(), report, selected).entries) {
    const entry = { ...e, pack: full.id, packVersion: full.version };
    const old = entries.get(entryKey(entry));
    if (
      !old ||
      Date.parse(old.finished) < Date.parse(entry.finished) ||
      (Date.parse(old.finished) === Date.parse(entry.finished) && old.reportHash <= entry.reportHash)
    )
      entries.set(entryKey(entry), entry);
  }
  // Gauntlet 0.7 ledgers are schema 2: entries carry run identity; schema 1 entries are kept as unknown identity.
  return validateLedger({
    schemaVersion: 2,
    entries: [...entries.values()].sort((a, b) => (entryKey(a) < entryKey(b) ? -1 : 1)),
  });
}
const selectedPack = (pack, ids, model) =>
  ids.length === pack.cases.length
    ? pack
    : {
        ...pack,
        id: pack.id + (model ? ':selected' : ':' + ids[0]),
        cases: pack.cases.filter((c) => ids.includes(c.id)),
      };

// A pending case is named only by an unfinished task (status other than closed) that lists it explicitly as
// `pack/case`, or a whole pack as `pack/*`. Record history and closed tasks never count, so a pack id that merely
// appears in prose cannot silence the check.
function openTaskText() {
  return readdirSync(here('docs/work/tasks'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJSON(here('docs/work/tasks/' + f)))
    .filter((t) => t.status !== 'closed')
    .map((t) => JSON.stringify(t))
    .join('\n');
}
export function unnamedPending(list, text) {
  const names = new Set(text.match(/[a-z0-9][a-z0-9.-]*\/(?:\*|[a-z0-9][a-z0-9.-]*)/gi) ?? []);
  return list.filter((p) => !names.has(`${p.pack}/${p.case}`) && !names.has(`${p.pack}/*`));
}
export function pending({ maxAgeDays, profile } = {}) {
  return pendingCases(
    allPacks().map((p) => p.pack),
    readLedger(),
    {
      ...(profile ? { profile } : {}),
      ...(maxAgeDays !== undefined ? { maxAgeMs: maxAgeDays * 86400000 } : {}),
    },
  );
}

// -------------------------------------------------------------------------------------------------- commands
export async function main(args = process.argv.slice(2), services = { execute: executeWithEvidence }) {
  const [command = 'plan', ...rest] = args,
    options = {};
  const allowed = {
    'inspect-failures': ['directory', 'report'],
    machine: ['id', 'version'],
    index: ['check', 'reports'],
    packs: [],
    pending: ['check-records', 'max-age-days', 'profile'],
    ledger: ['report', 'pack'],
    plan: ['only', 'profile', 'allow-expensive', 'machine-profile', 'scenario'],
    run: [
      'only',
      'out',
      'execute',
      'allow-expensive',
      'fresh',
      'cache-dir',
      'max-age-hours',
      'machine-profile',
      'scenario',
      'confirm-scenario',
    ],
    'model-plan': ['pack', 'format', 'profile', 'limits', 'machine-profile', 'scenario', 'only'],
    'model-run': [
      'pack',
      'format',
      'profile',
      'limits',
      'out',
      'execute',
      'allow-models',
      'fresh',
      'cache-dir',
      'max-age-hours',
      'sample-ms',
      'machine-profile',
      'scenario',
      'confirm-scenario',
      'only',
      'capture-failures',
    ],
    all: [
      'profile',
      'limits',
      'execute',
      'allow-models',
      'allow-expensive',
      'fresh',
      'out-dir',
      'cache-dir',
      'max-age-days',
      'machine-profile',
      'scenario',
      'confirm-scenario',
    ],
    compare: ['reports'],
    qualify: ['report', 'review', 'requirements', 'out'],
  };
  if (!Object.hasOwn(allowed, command))
    throw Error(
      'Use index, packs, plan, run, model-plan, model-run, all, pending, ledger, inspect-failures, compare or qualify',
    );
  for (const arg of rest) {
    const m = /^--([a-z-]+)(?:=(.+))?$/.exec(arg);
    if (!m || !allowed[command].includes(m[1]) || Object.hasOwn(options, m[1]))
      throw Error('Unknown or duplicate option');
    const boolean = [
      'execute',
      'allow-expensive',
      'allow-models',
      'check',
      'fresh',
      'confirm-scenario',
      'check-records',
    ].includes(m[1]);
    if (boolean === !!m[2]) throw Error('Invalid option value');
    options[m[1]] = boolean ? true : m[2];
  }
  const load = (key) => {
    if (typeof options[key] !== 'string') throw Error('Missing --' + key);
    return readJSON(resolve(options[key]));
  };
  const days = () => {
    if (options['max-age-days'] === undefined) return undefined;
    if (!/^\d+$/.test(options['max-age-days'])) throw Error('Invalid --max-age-days');
    return Number(options['max-age-days']);
  };
  if (command === 'inspect-failures') {
    if (!options.directory || !options.report) throw Error('Inspection needs --directory and --report');
    return inspectFailures(resolve(options.directory), readEvidence(resolve(options.report)));
  }
  if (command === 'machine') {
    if (!options.id) throw Error('Missing --id');
    return inspectMachine(options.id, options.version ?? '1.0.0');
  }
  if (command === 'packs')
    return {
      release: releaseTag(),
      packs: allPacks().map((p) => ({
        id: p.pack.id,
        version: p.pack.version,
        cases: p.pack.cases.length,
        source: p.file === systemFile ? 'nerv' : 'common',
      })),
      excluded: readJSON(consumptionPath()).exclude ?? {},
    };
  if (command === 'index') {
    const rendered = testIndex(options.reports ? options.reports.split(',').map((p) => readEvidence(resolve(p))) : []);
    if (options.reports) return { index: rendered, privateEvidence: true };
    const out = here('docs/test-capability-index.md');
    if (options.check) {
      if (!existsSync(out) || readFileSync(out, 'utf8') !== rendered) throw Error('Generated test index is stale');
      return { indexCurrent: true };
    }
    if (existsSync(out) && !readFileSync(out, 'utf8').startsWith('<!-- Generated from executable packs;'))
      throw Error('Index output is not generated');
    writeFileSync(out, rendered);
    return { index: 'docs/test-capability-index.md', cases: allPacks().reduce((n, p) => n + p.pack.cases.length, 0) };
  }
  if (command === 'pending') {
    const list = pending({
      maxAgeDays: days(),
      profile: options.profile ? validateProfile(load('profile')) : undefined,
    });
    if (!options['check-records']) return { pendingLines: list.map((p) => `${p.pack}/${p.case} (${p.reason})`) };
    const unnamed = unnamedPending(list, openTaskText());
    return {
      pendingLines: unnamed.map(
        (p) => `${p.pack}/${p.case} (${p.reason}): no unfinished task lists ${p.pack}/${p.case} or ${p.pack}/*`,
      ),
      pending: list.length,
      named: list.length - unnamed.length,
    };
  }
  if (command === 'ledger') {
    if (!options.report || !options.pack) throw Error('Ledger needs --report and --pack');
    const full = allPacks().find((p) => p.pack.id === options.pack)?.pack;
    if (!full) throw Error('Unknown pack ' + options.pack);
    const report = readEvidence(resolve(options.report));
    const ids = [...new Set(report.results.map((r) => r.id))];
    const next = recordSelected(readLedger(), report, full, selectedPack(full, ids, isModelPack(full)));
    writeLedger(next);
    return { ledger: ledgerFile, entries: next.entries.length };
  }
  if (command === 'compare') {
    if (typeof options.reports !== 'string') throw Error('Missing --reports');
    return compare(options.reports.split(',').map((p) => readEvidence(resolve(p))));
  }
  if (command === 'qualify') {
    if (!options.out) throw Error('Missing --out');
    const evidence = exportProfile(readEvidence(options.report), load('review'), load('requirements'));
    writeEvidence(options.out, evidence);
    return { exported: options.out, productionPermissionsChanged: false };
  }

  if (!!options['machine-profile'] !== !!options.scenario)
    throw Error('Machine profile and scenario must be supplied together');
  const environment = options.scenario
    ? validateExecutionEnvironment({ machine: load('machine-profile'), scenario: load('scenario') })
    : undefined;
  const limitsFor = (model, pack) =>
    validateLimits(
      options.limits ? load('limits') : model ? modelLimits(pack) : readJSON(here('evals/gauntlet/limits.json')),
    );
  const flags = {
    environment,
    allowModels: options['allow-models'] === true,
    allowExpensive: options['allow-expensive'] === true,
  };
  const execute = (pack, model, profile, out, extra = {}) =>
    services.execute(pack, profile, limitsFor(model, pack), {
      execute: true,
      ...flags,
      scenarioConfirmed: options['confirm-scenario'] === true,
      registry: model
        ? undefined
        : validateRegistry(readJSON(here('evals/gauntlet/runners.json')), here('evals/gauntlet')),
      output: out,
      cacheDirectory: options['cache-dir'] ?? defaultEvidenceDirectory(),
      forceFresh: options.fresh === true,
      sourceKey: model ? undefined : systemSourceKey(pack),
      telemetry: model,
      ...extra,
    });
  const confirmScenario = () => {
    if (environment && !options['confirm-scenario']) throw Error('Execution needs explicit current scenario confirmation');
    if (options['confirm-scenario'] && !environment) throw Error('Scenario confirmation needs machine and scenario');
  };

  if (command === 'all') {
    const profile = options.profile ? validateProfile(load('profile')) : null;
    if (options.execute) confirmScenario();
    return all(options, { profile, execute, limitsFor, maxAgeDays: days() });
  }

  const model = command.startsWith('model-');
  if (options.format && !['unconstrained', 'schema'].includes(options.format))
    throw Error('Use --format=unconstrained or schema');
  if (options.format && options.pack) throw Error('Use --pack or --format, not both');
  const packId = options.pack ?? (options.format === 'schema' ? 'neutral-smoke-schema' : 'neutral-smoke');
  let pack = model ? commonPacks().find((p) => p.pack.id === packId)?.pack : systemPacks()[0].pack;
  if (!pack) throw Error('Unknown common pack ' + packId + '; see `packs`');
  if (options.only) {
    const ids = options.only.split(',');
    if (
      (!model && ids.length !== 1) ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !pack.cases.some((c) => c.id === id))
    )
      throw Error('Unknown or duplicate selected case');
    pack = selectedPack(pack, ids, model);
  }
  const profile = options.profile ? validateProfile(load('profile')) : null;
  if (model && !profile) throw Error('Model plan/run needs --profile=path');
  if (command.endsWith('plan')) return plan(pack, profile, limitsFor(model, pack), flags);
  confirmScenario();
  if (!options.execute || !options.out) throw Error('Execution requires --execute --out=new.json');
  const result = await execute(pack, model, profile, options.out, {
    maxAgeMs: options['max-age-hours'] ? Number(options['max-age-hours']) * 3600000 : undefined,
    captureFailures: options['capture-failures'],
    sampleMs: options['sample-ms'] ? Number(options['sample-ms']) : undefined,
  });
  return {
    kind: result.kind,
    passed: result.report.passed,
    complete: result.report.complete,
    out: options.out,
    reportId: result.report.id,
    originalFinished: result.report.finished,
    performanceMeasuredNow: result.performanceMeasuredNow,
    reason: result.reason,
    modelQualification: false,
  };
}

// `all`: every NERV system pack and every common pack. Plans by default; with --execute it runs only the cases the
// ledger does not cover (new, changed, other-profile, or stale with --max-age-days), or every case with --fresh, and
// records the reports in the ledger. System cases need no model; expensive ones need --allow-expensive. Model cases
// need --allow-models and --profile: a real-model run is an owner-approved campaign.
async function all(options, { profile, execute, limitsFor, maxAgeDays }) {
  const ledger = readLedger();
  const open = pendingCases(
    allPacks().map((p) => p.pack),
    ledger,
    { ...(maxAgeDays !== undefined ? { maxAgeMs: maxAgeDays * 86400000 } : {}), ...(profile ? { profile } : {}) },
  );
  const packs = allPacks().map(({ pack }) => {
    const model = isModelPack(pack);
    const run = options.fresh
      ? pack.cases.map((c) => ({ case: c.id, reason: 'fresh' }))
      : open.filter((p) => p.pack === pack.id).map((p) => ({ case: p.case, reason: p.reason }));
    const reuse = pack.cases
      .filter((c) => !run.some((r) => r.case === c.id))
      .map((c) => {
        const e = ledger.entries
          .filter((x) => x.pack === pack.id && x.case === c.id)
          .sort((a, b) => Date.parse(b.finished) - Date.parse(a.finished))[0];
        return { case: c.id, status: e.status, finished: e.finished, reportHash: e.reportHash };
      });
    const blocked = run
      .filter((r) =>
        model
          ? !options['allow-models'] || !profile
          : pack.cases.find((c) => c.id === r.case).expensive && !options['allow-expensive'],
      )
      .map((r) => r.case);
    return { pack, model, run, reuse, blocked };
  });
  const summary = packs.map(({ pack, model, run, reuse, blocked }) => ({
    pack: pack.id,
    version: pack.version,
    layer: model ? 'model' : 'system',
    run,
    reuse,
    ...(blocked.length
      ? {
          blocked: {
            cases: blocked,
            needs: model ? '--allow-models and --profile (owner-approved budget)' : '--allow-expensive',
          },
        }
      : {}),
    ...(run.length > blocked.length
      ? {
          budget: (({ caseMs, suiteMs, outputTokens }) => ({ caseMs, suiteMs, outputTokens }))(
            limitsFor(model, selectedPack(pack, run.filter((r) => !blocked.includes(r.case)).map((r) => r.case), model)),
          ),
        }
      : {}),
  }));
  if (!options.execute) return { plan: summary, modelCallsAuthorized: options['allow-models'] === true };
  if (!options['out-dir']) throw Error('Execution requires --out-dir=new-directory');
  const outDir = resolve(options['out-dir']);
  if (existsSync(outDir)) throw Error('--out-dir must not exist yet');
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const results = [];
  let next = ledger;
  for (const { pack, model, run, blocked } of packs) {
    const ids = run.map((r) => r.case).filter((id) => !blocked.includes(id));
    // A system runner takes one selected case per run; a model run takes every selected case at once.
    const batches = model ? (ids.length ? [ids] : []) : ids.map((id) => [id]);
    for (const batch of batches) {
      const selected = selectedPack(pack, batch, model);
      const out = join(outDir, `${pack.id}${model ? '' : '-' + batch[0]}.json`);
      const result = await execute(selected, model, model ? profile : null, out, {
        ...(maxAgeDays !== undefined ? { maxAgeMs: maxAgeDays * 86400000 } : {}),
      });
      next = recordSelected(next, result.report, pack, selected);
      results.push({
        pack: pack.id,
        cases: batch,
        kind: result.kind,
        passed: result.report.passed,
        complete: result.report.complete,
        out,
      });
      writeLedger(next);
    }
  }
  return {
    plan: summary,
    results,
    passed: results.every((r) => r.passed),
    ledger: ledgerFile,
    stillPending: pendingCases(
      allPacks().map((p) => p.pack),
      next,
    ).length,
    modelQualification: false,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  try {
    const result = await main();
    if (result && Array.isArray(result.pendingLines)) {
      // pending: one line per case (the harness's evaluation-dependency contract); exit 1 when any are listed.
      for (const line of result.pendingLines) console.log(line);
      if (result.pendingLines.length) process.exitCode = 1;
    } else {
      console.log(JSON.stringify(result, null, 2));
      if (result.passed === false) process.exitCode = 1;
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : 'Gauntlet failed');
    process.exitCode = command === 'pending' || command === 'ledger' ? 2 : 1;
  }
}
