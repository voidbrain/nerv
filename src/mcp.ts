/**
 * MCP tools (F-021, slice 1). A minimal client for MCP servers over stdio (newline-delimited JSON-RPC 2.0: initialize,
 * tools/list, tools/call), the fingerprint a grant is pinned to, and the `tools` section of config.json.
 * Deny by default: a server's tool is offered to Misato only after the owner grants it, with an effect class (it sets
 * the Pattern) and an EVA class; a grant holds only while the tool's description keeps the fingerprint it was granted
 * with (a changed tool is suspended, never silently widened). Slice 1 grants reads only; EVA-03 needs F-049.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; [k: string]: unknown };
}
export interface McpServer {
  id: string;
  command: string;
  args: string[];
}
export type Eva = '00' | '01' | '02' | '03';
export interface ToolGrant {
  server: string;
  tool: string;
  effect: 'read';
  eva: Eva;
  fingerprint: string;
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
export function fingerprint(t: McpTool): string {
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
    .update(
      JSON.stringify(
        canon({
          name: t.name,
          description: t.description ?? '',
          inputSchema: t.inputSchema ?? null,
          annotations: t.annotations ?? null,
        }),
      ),
    )
    .digest('hex')
    .slice(0, 16);
}
/** The name Misato and the ledger use: server id, a dot, the tool's own name. */
export const toolName = (server: string, tool: string) => `${server}.${tool}`;

export function validateTools(value: unknown): ToolsConfig {
  const v = value as Record<string, unknown>;
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some((k) => !['mcp', 'grants'].includes(k)))
    throw new Error('Invalid tools: {"mcp": [servers], "grants": [grants]}.');
  const mcp: McpServer[] = [];
  for (const raw of (v.mcp ?? []) as unknown[]) {
    const s = raw as Record<string, unknown>;
    if (!s || typeof s !== 'object' || Object.keys(s).some((k) => !['id', 'command', 'args'].includes(k)))
      throw new Error('Invalid MCP server: id, command, args.');
    if (typeof s.id !== 'string' || !/^[a-z][a-z0-9]{1,15}$/.test(s.id) || RESERVED.includes(s.id))
      throw new Error(
        `Invalid MCP server id ${JSON.stringify(s.id)}: lower-case letters and digits, not one of NERV's own (${RESERVED.join(', ')}).`,
      );
    if (mcp.some((x) => x.id === s.id)) throw new Error(`MCP server ${s.id} is listed twice.`);
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
      Object.keys(g).some((k) => !['server', 'tool', 'effect', 'eva', 'fingerprint'].includes(k))
    )
      throw new Error('Invalid tool grant: server, tool, effect, eva, fingerprint.');
    if (typeof g.server !== 'string' || !mcp.some((s) => s.id === g.server))
      throw new Error(`Tool grant for an unknown server ${JSON.stringify(g.server)}.`);
    if (typeof g.tool !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(g.tool))
      throw new Error('Tool grant: a tool name.');
    if (g.effect !== 'read')
      throw new Error(
        `Tool grant ${g.server}.${g.tool}: only "read" for now (writes come with the approval path, F-021 slice 2).`,
      );
    if (!['00', '01', '02', '03'].includes(g.eva as string))
      throw new Error(`Tool grant ${g.server}.${g.tool}: eva is 00, 01, 02 or 03.`);
    if (typeof g.fingerprint !== 'string' || !/^[0-9a-f]{16}$/.test(g.fingerprint))
      throw new Error(`Tool grant ${g.server}.${g.tool}: a fingerprint.`);
    if (grants.some((x) => x.server === g.server && x.tool === g.tool))
      throw new Error(`Tool ${g.server}.${g.tool} is granted twice.`);
    grants.push({ server: g.server, tool: g.tool, effect: 'read', eva: g.eva as Eva, fingerprint: g.fingerprint });
  }
  return { mcp, grants };
}
/** Why a tool may not be granted as a read, or undefined when it may. */
export function grantRefusal(t: McpTool, effect: string, eva: string): string | undefined {
  if (effect !== 'read')
    return 'only "read" can be granted for now (writes come with the approval path, F-021 slice 2)';
  if (t.annotations?.destructiveHint === true || t.annotations?.readOnlyHint === false)
    return 'the server says this tool changes or removes things: it cannot be granted as a read';
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

/** One MCP server over stdio. Requests time out; the process is ended on close. Environment: PATH, HOME, LANG only. */
export class McpClient {
  private child: ChildProcess;
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
  constructor(server: McpServer, timeoutMs = 20_000) {
    this.timeoutMs = timeoutMs;
    this.child = spawn(server.command, server.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', LANG: process.env.LANG ?? 'C.UTF-8' },
    });
    this.child.stdout!.setEncoding('utf8');
    this.child.stdout!.on('data', (d: string) => {
      this.buffer += d;
      let i;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, i).trim();
        this.buffer = this.buffer.slice(i + 1);
        if (line) this.receive(line);
      }
    });
    // B-019: the last lines of the server's error output, so "it ended" says why (a broken npx, a wrong path).
    this.child.stderr!.setEncoding('utf8');
    this.child.stderr!.on('data', (d: string) => {
      this.stderr = (this.stderr + d).slice(-2000);
    });
    const tail = () => {
      const lines = this.stderr
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .filter(
          (l) => !/^(at |\^+$|throw |[{}\[\]]|Node\.js v|code:|requireStack|node:internal|[A-Za-z]+: \[?$)/.test(l),
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
    this.child.on('error', (e) => fail(`MCP server could not start: ${e.message}`));
    this.child.on('exit', (code) => fail(`MCP server ended${code !== null ? ` (exit ${code})` : ''}${tail()}.`));
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
      this.child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}) }) + '\n');
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
      this.child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
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
    this.child.kill();
  }
}
