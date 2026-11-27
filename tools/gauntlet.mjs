// NERV's adapter to the pinned Gauntlet release: system (NERV) packs and every common pack the release ships, the
// generated capability index, and the run ledger that says which cases still need a run (F-074-T06..T08).
import { AsyncLocalStorage } from 'node:async_hooks';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, existsSync, readdirSync, renameSync, mkdirSync, realpathSync } from 'node:fs';
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
  scenarioHash as gauntletScenarioHash,
} from '@voidbrain/gauntlet-protocol';
import { sourceInputs } from './evaluate.mjs';
import { validateRoleBundleConfig, runRoleBundle } from './evaluate-model.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const here = (path) => resolve(root, path);
const examples = here('node_modules/@voidbrain/gauntlet-protocol/examples');
const systemFile = 'evals/gauntlet/system-v1.json';
const ledgerFile = 'evals/gauntlet/ledger.json';
const consumptionFile = 'evals/gauntlet/consumption.json';
// Tests point these at temporary copies; production uses the committed files.
// B-165: a command reads these settings once, when it starts, and keeps them for its whole run: a test that changes
// the process environment while another test's command is in flight (a test the runner timed out keeps running)
// can no longer send that command's ledger write to the tracked ledger.
const SETTINGS = [
  'NERV_GAUNTLET_LEDGER',
  'NERV_GAUNTLET_CONSUMPTION',
  'NERV_GAUNTLET_TASKS',
  'NERV_GAUNTLET_SYSTEM',
  'NERV_GAUNTLET_BROWSER_BUILD',
];
const commandSettings = new AsyncLocalStorage();
const setting = (name) => (commandSettings.getStore() ?? process.env)[name];
// Runs `body` with these settings instead of the process environment's, for every command it starts (tests).
export const withGauntletSettings = (settings, body) => commandSettings.run({ ...settings }, body);
const ledgerPath = () => resolve(setting('NERV_GAUNTLET_LEDGER') ?? here(ledgerFile));
const consumptionPath = () => resolve(setting('NERV_GAUNTLET_CONSUMPTION') ?? here(consumptionFile));
const tasksPath = () => resolve(setting('NERV_GAUNTLET_TASKS') ?? here('docs/work/tasks'));
const systemPath = () => resolve(setting('NERV_GAUNTLET_SYSTEM') ?? here(systemFile));
// B-127: tests point this at a temporary folder instead of moving the shared build that browser tests serve.
const browserBuildPath = () => resolve(setting('NERV_GAUNTLET_BROWSER_BUILD') ?? here('dist/web/browser'));
const releaseTag = () => readJSON(here('vendor/gauntlet-protocol.json')).releaseTag;

export function readSystemPackWithInputs() {
  const raw = readJSON(systemPath());
  const caseInputs = new Map();
  const cases = Array.isArray(raw?.cases)
    ? raw.cases.map((c) => {
        if (c && typeof c === 'object' && 'inputs' in c && c.inputs !== undefined) {
          if (!Array.isArray(c.inputs) || !c.inputs.length || c.inputs.some((p) => typeof p !== 'string' || !p.trim())) {
            throw Error(`Invalid inputs for system case ${c.id}`);
          }
          caseInputs.set(c.id, [...c.inputs]);
          const { inputs: _inputs, ...rest } = c;
          return rest;
        }
        return c;
      })
    : raw?.cases;
  return { pack: validatePack({ ...raw, cases }), caseInputs };
}

function filterInputs(allInputs, declaredPaths) {
  return Object.fromEntries(
    Object.entries(allInputs).filter(([file]) =>
      declaredPaths.some((p) => file === p || file.startsWith(p.endsWith('/') ? p : p + '/')),
    ),
  );
}

