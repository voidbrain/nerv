#!/usr/bin/env -S node --use-system-ca
import { tryRunCliCommand } from './cli-commands.ts';
import { runKajiCommand } from './cli-kaji.ts';
import { startSnapshots } from './snapshots.ts';

import { createPeerHandlers } from './peer-handlers.ts';
import { buildProjectReport, fetchIntoQuarantine } from './quarantine.ts';
import { runResumeEngineTick } from './resume-intent.ts';
import { createHeadlessResumeDeps, type HeadlessResumeTarget } from './headless-resume.ts';
import { runCardCopyRule, type CopyRule } from './storage-copy.ts';
import { sliceModelWithProfile, type SlicerProfile } from './slicer.ts';
import {
  buildHarnessPushProposal,
  runCodingJobInWorktree,
  runHarnessJobInWorktree,
  type AllowedCodingRepo,
} from './coding-job.ts';
import { DesktopRecordingSession, type DesktopRecordingHeader } from './desktop-recording.ts';
import { defaultAutoUpdatePolicy } from './update-policy.ts';
import { startAutoUpdateScheduler } from './update-scheduler.ts';
import { buildInfo, checkRevisionSkew, type BuildInfo } from './build.ts';
import type { UpdateControl } from './server-update.ts';
import { clickNamedControl } from './browser-control.ts';
import { createCdpBrowserDriver, createCdpPageReader } from './browser-cdp-driver.ts';
import { assertDiyfpvBuildLink, DIYFPV_BUILDER_ORIGIN, parseDiyfpvBuild } from './diyfpv-build.ts';
import { clickDesktopControl } from './desktop-control.ts';
import { desktopDriverFor } from './desktop-macos-driver.ts';

import { SeatPool } from './seat-pool.ts';

import { assertRootMigrationReady, rootMigrationCommand } from './root-migration.ts';
import { formatCommandHelp, formatHelp } from './cli-help.ts';
import { nodesCommand } from './nodes-cli.ts';
import { placementEvidence, placementReport } from './placement-report.ts';
import { backupCommand } from './backup-cli.ts';
import { storeReceived } from './offhost.ts';

import { checkUpdateAvailability } from './update-availability.ts';

import { spawnSync } from 'node:child_process';

import { join, resolve } from 'node:path';

import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Store } from './store.ts';
import type { ActionDetail, SortieSummary } from './ledger.ts';
import type { SortieEvent } from './events.ts';
import { makeServer } from './server.ts';
import {
  dataHome,
  databasePath,
  initialize,
  pinKajiRoot,
  readConfig,
  readScrolls,
  readSeatKey,
  readTelegramToken,
  readToken,
  setting,
  type Base,
  setUpdatePolicy,
} from './config.ts';

import { TelegramApi, TelegramChannel, telegramBase } from './telegram.ts';
import {
  chronicleDays,
  composeChronicle,
  composeEvaChronicle,
  gatherMilestones,
  retellChronicleDayWithPilot,
} from './chronicle.ts';
import { composeBrief, gatherBrief } from './brief.ts';
import { KajiLink } from './kaji-link.ts';
import {
  guardLocalService,
  linuxServiceHost,
  macServiceHost,
  windowsServiceHost,
  type ServiceHost,
  command as runCommand,
} from './node-lifecycle-execution.ts';
import { ROOT_KEY_FILE, baseKey, createRootKey, fingerprint } from './kaji.ts';
import { service } from './service.ts';
import { startUpdaterJob } from './updater-job.ts';
import { reportUpdaterResult } from './updater-result.ts';
import { serviceMove } from './install-move-cli.ts';
import { updateCommand } from './update-cli.ts';
import { initializeNativeTLS, loadNativeTLS, nativeAdmin, NativeAuth, type Invitation } from './native-auth.ts';
import { Runtime, type ChatReply } from './runtime.ts';

