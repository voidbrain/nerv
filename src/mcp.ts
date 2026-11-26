/**
 * MCP tools (F-021). Minimal clients for MCP servers over stdio (newline-delimited JSON-RPC 2.0: initialize,
 * tools/list, tools/call) and over streamable HTTP (F-123: a server at an HTTPS URL, such as a hub on the tailnet),
 * the fingerprint a grant is pinned to, and the `tools` section of config.json.
 * Deny by default: a server's tool is offered to Misato only after the owner grants it, with an effect class (it sets
 * the Pattern: a read is Green, a change goes through the gate and, when it is Blue, the owner's card) and an EVA class;
 * a grant holds only while the tool's description keeps the fingerprint it was granted with (a changed tool is
 * suspended, never silently widened). EVA-03 needs F-049.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { effects, type Effect } from './policy.ts';

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; [k: string]: unknown };
}
export interface ToolDescriptor {
  name: string;
  version: string;
  source: 'nerv' | `mcp:${string}`;
  effect: string;
  description: string;
  inputSchema: unknown;
}
/** A server NERV starts and talks to over stdio. */
export interface McpStdioServer {
  id: string;
  command: string;
  args: string[];
}
/** F-123: a server already running elsewhere, reached at its MCP endpoint over streamable HTTP. */
export interface McpHttpServer {
  id: string;
  url: string;
}
export type McpServer = McpStdioServer | McpHttpServer;
export const isHttpServer = (s: McpServer): s is McpHttpServer => 'url' in s;
/** How `nerv tools` names a server: its URL, or its command line. */
export const serverLabel = (s: McpServer) => (isHttpServer(s) ? s.url : `${s.command} ${s.args.join(' ')}`.trim());
export type Eva = '00' | '01' | '02' | '03';
export interface ToolGrant {
  server: string;
  tool: string;
  effect: Effect;
  eva: Eva;
  fingerprint: string;
  /** B-175 stage 2: this read also runs in a conversation a tool result has tainted (owner opt-in). */
  allowTainted?: true;
}
export interface ToolsConfig {
  mcp: McpServer[];
  grants: ToolGrant[];
}
/** Namespaces NERV's own tools use: an MCP server may not take them. */
const RESERVED = [
  'reminders',
  'memory',
  'settings',
  'kaji',
  'pilots',
  'misato',
  'runtime',
  'actions',
  'sorties',
  'approvals',
  'tools',
];

/** A short, stable fingerprint of what a tool says it does and takes: name, description, input schema, annotations. */
function stableVersion(value: unknown): string {
  const canon = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canon)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v as object)
              .sort()
              .map((k) => [k, canon((v as Record<string, unknown>)[k])]),
          )
        : v;
  return createHash('sha256')
    .update(JSON.stringify(canon(value)))
    .digest('hex')
    .slice(0, 16);
}
export function descriptorVersion(value: Omit<ToolDescriptor, 'version' | 'source'>): string {
  return stableVersion(value);
}
export function fingerprint(t: McpTool): string {
  return stableVersion({
    name: t.name,
    description: t.description ?? '',
    inputSchema: t.inputSchema ?? null,
    annotations: t.annotations ?? null,
  });
}
/** The name Misato and the ledger use: server id, a dot, the tool's own name. */
export const toolName = (server: string, tool: string) => `${server}.${tool}`;
/**
 * F-021-T04: a tool name another base may offer or be asked to run: NERV's own (`reminders.add`) or a granted MCP tool
 * (`server.tool`). Offers arrive from another base and are shown to Misato, so no spaces or other text fit in one.
 */
