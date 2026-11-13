import { createHash } from 'node:crypto';
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, posix, win32 } from 'node:path';
import { validateEngineUrl, type EngineKind, type EngineLocality } from './engine-provider.ts';

/**
 * Optional start-at-login or on-demand lifecycle management for explicitly
 * selected, NERV-owned local inference engines. Never modifies unowned/external
 * installations, system-wide services, or NERV's own agent service.
 */

export type EngineOwnership = 'owned' | 'external';
export type EngineManagementMode = 'none' | 'on-demand' | 'start-at-login';
export type EngineLifecycleAction = 'install' | 'uninstall' | 'start' | 'stop' | 'status';
export type EnginePlatform = 'darwin' | 'linux' | 'win32';

export interface ManagedEngineSpec {
  id: string;
  provider: EngineKind;
  locality: EngineLocality;
  ownership: EngineOwnership;
  mode: EngineManagementMode;
  selected: boolean;
  baseUrl: string;
  executable: string;
  args?: readonly string[];
  workingDirectory?: string;
  env?: Readonly<Record<string, string>>;
  label?: string;
}

export interface EngineRuntimeReceipt {
  schemaVersion: 1;
  engineId: string;
  ownership: 'owned';
  mode: 'on-demand' | 'start-at-login';
  pid?: number;
  executable: string;
  baseUrl: string;
  startedAt: string;
  uncertain?: boolean;
  uncertainReason?: string;
}

export interface EngineStateSnapshot {
  receipt: EngineRuntimeReceipt | null;
  endpointReachable: boolean;
  pidAlive: boolean;
  serviceInstalled: boolean;
}

export interface EngineLifecyclePlan {
  ok: boolean;
  digest: string;
  engineId: string;
  action: EngineLifecycleAction;
  mode: EngineManagementMode;
  platform: EnginePlatform;
  refusals: string[];
  serviceLabel?: string;
  servicePath?: string;
  serviceDefinition?: string;
  receiptPath: string;
  command?: { executable: string; args: string[]; cwd: string; env?: Record<string, string> };
}

export interface EngineLifecycleOutcome {
  ok: boolean;
  status: 'applied' | 'refused' | 'uncertain' | 'observed';
  engineId: string;
  action: EngineLifecycleAction;
  digest: string;
  running: boolean;
  pid?: number;
  message: string;
  receipt: EngineRuntimeReceipt | null;
}

export interface EngineLifecycleDeps {
  spawn?: (executable: string, args: string[], cwd: string, env?: Record<string, string>) => Promise<{ pid: number }>;
  isAlive?: (pid: number) => boolean;
  kill?: (pid: number, signal?: NodeJS.Signals) => Promise<void>;
  probe?: (baseUrl: string) => Promise<boolean>;
  writeFile?: (path: string, content: string, mode?: number) => void;
  removeFile?: (path: string) => void;
  runServiceCommand?: (command: string, args: string[]) => Promise<{ ok: boolean; output: string }>;
  readReceipt?: (path: string) => EngineRuntimeReceipt | null;
  writeReceipt?: (path: string, receipt: EngineRuntimeReceipt) => void;
  removeReceipt?: (path: string) => void;
  now?: () => string;
}

const ID_RE = /^[a-zA-Z0-9._-]+$/;
const NERV_RESERVED_LABELS = new Set(['io.nerv.agent', 'io.nodo.agent', 'nerv.service', 'nodo.service', 'NERV Agency']);
const SAFE_ENV_KEY_RE = /^[A-Z0-9_]+$/;

const xml = (s: string) =>
  s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);

