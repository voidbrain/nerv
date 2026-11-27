import {
  GMAIL_NOT_CONNECTED,
  connectGmail,
  disconnectGmail,
  gmailStatus,
  readClientFile,
  readGmailCredentials,
} from './gmail-auth.ts';
import { runResumeEngineTick, type CreateResumeIntentInput, type ResumeIntentStatus } from './resume-intent.ts';
import { ClaudeCodeResumeAdapter } from './claude-resume-adapter.ts';
import { createWebChatResumeDeps } from './web-chat-resume-adapter.ts';
import { decideHitlThroughPersona, explainClassificationThroughPersona, formatMisatoPendingHitl } from './persona.ts';
import { EVA_CLASS_SPECS, admitEvaJob, type EvaAdmissionRequest } from './eva-classes.ts';
import { runToolsProcessInEva03 } from './eva-runner.ts';
import { EvaPool, defaultEvaLimits } from './eva-pool.ts';
import { EvaJobs, runEva03Durably } from './eva-jobs.ts';

import { recordPromotion } from './milestones.ts';
import { SeatPool } from './seat-pool.ts';
import { parseFleetImport } from './fleet.ts';
import { printLibraryRoot, resolvePrintFile } from './print-library.ts';
import { readSlicerProfiles } from './slicer.ts';
import { formatBatteryStateLines, formatDueResistancePrompt, type OneMoreBatteryExport } from './batteries.ts';
import {
  detectVoiceLanguage,
  evaluateVoiceCorpus,
  parseVoiceCommandIntent,
  type VoiceCorpus,
  type VoiceLanguage,
} from './voice.ts';
import {
  activateSkillVersion,
  checkSkillPermissionEscalation,
  evaluateSkillVersion,
  listSkillPackages,
  loadSkillVersion,
  reconcileSkillsAfterModelChange,
  retireSkillPackage,
  rollbackSkillVersion,
  stageSkillPackage,
  type SkillEvaluationSuite,
  type SkillPackage,
} from './skills.ts';

import {
  engineReceiptPath,
  executeEngineLifecycle,
  planEngineLifecycle,
  reconcileEngineState,
  type EngineLifecycleAction,
  type EnginePlatform,
  type ManagedEngineSpec,
} from './engine-lifecycle.ts';

import { runtimeBom } from './bom.ts';