export const OFFER_NAME = /^[a-z][a-z0-9-]{0,39}\.[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export function validateTools(value: unknown): ToolsConfig {
  const v = value as Record<string, unknown>;
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some((k) => !['mcp', 'grants'].includes(k)))
    throw new Error('Invalid tools: {"mcp": [servers], "grants": [grants]}.');
  const mcp: McpServer[] = [];
  for (const raw of (v.mcp ?? []) as unknown[]) {
    const s = raw as Record<string, unknown>;
    if (!s || typeof s !== 'object' || Object.keys(s).some((k) => !['id', 'command', 'args', 'url'].includes(k)))
      throw new Error('Invalid MCP server: id with command and args, or id with url.');
    if (typeof s.id !== 'string' || !/^[a-z][a-z0-9]{1,15}$/.test(s.id) || RESERVED.includes(s.id))
      throw new Error(
        `Invalid MCP server id ${JSON.stringify(s.id)}: lower-case letters and digits, not one of NERV's own (${RESERVED.join(', ')}).`,
      );
    if (mcp.some((x) => x.id === s.id)) throw new Error(`MCP server ${s.id} is listed twice.`);
    if (s.url !== undefined) {
      if (s.command !== undefined || s.args !== undefined)
        throw new Error(`MCP server ${s.id}: a url or a command, not both.`);
      const why = urlRefusal(s.url);
      if (why) throw new Error(`MCP server ${s.id}: ${why}.`);
      mcp.push({ id: s.id, url: s.url as string });
      continue;
    }
    if (typeof s.command !== 'string' || !s.command.trim() || s.command.length > 300)
      throw new Error(`MCP server ${s.id}: a command.`);
    if (
      s.args !== undefined &&
      (!Array.isArray(s.args) || s.args.length > 30 || s.args.some((a) => typeof a !== 'string' || a.length > 500))
    )
      throw new Error(`MCP server ${s.id}: args is a list of strings.`);
    mcp.push({ id: s.id, command: s.command, args: (s.args as string[] | undefined) ?? [] });
  }
  const grants: ToolGrant[] = [];
  for (const raw of (v.grants ?? []) as unknown[]) {
    const g = raw as Record<string, unknown>;
    if (
      !g ||
      typeof g !== 'object' ||
      Object.keys(g).some((k) => !['server', 'tool', 'effect', 'eva', 'fingerprint', 'allowTainted'].includes(k))
    )
      throw new Error('Invalid tool grant: server, tool, effect, eva, fingerprint, allowTainted.');
    if (typeof g.server !== 'string' || !mcp.some((s) => s.id === g.server))
      throw new Error(`Tool grant for an unknown server ${JSON.stringify(g.server)}.`);
    if (typeof g.tool !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(g.tool))
      throw new Error('Tool grant: a tool name.');
    if (!effects.includes(g.effect as Effect))
      throw new Error(`Tool grant ${g.server}.${g.tool}: effect is one of ${effects.join(', ')}.`);
    if (g.effect === 'write-local' && isHttpServer(mcp.find((x) => x.id === g.server)!))
      throw new Error(`Tool grant ${g.server}.${g.tool}: ${REMOTE_WRITE}.`);
    if (!['00', '01', '02', '03'].includes(g.eva as string))
      throw new Error(`Tool grant ${g.server}.${g.tool}: eva is 00, 01, 02 or 03.`);
    if (typeof g.fingerprint !== 'string' || !/^[0-9a-f]{16}$/.test(g.fingerprint))
      throw new Error(`Tool grant ${g.server}.${g.tool}: a fingerprint.`);
    if ('allowTainted' in g && g.allowTainted !== true)
      throw new Error(`Tool grant ${g.server}.${g.tool}: allowTainted is true or absent.`);
    if (g.allowTainted === true && g.effect !== 'read')
      throw new Error(`Tool grant ${g.server}.${g.tool}: allowTainted is only for a read grant.`);
    // Tainted context never leaves the machine (canLeaveMachine): a server on another machine never gets the opt-in.
    if (g.allowTainted === true && isHttpServer(mcp.find((x) => x.id === g.server)!))
      throw new Error(`Tool grant ${g.server}.${g.tool}: allowTainted is only for a server on this machine.`);
    if (grants.some((x) => x.server === g.server && x.tool === g.tool))
      throw new Error(`Tool ${g.server}.${g.tool} is granted twice.`);
    grants.push({
      server: g.server,
      tool: g.tool,
      effect: g.effect as Effect,
      eva: g.eva as Eva,
      fingerprint: g.fingerprint,
      ...(g.allowTainted === true ? { allowTainted: true as const } : {}),
    });
  }
  return { mcp, grants };
}
const REMOTE_WRITE = 'a tool on another machine changes things outside this base: grant it as write-external or above';
/**
 * F-123: why a URL may not be an MCP server, or undefined when it may. HTTPS anywhere (a tailnet name serves HTTPS);
 * plain HTTP only on this machine's loopback, so nothing travels the network in clear. No credentials in the URL:
 * config.json is not a secret store.
 */