const systemdQuote = (s: string, command = false) =>
  '"' + s.replace(/[%\\"$]/g, (c) => (c === '%' ? '%%' : c === '$' ? (command ? '$$' : '$') : '\\' + c)) + '"';

function checkNoControlChars(value: string, field: string): void {
  if (/[\r\n\0]/.test(value)) {
    throw new Error(`Invalid ${field}: contains control characters.`);
  }
}

export function engineServiceIdentity(
  platform: EnginePlatform,
  home: string,
  engineId: string,
): { label: string; path: string } {
  if (!ID_RE.test(engineId)) {
    throw new Error(`Invalid engine id: ${engineId}`);
  }
  const slug = engineId.toLowerCase();
  if (platform === 'darwin') {
    const label = `io.nerv.engine.${slug}`;
    return {
      label,
      path: posix.join(home, 'Library', 'LaunchAgents', `${label}.plist`),
    };
  }
  if (platform === 'linux') {
    const label = `nerv-engine-${slug}.service`;
    return {
      label,
      path: posix.join(home, '.config', 'systemd', 'user', label),
    };
  }
  const label = `NERV Engine (${engineId})`;
  return {
    label,
    path: win32.join(home, 'engines', slug, 'task.xml'),
  };
}

export function engineReceiptPath(platform: EnginePlatform, nervHome: string, engineId: string): string {
  const joiner = platform === 'win32' ? win32.join : posix.join;
  return joiner(nervHome, 'engines', engineId, 'runtime.json');
}

function validateSpec(spec: ManagedEngineSpec): string[] {
  const refusals: string[] = [];
  if (!spec.id || !ID_RE.test(spec.id)) {
    refusals.push('Invalid engine id.');
  }
  if (!spec.selected) {
    refusals.push(`Engine "${spec.id}" is not explicitly selected for management.`);
  }
  if (spec.ownership !== 'owned') {
    refusals.push(`Engine "${spec.id}" is not NERV-owned (ownership=${spec.ownership}); refusing to modify it.`);
  }
  if (spec.locality !== 'local') {
    refusals.push(`Engine "${spec.id}" is remote; only local owned engines can be managed.`);
  }
  if (spec.mode === 'none') {
    refusals.push(`Engine "${spec.id}" management mode is "none".`);
  }
  try {
    validateEngineUrl(spec.baseUrl, 'local', false);
  } catch (error) {
    refusals.push(error instanceof Error ? error.message : String(error));
  }
  if (!spec.executable || (!isAbsolute(spec.executable) && !win32.isAbsolute(spec.executable))) {
    refusals.push(`Engine "${spec.id}" executable must be an absolute path.`);
  } else {
    try {
      checkNoControlChars(spec.executable, 'executable');
    } catch (error) {
      refusals.push(error instanceof Error ? error.message : String(error));
    }
  }
  for (const arg of spec.args ?? []) {
    try {
      checkNoControlChars(arg, 'arg');
    } catch (error) {
      refusals.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (spec.workingDirectory) {
    try {
      checkNoControlChars(spec.workingDirectory, 'workingDirectory');
    } catch (error) {
      refusals.push(error instanceof Error ? error.message : String(error));
    }
  }
  for (const [k, v] of Object.entries(spec.env ?? {})) {
    if (!SAFE_ENV_KEY_RE.test(k)) {
      refusals.push(`Invalid environment variable name: ${k}`);
    }
    if (/[\r\n\0]/.test(v)) {
      refusals.push(`Invalid environment value for ${k}`);
    }
  }
  return refusals;
}

export function renderEngineService(platform: EnginePlatform, nervHome: string, spec: ManagedEngineSpec): string {
  const identity = engineServiceIdentity(platform, nervHome, spec.id);
  if (NERV_RESERVED_LABELS.has(identity.label)) {
    throw new Error(`Engine service label collides with reserved NERV service: ${identity.label}`);
  }
  const joiner = platform === 'win32' ? win32.join : posix.join;
  const cwd = spec.workingDirectory ?? dirname(spec.executable);
  const args = [...(spec.args ?? [])];
  const envEntries = Object.entries(spec.env ?? {});

  if (platform === 'darwin') {
    const envXml = envEntries.length
      ? `<key>EnvironmentVariables</key><dict>${envEntries.map(([k, v]) => `<key>${xml(k)}</key><string>${xml(v)}</string>`).join('')}</dict>\n`
      : '';
    const argsXml = [spec.executable, ...args].map((a) => `<string>${xml(a)}</string>`).join('');
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xml(identity.label)}</string>
<key>ProgramArguments</key><array>${argsXml}</array>
<key>WorkingDirectory</key><string>${xml(cwd)}</string>
${envXml}<key>Umask</key><integer>63</integer>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>${xml(joiner(nervHome, 'engines', spec.id, 'service.log'))}</string>
<key>StandardErrorPath</key><string>${xml(joiner(nervHome, 'engines', spec.id, 'service-error.log'))}</string>
</dict></plist>\n`;
  }

  if (platform === 'linux') {
    const envLines = envEntries.map(([k, v]) => `Environment=${systemdQuote(`${k}=${v}`)}\n`).join('');
    const execArgs = [spec.executable, ...args].map((a) => systemdQuote(a, true)).join(' ');
    return `[Unit]
Description=NERV owned local engine (${spec.id})
[Service]
Type=simple
WorkingDirectory=${cwd.replace(/%/g, '%%')}
${envLines}ExecStart=${execArgs}
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
[Install]
WantedBy=default.target
`;
  }

  const argStr = args.map((a) => systemdQuote(a)).join(' ');
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers><LogonTrigger><Enabled>true</Enabled></LogonTrigger></Triggers>
  <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><ExecutionTimeLimit>PT0S</ExecutionTimeLimit></Settings>
  <Actions Context="Author"><Exec><Command>${xml(spec.executable)}</Command>${argStr ? `<Arguments>${xml(argStr)}</Arguments>` : ''}<WorkingDirectory>${xml(cwd)}</WorkingDirectory></Exec></Actions>
</Task>\n`;
}

export function planEngineLifecycle(
  spec: ManagedEngineSpec,
  action: EngineLifecycleAction,
  platform: EnginePlatform,
  nervHome: string,
  state: EngineStateSnapshot,
  userHome: string = nervHome,
): EngineLifecyclePlan {
  const receiptPath = engineReceiptPath(platform, nervHome, spec.id);
  const refusals = action === 'status' ? [] : validateSpec(spec);

  if (action !== 'status' && state.receipt?.uncertain) {
    refusals.push(
      `Engine "${spec.id}" has an uncertain previous outcome (${state.receipt.uncertainReason ?? 'unknown'}); reconcile before mutating.`,
    );
  }

  if (action === 'install' || action === 'uninstall') {
    if (spec.mode !== 'start-at-login') {
      refusals.push(`Action "${action}" requires mode "start-at-login" (current mode: "${spec.mode}").`);
    }
  }

  if (action === 'start' && spec.mode === 'on-demand') {
    if (state.receipt?.pid && state.pidAlive) {
      refusals.push(`Engine "${spec.id}" is already running (pid ${state.receipt.pid}).`);
    } else if (state.endpointReachable && (!state.receipt?.pid || !state.pidAlive)) {
      refusals.push(
        `Endpoint ${spec.baseUrl} is already reachable without an owned runtime receipt; refusing to hijack an unowned listener.`,
      );
    }
  }

  if (action === 'stop' && spec.mode === 'on-demand') {
    if (!state.receipt || state.receipt.ownership !== 'owned' || !state.receipt.pid) {
      refusals.push(`Engine "${spec.id}" has no owned runtime receipt; refusing to stop an unowned process.`);
    }
  }

  let serviceLabel: string | undefined;
  let servicePath: string | undefined;
  let serviceDefinition: string | undefined;
  if (
    spec.mode === 'start-at-login' &&
    refusals.length === 0 &&
    (action === 'install' || action === 'uninstall' || action === 'start' || action === 'stop')
  ) {
    const identity = engineServiceIdentity(platform, userHome, spec.id);
    serviceLabel = identity.label;
    servicePath = identity.path;
    if (action === 'install') {
      serviceDefinition = renderEngineService(platform, nervHome, spec);
    }
  }

  const command =
    spec.mode === 'on-demand' && action === 'start' && refusals.length === 0
      ? {
          executable: spec.executable,
          args: [...(spec.args ?? [])],
          cwd: spec.workingDirectory ?? dirname(spec.executable),
          ...(spec.env ? { env: { ...spec.env } } : {}),
        }
      : undefined;

  const digestInput = JSON.stringify({
    engineId: spec.id,
    action,
    mode: spec.mode,
    platform,
    baseUrl: spec.baseUrl,
    serviceLabel,
    servicePath,
    command,
    refusals,
  });
  const digest = createHash('sha256').update(digestInput).digest('hex');

  return {
    ok: refusals.length === 0,
    digest,
    engineId: spec.id,
    action,
    mode: spec.mode,
    platform,
    refusals,
    ...(serviceLabel ? { serviceLabel } : {}),
    ...(servicePath ? { servicePath } : {}),
    ...(serviceDefinition ? { serviceDefinition } : {}),
    receiptPath,
    ...(command ? { command } : {}),
  };
}

function defaultReadReceipt(path: string): EngineRuntimeReceipt | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as EngineRuntimeReceipt;
  } catch {
    return null;
  }
}

function defaultWriteReceipt(path: string, receipt: EngineRuntimeReceipt): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
}

function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function defaultKill(pid: number, signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
  process.kill(pid, signal);
}

async function defaultSpawn(
  executable: string,
  args: string[],
  cwd: string,
  env?: Record<string, string>,
): Promise<{ pid: number }> {
  const child: ChildProcess = nodeSpawn(executable, args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    detached: true,
    stdio: 'ignore',
  });
  if (!child.pid) {
    throw new Error('Failed to spawn owned local engine process.');
  }
  child.unref();
  return { pid: child.pid };
}