export function systemSourceKey(_pack, caseId, overrideInputs) {
  const allInputs = overrideInputs ? { ...overrideInputs } : sourceInputs(root, false);
  delete allInputs[ledgerFile];
  const declared = caseId ? readSystemPackWithInputs().caseInputs.get(caseId) : undefined;
  const inputs = declared ? filterInputs(allInputs, declared) : allInputs;
  return hash({
    inputs,
    adapter: hash(readFileSync(here('tools/gauntlet-adapter.mjs'), 'utf8')),
    scriptedAgent: hash(readFileSync(here('tools/gauntlet-scripted-agent.mjs'), 'utf8')),
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
// F-120-T09: NERV's own model-layer packs, named by evals/gauntlet/consumption.json `nervModelPacks` (paths from the
// repository root). Like a common pack they follow the model; their prompts come from NERV's source, so a source
// change that changes a prompt changes the case hash and the case is pending again.
export function nervModelPacks() {
  const files = readJSON(consumptionPath())?.nervModelPacks ?? [];
  if (!Array.isArray(files) || files.some((f) => typeof f !== 'string' || !f.startsWith('evals/gauntlet/')))
    throw Error('Invalid nervModelPacks in ' + consumptionFile);
  return files.map((file) => ({ file, pack: validatePack(readJSON(here(file))), nerv: true }));
}
export function systemPacks() {
  return [{ file: systemFile, pack: readSystemPackWithInputs().pack, nerv: true }];
}
const modelPacks = () => [...commonPacks(), ...nervModelPacks()];
const allPacks = () => [...modelPacks(), ...systemPacks()];
// Model limits scale Gauntlet's day limits per case, so a 10-case pack gets exactly the day limits (cache reuse keeps
// working) and a larger pack gets the same per-case budget: time, output tokens and case count grow with the pack.
// F-120-T05 (owner decision 2026-11-26, "yes to 180 s"): a pack whose cases run on the release's coding, embedded or
// cad-3d reference runner scales the release's slow-host limits instead (180 s a case): those runners reserve 20 s of
// each case for grading, so the day limits' 30 s left the model 10 s. Every other pack keeps the day limits.
const SLOW_HOST_RUNNERS = new Set(['coding-reference', 'embedded-reference', 'cad-3d-reference']);
export function modelLimits(pack) {
  const slowHost = pack.cases.some((c) => SLOW_HOST_RUNNERS.has(c.runner));
  const base = validateLimits(readJSON(join(examples, slowHost ? 'limits-slow-host.json' : 'limits-day.json')));
  const n = pack.cases.length;
  return {
    caseMs: base.caseMs,
    suiteMs: Math.round((base.suiteMs / base.maxCases) * n),
    maxCases: n,
    repeat: base.repeat,
    outputTokens: codingPack(pack) ? CODING_REPLY_TOKENS * n : Math.round((base.outputTokens / base.maxCases) * n),
    maxBytes: base.maxBytes,
  };
}
// F-120-T07 (owner decision 2026-11-26, "Raise the output limit for the coding packs ok"): with thinking on, every
// coding-reference reply hit the profile's 2,048 output tokens and was scored truncated before its tests ran. Those
// packs raise the profile's reply cap to 3,072 tokens a case, and the suite budget with it; every other pack keeps the
// profile unchanged. 3,072 fits the 180 s case: the runner aborts the model at 160 s and grades in what is left after a
// 30 s reserve, and gemma4:12b on the Mac measured 20-30 tokens/s after a 12 s cold load, so 3,072 tokens end by about
// 115-165 s; 4,096 or 8,192 would be cut by the abort or leave no time to run the tests. The raised profile changes
// the profile hash, so `pending` checks coding results against the same raised profile (pendingByPack).
const CODING_REPLY_TOKENS = 3072;
const codingPack = (pack) => pack.cases.some((c) => c.runner === 'coding-reference');
export function modelProfile(pack, profile) {
  if (!profile || !codingPack(pack) || profile.maxOutputTokens >= CODING_REPLY_TOKENS) return profile;
  if (CODING_REPLY_TOKENS >= profile.context) throw Error('Profile context too small for the coding reply budget');
  return validateProfile({ ...profile, maxOutputTokens: CODING_REPLY_TOKENS });
}
const isModelPack = (pack) => pack.cases.some((c) => c.layer !== 'system');
const hasRunner = (pack) => pack.cases.some((c) => !!c.runner);
// F-120-T03: the release's coding, embedded and cad-3d reference runners ask the selected model (allowModels in the
// registry), so their cases follow the model like any model case and the pinned release, not NERV's source. NERV's own
// runners (adapter, scripted agent) are model-free and follow NERV's source.
const registryFile = 'evals/gauntlet/runners.json';
const modelRunner = (name) => readJSON(here(registryFile)).runners?.[name]?.allowModels === true;
const usesModelRunner = (pack) => pack.cases.some((c) => !!c.runner && modelRunner(c.runner));
const modelFreeRunnerPack = (pack) =>
  isModelPack(pack) && pack.cases.every((c) => !!c.runner) && !usesModelRunner(pack);
// F-120-T16 (owner decision 2026-11-26, "b: fix the key first"): the key binds only the registry entries the pack's
// cases run, so adding or changing a system runner no longer marks model cases as changed.
export function releaseSourceKey(pack, registry = readJSON(here(registryFile))) {
  const used = [...new Set(pack.cases.map((c) => c.runner).filter(Boolean))].sort();
  return hash({
    dependency: hash(readFileSync(here('vendor/gauntlet-protocol.json'), 'utf8')),
    runners: used.map((name) => [name, registry.runners?.[name] ?? null]),
  });
}
export const caseSourceKey = (pack, caseId) =>
  usesModelRunner(pack) ? releaseSourceKey(pack) : systemSourceKey(pack, caseId);
const pendingByPack = (packs, ledger, options) =>
  packs.flatMap((pack) => {
    const identity = { ...options, ...(options.profile ? { profile: modelProfile(pack, options.profile) } : {}) };
    // A runner-only contract pack on model-free runners exercises NERV's adapter, not the selected model binary.
    // Its profile and NERV source identity remain bound, but model digest changes do not invalidate it.
    if (modelFreeRunnerPack(pack)) {
      delete identity.modelDigest;
      delete identity.runtimeHash;
      delete identity.scenarioHash;
    }
    if (typeof identity.sourceKey === 'function') {
      const resolveKey = identity.sourceKey;
      return pack.cases.flatMap((c) =>
        pendingCases([{ ...pack, cases: [c] }], ledger, {
          ...identity,
          sourceKey: c.runner !== undefined ? resolveKey(pack, c.id) : null,
        }),
      );
    }
    return pendingCases([pack], ledger, identity);
  });
const unmetRequirements = (testCase) =>
  (testCase.requirements ?? []).filter(
    (requirement) => requirement === 'built-browser-assets' && !existsSync(browserBuildPath()),
  );
const assertRequirements = (pack) => {
  const unmet = pack.cases.flatMap((testCase) => unmetRequirements(testCase));
  if (unmet.length) throw Error('Unmet case requirement: ' + [...new Set(unmet)].join(', '));
};

export function testIndex(reports = []) {
  const packs = allPacks();
  const links = Object.fromEntries(
    packs.map((p) => [
      p.pack.id,
      p.nerv
        ? '../' + p.file
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
  const path = ledgerPath();
  // B-165: a test records only to a ledger it owns; the tracked one changes through an owner-approved run. The test
  // runner marks its file processes (NODE_TEST_CONTEXT) or runs in this one (--test-isolation=none); `node file.mjs`
  // is not recognisable. Real paths, so a symlinked or differently cased path to the same file is caught too.
  const underTest = Boolean(process.env.NODE_TEST_CONTEXT) || process.execArgv.some((a) => /^--test(=|$|-)/.test(a));
  const same = (a, b) => existsSync(a) && existsSync(b) && realpathSync(a) === realpathSync(b);
  if (underTest && (path === here(ledgerFile) || same(path, here(ledgerFile))))
    throw Error('Refusing to write the tracked Gauntlet ledger ' + ledgerFile + ' under the test runner (B-165)');
  const temporary = path + '.' + process.pid + '.tmp';
  writeFileSync(temporary, JSON.stringify(validateLedger(ledger), null, 2) + '\n', { flag: 'wx' });
  renameSync(temporary, path);
}
const entryKey = (e) => JSON.stringify([e.pack, e.case, e.profileHash]);
// A selected run (one system case, or a model pack's pending cases) ran the same case definitions as the full pack:
// Gauntlet checks the report against the selected pack it actually ran, and the entries are kept under the full pack.
export function recordSelected(ledger, report, full, selected, sourceKey = null) {
  const entries = new Map(ledger.entries.map((e) => [entryKey(e), e]));
  const rawEntries =
    typeof sourceKey === 'function'
      ? selected.cases.flatMap((c) => {
          const single = { ...selected, cases: [c] };
          const filtered = { ...report, results: report.results.filter((r) => r.id === c.id) };
          return recordRun(emptyLedger(), filtered, single, { sourceKey: sourceKey(c.id) }).entries;
        })
      : recordRun(emptyLedger(), report, selected, { sourceKey }).entries;
  for (const e of rawEntries) {
    const entry = { ...e, pack: full.id, packVersion: full.version };
    if (modelFreeRunnerPack(full)) {
      entry.modelDigest = null;
      entry.runtimeHash = null;
      entry.scenarioHash = null;
    }
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
  return readdirSync(tasksPath())
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJSON(join(tasksPath(), f)))
    .filter((t) => t.status !== 'closed')
    .map((t) => JSON.stringify(t))
    .join('\n');
}
export function unnamedPending(list, text) {
  const names = new Set(text.match(/[a-z0-9][a-z0-9.-]*\/(?:\*|[a-z0-9][a-z0-9.-]*)/gi) ?? []);
  return list.filter((p) => !names.has(`${p.pack}/${p.case}`) && !names.has(`${p.pack}/*`));
}
export function pending({ maxAgeDays, profile, modelDigest, runtimeHash, scenarioHash, sourceKey } = {}) {
  const effectiveSourceKey =
    sourceKey !== undefined ? sourceKey : (pack, caseId) => caseSourceKey(pack, caseId);
  return pendingByPack(
    allPacks().map((p) => p.pack),
    readLedger(),
    {
      ...(profile ? { profile } : {}),
      ...(maxAgeDays !== undefined ? { maxAgeMs: maxAgeDays * 86400000 } : {}),
      ...(modelDigest !== undefined ? { modelDigest } : {}),
      ...(runtimeHash !== undefined ? { runtimeHash } : {}),
      ...(scenarioHash !== undefined ? { scenarioHash } : {}),
      ...(effectiveSourceKey !== undefined ? { sourceKey: effectiveSourceKey } : {}),
    },
  );
}

// -------------------------------------------------------------------------------------------------- commands
export function main(args = process.argv.slice(2), services = { execute: executeWithEvidence }) {
  if (commandSettings.getStore()) return command(args, services);
  const settings = Object.fromEntries(SETTINGS.map((name) => [name, process.env[name]]));
  return commandSettings.run(settings, () => command(args, services));
}
async function command(args, services) {
  const [command = 'plan', ...rest] = args,
    options = {};
  const allowed = {
    'inspect-failures': ['directory', 'report'],
    machine: ['id', 'version'],
    index: ['check', 'reports'],
    packs: [],
    pending: [
      'check-records',
      'max-age-days',
      'profile',
      'model-digest',
      'runtime-hash',
      'scenario-hash',
      'source-key',
      'machine-profile',
      'scenario',
    ],
    ledger: ['report', 'pack', 'source-key'],
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
      'model-digest',
      'runtime-hash',
      'scenario-hash',
      'source-key',
    ],
    'role-plan': ['role', 'limit', 'profile', 'limits', 'machine-profile', 'scenario'],
    'role-run': [
      'role',
      'limit',
      'profile',
      'limits',
      'out',
      'execute',
      'allow-models',
      'fresh',
      'machine-profile',
      'scenario',
      'confirm-scenario',
    ],
    compare: ['reports'],
    qualify: ['report', 'review', 'requirements', 'out'],
  };
  if (!Object.hasOwn(allowed, command))
    throw Error(
      'Use index, packs, plan, run, model-plan, model-run, role-plan, role-run, all, pending, ledger, inspect-failures, compare or qualify',
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
        source: p.nerv ? 'nerv' : 'common',
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
  const intendedIdentity = (env) => {
    if (options['scenario-hash'] !== undefined && env)
      throw Error('Use --scenario-hash or --machine-profile/--scenario, not both');
    const scenarioHash = env
      ? gauntletScenarioHash(env)
      : options['scenario-hash'] !== undefined
        ? options['scenario-hash'] === 'none'
          ? null
          : options['scenario-hash']
        : undefined;
    const sourceKey =
      options['source-key'] !== undefined
        ? options['source-key'] === 'none'
          ? null
          : options['source-key']
        : undefined;
    return {
      ...(options['model-digest'] !== undefined
        ? { modelDigest: options['model-digest'] === 'none' ? null : options['model-digest'] }
        : {}),
      ...(options['runtime-hash'] !== undefined
        ? { runtimeHash: options['runtime-hash'] === 'none' ? null : options['runtime-hash'] }
        : {}),
      ...(scenarioHash !== undefined ? { scenarioHash } : {}),
      ...(sourceKey !== undefined ? { sourceKey } : {}),
    };
  };
  if (command === 'pending') {
    if (!!options['machine-profile'] !== !!options.scenario)
      throw Error('Machine profile and scenario must be supplied together');
    const env = options.scenario
      ? validateExecutionEnvironment({ machine: load('machine-profile'), scenario: load('scenario') })
      : undefined;
    const list = pending({
      maxAgeDays: days(),
      profile: options.profile ? validateProfile(load('profile')) : undefined,
      ...intendedIdentity(env),
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
    const sourceKey =
      options['source-key'] !== undefined
        ? options['source-key'] === 'none'
          ? null
          : options['source-key']
        : hasRunner(full)
          ? (caseId) => caseSourceKey(full, caseId)
          : null;
    const next = recordSelected(readLedger(), report, full, selectedPack(full, ids, isModelPack(full)), sourceKey);
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
    services.execute(pack, model ? modelProfile(pack, profile) : profile, limitsFor(model, pack), {
      execute: true,
      ...flags,
      scenarioConfirmed: options['confirm-scenario'] === true,
      registry: validateRegistry(readJSON(here(registryFile)), here('evals/gauntlet')),
      output: out,
      cacheDirectory: options['cache-dir'] ?? defaultEvidenceDirectory(),
      forceFresh: options.fresh === true,
      sourceKey: hasRunner(pack) ? caseSourceKey(pack, pack.cases.length === 1 ? pack.cases[0].id : undefined) : undefined,
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
    return all(options, { profile, execute, limitsFor, maxAgeDays: days(), intended: intendedIdentity(environment) });
  }
  if (command === 'role-plan' || command === 'role-run') {
    const profile = options.profile ? validateProfile(load('profile')) : null;
    if (!profile) throw Error('Role plan/run needs --profile=path');
    const limits = validateLimits(
      options.limits ? load('limits') : readJSON(join(examples, 'limits-day.json')),
    );
    const limit =
      options.limit !== undefined
        ? /^\d+$/.test(options.limit)
          ? Number(options.limit)
          : (() => {
              throw Error('Invalid --limit');
            })()
        : undefined;
    const role = options.role ?? 'both';
    const selection = validateRoleBundleConfig({ role, limit, profile, limits });
    if (command === 'role-plan') {
      return {
        bundle: 'nerv-role-evaluation',
        role: selection.role,
        limit: selection.limit,
        cases: selection.cases.map((c) => ({ role: c.role, suiteId: c.suiteId, id: c.case.id, split: c.case.split, family: c.case.family })),
        profile,
        limits: (({ caseMs, suiteMs, maxCases, repeat, outputTokens, maxBytes }) => ({
          caseMs,
          suiteMs,
          maxCases,
          repeat,
          outputTokens,
          maxBytes,
        }))(limits),
        environment: environment ?? null,
        reusesCommonSmoke: false,
        modelCallsAuthorized: false,
        modelQualification: false,
      };
    }
    confirmScenario();
    if (!options.execute || !options['allow-models'] || !options.out)
      throw Error('Role execution requires --execute --allow-models --out=new.json');
    return runRoleBundle(
      {
        role: selection.role,
        limit: selection.limit,
        profile,
        limits,
        environment: environment ?? null,
        out: options.out,
        sourceKey: systemPacks()[0]?.pack ? systemSourceKey(systemPacks()[0].pack) : null,
      },
      { fetch: services.fetch, signal: services.signal },
    );
  }

  const model = command.startsWith('model-');
  if (options.format && !['unconstrained', 'schema'].includes(options.format))
    throw Error('Use --format=unconstrained or schema');
  if (options.format && options.pack) throw Error('Use --pack or --format, not both');
  const packId = options.pack ?? (options.format === 'schema' ? 'neutral-smoke-schema' : 'neutral-smoke');
  let pack = model ? modelPacks().find((p) => p.pack.id === packId)?.pack : systemPacks()[0].pack;
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
  if (command.endsWith('plan')) return plan(pack, modelProfile(pack, profile), limitsFor(model, pack), flags);
  confirmScenario();
  if (!options.execute || !options.out) throw Error('Execution requires --execute --out=new.json');
  assertRequirements(pack);
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
async function all(options, { profile, execute, limitsFor, maxAgeDays, intended = {} }) {
  const ledger = readLedger();
  const pendingOptions = {
    ...(maxAgeDays !== undefined ? { maxAgeMs: maxAgeDays * 86400000 } : {}),
    ...(profile ? { profile } : {}),
    // B-079: the same per-case source key as `pending`, so a result recorded at another source is rerun, not reused.
    sourceKey: (pack, caseId) => caseSourceKey(pack, caseId),
    ...intended,
  };
  const open = pendingByPack(
    allPacks().map((p) => p.pack),
    ledger,
    pendingOptions,
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
    const blockedReasons = new Map();
    for (const pendingCase of run) {
      const testCase = pack.cases.find((candidate) => candidate.id === pendingCase.case);
      const requirements = unmetRequirements(testCase);
      if (requirements.length) blockedReasons.set(pendingCase.case, requirements.join(', '));
      else if (model && (!options['allow-models'] || !profile))
        blockedReasons.set(pendingCase.case, '--allow-models and --profile (owner-approved budget)');
      else if (testCase.expensive && !options['allow-expensive']) blockedReasons.set(pendingCase.case, '--allow-expensive');
    }
    return { pack, model, run, reuse, blockedReasons };
  });
  const summary = packs.map(({ pack, model, run, reuse, blockedReasons }) => ({
    pack: pack.id,
    version: pack.version,
    layer: model ? 'model' : 'system',
    run,
    reuse,
    ...(blockedReasons.size
      ? {
          blocked: {
            cases: [...blockedReasons.keys()],
            needs: Object.fromEntries(blockedReasons),
          },
        }
      : {}),
    ...(run.length > blockedReasons.size
      ? {
          budget: (({ caseMs, suiteMs, outputTokens }) => ({ caseMs, suiteMs, outputTokens }))(
            limitsFor(
              model,
              selectedPack(
                pack,
                run.filter((r) => !blockedReasons.has(r.case)).map((r) => r.case),
                model,
              ),
            ),
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
  for (const { pack, model, run, blockedReasons } of packs) {
    const ids = run.map((r) => r.case).filter((id) => !blockedReasons.has(id));
    // A system runner takes one selected case per run; a model run takes every selected case at once.
    const batches = model ? (ids.length ? [ids] : []) : ids.map((id) => [id]);
    for (const batch of batches) {
      const selected = selectedPack(pack, batch, model);
      const out = join(outDir, `${pack.id}${model ? '' : '-' + batch[0]}.json`);
      const sourceKey = hasRunner(pack) ? caseSourceKey(pack, batch.length === 1 ? batch[0] : undefined) : null;
      const result = await execute(selected, model, model ? profile : null, out, {
        ...(maxAgeDays !== undefined ? { maxAgeMs: maxAgeDays * 86400000 } : {}),
        ...(sourceKey ? { sourceKey } : {}),
      });
      next = recordSelected(next, result.report, pack, selected, sourceKey);
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
  const stillPending = pendingByPack(
    allPacks().map((p) => p.pack),
    next,
    pendingOptions,
  );
  return {
    plan: summary,
    results,
    passed: results.every((r) => r.passed),
    ledger: ledgerFile,
    stillPending: stillPending.length,
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