export function urlRefusal(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 500) return 'a url of at most 500 characters';
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return `${JSON.stringify(value.slice(0, 80))} is not a URL`;
  }
  if (u.username || u.password) return 'no user name or password in the url';
  if (u.protocol === 'https:') return undefined;
  if (u.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(u.hostname)) return undefined;
  return 'an https:// url (plain http only on 127.0.0.1 or localhost)';
}
/** Why a tool may not be granted with this effect class, or undefined when it may. */
export function grantRefusal(t: McpTool, effect: string, eva: string, remote = false): string | undefined {
  if (!effects.includes(effect as Effect)) return `effect is one of ${effects.join(', ')}`;
  if (effect === 'read' && (t.annotations?.destructiveHint === true || t.annotations?.readOnlyHint === false))
    return 'the server says this tool changes or removes things: it cannot be granted as a read';
  // The server's own word that a call may destroy something: every call is the owner's (Pattern Blue).
  if (t.annotations?.destructiveHint === true && effect !== 'irreversible' && effect !== 'physical')
    return 'the server says this tool may destroy or change things for good: grant it as irreversible or physical, so the owner approves each call';
  if (remote && effect === 'write-local') return REMOTE_WRITE;
  if (!['00', '01', '02', '03'].includes(eva)) return 'eva is 00, 01, 02 or 03';
  return undefined;
}
/** The text an MCP tool result carries, cut to size; images and other blocks are named, not inlined. */
export function resultText(result: unknown, max = 8000): string {
  const r = result as { content?: { type?: string; text?: string }[] };
  return (r?.content ?? [])
    .map((c) => (c.type === 'text' && typeof c.text === 'string' ? c.text : `[${c.type ?? 'content'}]`))
    .join('\n')
    .slice(0, max);
}

