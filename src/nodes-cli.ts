import { writeFileSync, existsSync, openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  inventoryCandidates,
  sshCandidates,
  tailscaleCandidates,
  registryCandidates,
  parseNodeInput,
  mergeCandidates,
  nodeTarget,
  NODE_INVENTORY_BYTES,
  type NodeCandidate,
} from './node-discovery.ts';
import {
  inspectLocalNode,
  inspectNode,
  nodeBelowRequirement,
  runNodeCommand,
  type CommandRunner,
} from './node-inspection.ts';
import { fileURLToPath } from 'node:url';
import { bootstrapOperation } from './node-bootstrap-execution.ts';
import { lifecyclePlan, lifecycleRecovery } from './node-lifecycle.ts';
import {
  linuxServiceHost,
  macServiceHost,
  windowsServiceHost,
  planService,
  applyService,
  serviceReceipt,
  releaseObservedService,
} from './node-lifecycle-execution.ts';
import { dataHome, readConfig, readToken } from './config.ts';
import { rehearseUpgrade } from './upgrade-rehearsal.ts';
import { bootstrapPlan } from './node-bootstrap.ts';
import { checkUpdateAvailability } from './update-availability.ts';
import { activateManagedNodeRuntime, planNodeRuntime, recoverManagedNodeRuntime } from './node-runtime.ts';
const NODES_HELP =
  'nodes update-check [--channel main] [--offline] [--out FILE]; nodes lifecycle-inspect --action install|start|stop|update|uninstall [--revision FULL-SHA] [--out FILE]; nodes lifecycle-apply --plan FILE --confirm DIGEST; nodes lifecycle-status --digest DIGEST; nodes lifecycle-release --receipt FILE --evidence FILE (local Mac default profile only); nodes upgrade-rehearse --backup ABS-DIR [--out FILE] (the reader of this checkout on a private copy of a backup; review only, admits no upgrade); nodes lifecycle-plan --input FILE [--out FILE]; nodes lifecycle-recovery-check --receipt FILE --evidence FILE [--out FILE] (review only; no service or journal changes); nodes discover --inventory FILE | --ssh-config FILE | --tailscale FILE | --tailscale-live | --registry FILE --root-key PUBKEY; nodes inspect --local | --ssh HOST [--user USER] [--port PORT] [--out FILE]; nodes plan --inspection FILE --revision FULL-SHA --checkout ABS --home ABS --base ID --name NAME [--service | --additional-profile] [--out FILE]; nodes apply --plan FILE --confirm DIGEST; nodes status --plan FILE; nodes release --plan FILE --confirm DIGEST --confirmed-stopped --reason EVIDENCE';