import { MODEL_TIMEOUT_MS } from './model.ts';
import { MAX_STEPS } from './misato.ts';
import { OLLAMA_URL, setupAtInit } from './model-setup.ts';
const [command, ...args] = process.argv.slice(2);
/** --base NERV-02 --name "Tabgha" (both, or neither). */
function baseFlags(list: string[]): Base | undefined {
  const at = (flag: string) => {
    const i = list.indexOf(flag);
    return i >= 0 ? list[i + 1] : undefined;
  };
  const id = at('--base'),
    name = at('--name');
  if (id === undefined && name === undefined) return undefined;
  if (!id || !name) throw new Error('Give both --base ID and --name "Name".');
  return { id: id.toUpperCase(), name };
}
/** A secret typed without echo (or one line from stdin with --passphrase-stdin, for scripts and tests). Never from argv or env. */
/** After a change: the running service re-reads its models in place; when it is not running, the change waits for its start. */
async function reloadIfRunning(homeDir: string, port: number): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/api/models/reload`, {
    method: 'POST',
    headers: { authorization: `Bearer ${readToken(homeDir)}` },
  }).catch(() => undefined);
  if (!response)
    return 'The NERV service is not running: the change applies when it starts. Start it with: nerv launch';
  const value = (await response.json()) as { error?: string; kept?: boolean };
  return response.ok
    ? 'The running service now uses it.'
    : `The running service refused it: ${value.error ?? 'reload failed'}${value.kept ? ' (it keeps the previous settings)' : ''}.`;
}
async function readSecret(prompt: string): Promise<string> {
  if (args.includes('--passphrase-stdin') || args.includes('--stdin')) {
    let data = '';
    for await (const chunk of process.stdin) data += chunk;
    return data.split(/\r?\n/)[0] ?? '';
  }
  if (!process.stdin.isTTY)
    throw new Error('A passphrase is needed: run this in a terminal (or pass --passphrase-stdin).');
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((done, fail) => {
    let value = '';
    const onData = (b: Buffer) => {
      for (const c of b.toString('utf8')) {
        if (c === '\r' || c === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off('data', onData);
          process.stdout.write('\n');
          done(value);
          return;
        }
        if (c === '\u0003') {
          process.stdin.setRawMode(false);
          process.stdout.write('\n');
          fail(new Error('Cancelled.'));
          return;
        }
        if (c === '\u007f' || c === '\b') value = value.slice(0, -1);
        else value += c;
      }
    };
    process.stdin.on('data', onData);
  });
}
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
/** Mints a one-use login code from the running service and opens (or prints) the page signed in. */
async function openPage(home: string, page: '/' | '/dashboard/', print: boolean) {
  const config = readConfig(home);
  const response = await fetch(`http://127.0.0.1:${config.port}/api/session/codes`, {
    method: 'POST',
    headers: { authorization: `Bearer ${readToken(home)}` },
  }).catch(() => {
    throw new Error('NERV Agency is not running: start it with serve, launch or service start.');
  });
  const value = (await response.json()) as { code?: string; error?: string };
  if (!response.ok || !value.code) throw new Error(value.error ?? 'Could not create a login code.');
  const url = `http://127.0.0.1:${config.port}${page}#code=${value.code}`;
  // Windows: `start` is a cmd built-in; its first quoted argument is a window title, hence the empty string.
  const [opener, openArgs] = print
    ? [undefined, []]
    : process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'linux'
        ? ['xdg-open', [url]]
        : process.platform === 'win32'
          ? ['cmd', ['/c', 'start', '', url]]
          : [undefined, []];
  if (opener) {
    const run = spawnSync(opener, openArgs, { stdio: 'ignore' });
    if (run.status !== 0) console.log(url);
  } else console.log(url);
}
let store: Store | undefined;
let running = false;
try {
  const home = dataHome();
  if (!['root-migration', 'nodes', 'help'].includes(command ?? 'help')) assertRootMigrationReady(home);
  if (
    !['nodes', 'help', 'backup'].includes(command ?? 'help') &&
    !(command === 'root-migration' && args[0] !== 'apply') &&
    !(command === 'service' && args[0] === 'status')
  )
    await guardLocalService(home, command === 'serve' || command === 'launch');
  if (command === 'root-migration') {
    console.log(JSON.stringify(await rootMigrationCommand(home, args), null, 2));
  } else if (command === 'backup') {
    await backupCommand(home, args, { readSecret, flag });
  } else if (command === 'nodes') {
    const result = await nodesCommand(args);
    console.log(JSON.stringify(result, null, 2));
    if (
      result &&
      typeof result === 'object' &&
      'state' in result &&
      !['completed', 'released', 'absent'].includes(String(result.state))
    )
      process.exitCode = 1;
  } else if (command === 'init') {
    initialize(home, baseFlags(args), args.includes('--fresh'));
    const b = readConfig(home).base;
    console.log(`NERV Agency configured: ${home} · base ${b.id} · ${b.name}\nAccess token: ${join(home, 'token')}`);
    console.log(
      args.includes('--no-model-setup')
        ? 'Automatic model setup skipped; model routes were left unchanged.'
        : await setupAtInit(home, readConfig(home).models, setting('OLLAMA') ?? OLLAMA_URL),
    );
  } else if (command === 'native-init') {
    initialize(home);
    initializeNativeTLS(home);
    console.log('Native TLS configured. Restart NERV Agency, then run pair.');
  } else if (command === 'placement') {
    const sub = args[0];
    const file = args[1];
    if (!['plan', 'run', 'report'].includes(sub ?? '') || !file || (sub === 'run' && !args.includes('--execute')))
      throw new Error(
        'Usage: nerv placement plan PROBE.json | nerv placement run PROBE.json --execute | nerv placement report EVIDENCE.json',
      );
    let probe: unknown;
    try {
      probe = JSON.parse(readFileSync(resolve(file), 'utf8'));
    } catch {
      throw new Error(`Placement ${sub === 'report' ? 'evidence' : 'probe'} must be a readable JSON file.`);
    }
    if (sub === 'report') console.log(JSON.stringify(placementReport(placementEvidence(probe)), null, 2));
    else {
      const config = readConfig(home);
      const response = await fetch(`http://127.0.0.1:${config.port}/api/placement/${sub}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${readToken(home)}`, 'content-type': 'application/json' },
        body: JSON.stringify(sub === 'run' ? { ...(probe as object), confirmExecute: true } : probe),
      }).catch(() => {
        throw new Error('NERV Agency is not running: start it with serve or service start.');
      });
      const value = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(value.error ?? 'Placement request failed.');
      console.log(JSON.stringify(value, null, 2));
    }
  } else if (['pair', 'clients', 'revoke'].includes(command ?? '')) {
    const config = readConfig(home);
    const path =
      command === 'pair'
        ? '/api/pairing/tickets'
        : command === 'clients'
          ? '/api/clients'
          : '/api/clients/' + encodeURIComponent(args[0] ?? '');
    const value = await nativeAdmin(
      home,
      config.nativePort ?? 4319,
      readToken(home),
      path,
      command === 'pair' ? 'POST' : command === 'revoke' ? 'DELETE' : 'GET',
      command === 'pair' ? { label: args[0] ?? 'NERV Agency Menu Bar' } : undefined,
    );
    if (command === 'pair') {
      const invitation = value as Invitation;
      console.log(
        'Private invitation (expires in 2 minutes; paste only into the NERV Agency companion):\n' +
          Buffer.from(JSON.stringify(invitation)).toString('base64url'),
      );
    } else console.log(JSON.stringify(value, null, 2));
  } else if (command === 'service' && args[0] === 'move') await serviceMove(args.slice(1), home);
  else if (command === 'update') await updateCommand(args, home);
  else if (command === 'service') service(args[0] ?? '', home);
  else if (await tryRunCliCommand(command, args, home, { readSecret, openPage, reloadIfRunning, flag })) {
    // Handled by cli-commands.ts
  } else if (!command || command === 'help') {
    const detail = args[0] ? formatCommandHelp(args[0]) : undefined;
    if (args[0] && !detail) throw new Error(`Unknown command: ${args[0]}. Run nerv help for the list.`);
    console.log(detail ?? formatHelp(Math.min(process.stdout.columns || 100, 100)));
  } else {
    const config = readConfig(home);
    const scrolls = readScrolls(home);
    if (command !== 'serve' && command !== 'launch') store = new Store(databasePath(home), scrolls, { home });
    const local = () => store!;
    switch (command) {
      case 'remind':
        console.log(JSON.stringify(local().add(args[0] ?? '', args[1] ?? ''), null, 2));
        break;
      case 'list':
        console.log(JSON.stringify(local().list(), null, 2));
        break;
      case 'cancel':
        if (!local().cancel(args[0] ?? '')) throw new Error('No pending reminder with that ID.');
        console.log('Cancelled.');
        break;
      case 'memory': {
        // The owner's direct control of Lilith: facts added here are active at once; every change keeps its history.
        const m = local().memory;
        const [sub, id, ...rest] = args;
        if (sub === 'list' || !sub) {
          const facts = m.list();
          console.log(
            facts.length
              ? facts
                  .map((f) => `${f.id.slice(0, 8)}  ${f.text}  (${f.source}${f.shareable ? ', shareable' : ''})`)
                  .join('\n')
              : 'No facts yet.',
          );
        } else if (sub === 'episodes') {
          const list = m.episodes();
          console.log(
            list.length
              ? list
                  .map(
                    (e) =>
                      `${e.until.slice(0, 16)}  ${e.exchanges} exchange(s), ${e.proposed} proposed  ${e.summary || '(nothing to consolidate)'}`,
                  )
                  .join('\n')
              : 'No episodes yet.',
          );
        } else if (sub === 'add') {
          const f = m.add([id, ...rest].join(' '), 'owner');
          console.log(`Remembered ${f.id.slice(0, 8)}: ${f.text}`);
        } else {
          const match = m.list(200).filter((f) => f.id.startsWith(id ?? '-'));
          if (match.length !== 1)
            throw new Error(
              match.length
                ? 'Several facts start with that id; give more of it.'
                : 'No active fact with that id (see memory list).',
            );
          const f = match[0]!;
          if (sub === 'forget') {
            m.forget(f.id, 'owner');
            console.log(`Forgot ${f.id.slice(0, 8)}.`);
          } else if (sub === 'edit') {
            const e = m.edit(f.id, rest.join(' '), 'owner');
            console.log(`Updated ${f.id.slice(0, 8)}: ${e?.text}`);
          } else if (sub === 'history')
            console.log(
              m
                .historyOf(f.id)
                .map((h) => `${h.created}  ${h.kind}  ${h.source}  ${h.text}`)
                .join('\n'),
            );
          else throw new Error('Usage: memory list | add "fact" | edit ID "fact" | forget ID | history ID | episodes');
        }
        break;
      }
      case 'key': {
        // key init [--out PATH]: creates the Key of Nebuchadnezzar on the owner's main base and pins its public half here.
        if (args[0] !== 'init') throw new Error('Usage: key init [--out PATH]');
        if (config.kaji?.root)
          throw new Error(
            'A root is already pinned and is never overwritten; use root-migration rather than key init to replace it.',
          );
        const out = flag('--out') ?? join(home, ROOT_KEY_FILE);
        if (existsSync(out)) throw new Error(`A key file already exists at ${out}; it is never overwritten.`);
        const pass = await readSecret('New passphrase for the Key of Nebuchadnezzar (12+ characters): ');
        if (!args.includes('--passphrase-stdin') && pass !== (await readSecret('Repeat it: ')))
          throw new Error('The two passphrases differ.');
        const key = createRootKey(pass);
        writeFileSync(out, key.file, { mode: 0o600 });
        chmodSync(out, 0o600);
        pinKajiRoot(home, key.publicKey);
        console.log(
          `Key of Nebuchadnezzar created: ${out}\nRoot fingerprint: ${fingerprint(key.publicKey)}\nKeep a second copy offline (for example on a USB stick) and the passphrase somewhere safe: without them no new base can be enrolled. It is never sent over the Kaji line.`,
        );
        break;
      }
      case 'workers': {
        if (args[0] === 'cancel') {
          const id = args[1] ?? '',
            owner = local().workerJobs.owner(id);
          if (!owner) throw new Error('No worker receipt with that ID.');
          console.log(
            JSON.stringify(
              local().cancelWorker(owner, id, flag('--reason') ?? 'Owner requested cancellation', 'cli'),
              null,
              2,
            ),
          );
        } else if (args[0] === 'cancel-outbox') {
          local().cancelWorkerOutbox(args[1] ?? '', flag('--reason') ?? 'Owner requested cancellation');
          console.log('Remote cancellation recorded; this does not prove the destination stopped.');
        } else if (args[0] === 'held') {
          console.log(
            JSON.stringify(local().heldWorkerOutbox(args[1] === undefined ? undefined : Number(args[1])), null, 2),
          );
        } else if (args[0] === 'retry-outbox' || args[0] === 'abandon-outbox') {
          if (!args[1]) throw new Error('A held request ID is required.');
          local().reconcileWorkerOutbox(
            args[1],
            args[0] === 'retry-outbox' ? 'retry' : 'abandon',
            flag('--reason') ?? '',
            args.includes('--confirmed-not-run'),
          );
          console.log('Legacy request reconciliation recorded.');
        } else if (args[0] === 'history') {
          console.log(
            JSON.stringify(local().workerJobs.history(args[1] === undefined ? undefined : Number(args[1])), null, 2),
          );
        } else if (args[0] === 'result') {
          console.log(
            JSON.stringify(
              local().workerJobs.receipt(args[1] ?? '') ?? { error: 'No worker receipt with that ID.' },
              null,
              2,
            ),
          );
        } else if (args[0] === 'pending') {
          const before = args[1] === undefined ? undefined : Number(args[1]);
          console.log(JSON.stringify(local().workerJobs.pending(before), null, 2));
        } else if (args[0] === 'release') {
          const reason = flag('--reason');
          if (!args[1] || !reason || !args.includes('--confirmed-stopped'))
            throw new Error('Use workers release ID --confirmed-stopped --reason "verified how it stopped".');
          local().releaseWorker(args[1], reason, true);
          console.log(
            'Resource released after owner confirmation. The old request will never be executed again; its effects were not assumed undone.',
          );
        } else
          throw new Error(
            'Use workers pending/history [BEFORE-FENCE], held [BEFORE-SEQUENCE], result ID, retry-outbox/abandon-outbox ID --reason TEXT, or workers release ID --confirmed-stopped --reason "evidence".',
          );
        break;
      }
      case 'kaji':
        await runKajiCommand(args, home, local(), config, { readSecret, flag });
        break;
      case 'brief':
        console.log(
          composeBrief({
            now: new Date(),
            timeZone: config.timeZone,
            language: config.language,
            base: config.base.name,
            ...(await gatherBrief(local(), new Date(Date.now() - 86_400_000))),
          }),
        );
        break;
      case 'chronicle': {
        // F-054: the Simple or Eva chronicle, from recorded milestones only; DAYS limits it to the last N days (default 30).
        const eva = args.includes('--eva');
        const pilotRetell = args.includes('--pilot');
        const dayArg = args.find((a) => a !== '--eva' && a !== '--pilot');
        const days = dayArg === undefined ? 30 : Number(dayArg);
        if (!Number.isSafeInteger(days) || days < 1 || days > 3660)
          throw new Error('Usage: chronicle [DAYS] [--eva] (1–3660)');
        const grouped = chronicleDays(
          gatherMilestones(local().db, config.kaji?.root),
          config.timeZone,
          new Date(Date.now() - days * 86_400_000),
        );
        if (eva && pilotRetell && grouped.length) {
          const retold = await Promise.all(
            grouped.map((d) =>
              retellChronicleDayWithPilot(d, async () => composeEvaChronicle([d], config.language), config.language),
            ),
          );
          console.log(retold.map((r) => r.text).join('\n\n'));
        } else {
          console.log((eva ? composeEvaChronicle : composeChronicle)(grouped, config.language));
        }
        break;
      }
      case 'tick':
        console.log(JSON.stringify({ delivered: local().tick() }));
        break;
      case 'inbox':
        console.log(JSON.stringify(local().inbox(), null, 2));
        break;
      case 'approvals':
        console.log(JSON.stringify(local().approvals(), null, 2));
        break;
      case 'approve':
      case 'reject':
        console.log(JSON.stringify(local().decide(args[0] ?? '', command, 'cli'), null, 2));
        break;
      case 'events':
        console.log(JSON.stringify(local().events(args[0] ?? ''), null, 2));
        break;
      case 'spear':
        console.log(JSON.stringify(local().spear(args[0] ?? '', args[1] ?? 'cli'), null, 2));
        break;
      case 'doctor': {
        let runningBuild: BuildInfo = buildInfo();
        try {
          const res = await fetch(`http://127.0.0.1:${config.port}/api/doctor`, {
            headers: { authorization: `Bearer ${readToken(home)}` },
            signal: AbortSignal.timeout(500),
          });
          if (res.ok) {
            const live = (await res.json()) as { build?: BuildInfo };
            if (live.build) runningBuild = live.build;
          }
        } catch {
          /* service not running locally: compare against local buildInfo */
        }
        console.log(
          JSON.stringify(
            {
              node: process.version,
              home,
              port: config.port,
              language: config.language,
              timeZone: config.timeZone,
              hostTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              build: runningBuild,
              revisionSkew: checkRevisionSkew(runningBuild),
              ...local().doctor(),
              update: await checkUpdateAvailability({ offline: true }),
              delivery: 'Durable local inbox; phone notifications not configured.',
              workers: {
                protocol: 1,
                unfinished: local().workerJobs.pending().length,
                legacyHeld: local().heldWorkerOutbox().length,
                counts: 'Up to 20 per page; workers pending/history/held show cursors.',
              },
            },
            null,
            2,
          ),
        );
        break;
      }
      case 'serve':
      case 'launch': {
        const webRoot = resolve(fileURLToPath(new URL('../dist/web/browser', import.meta.url)));
        if (!existsSync(join(webRoot, 'index.html'))) throw new Error('Frontend missing: run npm run build.');
        readToken(home);
        const nativeTLS = loadNativeTLS(home);
        const botToken = readTelegramToken(home);
        const nativeAuth = nativeTLS ? new NativeAuth(home) : undefined;
        const runtime = new Runtime(databasePath(home), undefined, home);
        try {
          await runtime.ready();
        } catch (e) {
          await runtime.close();
          nativeAuth?.close();
          throw e;
        }
        // Misato resumes after the owner decides, wherever the decision came from (F-033).
        runtime.startResumer();
        // Kaji line (F-036): this base's own key; the link starts once a root is pinned and listens only on the enrolled address.
        const own = baseKey(home);
        runtime.setBaseKey(own.publicKey, own.privateKey);
        let kaji: KajiLink | undefined;
        // Schedules are re-read every minute, so the owner can change them by chat or by hand without a restart.
        const live = () => {
          try {
            return readConfig(home);
          } catch {
            return config;
          }
        };
        // F-045: the pilot roster is read on every request, so `nerv pilots …` applies without a restart.
        runtime.setPilots(() => live().pilots ?? []);
        // Hyuga's brief goes into the inbox (F-028); every channel delivers it from there. The last brief Telegram sent before
        // the upgrade is read once, so the upgrade day does not get a second one.
        const sentBefore = (() => {
          try {
            return (JSON.parse(readFileSync(join(home, 'telegram-state.json'), 'utf8')) as { brief?: { at?: string } })
              .brief?.at;
          } catch {
            return undefined;
          }
        })();
        runtime.startBrief(() => {
          const c = live();
          return c.brief
            ? { at: c.brief.at, timeZone: c.timeZone, language: c.language, base: c.base.name }
            : undefined;
        }, sentBefore);
        runtime.startWatch();
        runtime.startRouteLog();
        // F-062-T02/T03/T06: one verified snapshot each night (owner's time zone), then encrypted copies to folders and peers.
        startSnapshots(
          home,
          () => databasePath(home),
          () => live().timeZone,
          undefined,
          undefined,
          () => live().backup,
          // F-062-T06: copies to peers go over the Kaji line once it is up; before that they wait.
          (peer, date, copy) =>
            kaji
              ? kaji.sendBackup(peer, date, copy)
              : Promise.reject(Object.assign(new Error('Kaji line not started'), { code: 'EUNREACHABLE' })),
        );
        runtime.startInstrumentality(() => {
          const c = live();
          return { ...(c.instrumentality ? { mode: c.instrumentality } : {}), timeZone: c.timeZone };
        });
        const localServiceHost = (): ServiceHost => {
          if (process.platform === 'win32') return windowsServiceHost(home);
          if (process.platform === 'linux') return linuxServiceHost(home);
          return macServiceHost(home);
        };
        let server: ReturnType<typeof makeServer>;
        let native: ReturnType<typeof makeServer> | undefined;
        let close: () => void = () => {};
        let updateControl: UpdateControl | undefined;
        try {
          server = makeServer(runtime, () => readToken(home), {
            webRoot,
            ...config,
            onStop: () => close(),
            lifecycleHost: localServiceHost,
            // B-113: dashboard sessions survive the restart an update makes (hashed, bound to the admin token).
            sessionFile: join(home, 'sessions.json'),
            // B-108: Update now and the scheduled apply hand the update to its own OS job outside this service.
            startUpdater: async (input) => {
              await startUpdaterJob(localServiceHost().context, input, async (program, args) => {
                const r = await runCommand(program, args);
                return { status: r.status, err: r.err };
              });
            },
            readUpdatePolicy: () => readConfig(home).updatePolicy ?? defaultAutoUpdatePolicy(),
            saveUpdatePolicy: (policy) => setUpdatePolicy(home, policy),
            exposeUpdateControl: (control) => {
              updateControl = control;
            },
          });
          native =
            nativeTLS && nativeAuth
              ? makeServer(runtime, () => readToken(home), {
                  ...config,
                  tls: nativeTLS,
                  native: {
                    auth: nativeAuth,
                    fingerprint: nativeTLS.fingerprint,
                    port: config.nativePort ?? 4319,
                    webPort: config.port,
                  },
                })
              : undefined;
        } catch (e) {
          await runtime.close();
          nativeAuth?.close();
          throw e;
        }
        const servers = native ? [server, native] : [server];
        let stopped = false;
        let aoba: TelegramChannel | undefined;
        runtime.setChannelState(() =>
          aoba ? aoba.channelState() : { mode: 'unavailable', checkedAt: new Date().toISOString() },
        );
        // F-102-T02: the scheduled automatic update (20:00 check, notice, 03:00 apply unless "aspetta"); the policy is
        // re-read every minute, so `nerv update-policy` and the dashboard switch apply without a restart.
        const control = updateControl;
        const updates = control
          ? startAutoUpdateScheduler({
              readPolicy: () => control.readPolicy(),
              check: (channel) => control.check(channel),
              evaluate: (input) => control.evaluate(input),
              notify: (message) => runtime.notice(message),
              settings: () => {
                const live = readConfig(home);
                return { timeZone: live.timeZone, language: live.language, target: live.base.id };
              },
              onError: (error) =>
                console.error(`Update scheduler: ${error instanceof Error ? error.message : String(error)}`),
            })
          : undefined;
        runtime.setUpdatePostpone((text) => updates?.scheduler.postpone(text));
        // B-108-T02: report the result the outside updater left (Update now, the scheduled apply, a terminal run): the
        // update restarts this service before the updater finishes, so look every 30 s, report once.
        const updaterReport = setInterval(() => {
          const live = readConfig(home);
          void reportUpdaterResult(
            home,
            (message) => runtime.notice(message),
            live.language === 'it' ? 'it' : 'en',
            live.timeZone,
          ).catch((error) =>
            console.error(`Updater result: ${error instanceof Error ? error.message : String(error)}`),
          );
        }, 30_000);
        updaterReport.unref();
        close = () => {
          if (stopped) return;
          stopped = true;
          updates?.stop();
          clearInterval(updaterReport);
          void aoba?.stop();
          void kaji?.stop();
          void Promise.all(
            servers.map(
              (s) =>
                new Promise<void>((done) => {
                  s.close(() => done());
                  s.closeIdleConnections();
                }),
            ),
          )
            .then(() => runtime.close())
            .finally(() => nativeAuth?.close());
        };
        runtime.nervous.child.once('exit', () => {
          if (!stopped) {
            console.error('Scheduler unavailable; shutting down for supervisor recovery.');
            process.exitCode = 1;
            close();
          }
        });
        for (const listener of servers)
          listener.on('error', (e) => {
            console.error(e.message);
            process.exitCode = 1;
            close();
          });
        if (native)
          await new Promise<void>((done, reject) => {
            native.once('error', reject);
            native.listen(config.nativePort ?? 4319, '127.0.0.1', done);
          }).catch((e) => {
            close();
            throw e;
          });
        // launch = serve, then open the live dashboard signed in once the server listens.
        server.listen(config.port, '127.0.0.1', () => {
          console.log(
            `NERV Agency ${config.base.id} · ${config.base.name}: http://127.0.0.1:${config.port} · ${config.language} · ${config.timeZone}`,
          );
          if (command === 'launch')
            void openPage(home, '/dashboard/', args.includes('--print')).catch((e) =>
              console.error(e instanceof Error ? e.message : 'Could not open the dashboard.'),
            );
        });
        running = true;
        // Aoba starts only when both the private bot token and the linked owner chat exist.
        if (botToken && config.telegram) {
          aoba = new TelegramChannel({
            api: new TelegramApi(() => readTelegramToken(home) ?? '', telegramBase()),
            store: runtime,
            chatId: config.telegram.chatId,
            statePath: join(home, 'telegram-state.json'),
            // F-036 phase 2: quiet while another base is the main one and online; relayed cards are decided where they were made.
            oneChannel: {
              destination: async () => {
                const m = await runtime.mainBase();
                return m && !m.self ? m.baseId : undefined;
              },
              quiet: async () => {
                const m = await runtime.mainBase();
                return !!m && !m.self && m.online;
              },
              relay: (text, cards) => (kaji ? kaji.relay({ text, cards }) : Promise.resolve(false)),
            },
            remote: {
              pendingApprovalIds: (baseId, ids) => {
                if (!kaji) throw new Error('The Kaji line is not running.');
                return kaji.pendingApprovalIds(baseId, ids);
              },
              decide: (baseId, approvalId, decision) => {
                if (!kaji) throw new Error('The Kaji line is not running.');
                return kaji.decide(baseId, approvalId, decision);
              },
            },
          });
          await aoba.start().then(
            () => console.log('Aoba (Telegram): configured; listener started.'),
            (e) => console.error(`Aoba (Telegram) did not start: ${e instanceof Error ? e.message : 'error'}.`),
          );
        } else if (botToken)
          console.log(
            'Aoba (Telegram): token found, no chat linked yet. Send /start to your bot, then run telegram link.',
          );
        // B-013: once the channels listen, close what the previous run left half done and tell the owner.
        void runtime.closeInterrupted().then((n) => {
          if (n) console.log(`Closed ${n} sortie(s) a restart had interrupted.`);
        });
        if (config.kaji?.root) {
          kaji = new KajiLink({
            trust: { root: config.kaji.root, required: config.kaji.rootBinding === true },
            worker: runtime.worker,
            baseId: config.base.id,
            key: own.privateKey,
            publicKey: own.publicKey,
            registry: runtime.kaji,
            health: () => runtime.baseHealth(),
            onHealth: (id, h) => runtime.notePeerHealth(id, h),
            onReachable: (id, peers) => runtime.notePeerReachable(id, peers),
            channel: () => runtime.channelState(),
            onChannel: (id, c) => runtime.notePeerChannel(id, c),
            onBackup: async (from, date, copy) => {
              try {
                return storeReceived(home, live().backup, from, date, copy);
              } catch (e) {
                const code = e && typeof e === 'object' && 'code' in e ? String(e.code) : 'unexpected error';
                console.error(`Backup copy from ${from} for ${date} was not stored (${code}).`);
                return 'refused';
              }
            },
            ...createPeerHandlers({
              base: config.base,
              getAoba: () => aoba,
              bases: () => runtime.bases(),
              decide: (approvalId, decision, source) => runtime.decide(approvalId, decision, source),
              chat: (message, conversation) => runtime.chat(message, conversation),
              sortie: (sortieId) => runtime.sortie(sortieId),
              events: (sortieId, after, limit) => runtime.events(sortieId, after, limit),
            }),
            onPendingApprovals: (ids) => runtime.pendingApprovalIds(ids),
            // Dispatch, on the main base: a request asked on another base, with its own conversation per base and channel.
            // Slice 3b, on the base asked: only actions this base offers, once per id, through this base's own gate.
            offers: () => {
              const base = live().kaji?.offers ?? [];
              return live().models.remote?.serve?.enabled && !base.includes('model.infer')
                ? [...base, 'model.infer']
                : base;
            },
            onOffers: (id, tools) => runtime.notePeerOffers(id, tools),
            pilots: () => runtime.offeredPilots(),
            onPilots: (id, pilots) => runtime.notePeerPilots(id, pilots),
            operator: () => runtime.ownOperatorEntry(),
            onOperator: (id, entry, bases) => runtime.notePeerOperator(id, entry, bases),
            // Phase 2, on the base asked: this base's Casper votes on the main base's action.
            onVerdict: (_from, ask) => runtime.peerVerdict(ask),
          });
          runtime.setLinkMetricsProvider(() => kaji?.linkMetrics() ?? []);
          if (kaji) {
            const link = kaji;
            runtime.setRemoteSortie(
              (baseId, sortieId) =>
                link.inspectSortie(baseId, sortieId) as Promise<{
                  base: { id: string; name: string };
                  sortie: SortieSummary & { detail: ActionDetail[] };
                  events: SortieEvent[];
                } | null>,
            );
          }
          // Phase 2, on the main base: every online base's Casper votes too, veto-only, shadow unless kaji seat BASE veto.
          if (kaji) runtime.usePeerSeats(kaji, () => live().kaji?.seats ?? {});
          if (config.seats?.length) runtime.useSeatPool(new SeatPool(config.seats, (id) => readSeatKey(home, id)));
          // Slice 3b, on the main base: actions queued by kaji.run go out over the line, each until it reached its base.
          if (kaji) {
            const link = kaji;
            if (link.workerLink) runtime.useWorkerLink(link.workerLink);
            runtime.startOutbox(
              (base, item, dispatching) => link.run(base, item, MODEL_TIMEOUT_MS * 2, dispatching),
              3000,
              (base, id, reason) => link.cancel(base, id, reason),
            );
          }
          // Dispatch, on the other bases: while the main base is online, requests go to its Misato (one planner, one memory).
          runtime.setDispatch(async (message, conversation, forwarding) => {
            const main = await runtime.mainBase();
            if (!main || main.self || !main.online || !kaji) return undefined;
            await forwarding({
              id: main.baseId,
              name: (await runtime.bases()).find((b) => b.baseId === main.baseId)?.name ?? main.baseId,
            });
            return (await kaji.chat(
              message,
              conversation && /^[a-z]{1,20}$/.test(conversation) ? conversation : undefined,
              MODEL_TIMEOUT_MS * MAX_STEPS * 2,
            )) as ChatReply | undefined;
          });
          void kaji.start();
        }
        process.once('SIGINT', close);
        process.once('SIGTERM', close);
        break;
      }
      case 'quarantine': {
        const sub = args[0];
        if ((sub !== 'fetch' && sub !== 'report') || !args[1]) {
          throw new Error('Usage: nerv quarantine <fetch|report> <url> [--kind repo|page]');
        }
        const kindIdx = args.indexOf('--kind');
        const kind = kindIdx >= 0 ? (args[kindIdx + 1] as 'repo' | 'page' | undefined) : undefined;
        const result = await fetchIntoQuarantine(args[1], kind ? { kind } : {});
        if (sub === 'report') {
          console.log(JSON.stringify(buildProjectReport(result), null, 2));
          break;
        }
        console.log(
          JSON.stringify(
            {
              target: result.target,
              kind: result.kind,
              tainted: result.tainted,
              files: result.files.map((f) => f.path),
            },
            null,
            2,
          ),
        );
        break;
      }
      case 'headless-resume': {
        if (!args[0]) throw new Error('Usage: nerv headless-resume <targets.json>');
        const entries = JSON.parse(readFileSync(resolve(args[0]), 'utf8')) as Array<[string, HeadlessResumeTarget]>;
        const store = new Store(databasePath(home), readScrolls(home), { home });
        try {
          const res = await runResumeEngineTick(
            store.resumeIntents,
            createHeadlessResumeDeps(new Map(entries), { owner: 'cli' }),
          );
          console.log(JSON.stringify(res, null, 2));
        } finally {
          store.close();
        }
        break;
      }
      case 'card-copy': {
        if (!args[0] || !args[1] || !args[2]) {
          throw new Error('Usage: nerv card-copy <mountRoot> <label> <rules.json>');
        }
        const rules = JSON.parse(readFileSync(resolve(args[2]), 'utf8')) as CopyRule[];
        console.log(JSON.stringify(runCardCopyRule(args[0], args[1], rules), null, 2));
        break;
      }
      case 'slice': {
        if (!args[0] || !args[1] || !args[2] || !args[3]) {
          throw new Error('Usage: nerv slice <input> <output.gcode.3mf> <profileName> <allowlist.json>');
        }
        const allowlist = JSON.parse(readFileSync(resolve(args[3]), 'utf8')) as SlicerProfile[];
        console.log(
          JSON.stringify(
            sliceModelWithProfile({ inputPath: args[0], outputPath: args[1], profileName: args[2] }, allowlist),
            null,
            2,
          ),
        );
        break;
      }
      case 'coding-job': {
        if (!args[0] || !args[1] || !args[2]) {
          throw new Error('Usage: nerv coding-job <repoId> <jobId> <allowlist.json>');
        }
        const allowlist = JSON.parse(readFileSync(resolve(args[2]), 'utf8')) as AllowedCodingRepo[];
        const res = await runCodingJobInWorktree(
          { repoId: args[0], jobId: args[1], prompt: args[3] ?? '' },
          allowlist,
          async () => ({
            testPassed: false,
            testSummary: 'No live coding-agent runner bound in CLI.',
            tokens: 0,
            costUsd: 0,
          }),
        );
        console.log(JSON.stringify(res, null, 2));
        break;
      }
      case 'harness-job': {
        if (!args[0] || !args[1] || !args[2] || !args[3] || !args[4]) {
          throw new Error('Usage: nerv harness-job <repoId> <jobId> <templateRepo> <templateTag> <allowlist.json>');
        }
        const allowlist = JSON.parse(readFileSync(resolve(args[4]), 'utf8')) as AllowedCodingRepo[];
        const res = await runHarnessJobInWorktree(
          { repoId: args[0], jobId: args[1], templateRepo: args[2], templateTag: args[3] },
          allowlist,
          async () => ({
            testPassed: false,
            testSummary: 'No live coding-agent runner bound in CLI.',
            tokens: 0,
            costUsd: 0,
          }),
        );
        const proposal = buildHarnessPushProposal(res, { baseBranch: 'main' });
        console.log(JSON.stringify({ result: res, proposal }, null, 2));
        break;
      }
      case 'desktop-record': {
        if (!args[0] || !args[1]) throw new Error('Usage: nerv desktop-record <id> <header.json>');
        const header = JSON.parse(readFileSync(resolve(args[1]), 'utf8')) as DesktopRecordingHeader;
        const session = new DesktopRecordingSession({
          id: args[0],
          permissions: { accessibilityGranted: false, inputMonitoringGranted: false },
          header,
        });
        console.log(JSON.stringify(session.stop(), null, 2));
        break;
      }
      case 'fpv-read-build': {
        const link = args.find((a) => !a.startsWith('--'));
        if (!link) throw new Error('Usage: nerv fpv-read-build <diyfpv.com build link>');
        assertDiyfpvBuildLink(link);
        const browser = config.browser;
        if (!browser?.allowedOrigins.includes(DIYFPV_BUILDER_ORIGIN)) {
          throw new Error(
            `Add "${DIYFPV_BUILDER_ORIGIN}" to browser.allowedOrigins in config.json and start the dedicated browser profile on browser.debugPort.`,
          );
        }
        const page = await createCdpPageReader({ port: browser.debugPort }).readPageTables(
          link,
          browser.allowedOrigins,
        );
        const build = parseDiyfpvBuild(page, link);
        console.log(JSON.stringify(local().fpvBuilds.importBuild(build), null, 2));
        break;
      }
      case 'browser-click': {
        const controlName = args.find((a) => !a.startsWith('--'));
        if (!controlName) throw new Error('Usage: nerv browser-click <control-name> [--approved]');
        const browser = readConfig(home).browser;
        if (!browser || browser.allowedOrigins.length === 0) {
          throw new Error(
            'No browser origins allowed. Add "browser": {"allowedOrigins": ["https://..."], "debugPort": 9222} to config.json and start the dedicated browser profile with that remote debugging port.',
          );
        }
        const res = await clickNamedControl(createCdpBrowserDriver({ port: browser.debugPort }), {
          controlName,
          allowedOrigins: browser.allowedOrigins,
          approved: args.includes('--approved'),
        });
        console.log(JSON.stringify(res, null, 2));
        break;
      }
      case 'desktop-click': {
        const positional = args.filter((a) => !a.startsWith('--'));
        if (!positional[0] || !positional[1]) {
          throw new Error('Usage: nerv desktop-click <app-name> <control-name> [--window=<title>] [--approved]');
        }
        const windowTitle = args.find((a) => a.startsWith('--window='))?.slice('--window='.length);
        const res = await clickDesktopControl(desktopDriverFor(process.platform), {
          appName: positional[0],
          ...(windowTitle ? { windowTitle } : {}),
          controlName: positional[1],
          approved: args.includes('--approved'),
        });
        console.log(JSON.stringify(res, null, 2));
        break;
      }
      case 'circuits': {
        const sub = args[0] ?? 'list';
        const store = new Store(databasePath(home), readScrolls(home), { home });
        try {
          if (sub === 'list') {
            console.log(JSON.stringify(store.circuits.list(), null, 2));
          } else if (sub === 'rearm' && args[1]) {
            console.log(JSON.stringify(store.circuits.rearm(args[1], 'owner'), null, 2));
          } else {
            throw new Error('Usage: nerv circuits list | nerv circuits rearm <channel>');
          }
        } finally {
          store.close();
        }
        break;
      }
      default:
        throw new Error('Unknown command. Run help.');
    }
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : 'Command failed.');
  process.exitCode = 1;
} finally {
  if (!running) store?.close();
}