export async function executeEngineLifecycle(
  plan: EngineLifecyclePlan,
  spec: ManagedEngineSpec,
  deps: EngineLifecycleDeps = {},
): Promise<EngineLifecycleOutcome> {
  const readReceipt = deps.readReceipt ?? defaultReadReceipt;
  const writeReceipt = deps.writeReceipt ?? defaultWriteReceipt;
  const removeReceipt =
    deps.removeReceipt ??
    ((p: string) => {
      if (existsSync(p)) unlinkSync(p);
    });
  const isAlive = deps.isAlive ?? defaultIsAlive;
  const kill = deps.kill ?? defaultKill;
  const spawn = deps.spawn ?? defaultSpawn;
  const probe = deps.probe ?? (async () => false);
  const writeFile =
    deps.writeFile ??
    ((p: string, content: string, mode = 0o600) => {
      mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
      writeFileSync(p, content, { mode });
    });
  const removeFile =
    deps.removeFile ??
    ((p: string) => {
      if (existsSync(p)) unlinkSync(p);
    });
  const now = deps.now ?? (() => new Date().toISOString());

  if (!plan.ok) {
    return {
      ok: false,
      status: 'refused',
      engineId: plan.engineId,
      action: plan.action,
      digest: plan.digest,
      running: false,
      message: plan.refusals.join(' '),
      receipt: readReceipt(plan.receiptPath),
    };
  }

  if (plan.action === 'status') {
    const receipt = readReceipt(plan.receiptPath);
    const pidAlive = receipt?.pid ? isAlive(receipt.pid) : false;
    const reachable = await probe(spec.baseUrl);
    return {
      ok: true,
      status: 'observed',
      engineId: plan.engineId,
      action: 'status',
      digest: plan.digest,
      running: pidAlive || reachable,
      ...(receipt?.pid && pidAlive ? { pid: receipt.pid } : {}),
      message: receipt?.uncertain
        ? `Uncertain state: ${receipt.uncertainReason ?? 'reconcile required'}`
        : pidAlive || reachable
          ? `Engine "${plan.engineId}" is running.`
          : `Engine "${plan.engineId}" is stopped.`,
      receipt,
    };
  }

  if (plan.mode === 'on-demand') {
    if (plan.action === 'start' && plan.command) {
      const spawned = await spawn(plan.command.executable, plan.command.args, plan.command.cwd, plan.command.env);
      const receipt: EngineRuntimeReceipt = {
        schemaVersion: 1,
        engineId: plan.engineId,
        ownership: 'owned',
        mode: 'on-demand',
        pid: spawned.pid,
        executable: plan.command.executable,
        baseUrl: spec.baseUrl,
        startedAt: now(),
      };
      writeReceipt(plan.receiptPath, receipt);
      return {
        ok: true,
        status: 'applied',
        engineId: plan.engineId,
        action: 'start',
        digest: plan.digest,
        running: true,
        pid: spawned.pid,
        message: `Started owned local engine "${plan.engineId}" (pid ${spawned.pid}).`,
        receipt,
      };
    }

    if (plan.action === 'stop') {
      const receipt = readReceipt(plan.receiptPath);
      if (!receipt?.pid) {
        return {
          ok: false,
          status: 'refused',
          engineId: plan.engineId,
          action: 'stop',
          digest: plan.digest,
          running: false,
          message: `No owned runtime receipt for "${plan.engineId}".`,
          receipt,
        };
      }
      if (!isAlive(receipt.pid)) {
        removeReceipt(plan.receiptPath);
        return {
          ok: true,
          status: 'applied',
          engineId: plan.engineId,
          action: 'stop',
          digest: plan.digest,
          running: false,
          message: `Owned engine "${plan.engineId}" (pid ${receipt.pid}) was already stopped; cleared receipt.`,
          receipt: null,
        };
      }
      try {
        await kill(receipt.pid, 'SIGTERM');
      } catch (error) {
        const uncertain: EngineRuntimeReceipt = {
          ...receipt,
          uncertain: true,
          uncertainReason: error instanceof Error ? error.message : String(error),
        };
        writeReceipt(plan.receiptPath, uncertain);
        return {
          ok: false,
          status: 'uncertain',
          engineId: plan.engineId,
          action: 'stop',
          digest: plan.digest,
          running: isAlive(receipt.pid),
          pid: receipt.pid,
          message: `Stop signal failed for "${plan.engineId}": ${uncertain.uncertainReason}`,
          receipt: uncertain,
        };
      }
      removeReceipt(plan.receiptPath);
      return {
        ok: true,
        status: 'applied',
        engineId: plan.engineId,
        action: 'stop',
        digest: plan.digest,
        running: false,
        message: `Stopped owned local engine "${plan.engineId}" (pid ${receipt.pid}).`,
        receipt: null,
      };
    }
  }

  if (plan.mode === 'start-at-login' && plan.servicePath && plan.serviceLabel) {
    const runServiceCommand = deps.runServiceCommand;
    if (plan.action === 'install' && plan.serviceDefinition) {
      writeFile(plan.servicePath, plan.serviceDefinition, 0o600);
      if (runServiceCommand) {
        const cmd =
          plan.platform === 'darwin'
            ? { bin: 'launchctl', args: ['load', '-w', plan.servicePath] }
            : plan.platform === 'linux'
              ? { bin: 'systemctl', args: ['--user', 'enable', '--now', plan.serviceLabel] }
              : { bin: 'schtasks', args: ['/Create', '/TN', plan.serviceLabel, '/XML', plan.servicePath, '/F'] };
        const res = await runServiceCommand(cmd.bin, cmd.args);
        if (!res.ok) {
          const uncertain: EngineRuntimeReceipt = {
            schemaVersion: 1,
            engineId: plan.engineId,
            ownership: 'owned',
            mode: 'start-at-login',
            executable: spec.executable,
            baseUrl: spec.baseUrl,
            startedAt: now(),
            uncertain: true,
            uncertainReason: res.output || 'Service registration failed',
          };
          writeReceipt(plan.receiptPath, uncertain);
          return {
            ok: false,
            status: 'uncertain',
            engineId: plan.engineId,
            action: 'install',
            digest: plan.digest,
            running: false,
            message: `Failed to register start-at-login service for "${plan.engineId}": ${uncertain.uncertainReason}`,
            receipt: uncertain,
          };
        }
      }
      const receipt: EngineRuntimeReceipt = {
        schemaVersion: 1,
        engineId: plan.engineId,
        ownership: 'owned',
        mode: 'start-at-login',
        executable: spec.executable,
        baseUrl: spec.baseUrl,
        startedAt: now(),
      };
      writeReceipt(plan.receiptPath, receipt);
      return {
        ok: true,
        status: 'applied',
        engineId: plan.engineId,
        action: 'install',
        digest: plan.digest,
        running: true,
        message: `Installed start-at-login service "${plan.serviceLabel}" for "${plan.engineId}".`,
        receipt,
      };
    }

    if (plan.action === 'uninstall') {
      if (runServiceCommand) {
        const cmd =
          plan.platform === 'darwin'
            ? { bin: 'launchctl', args: ['unload', '-w', plan.servicePath] }
            : plan.platform === 'linux'
              ? { bin: 'systemctl', args: ['--user', 'disable', '--now', plan.serviceLabel] }
              : { bin: 'schtasks', args: ['/Delete', '/TN', plan.serviceLabel, '/F'] };
        await runServiceCommand(cmd.bin, cmd.args);
      }
      removeFile(plan.servicePath);
      removeReceipt(plan.receiptPath);
      return {
        ok: true,
        status: 'applied',
        engineId: plan.engineId,
        action: 'uninstall',
        digest: plan.digest,
        running: false,
        message: `Uninstalled start-at-login service "${plan.serviceLabel}" for "${plan.engineId}".`,
        receipt: null,
      };
    }
  }

  return {
    ok: false,
    status: 'refused',
    engineId: plan.engineId,
    action: plan.action,
    digest: plan.digest,
    running: false,
    message: `Unsupported action "${plan.action}" for mode "${plan.mode}".`,
    receipt: readReceipt(plan.receiptPath),
  };
}

export function reconcileEngineState(
  receiptPath: string,
  observedStopped: boolean,
  deps: Pick<EngineLifecycleDeps, 'readReceipt' | 'writeReceipt' | 'removeReceipt'> = {},
): EngineRuntimeReceipt | null {
  const readReceipt = deps.readReceipt ?? defaultReadReceipt;
  const removeReceipt =
    deps.removeReceipt ??
    ((p: string) => {
      if (existsSync(p)) unlinkSync(p);
    });
  const receipt = readReceipt(receiptPath);
  if (!receipt) return null;
  if (observedStopped) {
    removeReceipt(receiptPath);
    return null;
  }
  const writeReceipt = deps.writeReceipt ?? defaultWriteReceipt;
  const cleared: EngineRuntimeReceipt = { ...receipt, uncertain: false };
  delete cleared.uncertainReason;
  writeReceipt(receiptPath, cleared);
  return cleared;
}