function file(path: string): string {
  const fd = openSync(path, 'r');
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > NODE_INVENTORY_BYTES)
      throw Error('Node input must be a regular file up to 256 KiB.');
    const bytes = Buffer.alloc(NODE_INVENTORY_BYTES + 1);
    let size = 0,
      n = 0;
    while (size < bytes.length && (n = readSync(fd, bytes, size, bytes.length - size, null)) > 0) size += n;
    if (size > NODE_INVENTORY_BYTES) throw Error('Node input exceeds 256 KiB.');
    return bytes.subarray(0, size).toString('utf8');
  } finally {
    closeSync(fd);
  }
}
export async function nodesCommand(args: string[], runner: CommandRunner = runNodeCommand): Promise<unknown> {
  const [command, ...rest] = args,
    values = new Map<string, string>(),
    switches = new Set<string>();
  const schema: Record<string, { values: string[]; switches: string[] }> = {
    'update-check': { values: ['channel', 'out'], switches: ['offline'] },
    'node-runtime-plan': { values: ['node', 'home', 'source', 'target-version', 'out'], switches: [] },
    'node-runtime-activate': {
      values: ['home', 'source', 'binary', 'version', 'confirm-choice', 'out'],
      switches: [],
    },
    'node-runtime-recover': { values: ['home', 'out'], switches: [] },
    'lifecycle-inspect': { values: ['action', 'revision', 'out'], switches: [] },
    'lifecycle-apply': { values: ['plan', 'confirm', 'out'], switches: [] },
    'lifecycle-status': { values: ['digest', 'out'], switches: [] },
    'lifecycle-release': { values: ['receipt', 'evidence', 'out'], switches: [] },
    'lifecycle-plan': { values: ['input', 'out'], switches: [] },
    'upgrade-rehearse': { values: ['backup', 'out'], switches: [] },
    'lifecycle-recovery-check': { values: ['receipt', 'evidence', 'out'], switches: [] },
    discover: {
      values: ['inventory', 'ssh-config', 'tailscale', 'registry', 'root-key'],
      switches: ['tailscale-live'],
    },
    inspect: { values: ['ssh', 'user', 'port', 'out'], switches: ['local'] },
    plan: {
      values: ['inspection', 'revision', 'checkout', 'home', 'base', 'name', 'out'],
      switches: ['service', 'additional-profile'],
    },
    apply: { values: ['plan', 'confirm', 'out'], switches: [] },
    status: { values: ['plan', 'out'], switches: [] },
    release: { values: ['plan', 'confirm', 'reason', 'out'], switches: ['confirmed-stopped'] },
  };
  if (!command || command === 'help') return { usage: NODES_HELP, execution: 'none' };
  if (!schema[command]) throw Error(NODES_HELP);
  const allowed = schema[command]!;
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i]!.replace(/^--/, '');
    if (!rest[i]!.startsWith('--') || values.has(key) || switches.has(key))
      throw Error('Invalid or duplicate nodes option.');
    if (allowed.switches.includes(key)) switches.add(key);
    else if (allowed.values.includes(key) && rest[i + 1] && !rest[i + 1]!.startsWith('--')) values.set(key, rest[++i]!);
    else throw Error('Invalid nodes option: ' + key);
  }
  const required = (key: string) => {
    const value = values.get(key);
    if (!value) throw Error('Missing --' + key);
    return value;
  };
  if (values.has('out') && existsSync(values.get('out')!))
    throw Error('EEXIST: choose a new output file; nothing was inspected.');
  let result: unknown;
  if (['lifecycle-inspect', 'lifecycle-apply', 'lifecycle-status', 'lifecycle-release'].includes(command)) {
    const host =
      process.platform === 'win32'
        ? windowsServiceHost(dataHome())
        : process.platform === 'linux'
          ? linuxServiceHost(dataHome())
          : macServiceHost(dataHome());
    if (command === 'lifecycle-inspect')
      result = await planService(
        host,
        required('action') as 'install' | 'start' | 'stop' | 'update' | 'uninstall',
        values.get('revision'),
      );
    else if (command === 'lifecycle-apply')
      result = await applyService(host, parseNodeInput(file(required('plan'))), required('confirm'));
    else if (command === 'lifecycle-status') result = serviceReceipt(host, required('digest'));
    else
      result = await releaseObservedService(
        host,
        parseNodeInput(file(required('receipt'))),
        parseNodeInput(file(required('evidence'))),
      );
  } else if (command === 'node-runtime-plan') {
    const source = values.get('source') ?? resolve(fileURLToPath(new URL('..', import.meta.url)));
    const home = values.get('home') ?? dataHome();
    const nodePath = values.get('node') ?? process.execPath;
    result = await planNodeRuntime(
      {
        home,
        source,
        nodePath,
        ...(values.has('target-version') ? { targetVersion: values.get('target-version')! } : {}),
      },
      async (program, cmdArgs) => {
        try {
          const out = await runner({ program, args: cmdArgs, timeoutMs: 5000, maxBytes: 4096 });
          return { status: 0, out, err: '' };
        } catch (e) {
          return { status: 1, out: '', err: e instanceof Error ? e.message : 'Command failed.' };
        }
      },
    );
  } else if (command === 'node-runtime-activate') {
    const source = values.get('source') ?? resolve(fileURLToPath(new URL('..', import.meta.url)));
    const home = values.get('home') ?? dataHome();
    const confirmChoice = required('confirm-choice') as 'install-nerv-managed' | 'upgrade-nerv-managed';
    result = await activateManagedNodeRuntime(
      {
        home,
        source,
        candidateBinary: required('binary'),
        version: required('version'),
        confirmChoice,
      },
      async (program, cmdArgs) => {
        try {
          const out = await runner({ program, args: cmdArgs, timeoutMs: 5000, maxBytes: 4096 });
          return { status: 0, out, err: '' };
        } catch (e) {
          return { status: 1, out: '', err: e instanceof Error ? e.message : 'Command failed.' };
        }
      },
    );
  } else if (command === 'node-runtime-recover') {
    result = recoverManagedNodeRuntime(values.get('home') ?? dataHome());
  } else if (command === 'update-check') {
    let runningRevision: string | null = null;
    try {
      const home = dataHome();
      const config = readConfig(home);
      const token = readToken(home);
      const r = await fetch(`http://127.0.0.1:${config.port}/api/doctor`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(1500),
      });
      if (r.ok) {
        const body = (await r.json()) as { build?: { commit?: unknown } };
        if (typeof body.build?.commit === 'string') runningRevision = body.build.commit;
      }
    } catch {
      /* stopped or uninitialized profile: runningRevision stays null */
    }
    result = await checkUpdateAvailability({
      channel: values.get('channel'),
      offline: switches.has('offline'),
      runningRevision,
    });
  } else if (command === 'upgrade-rehearse') result = await rehearseUpgrade(required('backup'));
  else if (command === 'lifecycle-plan') result = lifecyclePlan(parseNodeInput(file(required('input'))));
  else if (command === 'lifecycle-recovery-check')
    result = {
      execution: 'none',
      decision: lifecycleRecovery(
        parseNodeInput(file(required('receipt'))),
        parseNodeInput(file(required('evidence'))),
      ),
    };
  else if (command === 'discover') {
    const sources: NodeCandidate[][] = [];
    if (values.has('inventory')) sources.push(inventoryCandidates(parseNodeInput(file(required('inventory')))));
    if (values.has('ssh-config')) sources.push(sshCandidates(file(required('ssh-config'))));
    if (values.has('tailscale')) sources.push(tailscaleCandidates(parseNodeInput(file(required('tailscale')))));
    if (switches.has('tailscale-live'))
      sources.push(
        tailscaleCandidates(
          parseNodeInput(
            await runner({
              program: 'tailscale',
              args: ['status', '--json'],
              timeoutMs: 5000,
              maxBytes: NODE_INVENTORY_BYTES,
            }),
          ),
        ),
      );
    if (values.has('registry'))
      sources.push(registryCandidates(parseNodeInput(file(required('registry'))), required('root-key')));
    else if (values.has('root-key')) throw Error('--root-key needs --registry.');
    if (!sources.length) throw Error('Select a discovery source; no network range is scanned automatically.');
    result = {
      version: 1,
      candidates: mergeCandidates(...sources),
      trust: 'Discovery does not enroll a host or establish reachability.',
    };
  } else if (command === 'inspect') {
    if (switches.has('local')) {
      if (values.has('ssh') || values.has('user') || values.has('port')) throw Error('Choose local or SSH inspection.');
      result = await inspectLocalNode(runner);
    } else
      result = await inspectNode(
        nodeTarget({
          host: required('ssh'),
          ...(values.has('user') ? { user: values.get('user') } : {}),
          port: values.has('port') ? Number(values.get('port')) : 22,
        }),
        runner,
      );
  } else if (command === 'plan') {
    const revision = required('revision');
    if (!/^[a-f0-9]{40}$/.test(revision)) throw Error('Pin the full 40-character NERV commit ID.');
    let declaration: unknown;
    try {
      declaration = parseNodeInput(
        await runner({
          program: 'git',
          args: ['-C', fileURLToPath(new URL('..', import.meta.url)), 'show', revision + ':shared/node-bootstrap.json'],
          timeoutMs: 5000,
          maxBytes: 16384,
        }),
      );
    } catch {
      throw Error(
        'Pinned source must declare bootstrap protocol 1; select a compatible NERV commit available in this source checkout.',
      );
    }
    if (
      !declaration ||
      typeof declaration !== 'object' ||
      Array.isArray(declaration) ||
      (declaration as Record<string, unknown>).version !== 1 ||
      (declaration as Record<string, unknown>).initNoModelSetup !== true ||
      (declaration as Record<string, unknown>).freshInit !== true
    )
      throw Error('Pinned source does not support model-free bootstrap protocol 1.');
    result = bootstrapPlan(parseNodeInput(file(required('inspection'))), {
      sourceProtocol: 1,
      additionalProfile: switches.has('additional-profile'),
      revision,
      checkout: required('checkout'),
      home: required('home'),
      base: { id: required('base'), name: required('name') },
      installService: switches.has('service'),
    });
  }
  if (['apply', 'status', 'release'].includes(command))
    result = await bootstrapOperation(
      parseNodeInput(file(required('plan'))),
      command as 'apply' | 'status' | 'release',
      {
        confirm: values.get('confirm'),
        reason: values.get('reason'),
        confirmedStopped: switches.has('confirmed-stopped'),
      },
      runner,
    );
  // B-063: an inspection with a Node.js older than engines.node is saved as evidence, then the command fails.
  const tooOld = command === 'inspect' ? nodeBelowRequirement((result as { node: string }).node) : undefined;
  if (values.has('out')) {
    writeFileSync(required('out'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    if (tooOld) throw Error(`${tooOld} The inspection was saved to ${required('out')}; no installation was requested.`);
    return {
      saved: required('out'),
      execution:
        command === 'lifecycle-apply'
          ? 'performed-or-cached'
          : command === 'lifecycle-release'
            ? 'journal-reconciliation'
            : command === 'upgrade-rehearse'
              ? 'rehearsal-only'
              : 'none',
    };
  }
  if (tooOld) throw Error(`${tooOld} No installation was requested.`);
  return result;
}