/** Commands that ship with node: looked for next to the running node first (B-148). */
const NODE_COMMANDS = new Set(['node', 'npx', 'npm']);
const isExecutable = (file: string) => {
  try {
    if (!statSync(file).isFile()) return false;
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};
/**
 * B-148: the absolute file a bare MCP command runs. Under launchd the service PATH lacks the node folder (node runs by
 * absolute path), so `npx` and `node` are looked for next to the running node first, then in the service PATH; only
 * absolute folders count, nothing runs through a shell. A command with a slash is used as written. `nodeDir` is set
 * when the file came from the node folder: that child (and only it) gets the folder on its PATH, because npx and the
 * packages it starts run `#!/usr/bin/env node`.
 */
export function resolveCommand(
  command: string,
  where: { nodeDir?: string; path?: string } = {},
): { file: string; nodeDir?: string } {
  if (command.includes('/') || command.includes('\\')) return { file: command };
  const nodeDir = where.nodeDir ?? dirname(process.execPath);
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  const searched: string[] = [];
  const find = (dir: string) => extensions.map((x) => join(dir, command + x)).find(isExecutable);
  if (NODE_COMMANDS.has(command)) {
    searched.push(nodeDir);
    const file = find(nodeDir);
    if (file) return { file, nodeDir };
  }
  for (const dir of (where.path ?? process.env.PATH ?? '').split(delimiter)) {
    if (!dir || !isAbsolute(dir) || searched.includes(dir)) continue;
    searched.push(dir);
    const file = find(dir);
    if (file) return { file };
  }
  throw new Error(
    `${command} not found (searched ${searched.join(', ') || 'no folders'}): set its absolute path as the command in config.json.`,
  );
}

/** One MCP server over stdio. Requests time out; the process is ended on close. Environment: PATH, HOME, LANG only. */
export class McpClient implements McpConnection {
  private child?: ChildProcess;
  private buffer = '';
  private next = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  private ready: Promise<void>;
  private closed = false;
  private readonly timeoutMs: number;
  private stderr = '';
  constructor(server: McpStdioServer, timeoutMs = 20_000) {
    this.timeoutMs = timeoutMs;
    // B-148: an absolute file from known folders, never a shell; a command found nowhere is not started at all.
    let resolved: { file: string; nodeDir?: string };
    try {
      resolved = resolveCommand(server.command);
    } catch (e) {
      this.closed = true;
      this.ready = Promise.reject(new Error(`MCP server could not start: ${(e as Error).message}`));
      this.ready.catch(() => {});
      return;
    }
    const path = process.env.PATH ?? '';
    const child = spawn(resolved.file, server.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      env: {
        // Only this child gets the node folder, so npx's `#!/usr/bin/env node` finds the node that resolved it.
        PATH: resolved.nodeDir ? [resolved.nodeDir, path].filter(Boolean).join(delimiter) : path,
        HOME: process.env.HOME ?? '',
        LANG: process.env.LANG ?? 'C.UTF-8',
      },
    });
    this.child = child;
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (d: string) => {
      this.buffer += d;
      let i;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, i).trim();
        this.buffer = this.buffer.slice(i + 1);
        if (line) this.receive(line);
      }
    });
    // B-019: the last lines of the server's error output, so "it ended" says why (a broken npx, a wrong path).
    child.stderr!.setEncoding('utf8');
    child.stderr!.on('data', (d: string) => {
      this.stderr = (this.stderr + d).slice(-2000);
    });
    const tail = () => {
      const lines = this.stderr
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .filter(
          (l) => !/^(at |\^+$|throw |[{}[\]]|Node\.js v|code:|requireStack|node:internal|[A-Za-z]+: \[?$)/.test(l),
        );
      const named = lines.find((l) => /error/i.test(l));
      const pick = named ? [named] : lines.slice(-2);
      return pick.length ? `: ${pick.join(' · ').slice(0, 300)}` : '';
    };
    const fail = (why: string) => {
      this.closed = true;
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error(why));
      }
      this.pending.clear();
    };
    child.on('error', (e) => fail(`MCP server could not start: ${e.message}`));
    child.on('exit', (code) => fail(`MCP server ended${code !== null ? ` (exit ${code})` : ''}${tail()}.`));
    this.ready = this.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'nerv-agency', version: '1' },
    }).then(() => {
      this.notify('notifications/initialized');
    });
  }
  private receive(line: string) {
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (typeof m.id !== 'number' || !this.pending.has(m.id)) return;
    const p = this.pending.get(m.id)!;
    this.pending.delete(m.id);
    clearTimeout(p.timer);
    if (m.error) {
      const e = m.error as { message?: string };
      p.reject(new Error(e.message ?? 'MCP error.'));
    } else p.resolve(m.result);
  }
  private notify(method: string, params?: object) {
    if (!this.closed)
      this.child!.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}) }) + '\n');
  }
  private request(method: string, params: object): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('MCP server is not running.'));
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP server did not answer ${method} in time.`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  async listTools(): Promise<McpTool[]> {
    await this.ready;
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const r = (await this.request('tools/list', cursor ? { cursor } : {})) as {
        tools?: McpTool[];
        nextCursor?: string;
      };
      tools.push(...(r.tools ?? []));
      if (!r.nextCursor) break;
      cursor = r.nextCursor;
    }
    return tools.filter((t) => t && typeof t.name === 'string');
  }
  async callTool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
    await this.ready;
    const r = (await this.request('tools/call', { name, arguments: args })) as { isError?: boolean };
    return { text: resultText(r), isError: r?.isError === true };
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
    this.child?.kill();
  }
}

/** What NERV needs from any MCP server, whatever carries it. */
export interface McpConnection {
  listTools(): Promise<McpTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }>;
  close(): void;
}
/** The client for a configured server: stdio for a command, streamable HTTP for a URL (F-123). */
export function connect(server: McpServer, timeoutMs?: number): McpConnection {
  return isHttpServer(server) ? new McpHttpClient(server, timeoutMs) : new McpClient(server, timeoutMs);
}

const PROTOCOL = '2025-06-18';
const MAX_BODY = 4 * 1024 * 1024;
/**
 * F-123: why a request to a remote server failed, in the owner's words: which kind of failure, so an unreachable
 * machine is told apart from a wrong path or a server that is not MCP.
 */
export function httpFailure(host: string, e: unknown): string {
  const err = e as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return `${host} did not answer in time`;
  const code = err?.cause?.code ?? '';
  if (/CERT|SSL|TLS/i.test(code)) return `${host} has a certificate this base does not trust (${code})`;
  // Every connection-level failure, whichever code the OS or undici gives: refused, reset or closed (a kept-alive socket
  // the server closed is UND_ERR_SOCKET), no route, no name, a connect timeout.
  if (
    /^(ECONN[A-Z]+|EPIPE|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|EHOSTDOWN|ENETUNREACH|ENETDOWN|ETIMEDOUT|UND_ERR_[A-Z_]+)$/.test(
      code,
    )
  )
    return `${host} is unreachable (${code}): is that machine on, and is this one on the same tailnet?`;
  if (code) return `${host} could not be reached (${code})`;
  return `${host} could not be reached: ${(err?.cause?.message ?? err?.message ?? 'unknown error').slice(0, 200)}`;
}
const sentence = (text: string) => (/[.?!]$/.test(text) ? text : `${text}.`);
/** One JSON-RPC answer out of a streamable HTTP reply: a JSON body, or the event of an SSE stream that carries it. */
function answerIn(body: string, contentType: string, id: number): Record<string, unknown> | undefined {
  const messages: unknown[] = [];
  if (contentType.includes('text/event-stream')) {
    for (const event of body.split(/\r?\n\r?\n/)) {
      const data = event
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      if (!data) continue;
      try {
        messages.push(JSON.parse(data));
      } catch {
        /* Not a JSON-RPC event: skipped. */
      }
    }
  } else {
    try {
      const parsed = JSON.parse(body) as unknown;
      messages.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch {
      return undefined;
    }
  }
  return messages.find((m) => (m as { id?: unknown })?.id === id) as Record<string, unknown> | undefined;
}

/**
 * F-123: one MCP server at a URL, over streamable HTTP (JSON-RPC by POST; the answer as JSON or as an SSE stream).
 * Redirects are refused, so a call never goes anywhere but the URL the owner registered; nothing is sent until NERV
 * lists or calls a tool. Requests time out; an unreachable server is an error that says so.
 */
export class McpHttpClient implements McpConnection {
  private next = 1;
  private session?: string;
  private ready?: Promise<void>;
  private closed = false;
  private readonly host: string;
  private readonly server: McpHttpServer;
  private readonly timeoutMs: number;
  /** A tool call may run hardware for longer than a listing takes. */
  private readonly callTimeoutMs: number;
  constructor(server: McpHttpServer, timeoutMs = 10_000, callTimeoutMs = 110_000) {
    this.server = server;
    this.timeoutMs = timeoutMs;
    this.callTimeoutMs = callTimeoutMs;
    this.host = new URL(server.url).host;
  }
  private async post(message: object, timeoutMs: number): Promise<Response> {
    if (this.closed) throw new Error('MCP server is not connected.');
    let res: Response;
    try {
      res = await fetch(this.server.url, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'content-type': 'application/json',
          'accept': 'application/json, text/event-stream',
          ...(this.ready ? { 'mcp-protocol-version': PROTOCOL } : {}),
          ...(this.session ? { 'mcp-session-id': this.session } : {}),
        },
        body: JSON.stringify(message),
      });
    } catch (e) {
      throw new Error(sentence(`MCP server ${httpFailure(this.host, e)}`));
    }
    const session = res.headers.get('mcp-session-id');
    if (session && /^[\x21-\x7e]{1,200}$/.test(session)) this.session = session;
    return res;
  }
  private async request(method: string, params: object, timeoutMs = this.timeoutMs): Promise<unknown> {
    const id = this.next++;
    const res = await this.post({ jsonrpc: '2.0', id, method, params }, timeoutMs);
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new Error(
        `MCP server ${this.host} answered ${method} with HTTP ${res.status}${res.status === 404 ? ': is the path right (…/mcp)?' : ''}.`,
      );
    }
    const body = await this.read(res);
    const m = answerIn(body, res.headers.get('content-type') ?? '', id);
    if (!m) throw new Error(`${this.host} did not answer ${method} as an MCP server.`);
    if (m.error) throw new Error((m.error as { message?: string }).message ?? 'MCP error.');
    return m.result;
  }
  /** The answer's body, read as it streams and cut off past MAX_BODY bytes, so a runaway answer is never held whole. */
  private async read(res: Response): Promise<string> {
    if (!res.body) return '';
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY) {
          await reader.cancel().catch(() => undefined);
          throw new Error(`MCP server ${this.host} sent an answer too large to read.`);
        }
        chunks.push(value);
      }
    } catch (e) {
      if (e instanceof Error && e.message.endsWith('too large to read.')) throw e;
      throw new Error(sentence(`MCP server ${httpFailure(this.host, e)}`));
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  private init(): Promise<void> {
    this.ready ??= this.request('initialize', {
      protocolVersion: PROTOCOL,
      capabilities: {},
      clientInfo: { name: 'nerv-agency', version: '1' },
    }).then(async () => {
      const res = await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, this.timeoutMs);
      await res.body?.cancel().catch(() => undefined);
    });
    return this.ready;
  }
  async listTools(): Promise<McpTool[]> {
    await this.init();
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const r = (await this.request('tools/list', cursor ? { cursor } : {})) as {
        tools?: McpTool[];
        nextCursor?: string;
      };
      tools.push(...(r?.tools ?? []));
      if (!r?.nextCursor) break;
      cursor = r.nextCursor;
    }
    return tools.filter((t) => t && typeof t.name === 'string');
  }
  async callTool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
    await this.init();
    const r = (await this.request('tools/call', { name, arguments: args }, this.callTimeoutMs)) as {
      isError?: boolean;
    };
    return { text: resultText(r), isError: r?.isError === true };
  }
  close() {
    this.closed = true;
  }
}
