import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { posix, win32 } from 'node:path';
import { nodeTarget, type NodeTarget } from './node-discovery.ts';
export interface CommandRequest {
  program: string;
  args: string[];
  input?: string;
  timeoutMs: number;
  maxBytes: number;
  mayWrite?: boolean;
}
export type CommandRunner = (request: CommandRequest) => Promise<string>;
export const runNodeCommand: CommandRunner = (request) =>
  new Promise((done, fail) => {
    const allowed = [
      'PATH',
      'HOME',
      'USER',
      'USERPROFILE',
      'HOMEDRIVE',
      'HOMEPATH',
      'SYSTEMROOT',
      'WINDIR',
      'TEMP',
      'TMP',
      'LANG',
      'LC_ALL',
      'SSH_AUTH_SOCK',
    ];
    const env = Object.fromEntries(
      allowed.flatMap((key) => (process.env[key] === undefined ? [] : [[key, process.env[key]!]])),
    );
    const child = spawn(request.program, request.args, { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const out: Buffer[] = [];
    let bytes = 0,
      settled = false;
    const stop = (message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      fail(Error(message));
    };
    const timer = setTimeout(
      () =>
        stop(
          request.mayWrite
            ? 'Bootstrap transport timed out; inspect its target receipt before retrying.'
            : 'Inspection timed out; no installation was requested.',
        ),
      request.timeoutMs,
    );
    child.stdout.on('data', (data: Buffer) => {
      bytes += data.length;
      if (bytes > request.maxBytes) stop('Inspection output exceeded its bound.');
      else out.push(data);
    });
    child.stderr.on('data', (data: Buffer) => {
      bytes += data.length;
      if (bytes > request.maxBytes) stop('Inspection output exceeded its bound.');
    });
    child.once('error', () => stop('Inspection client could not start.'));
    child.stdin.on('error', () => stop('Inspection input could not be sent.'));
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) done(Buffer.concat(out).toString('utf8'));
      else
        fail(
          Error(
            request.mayWrite
              ? 'Bootstrap command failed; inspect its target receipt before retrying.'
              : 'Read-only command failed. Check the selected client and target prerequisites; no installation was requested.',
          ),
        );
    });
    child.stdin.end(request.input);
  });