import { randomBytes, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { formatQueuedMessage } from './request-queue.ts';
import { requestLanguage } from './misato.ts';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { OWNER_SOURCE, Store } from './store.ts';
import { argsHash } from './ledger.ts';
import { formatDevices, matchDevice, type DeviceInfo } from './device-book.ts';
import { pairingBase, phoneBaseResolver, tailnetBase, terminalQr, type PhoneBase } from './pairing-qr.ts';

import {
  savePilots,
  saveTools,
  databasePath,
  isTelegramToken,
  telegramTokenPath,
  readConfig,
  setUpdatePolicy,
  readModelKey,
  readScrolls,
  readSeatKey,
  readTelegramToken,
  seatKeyPath,
  writeSeatKey,
  readToken,
  rotateCredential,
  setBase,
  setting,
  setEvaJobUser,
} from './config.ts';
import { STAGES, addPilot, describePilots, setPilotFlag, updatePilot, type EvaClass, type Stage } from './pilots.ts';
import { DEFAULT_UPDATE_SCHEDULE, defaultAutoUpdatePolicy } from './update-policy.ts';
import {
  connect as connectMcp,
  fingerprint as toolFingerprint,
  grantRefusal,
  isHttpServer,
  serverLabel,
  toolName,
  urlRefusal,
  type Eva,
  type McpTool,
} from './mcp.ts';
import { listModules, setModuleOn, type ServerListing } from './modules.ts';
import { builtinPackRegistry } from './packs.ts';
import { effects, patternOf, defaultPolicy, type Effect } from './policy.ts';
import { TelegramApi, diagnoseNoStart, startChats, telegramBase } from './telegram.ts';

import { baseKey, fingerprint } from './kaji.ts';

import { builtinToolDescriptors } from './executors.ts';

import { detectOllama, modelsReport, ollamaUrlOf, planModels, writeModels, type ModelChange } from './model-setup.ts';

export interface CliCommandContext {
  readSecret: (prompt: string) => Promise<string>;
  openPage: (home: string, page: '/' | '/full' | '/dashboard/', print: boolean) => Promise<void>;
  reloadIfRunning: (homeDir: string, port: number) => Promise<string>;
  flag: (name: string) => string | undefined;
}

/**
 * B-128: the address a phone opens for a pairing QR, for both `nerv open --phone --qr` and Settings (serve): config
 * phone.url (read each time, so an edit needs no restart), else this machine's tailnet name, looked up at most once a
 * minute.
 */
export function phoneBaseFor(home: string, port: number): PhoneBase {
  return phoneBaseResolver({
    configured: () => readConfig(home).phone?.url,
    tailnet: () => tailnetBase(port),
  });
}

export async function tryRunCliCommand(
  command: string | undefined,
  args: string[],
  home: string,
  ctx: CliCommandContext,
): Promise<boolean> {
  if (command === 'engines') {
    const action = (args[0] ?? 'status') as EngineLifecycleAction | 'reconcile';
    const specFlag = args.indexOf('--spec');
    const specPath = specFlag >= 0 ? args[specFlag + 1] : undefined;
    if (!specPath) throw new Error('Usage: engines <status|start|stop|install|uninstall|reconcile> --spec FILE');
    const spec = JSON.parse(readFileSync(resolve(specPath), 'utf8')) as ManagedEngineSpec;
    const platform: EnginePlatform =
      process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';
    const receiptPath = engineReceiptPath(platform, home, spec.id);
    if (action === 'reconcile') {
      const updated = reconcileEngineState(receiptPath, args.includes('--observed-stopped'));
      console.log(JSON.stringify({ ok: true, engineId: spec.id, receipt: updated }, null, 2));
    } else {
      const receipt = existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath, 'utf8')) : null;
      const plan = planEngineLifecycle(spec, action, platform, home, {
        receipt,
        endpointReachable: false,
        pidAlive: false,
        serviceInstalled: false,
      });
      const outcome = await executeEngineLifecycle(plan, spec);
      console.log(JSON.stringify(outcome, null, 2));
      if (!outcome.ok) process.exitCode = 1;
    }
  } else if (command === 'skills') {
    const sub = args[0] ?? 'list';
    if (sub === 'list') {
      console.log(JSON.stringify(listSkillPackages(home), null, 2));
    } else if (sub === 'inspect') {
      if (!args[1] || !args[2]) throw new Error('Usage: skills inspect <id> <version>');
      console.log(JSON.stringify(loadSkillVersion(home, args[1], args[2]), null, 2));
    } else if (sub === 'stage') {
      if (!args[1]) throw new Error('Usage: skills stage <package.json>');
      const pkg = JSON.parse(readFileSync(resolve(args[1]), 'utf8')) as SkillPackage;
      console.log(JSON.stringify(stageSkillPackage(home, pkg), null, 2));
    } else if (sub === 'promote') {
      if (!args[1] || !args[2])
        throw new Error('Usage: skills promote <id> <version> --owner-approved [--model <model>]');
      const modelIdx = args.indexOf('--model');
      const model = modelIdx >= 0 ? args[modelIdx + 1] : undefined;
      console.log(
        JSON.stringify(
          activateSkillVersion(home, args[1], args[2], {
            ownerApproved: args.includes('--owner-approved'),
            ...(model ? { model, requireEvaluation: true } : {}),
          }),
          null,
          2,
        ),
      );
    } else if (sub === 'evaluate') {
      if (!args[1] || !args[2] || !args[3] || !args[4]) {
        throw new Error('Usage: skills evaluate <id> <version> <suite.json> <model>');
      }
      const suite = JSON.parse(readFileSync(resolve(args[3]), 'utf8')) as SkillEvaluationSuite;
      const pkg = loadSkillVersion(home, args[1], args[2]);
      const escalation = checkSkillPermissionEscalation(pkg, suite.allowedCapabilities);
      const report = evaluateSkillVersion(home, args[1], args[2], suite, { model: args[4] });
      console.log(JSON.stringify({ ...report, escalation }, null, 2));
      if (!report.eligibleForPromotion) process.exitCode = 1;
    } else if (sub === 'reconcile-model') {
      if (!args[1] || !args[2]) {
        throw new Error('Usage: skills reconcile-model <new-model> <suites.json> --owner-approved');
      }
      const suites = JSON.parse(readFileSync(resolve(args[2]), 'utf8')) as Record<
        string,
        { suite: SkillEvaluationSuite }
      >;
      console.log(
        JSON.stringify(
          reconcileSkillsAfterModelChange(home, args[1], suites, {
            ownerApproved: args.includes('--owner-approved'),
          }),
          null,
          2,
        ),
      );
    } else if (sub === 'rollback') {
      if (!args[1]) throw new Error('Usage: skills rollback <id> --owner-approved');
      console.log(
        JSON.stringify(
          rollbackSkillVersion(home, args[1], { ownerApproved: args.includes('--owner-approved') }),
          null,
          2,
        ),
      );
    } else if (sub === 'retire') {
      if (!args[1]) throw new Error('Usage: skills retire <id> --owner-approved');
      console.log(
        JSON.stringify(
          retireSkillPackage(home, args[1], { ownerApproved: args.includes('--owner-approved') }),
          null,
          2,
        ),
      );
    } else {
      throw new Error(
        'Usage: skills list | inspect <id> <version> | stage <file> | evaluate <id> <version> <suite> <model> | promote <id> <version> --owner-approved | reconcile-model <model> <suites> --owner-approved | rollback <id> --owner-approved | retire <id> --owner-approved',
      );
    }
  } else if (command === 'voice') {
    const sub = args[0];
    if (sub === 'parse' && args[1]) {
      const lang = args[2] === 'it' || args[2] === 'en' ? (args[2] as VoiceLanguage) : detectVoiceLanguage(args[1]);
      console.log(JSON.stringify(parseVoiceCommandIntent(args[1], lang), null, 2));
    } else if (sub === 'eval' && args[1]) {
      const corpus = JSON.parse(readFileSync(resolve(args[1]), 'utf8')) as VoiceCorpus;
      const report = evaluateVoiceCorpus(corpus);
      console.log(JSON.stringify(report, null, 2));
      if (report.failures.length > 0) process.exitCode = 1;
    } else {
      throw new Error('Usage: voice parse <transcript> [it|en] | voice eval <corpus.json>');
    }
  } else if (command === 'batteries') {
    const sub = args[0] ?? 'list';
    const store = new Store(databasePath(home), readScrolls(home), { home });
    try {
      if (sub === 'list') {
        console.log(JSON.stringify(store.batteries.list(), null, 2));
      } else if (sub === 'status') {
        const lang = ctx.flag('--lang') === 'it' ? 'it' : 'en';
        console.log(formatBatteryStateLines(store.batteries.list(), lang));
      } else if (sub === 'due') {
        const lang = ctx.flag('--lang') === 'it' ? 'it' : 'en';
        console.log(formatDueResistancePrompt(store.batteries.dueResistanceChecks(), lang));
      } else if (sub === 'resistance' && args[1] && args[2]) {
        console.log(JSON.stringify(store.batteries.recordResistance(args[1], args.slice(2).join(' ')), null, 2));
      } else if (sub === 'chat' && args[1]) {
        console.log(JSON.stringify(store.batteries.applyChatPhrase(args.slice(1).join(' ')), null, 2));
      } else if (sub === 'add' && args[1]) {
        const packNumber = Number(args[1]);
        const series = ctx.flag('--series');
        const brand = ctx.flag('--brand') ?? 'Generic';
        const cellFlag = ctx.flag('--cells');
        const typeFlag = ctx.flag('--type');
        const cells = cellFlag ? Number(cellFlag) : Number(/(\d+)s/i.exec(typeFlag ?? '')?.[1] ?? 6);
        const batteryType = typeFlag ?? `LiPo ${cells}S`;
        const capacityMah = Number(ctx.flag('--mah') ?? 1300);
        const purchaseDate = ctx.flag('--date') ?? new Date().toISOString().slice(0, 10);
        const resFlag = ctx.flag('--resistance');
        const initialResistanceMohm = resFlag
          ? resFlag
              .split(',')
              .map((v) => Number(v.trim()))
              .filter(Number.isFinite)
          : undefined;
        const created = store.batteries.register({
          packNumber,
          ...(series ? { series, seriesColor: series } : {}),
          brand,
          batteryType,
          cellCount: cells,
          capacityMah,
          purchaseDate,
          ...(initialResistanceMohm ? { initialResistanceMohm } : { allowPendingResistance: true }),
        });
        console.log(JSON.stringify(created, null, 2));
      } else if (sub === 'import' && args[1]) {
        const payload = JSON.parse(readFileSync(resolve(args[1]), 'utf8')) as OneMoreBatteryExport;
        console.log(JSON.stringify(store.batteries.importOneMoreBattery(payload), null, 2));
      } else {
        throw new Error(
          'Usage: batteries list | batteries status [--lang it|en] | batteries due [--lang it|en] | batteries resistance <id> <v1,v2,...> | batteries chat <phrase> | batteries import <export.json>',
        );
      }
    } finally {
      store.close();
    }
  } else if (command === 'fleet') {
    const sub = args[0] ?? 'drones';
    const store = new Store(databasePath(home), readScrolls(home), { home });
    try {
      if (sub === 'drones') {
        console.log(JSON.stringify(store.fleet.listDrones(), null, 2));
      } else if (sub === 'parts' && args[1]) {
        console.log(JSON.stringify(store.fleet.listParts(args[1]), null, 2));
      } else if (sub === 'spares') {
        console.log(JSON.stringify(store.fleet.listSpares(args[1]), null, 2));
      } else if (sub === 'import' && args[1]) {
        let raw: unknown;
        try {
          raw = JSON.parse(readFileSync(resolve(args[1]), 'utf8'));
        } catch (error) {
          throw new Error(`${args[1]} is not readable JSON: ${(error as Error).message}`);
        }
        const slicerProfiles = readSlicerProfiles(home).map((profile) => profile.name);
        console.log(
          JSON.stringify(
            store.fleet.importFleet(parseFleetImport(raw, { slicerProfiles }), undefined, { slicerProfiles }),
            null,
            2,
          ),
        );
      } else if (sub === 'models') {
        console.log(
          JSON.stringify(
            store.fleet
              .listDroneModels()
              .map((model) => ({ ...model, parts: store.fleet.printedPartsForModel(model.name) })),
            null,
            2,
          ),
        );
      } else if (sub === 'prints' && args[1]) {
        // F-121-T01: a drone's inherited printed parts (or a model's), each with its library file checked.
        const parts = store.fleet.getDroneByName(args[1])
          ? store.fleet.printedPartsForDrone(args[1])
          : store.fleet.getDroneModel(args[1])
            ? store.fleet.printedPartsForModel(args[1])
            : undefined;
        if (!parts) throw new Error(`No drone or drone model named ${args[1]}.`);
        const root = printLibraryRoot(home);
        console.log(
          JSON.stringify(
            parts.map((part) => {
              const file = resolvePrintFile(root, part.file);
              return { ...part, fileStatus: file.status, ...(file.status === 'ok' ? {} : { fileNote: file.reason }) };
            }),
            null,
            2,
          ),
        );
      } else {
        throw new Error(
          'Usage: fleet drones | fleet parts <drone> | fleet spares [category] | fleet import <fleet.json> | fleet models | fleet prints <drone|model>',
        );
      }
    } finally {
      store.close();
    }
  } else if (command === 'session-limit') {
    // F-090-T04: record a coding session that stopped at its usage limit; `serve` resumes it once after the reset.
    const sub = args[0] ?? 'list';
    const store = new Store(databasePath(home), readScrolls(home), { home });
    try {
      if (sub === 'list') {
        console.log(JSON.stringify(store.sessionLimits.list(), null, 2));
      } else if (sub === 'record' && args[1] && args[2] && args[3] && args[4]) {
        const resetAt = Date.parse(args[4]);
        if (!/(Z|[+-]\d{2}:\d{2})$/.test(args[4]) || !Number.isFinite(resetAt))
          throw new Error('The reset time is an ISO time with its zone, e.g. 2026-11-23T15:00:00+01:00.');
        const prompt = ctx.flag('--prompt');
        const recorded = store.sessionLimits.record({
          sessionId: args[1],
          repoPath: resolve(args[2]),
          branch: args[3],
          resetAt,
          ...(prompt ? { prompt } : {}),
        });
        console.log(JSON.stringify(recorded, null, 2));
      } else {
        throw new Error('Usage: session-limit list | record SESSION REPO BRANCH "ISO reset time+zone" [--prompt TEXT]');
      }
    } finally {
      store.close();
    }
  } else if (command === 'resume-intent') {
    const sub = args[0] ?? 'list';
    const store = new Store(databasePath(home), readScrolls(home), { home });
    try {
      if (sub === 'list') {
        const status = args[1] as ResumeIntentStatus | undefined;
        console.log(JSON.stringify(store.resumeIntents.list(status), null, 2));
      } else if (sub === 'create' && args[1]) {
        const input = JSON.parse(readFileSync(resolve(args[1]), 'utf8')) as CreateResumeIntentInput;
        console.log(JSON.stringify(store.resumeIntents.create(input), null, 2));
      } else if (sub === 'cancel' && args[1]) {
        console.log(JSON.stringify(store.resumeIntents.cancel(args[1], args[2]), null, 2));
      } else if (sub === 'tick') {
        const owner = ctx.flag('--owner') ?? 'cli';
        const deps = args.includes('--claude-code')
          ? new ClaudeCodeResumeAdapter().toEngineDeps(owner)
          : args.includes('--web-chat')
            ? createWebChatResumeDeps({
                owner,
                allowedOrigins: [],
                driver: {
                  getActiveTab: async () => {
                    throw new Error('No live browser-worker driver bound in CLI tick.');
                  },
                  clickControl: async () => {
                    throw new Error('No live browser-worker driver bound in CLI tick.');
                  },
                },
              })
            : {
                owner,
                checkAvailability: () => ({ available: false, reason: 'Live adapter readiness probe required.' }),
                verifyIdentity: () => null,
                executeResume: () => ({ kind: 'failed' as const, reason: 'No live adapter bound in CLI tick.' }),
              };
        const res = await runResumeEngineTick(store.resumeIntents, deps);
        console.log(JSON.stringify(res, null, 2));
      } else {
        throw new Error('Usage: resume-intent list [status] | create <intent.json> | cancel <id> [reason] | tick');
      }
    } finally {
      store.close();
    }
  } else if (command === 'persona') {
    const sub = args[0];
    const action = args[1];
    const store = new Store(databasePath(home), readScrolls(home), { home });
    const persona = readConfig(home).personas;
    try {
      if (sub === 'hitl' && action === 'list') {
        console.log(formatMisatoPendingHitl(store.approvals(20), persona));
      } else if (sub === 'hitl' && action === 'decide' && args[2] && (args[3] === 'approve' || args[3] === 'reject')) {
        const res = await decideHitlThroughPersona(store, args[2], args[3], { persona, source: 'cli' });
        console.log(JSON.stringify(res, null, 2));
      } else if (sub === 'explain' && action) {
        const res = explainClassificationThroughPersona(store, action, persona);
        console.log(res.summary);
      } else {
        throw new Error(
          'Usage: persona hitl list | persona hitl decide <approvalId> approve|reject | persona explain <ref>',
        );
      }
    } finally {
      store.close();
    }
  } else if (command === 'eva') {
    const sub = args[0] ?? 'classes';
    if (sub === 'classes') {
      console.log(JSON.stringify(EVA_CLASS_SPECS, null, 2));
    } else if (sub === 'admit' && args[1]) {
      const req = JSON.parse(readFileSync(resolve(args[1]), 'utf8')) as EvaAdmissionRequest;
      const withPilots =
        req.pilotId && !req.pilots && !req.pilotRegistry ? { ...req, pilots: readConfig(home).pilots } : req;
      console.log(JSON.stringify(admitEvaJob(withPilots), null, 2));
    } else if (sub === 'limits') {
      // F-049-T06: what this machine gives EVA jobs (config.json eva.limits, or the defaults).
      console.log(JSON.stringify(readConfig(home).eva?.limits ?? defaultEvaLimits(), null, 2));
    } else if (sub === 'job-user') {
      // B-099-T02: EVA jobs run as a dedicated user once the owner set it up (docs/guides/eva-job-user.md).
      if (args[1] === 'off') {
        setEvaJobUser(home, null);
        console.log('EVA jobs run as you again.');
      } else if (args[1] && args[2]) {
        setEvaJobUser(home, { name: args[1], sharedRoot: args[2] });
        console.log(`EVA jobs run as ${args[1]} in ${args[2]}.`);
      } else {
        const u = readConfig(home).eva?.jobUser;
        console.log(u ? `EVA jobs run as ${u.name} in ${u.sharedRoot}.` : 'EVA jobs run as you (no job user set).');
      }
    } else if (sub === 'run-tools-03' || sub === 'jobs' || sub === 'reconcile') {
      // F-049-T13: EVA-03 jobs leave a durable receipt and their events on a sortie; an interrupted one is uncertain.
      const store = new Store(databasePath(home), readScrolls(home), { home });
      try {
        const jobs = new EvaJobs(store.db);
        const recovered = jobs.recover(store.ledger);
        if (recovered.length)
          console.error(
            `Interrupted EVA jobs, now uncertain (their processes may still be running): ${recovered.map((r) => r.id).join(', ')}. See nerv eva jobs; release one with nerv eva reconcile.`,
          );
        if (sub === 'jobs') {
          console.log(JSON.stringify(jobs.list(), null, 2));
        } else if (sub === 'reconcile') {
          if (!args[1] || !args[2])
            throw new Error('Usage: eva reconcile <jobId> <what you confirmed it did or did not do>');
          console.log(JSON.stringify(jobs.reconcile(store.ledger, args[1], args.slice(2).join(' ')), null, 2));
        } else {
          const jobId = `cli-${randomUUID()}`;
          const sortieId = store.ledger.openSortie(
            OWNER_SOURCE,
            'EVA-03: list tools (nerv eva run-tools-03)',
            'trusted',
          );
          let ok = false;
          try {
            const pool = new EvaPool(readConfig(home).eva?.limits ?? defaultEvaLimits());
            const result = await pool.run({ jobId, evaClass: 'eva-03' }, () =>
              runEva03Durably({
                jobs,
                ledger: store.ledger,
                sortieId,
                jobId,
                // Listing tools changes nothing outside the instance: no resource to hold for later jobs.
                key: `eva03:tools-process:${jobId}`,
                hash: argsHash({ command: 'run-tools-03' }),
                run: (onLedgerEvent) =>
                  runToolsProcessInEva03({
                    jobId,
                    home,
                    repoRoot: resolve(import.meta.dirname, '..'),
                    onLedgerEvent,
                    ...(readConfig(home).eva?.jobUser ? { jobUser: readConfig(home).eva!.jobUser! } : {}),
                  }),
              }),
            );
            ok = result.exitCode === 0 && !result.timedOut && !result.cancelled;
            console.log(JSON.stringify({ sortieId, ...result }, null, 2));
            if (!ok) process.exitCode = 1;
          } finally {
            // Whatever happened (refused, the runner threw, the job failed), the sortie does not stay open.
            store.ledger.close(sortieId, ok ? 'done' : 'failed');
          }
        }
      } finally {
        store.close();
      }
    } else {
      throw new Error(
        'Usage: eva classes | eva limits | eva job-user [<user> <folder> | off] | eva admit <request.json> | eva run-tools-03 | eva jobs | eva reconcile <jobId> <confirmed>',
      );
    }
  } else if (command === 'credentials') {
    if (args[0] !== 'rotate' || !['admin', 'telegram', 'cloud'].includes(args[1] ?? ''))
      throw new Error('Usage: credentials rotate admin|telegram|cloud');
    const kind = args[1] as 'admin' | 'telegram' | 'cloud';
    if (kind === 'admin') {
      if (setting('TOKEN')) throw new Error('Unset NERV_TOKEN before rotating the file-backed admin credential.');
      rotateCredential(home, kind, randomBytes(32).toString('hex'));
      console.log('Admin credential rotated; the running service uses it now.');
    } else {
      const value = (
        await ctx.readSecret(`${kind === 'telegram' ? 'New BotFather token' : 'New cloud API key'} (not shown): `)
      ).trim();
      if (kind === 'telegram' ? !isTelegramToken(value) : value.length < 20 || /\s/.test(value))
        throw new Error(
          `That does not look like a ${kind === 'telegram' ? 'BotFather token' : 'cloud API key'}: nothing was saved.`,
        );
      rotateCredential(home, kind, value);
      console.log(`${kind === 'telegram' ? 'Telegram' : 'Cloud'} credential rotated; no secret was printed.`);
      if (kind === 'cloud') console.log(await ctx.reloadIfRunning(home, readConfig(home).port));
    }
  } else if (command === 'gmail') {
    // F-086-T05: the owner connects Gmail himself; the credential goes to a private file, never config.json or a log.
    const sub = args[0] ?? 'status';
    if (sub === 'status') console.log(gmailStatus(home));
    else if (sub === 'disconnect') console.log(await disconnectGmail(home));
    else if (sub === 'connect') {
      const compose = args.includes('--compose');
      const clientFile = ctx.flag('--client-file');
      let existing: ReturnType<typeof readGmailCredentials>;
      try {
        existing = readGmailCredentials(home);
      } catch {
        existing = undefined;
      }
      const client = clientFile
        ? readClientFile(clientFile)
        : existing
          ? { clientId: existing.clientId, clientSecret: existing.clientSecret }
          : {
              clientId: (await ctx.readSecret('Google OAuth client ID (Desktop app; not shown): ')).trim(),
              clientSecret: (await ctx.readSecret('Google OAuth client secret (not shown): ')).trim(),
            };
      if (!client.clientId || !client.clientSecret)
        throw new Error(`Both the client ID and the client secret are needed. ${GMAIL_NOT_CONNECTED}`);
      const { scopes } = await connectGmail({ home, ...client, compose, print: (line) => console.log(line) });
      console.log(
        `${gmailStatus(home)} Scopes: ${scopes.join(' ')}. The credential is in ${home} (mode 600); no secret was printed.`,
      );
      if (clientFile) console.log(`You can now delete the downloaded client file: ${clientFile}`);
    } else throw new Error('Usage: gmail connect [--compose] [--client-file FILE] | gmail status | gmail disconnect');
  } else if (command === 'telegram') {
    // telegram link [CHAT_ID]: binds Aoba to the private chat that sent /start to the bot.
    // telegram token: asks for the BotFather token without showing it, checks its format and saves it privately.
    if (args[0] === 'token') {
      const path = telegramTokenPath(home);
      const token = (
        await ctx.readSecret('Paste the bot token from @BotFather (it is not shown), then Enter: ')
      ).trim();
      if (!isTelegramToken(token))
        throw new Error(
          'That does not look like a BotFather token (digits, a colon, then letters and digits). Nothing was saved.',
        );
      mkdirSync(home, { recursive: true, mode: 0o700 });
      writeFileSync(path, token + '\n', { mode: 0o600 });
      chmodSync(path, 0o600);
      console.log(`Saved to ${path}. Now send /start to your bot in Telegram, then run: nerv telegram link`);
    } else {
      if (args[0] !== 'link') throw new Error('Usage: telegram token | telegram link [CHAT_ID]');
      const botToken = readTelegramToken(home);
      if (!botToken)
        throw new Error(
          `No Telegram bot token at ${telegramTokenPath(home)}. Run: nerv telegram token (it asks for the token from @BotFather and saves it there).`,
        );
      if (readConfig(home).telegram && !args.includes('--relink')) {
        console.log(
          `Already linked to chat ${readConfig(home).telegram!.chatId}: nothing to do. To link another chat, run: nerv telegram link --relink`,
        );
      } else {
        const api = new TelegramApi(botToken, telegramBase());
        const chats = await startChats(api);
        const wanted = args[1] && /^\d+$/.test(args[1]) ? Number(args[1]) : undefined;
        const pick =
          wanted !== undefined ? chats.find((c) => c.chatId === wanted) : chats.length === 1 ? chats[0] : undefined;
        if (!pick) {
          if (!chats.length) throw new Error(`No /start found. ${await diagnoseNoStart(api)}`);
          throw new Error(
            `Several chats sent /start; choose one: ${chats.map((c) => `telegram link ${c.chatId} (${c.name})`).join(' | ')}`,
          );
        }
        const path = join(home, 'config.json');
        const current = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>) : {};
        writeFileSync(path, JSON.stringify({ ...current, telegram: { chatId: pick.chatId } }, null, 2) + '\n', {
          mode: 0o600,
        });
        chmodSync(path, 0o600);
        readConfig(home);
        console.log(`Aoba linked to ${pick.name} (chat ${pick.chatId}). Restart the service to start it.`);
      }
    }
  } else if (command === 'open' && args.includes('--phone')) {
    // F-118: open --phone mints a one-use pairing code (5 minutes) that the installed phone app swaps for a device credential.
    // F-118-T05: --qr also shows a QR of the dashboard link with the code in its fragment (10 minutes): scanned, Safari
    // shows the code and how to install the app; the installed app takes it. --url is the address the phone opens,
    // otherwise config phone.url, else this machine's tailnet name (where tailscale serve answers): the same helper as
    // Settings (B-128).
    const config = readConfig(home);
    const qr = args.includes('--qr');
    let base: string | undefined;
    if (qr) {
      const given = ctx.flag('--url');
      base = given !== undefined ? pairingBase(given) : await phoneBaseFor(home, config.port)();
      if (given !== undefined && !base) throw new Error('--url takes the http(s) address the phone opens.');
      if (!base)
        throw new Error(
          'No address for the phone: give it with --url https://NAME.TAILNET.ts.net (where tailscale serve answers), or set "phone": {"url": …} in config.json.',
        );
    }
    const response = await fetch(`http://127.0.0.1:${config.port}/api/device/codes`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${readToken(home)}`,
        ...(base ? { 'content-type': 'application/json' } : {}),
      },
      body: base ? JSON.stringify({ base }) : undefined,
    }).catch(() => {
      throw new Error('NERV Agency is not running: start it with serve, launch or service start.');
    });
    const value = (await response.json()) as {
      code?: string;
      expiresInMs?: number;
      link?: string;
      qr?: string[];
      qrError?: string;
      error?: string;
    };
    if (!response.ok || !value.code) throw new Error(value.error ?? 'Could not create a pairing code.');
    const valid = `one use, valid ${Math.round((value.expiresInMs ?? 0) / 60_000)} minutes`;
    if (qr)
      console.log(
        (value.qr ? terminalQr(value.qr) + '\n' : `No QR: ${value.qrError ?? 'none returned'}\n`) +
          `Pairing code: ${value.code} (${valid})\n` +
          `Link: ${value.link}\n` +
          'Scan it with the phone: Safari opens the dashboard and shows the code (it never pairs). There, Share → Add to ' +
          'Home Screen, open NERV from the Home Screen and type the code. (iOS opens a scanned link in Safari, never in ' +
          'the installed app.)',
      );
    else
      console.log(
        `Pairing code: ${value.code} (${valid})\n` +
          `Link: http://127.0.0.1:${config.port}/ on this computer, or its address on your network (Tailscale).\n` +
          'On the phone, open NERV from the Home Screen and type the code. For a QR to scan: nerv open --phone --qr.',
      );
  } else if (command === 'open') {
    // open dashboard: the same sign-in, landing on the live dashboard instead of the workspace. open full (B-184): the
    // workspace's full dashboard; the sign-in lives in page memory, so typing /full afterwards would ask again.
    const page = args.includes('full') ? '/full' : args.includes('dashboard') ? '/dashboard/' : '/';
    await ctx.openPage(home, page, args.includes('--print'));
  } else if (command === 'base') {
    // base: show this machine's identity; base ID "Name": change it (restart the service to show it everywhere).
    if (args[0] === 'pubkey') {
      const k = baseKey(home);
      console.log(`${k.publicKey}\nFingerprint: ${fingerprint(k.publicKey)}`);
    } else if (args.length) {
      const b = setBase(home, { id: (args[0] ?? '').toUpperCase(), name: args.slice(1).join(' ') });
      console.log(`Base set: ${b.id} · ${b.name}. Restart the service to apply it.`);
    } else if (args.length === 0) {
      const b = readConfig(home).base;
      console.log(`${b.id} · ${b.name}`);
    }
  } else if (command === 'chat') {
    // A request to Misato through the running service. It plans, the gate reviews each action, and the reply comes back.
    const message = args.join(' ');
    if (!message) throw new Error('Usage: chat "what you want"');
    const config = readConfig(home);
    const token = readToken(home);
    const requestId = randomUUID();
    const lang = requestLanguage(message, [], config.language);
    let lastAhead = 0;
    const queuePoll = setInterval(() => {
      void fetch(`http://127.0.0.1:${config.port}/api/queue`, {
        headers: { authorization: `Bearer ${token}` },
      })
        .then((r) => (r.ok ? (r.json() as Promise<{ queued?: { id: string; ahead: number }[] }>) : null))
        .then((q) => {
          const item = q?.queued?.find((entry) => entry.id === requestId);
          if (item && item.ahead > 0 && item.ahead !== lastAhead) {
            lastAhead = item.ahead;
            console.log(formatQueuedMessage(item.ahead, lang));
          }
        })
        .catch(() => {});
    }, 200);
    queuePoll.unref();
    let response: Response;
    try {
      response = await fetch(`http://127.0.0.1:${config.port}/api/chat`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ message, conversation: 'cli', requestId }),
      }).catch(() => {
        throw new Error('NERV Agency is not running: start it with serve or service start.');
      });
    } finally {
      clearInterval(queuePoll);
    }
    const value = (await response.json()) as {
      reply?: string;
      error?: string;
      sortieId?: string;
      steps?: { tool?: string; outcome: string; reason?: string; error?: string }[];
      waiting?: { approvalId: string; tool: string }[];
      base?: { id: string; name: string };
    };
    if (!response.ok) throw new Error(value.error ?? 'Chat failed.');
    for (const s of value.steps ?? [])
      console.log(
        `· ${s.tool ?? '(invalid reply)'} → ${s.outcome}${s.error ? ` · ${s.error}` : s.reason ? ` · ${s.reason}` : ''}`,
      );
    // Dispatched (F-036): the main base's Misato answered; its cards are decided there (Aoba or its dashboard).
    for (const w of value.waiting ?? [])
      console.log(
        value.base
          ? `⏸ ${w.tool} waits for you on ${value.base.name}: decide it on Aoba or on ${value.base.name}'s dashboard`
          : `⏸ ${w.tool} waits for you: approve ${w.approvalId} | reject ${w.approvalId}`,
      );
    console.log(value.reply ?? `[no reply: ${value.error}]`);
    console.log(
      value.base
        ? `— answered by ${value.base.name} (${value.base.id}), sortie ${value.sortieId} there`
        : `— sortie ${value.sortieId}`,
    );
    if (!value.reply) process.exitCode = 1;
  } else if (command === 'instrumentality') {
    // Runs tonight's consolidation now, through the running service (it needs the brain's model).
    const config = readConfig(home);
    const response = await fetch(`http://127.0.0.1:${config.port}/api/memory/consolidate`, {
      method: 'POST',
      headers: { authorization: `Bearer ${readToken(home)}` },
    }).catch(() => {
      throw new Error('NERV Agency is not running: start it with serve, launch or service start.');
    });
    const value = (await response.json()) as {
      summary?: string;
      exchanges?: number;
      proposed?: number;
      skipped?: number;
      error?: string;
    };
    if (!response.ok || value.error) throw new Error(value.error ?? 'Consolidation failed.');
    console.log(
      `${value.exchanges} exchange(s) consolidated · ${value.proposed} fact(s) proposed as cards · ${value.skipped} already known${value.summary ? `\n${value.summary}` : ''}`,
    );
  } else if (command === 'devices') {
    // F-118-T03: the paired phones (name, last use) and revoking one; its next request is refused and it asks to pair.
    const [sub = 'list', ...rest] = args;
    if (!(sub === 'list' && !rest.length) && !(sub === 'revoke' && rest.length))
      throw new Error('Usage: devices [list] | devices revoke NAME|ID');
    const config = readConfig(home);
    const call = async (path: string, method = 'GET') => {
      const response = await fetch(`http://127.0.0.1:${config.port}/api/${path}`, {
        method,
        headers: { authorization: `Bearer ${readToken(home)}` },
      }).catch(() => {
        throw new Error('NERV Agency is not running: start it with serve, launch or service start.');
      });
      const value = (await response.json()) as { devices?: DeviceInfo[]; error?: string };
      if (!response.ok) throw new Error(value.error ?? `Request failed (${response.status}).`);
      return value;
    };
    const list = (await call('devices')).devices ?? [];
    if (sub === 'list') console.log(formatDevices(list, Date.now()));
    else {
      const found = matchDevice(list, rest.join(' '));
      if ('error' in found) throw new Error(found.error);
      await call(`devices/${encodeURIComponent(found.device.id)}`, 'DELETE');
      console.log(
        `Revoked ${found.device.name} (${found.device.id}): its next request is refused and it asks to pair again (nerv open --phone).`,
      );
    }
  } else if (command === 'sessions') {
    // Ends every dashboard session (F-039): each open dashboard asks to sign in again; the admin token is unchanged.
    if (args[0] !== 'revoke') throw new Error('Usage: sessions revoke');
    const config = readConfig(home);
    const response = await fetch(`http://127.0.0.1:${config.port}/api/session/revoke`, {
      method: 'POST',
      headers: { authorization: `Bearer ${readToken(home)}` },
    }).catch(() => {
      throw new Error('NERV Agency is not running: start it with serve, launch or service start.');
    });
    const value = (await response.json()) as { revoked?: number; error?: string };
    if (!response.ok) throw new Error(value.error ?? 'Revoke failed.');
    console.log(`${value.revoked ?? 0} dashboard session(s) ended. Open the dashboard again with: open dashboard`);
  } else if (command === 'tools') {
    // F-021: MCP servers and their tools; deny by default: a tool is offered to Misato only once granted here.
    const [sub, target, ...rest] = args;
    const config = readConfig(home);
    const tools = config.tools ?? { mcp: [], grants: [] };
    const opt = (name: string, d: string) => {
      const i = rest.indexOf('--' + name);
      return i >= 0 ? (rest[i + 1] ?? d) : d;
    };
    const usage = `Usage: tools | tools add ID COMMAND [ARGS…] | tools add ID https://HOST/mcp | tools remove ID | tools grant SERVER/TOOL [--effect ${effects.join('|')}] [--eva 00|01|02|03] | tools revoke SERVER/TOOL`;
    const listOf = async (id: string) => {
      const s = tools.mcp.find((x) => x.id === id);
      if (!s) throw new Error(`No MCP server ${id}: nerv tools add ${id} COMMAND …`);
      if (s.off) throw new Error(`${id} is off: nerv modules on ${id}, then grant.`);
      const c = connectMcp(s);
      try {
        return await c.listTools();
      } finally {
        c.close();
      }
    };
    if (!sub) {
      console.log(`NERV · ${builtinToolDescriptors.length} built-in tool(s)`);
      for (const descriptor of builtinToolDescriptors)
        console.log(`   ${descriptor.name} · ${descriptor.effect} · version ${descriptor.version}`);
      if (!tools.mcp.length) {
        console.log(
          'No MCP servers yet. Add one, for example: nerv tools add files npx -y @modelcontextprotocol/server-filesystem ~/NERV-files',
        );
      }
      for (const s of tools.mcp) {
        if (s.off) {
          const kept = tools.grants.filter((g) => g.server === s.id).length;
          console.log(`${s.id} · ${serverLabel(s)} · off, not asked: nerv modules on ${s.id} · ${kept} grant(s) kept`);
          continue;
        }
        let list: McpTool[];
        try {
          list = await listOf(s.id);
        } catch (e) {
          console.log(
            `${s.id} · ${serverLabel(s)}\n   could not list its tools: ${e instanceof Error ? e.message : 'unknown error'}`,
          );
          continue;
        }
        console.log(`${s.id} · ${serverLabel(s)} · ${list.length} tool(s)`);
        for (const t of list) {
          const g = tools.grants.find((x) => x.server === s.id && x.tool === t.name);
          const fp = toolFingerprint(t);
          const state = !g
            ? 'not granted'
            : g.fingerprint !== fp
              ? 'SUSPENDED: changed since granted, grant it again'
              : `granted ${g.effect} · EVA-${g.eva}`;
          const hint =
            t.annotations?.destructiveHint === true
              ? ' · destructive'
              : t.annotations?.readOnlyHint === true
                ? ' · read-only'
                : '';
          console.log(
            `   ${toolName(s.id, t.name)}${hint} · ${state}\n      ${(t.description ?? '').split('\n')[0]!.slice(0, 140)}`,
          );
        }
      }
    } else if (sub === 'add') {
      const command = rest[0];
      if (!target || !command) throw new Error(usage);
      // F-123: a URL is a server already running elsewhere (a hub on the tailnet), reached over streamable HTTP.
      const remote = /^[a-z]+:\/\//i.test(command);
      if (remote && rest.length > 1) throw new Error(usage);
      const why = remote ? urlRefusal(command) : undefined;
      if (why) throw new Error(`MCP server ${target}: ${why}.`);
      saveTools(home, {
        ...tools,
        mcp: [
          ...tools.mcp.filter((x) => x.id !== target),
          remote ? { id: target, url: command } : { id: target, command, args: rest.slice(1) },
        ],
        // A server replaced under the same id keeps no grant made for the old one.
        grants: tools.grants.filter((g) => g.server !== target),
      });
      console.log(
        `MCP server ${target} added. Its tools are not offered to Misato until you grant them: nerv tools${remote ? '\nNothing is sent to it until NERV lists or calls its tools.' : ''}`,
      );
    } else if (sub === 'remove') {
      if (!target || !tools.mcp.some((x) => x.id === target)) throw new Error(usage);
      saveTools(home, {
        mcp: tools.mcp.filter((x) => x.id !== target),
        grants: tools.grants.filter((g) => g.server !== target),
      });
      console.log(`MCP server ${target} removed, with its grants.`);
    } else if (sub === 'grant' || sub === 'revoke') {
      const [server, tool] = (target ?? '').split('/');
      if (!server || !tool) throw new Error(usage);
      if (sub === 'revoke') {
        saveTools(home, { ...tools, grants: tools.grants.filter((g) => !(g.server === server && g.tool === tool)) });
        console.log(`${toolName(server, tool)} revoked: Misato no longer sees it.`);
      } else {
        const t = (await listOf(server)).find((x) => x.name === tool);
        if (!t) throw new Error(`${server} has no tool ${tool}: nerv tools lists them.`);
        // A change runs in EVA-01 (bounded) by default: EVA-00 is shadow work and refuses every outside effect.
        const effect = opt('effect', 'read'),
          eva = opt('eva', effect === 'read' ? '00' : '01');
        const srv = tools.mcp.find((x) => x.id === server)!;
        const no = grantRefusal(t, effect, eva, isHttpServer(srv));
        if (no) throw new Error(`${toolName(server, tool)} not granted: ${no}.`);
        saveTools(home, {
          ...tools,
          grants: [
            ...tools.grants.filter((g) => !(g.server === server && g.tool === tool)),
            { server, tool, effect: effect as Effect, eva: eva as Eva, fingerprint: toolFingerprint(t) },
          ],
        });
        // The Pattern the gate gives it with trusted context and no Scrolls of its own (untrusted input raises it).
        const pattern = patternOf(effect as Effect, 'trusted', toolName(server, tool), defaultPolicy);
        const how =
          pattern === 'green'
            ? 'Pattern Green'
            : pattern === 'orange'
              ? 'Pattern Orange: the MAGI vote on each call, Blue after untrusted input'
              : 'Pattern Blue: you approve each call on a card';
        console.log(
          `${toolName(server, tool)} granted as ${effect === 'read' ? 'a read' : effect} (${how}), EVA-${eva}${eva === '03' ? ': it will not run until EVAs exist' : ''}. Pinned to its current description: if the server changes it, the grant is suspended.`,
        );
      }
    } else throw new Error(usage);
  } else if (command === 'modules') {
    // F-159: one switch per MCP server and built-in pack. Off keeps grants and data; `tools remove` drops a server.
    const [sub, id] = args;
    const usage = 'Usage: modules | modules on NAME | modules off NAME';
    if (!sub) {
      const config = readConfig(home);
      const listing: ServerListing = [];
      for (const s of config.tools?.mcp ?? []) {
        if (s.off) continue;
        const c = connectMcp(s);
        try {
          await c.listTools();
          listing.push({ server: s.id });
        } catch (e) {
          listing.push({ server: s.id, error: e instanceof Error ? e.message : 'could not list its tools' });
        } finally {
          c.close();
        }
      }
      for (const m of listModules(config, builtinPackRegistry, listing)) {
        const reach = !m.on
          ? 'not asked while off'
          : m.reachable === false
            ? `not reachable: ${m.why ?? 'unknown'}`
            : 'reachable';
        console.log(`${m.name} (${m.id}) · ${m.on ? 'on' : 'off'} · ${reach} · ${m.tools} tool(s)`);
      }
    } else if ((sub === 'on' || sub === 'off') && id && args.length === 2) {
      const m = setModuleOn(home, id, sub === 'on');
      const grants = (readConfig(home).tools?.grants ?? []).filter((g) => m.servers.includes(g.server)).length;
      console.log(
        sub === 'off'
          ? `${m.name} is off: Misato is offered none of its tools, its dashboard cards hide and nothing calls it; its ${grants} grant(s) and its data are kept. Turn it back on: nerv modules on ${m.id}`
          : `${m.name} is on: its tools are offered again as granted, no new grant needed.`,
      );
    } else throw new Error(usage);
  } else if (command === 'pilots') {
    // F-045: the owner's permanent agents. Slice 1: they advise Misato before it plans, by domain keywords.
    const [sub, id, ...rest] = args;
    const config = readConfig(home);
    const roster = config.pilots ?? [];
    const opt = (name: string) => {
      const i = rest.indexOf('--' + name);
      return i >= 0 ? rest[i + 1] : undefined;
    };
    const find = () => {
      const p = roster.find((x) => x.id === id);
      if (!p) throw new Error(`No pilot ${id ?? ''}: nerv pilots lists them.`);
      return p;
    };
    const checkModel = async (model: string) => {
      const found = await detectOllama(setting('OLLAMA') ?? ollamaUrlOf(config.models));
      if (found.reachable && !found.models.some((m) => m.name === model))
        throw new Error(`Ollama has no model ${model}: ollama pull ${model} first, or pick one from nerv models.`);
    };
    const usage =
      'Usage: pilots | pilots generic MODEL|off | pilots add ID --name NAME --domain "WHAT IT KNOWS" --keywords a,b,c --model MODEL [--role ROLE] [--skills a,b] [--tools a,b] [--memory-scope SCOPE] [--eva-class eva-00|eva-01|eva-02|eva-03] [--stage prototype|test|production] [--parent ID] | pilots set ID [--name …] [--role …] [--domain …] [--keywords …] [--skills …] [--tools …] [--model …] [--memory-scope …] [--eva-class …] [--stage …] | pilots rename ID NAME | pilots pin|unpin|retire|restore ID';
    const list = (v: string | undefined) =>
      v === undefined
        ? undefined
        : v
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean);
    if (!sub) {
      console.log(describePilots(roster, config.models.roles?.consultant?.model ?? null));
    } else if (sub === 'generic') {
      // The generic pilot is the consultant role (F-025): `pilots generic MODEL|off` is `models set consultant MODEL|off`.
      if (!id) throw new Error('Usage: pilots generic MODEL | pilots generic off');
      const found = await detectOllama(setting('OLLAMA') ?? ollamaUrlOf(config.models));
      writeModels(
        home,
        planModels(
          config.models,
          { consultant: id === 'off' ? null : { model: id } },
          found.reachable ? found.models.map((m) => m.name) : undefined,
        ),
      );
      console.log(
        `Generic pilot ${id === 'off' ? 'off' : `on ${id}`}. ${await ctx.reloadIfRunning(home, config.port)}`,
      );
    } else if (sub === 'add') {
      if (!id || !opt('name') || !opt('domain') || !opt('keywords') || !opt('model')) throw new Error(usage);
      await checkModel(opt('model')!);
      savePilots(
        home,
        addPilot(roster, {
          id,
          name: opt('name')!,
          ...(opt('role') !== undefined ? { role: opt('role')! } : {}),
          domain: opt('domain')!,
          keywords: list(opt('keywords'))!,
          ...(opt('skills') !== undefined ? { skills: list(opt('skills'))! } : {}),
          ...(opt('tools') !== undefined ? { tools: list(opt('tools'))! } : {}),
          model: opt('model')!,
          ...(opt('memory-scope') !== undefined ? { memoryScope: opt('memory-scope')! } : {}),
          ...(opt('eva-class') !== undefined ? { evaClass: opt('eva-class') as EvaClass } : {}),
          stage: (opt('stage') ?? 'prototype') as Stage,
          parent: opt('parent') ?? 'generic',
        }),
      );
      console.log(`Pilot ${id} added (prototype unless set). It advises Misato on requests with its keywords.`);
    } else if (sub === 'rename') {
      const p = find();
      const newName = rest[0];
      if (!newName || newName.startsWith('--')) throw new Error('Usage: pilots rename ID NAME');
      savePilots(home, updatePilot(roster, p.id, { name: newName }));
      console.log(`Pilot ${p.id} renamed to ${newName.trim()}.`);
    } else if (sub === 'set') {
      const p = find();
      const model = opt('model');
      if (model) await checkModel(model);
      savePilots(
        home,
        updatePilot(roster, p.id, {
          ...(opt('name') ? { name: opt('name')! } : {}),
          ...(opt('role') !== undefined ? { role: opt('role')! } : {}),
          ...(opt('domain') ? { domain: opt('domain')! } : {}),
          ...(opt('keywords') ? { keywords: list(opt('keywords'))! } : {}),
          ...(opt('skills') !== undefined ? { skills: list(opt('skills'))! } : {}),
          ...(opt('tools') !== undefined ? { tools: list(opt('tools'))! } : {}),
          ...(model ? { model } : {}),
          ...(opt('memory-scope') !== undefined ? { memoryScope: opt('memory-scope')! } : {}),
          ...(opt('eva-class') !== undefined ? { evaClass: opt('eva-class') as EvaClass } : {}),
          ...(opt('stage') ? { stage: opt('stage') as Stage } : {}),
        }),
      );
      // F-054-T04: a move to a later stage is a promotion, kept for the chronicle (append-only; the config edit stays).
      const stage = opt('stage');
      let promoted = '';
      if (stage && STAGES.indexOf(stage as Stage) > STAGES.indexOf(p.stage)) {
        try {
          const s = new Store(databasePath(home), readScrolls(home), { home });
          try {
            recordPromotion(s.db, p, p.stage, stage, new Date().toISOString());
            promoted = ` Promoted from ${p.stage} to ${stage}: in the chronicle.`;
          } finally {
            s.db.close();
          }
        } catch {
          promoted = ' The promotion could not be recorded in the chronicle.';
        }
      }
      console.log(`Pilot ${p.id} changed.${promoted}`);
    } else if (['pin', 'unpin', 'retire', 'restore'].includes(sub)) {
      const p = find();
      const on = sub === 'pin' || sub === 'retire';
      const field = sub === 'pin' || sub === 'unpin' ? 'pinned' : 'retired';
      savePilots(home, setPilotFlag(roster, p.id, field, on));
      console.log(
        `Pilot ${p.id} ${sub === 'pin' ? 'pinned: chosen first when its keywords match' : sub === 'unpin' ? 'unpinned' : sub === 'retire' ? 'retired: never chosen, kept in the roster' : 'restored'}.`,
      );
    } else throw new Error(usage);
  } else if (command === 'models') {
    // F-038: see the routes and what Ollama has; pick Misato's and Casper's model; the cloud route on or off; its key.
    const [sub, a1, a2] = args;
    const config = readConfig(home);
    if (!sub) {
      const found = await detectOllama(setting('OLLAMA') ?? ollamaUrlOf(config.models));
      let key: boolean;
      try {
        key = !!readModelKey(home);
      } catch {
        key = false;
      }
      console.log(modelsReport(config.models, key, found));
    } else if (sub === 'key') {
      const value = (await ctx.readSecret('Claude API key (not shown): ')).trim();
      if (value.length < 20 || /\s/.test(value))
        throw new Error('That does not look like an API key: nothing was saved.');
      const file = join(home, 'anthropic-key');
      writeFileSync(file, value + '\n', { mode: 0o600 });
      chmodSync(file, 0o600);
      console.log(`Saved to ${file} (readable only by you). Turn the route on with: models cloud on`);
      console.log(await ctx.reloadIfRunning(home, config.port));
    } else {
      const change: ModelChange =
        sub === 'set' && a1 === 'misato' && a2 === 'cloud'
          ? { misato: { route: 'cloud', ...(args[3] ? { model: args[3] } : {}) } }
          : sub === 'set' && a1 === 'misato' && a2
            ? { misato: { route: 'local', model: a2 } }
            : sub === 'set' && a1 === 'casper' && a2
              ? { casper: { model: a2 } }
              : sub === 'set' && a1 === 'consultant' && a2
                ? { consultant: a2 === 'off' ? null : { model: a2 } }
                : sub === 'cloud' && (a1 === 'on' || a1 === 'off')
                  ? { cloud: { enabled: a1 === 'on', ...(a2 ? { model: a2 } : {}) } }
                  : (() => {
                      throw new Error(
                        'Usage: models | models set misato MODEL | models set misato cloud [MODEL] | models set casper MODEL | models set consultant MODEL|off | models cloud on|off [MODEL] | models key',
                      );
                    })();
      const found = await detectOllama(setting('OLLAMA') ?? ollamaUrlOf(config.models));
      writeModels(
        home,
        planModels(config.models, change, found.reachable ? found.models.map((m) => m.name) : undefined),
      );
      console.log(`Saved. ${await ctx.reloadIfRunning(home, config.port)}`);
    }
  } else if (command === 'seats') {
    const config = readConfig(home);
    const sub = args[0] ?? 'check';
    if (sub === 'key') {
      const id = args[1];
      if (!id) throw new Error('Usage: seats key <seat-id>');
      const entry = (config.seats ?? []).find((s) => s.id === id);
      if (!entry) throw new Error(`Unknown seat ${id}: configure it under seats in config.json first.`);
      const value = (await ctx.readSecret(`API key for seat ${id} (not shown): `)).trim();
      writeSeatKey(home, id, value);
      console.log(`Saved to ${seatKeyPath(home, id)} (readable only by you).`);
    } else if (sub === 'check' || sub === 'list') {
      const seats = config.seats ?? [];
      if (!seats.length) {
        console.log('No extra cloud seats configured.');
      } else {
        const pool = new SeatPool(seats, (id) => readSeatKey(home, id));
        const states = await pool.checkAll();
        for (const s of states) {
          console.log(`${s.id.padEnd(20)} ${s.provider}/${s.model}  ${s.status}${s.reason ? ` (${s.reason})` : ''}`);
        }
      }
    } else {
      throw new Error('Usage: seats [check | key <seat-id>]');
    }
  } else if (command === 'reload') {
    // The running brain re-reads config.json and anthropic-key; a broken file keeps the last working settings.
    const config = readConfig(home);
    const response = await fetch(`http://127.0.0.1:${config.port}/api/models/reload`, {
      method: 'POST',
      headers: { authorization: `Bearer ${readToken(home)}` },
    }).catch(() => {
      throw new Error('NERV Agency is not running: start it with serve or service start.');
    });
    const value = (await response.json()) as { error?: string; kept?: boolean; models?: unknown };
    if (!response.ok)
      throw new Error(
        `${value.error ?? 'Reload failed.'}${value.kept ? ' The previous model settings stay in use.' : ''}`,
      );
    console.log(JSON.stringify(value.models, null, 2));
  } else if (command === 'act') {
    // Through the running service, like ask: the gate, Casper and the executors live there.
    const [request, tool, json] = args;
    if (!request || !tool) throw new Error('Usage: act "what you want" TOOL [\'{"arg":"value"}\']');
    let toolArgs: unknown;
    try {
      toolArgs = JSON.parse(json ?? '{}');
    } catch {
      throw new Error('Tool arguments must be a JSON object.');
    }
    const config = readConfig(home);
    const response = await fetch(`http://127.0.0.1:${config.port}/api/actions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${readToken(home)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ request, tool, args: toolArgs }),
    }).catch(() => {
      throw new Error('NERV Agency is not running: start it with serve or service start.');
    });
    const value = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(value.error ?? 'Action failed.');
    console.log(JSON.stringify(value, null, 2));
  } else if (command === 'bom') {
    if (args.length) throw new Error('Usage: bom');
    const config = readConfig(home);
    const found = config.models.local
      ? await detectOllama(ollamaUrlOf(config.models))
      : { reachable: false, models: [] };
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    console.log(JSON.stringify(runtimeBom(config, found, pkg.version), null, 2));
  } else if (command === 'ask') {
    // Goes through the running service so only one brain and one scheduler exist. Local-only unless --cloud.
    const cloud = args[0] === '--cloud';
    const prompt = (cloud ? args.slice(1) : args).join(' ');
    if (!prompt) throw new Error('Usage: ask [--cloud] "text"');
    const config = readConfig(home);
    const response = await fetch(`http://127.0.0.1:${config.port}/api/ask`, {
      method: 'POST',
      headers: { authorization: `Bearer ${readToken(home)}`, 'content-type': 'application/json' },
      body: JSON.stringify(cloud ? { prompt, privacy: 'any', route: 'cloud' } : { prompt, privacy: 'local-only' }),
    }).catch(() => {
      throw new Error('NERV Agency is not running: start it with serve or service start.');
    });
    const value = (await response.json()) as {
      text?: string;
      route?: string;
      model?: string;
      truncated?: boolean;
      error?: string;
    };
    if (!response.ok) throw new Error(value.error ?? 'Ask failed.');
    console.log(value.text + (value.truncated ? '\n[reply truncated]' : '') + `\n— ${value.route} · ${value.model}`);
  } else if (command === 'update-policy') {
    // F-102-T02: the owner's switch for the scheduled automatic update (F-102-T01: 20:00 check, 03:00 apply unless
    // "aspetta"). Saved in config.json; a running `serve` reads it within a minute.
    const mode = args[0] ?? 'status';
    const config = readConfig(home);
    const current = config.updatePolicy ?? defaultAutoUpdatePolicy();
    if (mode === 'status') {
      console.log(JSON.stringify(current, null, 2));
    } else if (mode === 'on' || mode === 'off') {
      const channel = ctx.flag('--channel') ?? current.channels[0] ?? 'main';
      const target = ctx.flag('--target') ?? current.targets[0] ?? config.base.id;
      const next = setUpdatePolicy(home, {
        enabled: mode === 'on',
        channels: mode === 'on' ? [channel] : current.channels,
        targets: mode === 'on' ? [target] : current.targets,
        ...(mode === 'on' ? { acceptedAt: current.acceptedAt ?? new Date().toISOString() } : {}),
        ...(current.schedule ? { schedule: current.schedule } : {}),
      });
      const sched = next.schedule ?? DEFAULT_UPDATE_SCHEDULE;
      const hh = (h: number) => String(h).padStart(2, '0') + ':00';
      console.log(JSON.stringify(next, null, 2));
      console.log(
        mode === 'on'
          ? sched.mode === 'notify'
            ? `Automatic updates on for ${target} (${channel}): checked at ${hh(sched.checkHour)}; notify only, never applied automatically.`
            : `Automatic updates on for ${target} (${channel}): checked at ${hh(sched.checkHour)}, applied at ${hh(sched.applyHour)} unless you say "aspetta"; never between ${hh(sched.quietFrom)} and ${hh(sched.quietUntil)}.`
          : 'Automatic updates off; nothing is scheduled.',
      );
    } else {
      throw new Error('Usage: update-policy <on|off|status> [--channel main] [--target BASE-ID]');
    }
  } else {
    return false;
  }
  return true;
}