/** B-063: the Node.js range NERV requires, read from package.json `engines.node` (">=X.Y.Z"). */
export function requiredNode(): string {
  const range = (
    JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      engines?: { node?: string };
    }
  ).engines?.node;
  if (!range || !/^>=\d+\.\d+\.\d+$/.test(range)) throw Error('package.json engines.node must be ">=X.Y.Z".');
  return range;
}
/** A sentence naming the found and required versions when `found` is below the range, else undefined. */
export function nodeBelowRequirement(found: string, range = requiredNode()): string | undefined {
  const parts = (v: string) =>
    v
      .replace(/^v|^>=/g, '')
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0);
  const [a, b] = [parts(found), parts(range)];
  for (let i = 0; i < 3; i++)
    if (a[i]! !== b[i]!)
      return a[i]! < b[i]!
        ? `Node.js ${found} on the target is below the version NERV requires (${range}).`
        : undefined;
  return undefined;
}
/** Fixed read-only probe. Never read credentials, open SQLite, enroll a base or ask a model. */
export const NODE_PROBE = String.raw`const os=require('node:os'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
function version(command){try{const r=cp.spawnSync(command,{shell:true,encoding:'utf8',timeout:3000,maxBuffer:4096,windowsHide:true});const text=(r.stdout||'').trim();return r.status===0&&/^(?:git version )?\d+\.\d+[^\r\n]{0,80}$/.test(text)?text:null;}catch{return null;}}
let base=null,configured=false;const dir=path.join(os.homedir(),'.nerv');try{const file=path.join(dir,'config.json');configured=fs.existsSync(file);if(fs.statSync(file).size<=65536){const c=JSON.parse(fs.readFileSync(file,'utf8'));if(c.base&&typeof c.base.id==='string')base={id:c.base.id,name:c.base.name};}}catch{}
process.stdout.write(JSON.stringify({version:1,platform:process.platform,arch:process.arch,node:process.versions.node,hostname:os.hostname(),userId:process.getuid?process.getuid():null,userHome:os.homedir(),git:version('git --version'),npm:version('npm --version'),base,configured,runtime:'not-checked'}));`;
export interface NodeInspection {
  version: 1;
  target: NodeTarget;
  transport: 'local' | 'ssh';
  observedAt: string;
  platform: 'darwin' | 'linux' | 'win32';
  arch: string;
  node: string;
  hostname: string;
  userId: number | null;
  userHome: string;
  git: string | null;
  npm: string | null;
  configured: boolean;
  base: { id: string; name: string } | null;
  runtime: 'not-checked';
  digest: string;
}
function report(raw: string, target: NodeTarget, now: Date, transport: 'local' | 'ssh'): NodeInspection {
  if (Buffer.byteLength(raw) > 16384) throw Error('Inspection report exceeds 16 KiB.');
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw Error('Inspection did not return a valid report.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid inspection report.');
  const v = value as Record<string, unknown>;
  if (
    v.version !== 1 ||
    !['darwin', 'linux', 'win32'].includes(String(v.platform)) ||
    v.runtime !== 'not-checked' ||
    typeof v.configured !== 'boolean'
  )
    throw Error('Unsupported inspection report.');
  const text = (key: string, max = 256) => {
    const value = v[key];
    if (typeof value !== 'string' || !value || value.length > max || /[\x00-\x1f\x7f]/.test(value))
      throw Error('Invalid inspection ' + key);
    return value;
  };
  const node = text('node', 80);
  if (!/^\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?$/i.test(node)) throw Error('Invalid inspected Node version.');
  const version = (key: string) => {
    if (v[key] === null) return null;
    const val = text(key, 100);
    if (!/^(?:git version )?\d+\.\d+[^\r\n]{0,80}$/.test(val)) throw Error('Invalid inspected dependency version.');
    return val;
  };
  let base: NodeInspection['base'] = null;
  if (v.base !== null) {
    if (!v.base || typeof v.base !== 'object' || Array.isArray(v.base)) throw Error('Invalid inspected base.');
    const b = v.base as Record<string, unknown>;
    if (
      typeof b.id !== 'string' ||
      !/^([A-Z0-9][A-Z0-9-]{1,15})$/.test(b.id) ||
      typeof b.name !== 'string' ||
      !b.name.trim() ||
      b.name.length > 40 ||
      /[\x00-\x1f\x7f]/.test(b.name)
    )
      throw Error('Invalid inspected base.');
    base = { id: b.id, name: b.name };
  }
  if (v.userId !== null && (!Number.isInteger(v.userId) || Number(v.userId) < 0))
    throw Error('Invalid inspected user ID.');
  const userHome = text('userHome', 1024);
  if (!(v.platform === 'win32' ? win32 : posix).isAbsolute(userHome))
    throw Error('Inspected user home must be absolute.');
  const result = {
    version: 1 as const,
    target,
    transport,
    observedAt: now.toISOString(),
    platform: v.platform as NodeInspection['platform'],
    arch: text('arch', 32),
    node,
    hostname: text('hostname'),
    userId: v.userId as number | null,
    userHome,
    git: version('git'),
    npm: version('npm'),
    base,
    configured: v.configured as boolean,
    runtime: 'not-checked' as const,
  };
  return { ...result, digest: createHash('sha256').update(JSON.stringify(result)).digest('hex') };
}
export function sshInspectionRequest(target: NodeTarget): CommandRequest {
  const valid = nodeTarget(target);
  return {
    program: 'ssh',
    args: [
      '-T',
      '-a',
      '-x',
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=yes',
      '-o',
      'UpdateHostKeys=no',
      '-S',
      'none',
      '-o',
      'ConnectTimeout=10',
      '-o',
      'ConnectionAttempts=1',
      '-o',
      'ClearAllForwardings=yes',
      '-o',
      'PermitLocalCommand=no',
      '-o',
      'LogLevel=ERROR',
      '-p',
      String(valid.port),
      ...(valid.user ? ['-l', valid.user] : []),
      '--',
      valid.host,
      'node --input-type=commonjs -',
    ],
    input: NODE_PROBE,
    timeoutMs: 15000,
    maxBytes: 32768,
  };
}
export async function inspectNode(
  target: NodeTarget,
  runner: CommandRunner = runNodeCommand,
  now = new Date(),
): Promise<NodeInspection> {
  return report(await runner(sshInspectionRequest(target)), nodeTarget(target), now, 'ssh');
}
export async function inspectLocalNode(
  runner: CommandRunner = runNodeCommand,
  now = new Date(),
): Promise<NodeInspection> {
  return report(
    await runner({
      program: process.execPath,
      args: ['--input-type=commonjs', '-'],
      input: NODE_PROBE,
      timeoutMs: 15000,
      maxBytes: 32768,
    }),
    nodeTarget({ host: 'localhost' }),
    now,
    'local',
  );
}
export function validateInspection(value: unknown, now = new Date()): NodeInspection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid inspection.');
  const v = value as Record<string, unknown>;
  const date = new Date(String(v.observedAt)),
    age = now.getTime() - date.getTime();
  if (!Number.isFinite(age) || age < 0 || age > 86400000)
    throw Error('Inspect the target again; reports expire after 24 hours.');
  if (!['local', 'ssh'].includes(String(v.transport))) throw Error('Invalid inspection transport.');
  const valid = report(JSON.stringify(v), nodeTarget(v.target), date, v.transport as 'local' | 'ssh');
  if (valid.digest !== v.digest) throw Error('Inspection digest differs; inspect the target again.');
  return valid;
}
