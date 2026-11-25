import { createHash } from 'node:crypto';
import { runEvaJob, type EvaSandboxUnavailableError } from './eva-runner.ts';

export const SCRIPT_DEFAULTS = {
  maxSourceBytes: 8 * 1024,
  hardMaxSourceBytes: 16 * 1024,
  maxCalls: 16,
  hardMaxCalls: 32,
  maxIterations: 64,
  hardMaxIterations: 128,
  timeoutMs: 10_000,
  hardTimeoutMs: 30_000,
  maxFrameBytes: 32 * 1024,
  hardMaxFrameBytes: 48 * 1024,
  maxAggregateResultBytes: 512 * 1024,
  hardMaxAggregateResultBytes: 1024 * 1024,
} as const;

export interface ScriptToolSpec {
  readonly name: string;
  readonly effect: string;
  readonly fingerprint?: string;
}

export interface ScriptLimits {
  readonly maxSourceBytes: number;
  readonly maxCalls: number;
  readonly maxIterations: number;
  readonly timeoutMs: number;
  readonly maxFrameBytes: number;
  readonly maxAggregateResultBytes: number;
}

export function resolveScriptLimits(limits?: Partial<ScriptLimits>): ScriptLimits {
  const clamp = (v: number | undefined, def: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.min(Math.floor(v), max) : def;
  return {
    maxSourceBytes: clamp(limits?.maxSourceBytes, SCRIPT_DEFAULTS.maxSourceBytes, SCRIPT_DEFAULTS.hardMaxSourceBytes),
    maxCalls: clamp(limits?.maxCalls, SCRIPT_DEFAULTS.maxCalls, SCRIPT_DEFAULTS.hardMaxCalls),
    maxIterations: clamp(limits?.maxIterations, SCRIPT_DEFAULTS.maxIterations, SCRIPT_DEFAULTS.hardMaxIterations),
    timeoutMs: clamp(limits?.timeoutMs, SCRIPT_DEFAULTS.timeoutMs, SCRIPT_DEFAULTS.hardTimeoutMs),
    maxFrameBytes: clamp(limits?.maxFrameBytes, SCRIPT_DEFAULTS.maxFrameBytes, SCRIPT_DEFAULTS.hardMaxFrameBytes),
    maxAggregateResultBytes: clamp(
      limits?.maxAggregateResultBytes,
      SCRIPT_DEFAULTS.maxAggregateResultBytes,
      SCRIPT_DEFAULTS.hardMaxAggregateResultBytes,
    ),
  };
}

export type ScriptExpr =
  | { kind: 'lit'; value: string | number | boolean | null }
  | { kind: 'ident'; name: string }
  | { kind: 'array'; items: ScriptExpr[] }
  | { kind: 'object'; entries: Array<{ key: string; value: ScriptExpr }> }
  | { kind: 'member'; target: ScriptExpr; prop: string }
  | { kind: 'index'; target: ScriptExpr; index: ScriptExpr }
  | { kind: 'unary'; op: '!'; arg: ScriptExpr }
  | { kind: 'binary'; op: '===' | '!==' | '<' | '<=' | '>' | '>=' | '&&' | '||'; left: ScriptExpr; right: ScriptExpr }
  | { kind: 'call'; tool: string; args: ScriptExpr };

export type ScriptStmt =
  | { kind: 'const'; name: string; expr: ScriptExpr }
  | { kind: 'push'; target: string; expr: ScriptExpr }
  | { kind: 'expr'; expr: ScriptExpr }
  | { kind: 'for'; varName: string; iterable: ScriptExpr; body: ScriptStmt[] }
  | { kind: 'if'; cond: ScriptExpr; thenBody: ScriptStmt[]; elseBody: ScriptStmt[] }
  | { kind: 'return'; expr: ScriptExpr };

export interface ParsedScriptPlan {
  readonly statements: ScriptStmt[];
  readonly toolNames: string[];
  readonly pinnedTools: Record<string, { effect: string; fingerprint: string }>;
  readonly sourceDigest: string;
}

const FORBIDDEN_IDENTS = new Set([
  'import',
  'export',
  'require',
  'eval',
  'Function',
  'class',
  'prototype',
  '__proto__',
  'constructor',
  'process',
  'globalThis',
  'global',
  'window',
  'fs',
  'child_process',
  'while',
  'do',
  'try',
  'catch',
  'throw',
  'new',
  'this',
  'var',
  'let',
  'function',
  'async',
]);

interface Token {
  type: 'ident' | 'string' | 'number' | 'op' | 'punc';
  value: string;
}

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const q = ch;
      i++;
      let s = '';
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\' && i + 1 < src.length) {
          const n = src[++i]!;
          s += n === 'n' ? '\n' : n === 't' ? '\t' : n;
        } else s += src[i];
        i++;
      }
      if (src[i] !== q) throw new Error('Unterminated string literal');
      i++;
      out.push({ type: 'string', value: s });
      continue;
    }
    if (/\d/.test(ch) || (ch === '-' && /\d/.test(src[i + 1] ?? ''))) {
      const m = src.slice(i).match(/^-?\d+(?:\.\d+)?/);
      if (!m) throw new Error('Invalid number');
      out.push({ type: 'number', value: m[0] });
      i += m[0].length;
      continue;
    }
    const three = src.slice(i, i + 3);
    if (three === '===' || three === '!==') {
      out.push({ type: 'op', value: three });
      i += 3;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '<=' || two === '>=' || two === '&&' || two === '||' || two === '=>') {
      if (two === '=>') throw new Error('Unsupported arrow function in script plan');
      out.push({ type: 'op', value: two });
      i += 2;
      continue;
    }
    if (ch === '<' || ch === '>' || ch === '!') {
      out.push({ type: 'op', value: ch });
      i++;
      continue;
    }
    if ('{}[]().,:;='.includes(ch)) {
      out.push({ type: 'punc', value: ch });
      i++;
      continue;
    }
    if (/[a-zA-Z_$]/.test(ch)) {
      const m = src.slice(i).match(/^[a-zA-Z_$][a-zA-Z0-9_$]*/)!;
      if (FORBIDDEN_IDENTS.has(m[0])) throw new Error(`Forbidden construct in script plan: ${m[0]}`);
      out.push({ type: 'ident', value: m[0] });
      i += m[0].length;
      continue;
    }
    throw new Error(`Unsupported character in script plan: ${ch}`);
  }
  return out;
}

function collectIdents(expr: ScriptExpr, out = new Set<string>()): Set<string> {
  if (expr.kind === 'ident') out.add(expr.name);
  else if (expr.kind === 'array') expr.items.forEach((x) => collectIdents(x, out));
  else if (expr.kind === 'object') expr.entries.forEach((e) => collectIdents(e.value, out));
  else if (expr.kind === 'member') collectIdents(expr.target, out);
  else if (expr.kind === 'index') {
    collectIdents(expr.target, out);
    collectIdents(expr.index, out);
  } else if (expr.kind === 'unary') collectIdents(expr.arg, out);
  else if (expr.kind === 'binary') {
    collectIdents(expr.left, out);
    collectIdents(expr.right, out);
  } else if (expr.kind === 'call') collectIdents(expr.args, out);
  return out;
}

function exprHasCall(expr: ScriptExpr): boolean {
  if (expr.kind === 'call') return true;
  if (expr.kind === 'array') return expr.items.some(exprHasCall);
  if (expr.kind === 'object') return expr.entries.some((e) => exprHasCall(e.value));
  if (expr.kind === 'member') return exprHasCall(expr.target);
  if (expr.kind === 'index') return exprHasCall(expr.target) || exprHasCall(expr.index);
  if (expr.kind === 'unary') return exprHasCall(expr.arg);
  if (expr.kind === 'binary') return exprHasCall(expr.left) || exprHasCall(expr.right);
  return false;
}

/** Parses and statically validates a bounded read-only script plan. */
export function parseScriptPlan(
  source: string,
  registeredTools: readonly ScriptToolSpec[],
  limits?: Partial<ScriptLimits>,
): ParsedScriptPlan {
  const lim = resolveScriptLimits(limits);
  if (typeof source !== 'string' || !source.trim()) throw new Error('Script source is empty');
  const bytes = Buffer.byteLength(source, 'utf8');
  if (bytes > lim.maxSourceBytes) throw new Error(`Script source exceeds ${lim.maxSourceBytes} bytes`);

  const toolMap = new Map<string, ScriptToolSpec>();
  for (const t of registeredTools) toolMap.set(t.name, t);

  const tokens = tokenize(source);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const expect = (type: Token['type'], value?: string): Token => {
    const t = next();
    if (!t || t.type !== type || (value !== undefined && t.value !== value)) {
      throw new Error(`Expected ${value ?? type} in script plan`);
    }
    return t;
  };
  const accept = (type: Token['type'], value?: string): boolean => {
    const t = peek();
    if (t && t.type === type && (value === undefined || t.value === value)) {
      pos++;
      return true;
    }
    return false;
  };

  const resultDerived = new Set<string>();
  const aliases = new Map<string, Set<string>>();
  const aliasGroup = (name: string): Set<string> => {
    let g = aliases.get(name);
    if (!g) {
      g = new Set([name]);
      aliases.set(name, g);
    }
    return g;
  };
  const markDerived = (name: string) => {
    for (const n of aliasGroup(name)) resultDerived.add(n);
  };
  const isExprDerived = (e: ScriptExpr): boolean =>
    exprHasCall(e) || [...collectIdents(e)].some((id) => resultDerived.has(id));
  let taintedControlDepth = 0;
  const usedTools = new Set<string>();

  const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

  const parsePrimary = (): ScriptExpr => {
    const t = peek();
    if (!t) throw new Error('Unexpected end of script plan');
    if (t.type === 'string') {
      pos++;
      return { kind: 'lit', value: t.value };
    }
    if (t.type === 'number') {
      pos++;
      return { kind: 'lit', value: Number(t.value) };
    }
    if (t.type === 'ident' && (t.value === 'true' || t.value === 'false' || t.value === 'null')) {
      pos++;
      return { kind: 'lit', value: t.value === 'true' ? true : t.value === 'false' ? false : null };
    }
    if (t.type === 'punc' && t.value === '[') {
      pos++;
      const items: ScriptExpr[] = [];
      while (!accept('punc', ']')) {
        items.push(parseExpr());
        if (!accept('punc', ',')) {
          expect('punc', ']');
          break;
        }
      }
      return { kind: 'array', items };
    }
    if (t.type === 'punc' && t.value === '{') {
      pos++;
      const entries: Array<{ key: string; value: ScriptExpr }> = [];
      while (!accept('punc', '}')) {
        const k = peek();
        if (!k || (k.type !== 'ident' && k.type !== 'string')) throw new Error('Expected object key');
        if (FORBIDDEN_KEYS.has(k.value)) throw new Error(`Forbidden property key in script plan: ${k.value}`);
        pos++;
        expect('punc', ':');
        entries.push({ key: k.value, value: parseExpr() });
        if (!accept('punc', ',')) {
          expect('punc', '}');
          break;
        }
      }
      return { kind: 'object', entries };
    }
    if (t.type === 'punc' && t.value === '(') {
      pos++;
      const inner = parseExpr();
      expect('punc', ')');
      return inner;
    }
    if (t.type === 'op' && t.value === '!') {
      pos++;
      return { kind: 'unary', op: '!', arg: parsePrimary() };
    }
    if (t.type === 'ident') {
      pos++;
      if (t.value === 'await') return parsePrimary();
      if (t.value === 'tools' && accept('punc', '.') && accept('ident', 'call')) {
        expect('punc', '(');
        const toolTok = peek();
        if (!toolTok || toolTok.type !== 'string') throw new Error('tools.call requires a literal tool name string');
        pos++;
        const spec = toolMap.get(toolTok.value);
        if (!spec) throw new Error(`Unknown tool in script plan: ${toolTok.value}`);
        if (spec.effect !== 'read') throw new Error(`Only read tools are allowed in script plans: ${toolTok.value}`);
        usedTools.add(spec.name);
        expect('punc', ',');
        const args = parseExpr();
        expect('punc', ')');
        if (args.kind !== 'object') {
          throw new Error('tools.call arguments must be an object literal');
        }
        if (exprHasCall(args)) throw new Error('Nested tools.call inside arguments is forbidden');
        if (taintedControlDepth > 0) {
          throw new Error('Result-derived control flow cannot gate tools.call in script plan');
        }
        for (const id of collectIdents(args)) {
          if (resultDerived.has(id)) {
            throw new Error(`Result-derived argument forbidden in script plan (${id})`);
          }
        }
        return { kind: 'call', tool: spec.name, args };
      }
      let expr: ScriptExpr = { kind: 'ident', name: t.value };
      for (;;) {
        if (accept('punc', '.')) {
          const prop = expect('ident').value;
          if (FORBIDDEN_KEYS.has(prop)) throw new Error(`Forbidden property access in script plan: ${prop}`);
          expr = { kind: 'member', target: expr, prop };
        } else if (accept('punc', '[')) {
          const idx = parseExpr();
          if (idx.kind === 'lit' && typeof idx.value === 'string' && FORBIDDEN_KEYS.has(idx.value)) {
            throw new Error(`Forbidden property access in script plan: ${idx.value}`);
          }
          expect('punc', ']');
          expr = { kind: 'index', target: expr, index: idx };
        } else break;
      }
      return expr;
    }
    throw new Error(`Unexpected token in script plan: ${t.value}`);
  };

  const parseComparison = (): ScriptExpr => {
    let left = parsePrimary();
    while (peek()?.type === 'op' && ['===', '!==', '<', '<=', '>', '>='].includes(peek()!.value)) {
      const op = next()!.value as '===' | '!==' | '<' | '<=' | '>' | '>=';
      left = { kind: 'binary', op, left, right: parsePrimary() };
    }
    return left;
  };

  const parseExpr = (): ScriptExpr => {
    let left = parseComparison();
    while (peek()?.type === 'op' && (peek()!.value === '&&' || peek()!.value === '||')) {
      const op = next()!.value as '&&' | '||';
      left = { kind: 'binary', op, left, right: parseComparison() };
    }
    return left;
  };

  const parseBlock = (): ScriptStmt[] => {
    expect('punc', '{');
    const body: ScriptStmt[] = [];
    while (!accept('punc', '}')) body.push(parseStmt());
    return body;
  };

  const parseStmt = (): ScriptStmt => {
    const t = peek();
    if (!t) throw new Error('Unexpected end of script plan');
    if (t.type === 'ident' && t.value === 'const') {
      pos++;
      const name = expect('ident').value;
      expect('punc', '=');
      const expr = parseExpr();
      accept('punc', ';');
      if (expr.kind === 'ident') {
        const g = aliasGroup(expr.name);
        g.add(name);
        aliases.set(name, g);
      }
      if (isExprDerived(expr) || taintedControlDepth > 0) {
        markDerived(name);
      }
      return { kind: 'const', name, expr };
    }
    if (t.type === 'ident' && t.value === 'for') {
      pos++;
      expect('punc', '(');
      expect('ident', 'const');
      const varName = expect('ident').value;
      expect('ident', 'of');
      const iterable = parseExpr();
      expect('punc', ')');
      const iterDerived = isExprDerived(iterable);
      if (iterDerived) {
        markDerived(varName);
        taintedControlDepth++;
      }
      try {
        const body = parseBlock();
        return { kind: 'for', varName, iterable, body };
      } finally {
        if (iterDerived) taintedControlDepth--;
      }
    }
    if (t.type === 'ident' && t.value === 'if') {
      pos++;
      expect('punc', '(');
      const cond = parseExpr();
      expect('punc', ')');
      const condDerived = isExprDerived(cond);
      if (condDerived) taintedControlDepth++;
      try {
        const thenBody = parseBlock();
        const elseBody = accept('ident', 'else') ? parseBlock() : [];
        return { kind: 'if', cond, thenBody, elseBody };
      } finally {
        if (condDerived) taintedControlDepth--;
      }
    }
    if (t.type === 'ident' && t.value === 'return') {
      pos++;
      const expr = parseExpr();
      accept('punc', ';');
      return { kind: 'return', expr };
    }
    const expr = parseExpr();
    if (expr.kind === 'member' && expr.target.kind === 'ident' && expr.prop === 'push' && accept('punc', '(')) {
      const arg = parseExpr();
      expect('punc', ')');
      accept('punc', ';');
      if (isExprDerived(arg) || taintedControlDepth > 0) {
        markDerived(expr.target.name);
      }
      return { kind: 'push', target: expr.target.name, expr: arg };
    }
    accept('punc', ';');
    return { kind: 'expr', expr };
  };

  const statements: ScriptStmt[] = [];
  while (pos < tokens.length) statements.push(parseStmt());

  const pinnedTools: Record<string, { effect: string; fingerprint: string }> = {};
  for (const name of usedTools) {
    const spec = toolMap.get(name)!;
    pinnedTools[name] = { effect: spec.effect, fingerprint: spec.fingerprint ?? `${spec.name}:${spec.effect}` };
  }
  return {
    statements,
    toolNames: [...usedTools].sort(),
    pinnedTools,
    sourceDigest: createHash('sha256').update(source).digest('hex').slice(0, 16),
  };
}

export interface ScriptCallReceipt {
  readonly callIndex: number;
  readonly tool: string;
  readonly argsDigest: string;
  readonly outcome: 'grant' | 'approval' | 'reject' | 'invalid' | 'error' | 'completed_late';
  readonly grantId?: string;
  readonly reason?: string;
  readonly resultBytes?: number;
}

export interface ScriptPlanRunResult {
  readonly status: 'completed' | 'terminated';
  readonly result?: unknown;
  readonly reason?: string;
  readonly calls: number;
  readonly receipts: ScriptCallReceipt[];
}

export interface RunScriptPlanOptions {
  readonly jobId: string;
  readonly source: string;
  readonly tools: readonly ScriptToolSpec[] | (() => readonly ScriptToolSpec[] | Promise<readonly ScriptToolSpec[]>);
  readonly limits?: Partial<ScriptLimits>;
  readonly gate: (
    tool: string,
    args: Record<string, unknown>,
  ) => Promise<{ outcome: 'grant' | 'approval' | 'reject'; grantId?: string; reason?: string }>;
  readonly execute: (
    tool: string,
    args: Record<string, unknown>,
    grantId?: string,
    signal?: AbortSignal,
  ) => Promise<unknown>;
  readonly onReceipt?: (receipt: ScriptCallReceipt) => void;
  readonly sandboxExecPath?: string;
  readonly bwrapPath?: string;
}

// Self-contained AST evaluator executed inside the EVA-03 child process.
const EVA_SCRIPT_WORKER = `
const readline = require('node:readline');
const payload = JSON.parse(process.argv[1]);
const { statements, limits } = payload;
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const pending = new Map();
let nextId = 1;
let calls = 0;
let iterations = 0;
rl.on('line', (line) => {
  try {
    const msg = JSON.parse(line);
    const fn = pending.get(msg.id);
    if (fn) { pending.delete(msg.id); fn(msg); }
  } catch {}
});
function callTool(tool, args) {
  if (++calls > limits.maxCalls) throw new Error('Tool call budget exceeded');
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, (msg) => {
      if (msg.ok) resolve(msg.result);
      else reject(new Error(msg.error || 'Tool call refused'));
    });
    const frame = JSON.stringify({ kind: 'call', id, tool, args });
    if (Buffer.byteLength(frame, 'utf8') > limits.maxFrameBytes) {
      pending.delete(id);
      reject(new Error('Bridge request exceeds frame budget'));
      return;
    }
    process.stdout.write(frame + '\\n');
  });
}
async function evalExpr(e, env) {
  switch (e.kind) {
    case 'lit': return e.value;
    case 'ident': return env.has(e.name) ? env.get(e.name) : undefined;
    case 'array': {
      const out = [];
      for (const it of e.items) out.push(await evalExpr(it, env));
      return out;
    }
    case 'object': {
      const out = {};
      for (const ent of e.entries) out[ent.key] = await evalExpr(ent.value, env);
      return out;
    }
    case 'member': {
      const obj = await evalExpr(e.target, env);
      return obj != null && typeof obj === 'object' ? obj[e.prop] : undefined;
    }
    case 'index': {
      const obj = await evalExpr(e.target, env);
      const idx = await evalExpr(e.index, env);
      return obj != null && typeof obj === 'object' ? obj[idx] : undefined;
    }
    case 'unary': return !(await evalExpr(e.arg, env));
    case 'binary': {
      const l = await evalExpr(e.left, env);
      if (e.op === '&&') return l ? await evalExpr(e.right, env) : l;
      if (e.op === '||') return l ? l : await evalExpr(e.right, env);
      const r = await evalExpr(e.right, env);
      if (e.op === '===') return l === r;
      if (e.op === '!==') return l !== r;
      if (e.op === '<') return l < r;
      if (e.op === '<=') return l <= r;
      if (e.op === '>') return l > r;
      if (e.op === '>=') return l >= r;
      return undefined;
    }
    case 'call': {
      const a = await evalExpr(e.args, env);
      return await callTool(e.tool, a && typeof a === 'object' && !Array.isArray(a) ? a : {});
    }
  }
}
async function runBlock(stmts, env) {
  for (const s of stmts) {
    if (s.kind === 'const') {
      env.set(s.name, await evalExpr(s.expr, env));
    } else if (s.kind === 'push') {
      const arr = env.get(s.target);
      if (Array.isArray(arr)) arr.push(await evalExpr(s.expr, env));
    } else if (s.kind === 'expr') {
      await evalExpr(s.expr, env);
    } else if (s.kind === 'for') {
      const arr = await evalExpr(s.iterable, env);
      if (!Array.isArray(arr)) throw new Error('for-of requires an array');
      for (const item of arr) {
        if (++iterations > limits.maxIterations) throw new Error('Loop iteration budget exceeded');
        const child = new Map(env);
        child.set(s.varName, item);
        const r = await runBlock(s.body, child);
        if (r && r.returned) return r;
      }
    } else if (s.kind === 'if') {
      const cond = await evalExpr(s.cond, env);
      const branch = cond ? s.thenBody : s.elseBody;
      const r = await runBlock(branch, new Map(env));
      if (r && r.returned) return r;
    } else if (s.kind === 'return') {
      return { returned: true, value: await evalExpr(s.expr, env) };
    }
  }
  return { returned: false, value: null };
}
runBlock(statements, new Map()).then((r) => {
  const frame = JSON.stringify({ kind: 'result', value: r.value });
  if (Buffer.byteLength(frame, 'utf8') > limits.maxFrameBytes) {
    process.stdout.write(JSON.stringify({ kind: 'error', reason: 'Final reply exceeds frame budget' }) + '\\n');
    process.exit(1);
  }
  process.stdout.write(frame + '\\n');
  rl.close();
  process.exit(0);
}).catch((err) => {
  process.stdout.write(JSON.stringify({ kind: 'error', reason: String(err && err.message || err) }) + '\\n');
  rl.close();
  process.exit(1);
});
`;

/** Executes a validated read-only script plan inside a fresh EVA-03 instance with per-call MAGI gating. */
export async function runScriptPlanInEva03(options: RunScriptPlanOptions): Promise<ScriptPlanRunResult> {
  const resolveTools = async () => (typeof options.tools === 'function' ? await options.tools() : options.tools);
  const limits = resolveScriptLimits(options.limits);
  const parsed = parseScriptPlan(options.source, await resolveTools(), limits);
  const receipts: ScriptCallReceipt[] = [];
  let calls = 0;
  let aggregateBytes = 0;
  let finalResult: unknown;
  let hasResult = false;
  let termReason: string | undefined;
  const ac = new AbortController();
  const inFlight = new Set<Promise<void>>();

  const terminate = (reason: string) => {
    if (!termReason) termReason = reason;
    ac.abort();
  };

  const sendErrorFrame = (send: (line: string) => void, callId: number, reason: string) => {
    const raw = JSON.stringify({ id: callId, ok: false, error: reason.slice(0, 1024) });
    if (Buffer.byteLength(raw, 'utf8') <= limits.maxFrameBytes) send(raw);
    else send(JSON.stringify({ id: callId, ok: false, error: 'Error frame exceeds budget' }));
  };

  const handleBridgeLine = (line: string, send: (replyLine: string) => void) => {
    if (Buffer.byteLength(line, 'utf8') > limits.maxFrameBytes) {
      terminate('Bridge frame exceeds budget');
      return;
    }
    let msg: { kind?: string; id?: number; tool?: string; args?: unknown; value?: unknown; reason?: string };
    try {
      msg = JSON.parse(line) as typeof msg;
    } catch {
      terminate('Malformed bridge JSON from EVA-03');
      return;
    }
    if (msg.kind === 'result') {
      finalResult = msg.value;
      hasResult = true;
      return;
    }
    if (msg.kind === 'error') {
      terminate(msg.reason || 'Script execution failed');
      return;
    }
    if (msg.kind !== 'call' || typeof msg.id !== 'number' || typeof msg.tool !== 'string') {
      terminate('Invalid bridge message from EVA-03');
      return;
    }
    const callId = msg.id;
    const tool = msg.tool;
    if (!msg.args || typeof msg.args !== 'object' || Array.isArray(msg.args)) {
      terminate(`Invalid arguments object for ${tool}`);
      sendErrorFrame(send, callId, 'Arguments must be an object');
      return;
    }
    const args = msg.args as Record<string, unknown>;
    const argsDigest = createHash('sha256').update(JSON.stringify(args)).digest('hex').slice(0, 16);

    const work = (async () => {
      if (ac.signal.aborted) return;
      calls++;
      if (calls > limits.maxCalls) {
        const rec: ScriptCallReceipt = {
          callIndex: calls,
          tool,
          argsDigest,
          outcome: 'invalid',
          reason: 'Tool call budget exceeded',
        };
        receipts.push(rec);
        options.onReceipt?.(rec);
        sendErrorFrame(send, callId, 'Tool call budget exceeded');
        terminate('Tool call budget exceeded');
        return;
      }
      const currentSpec = (await resolveTools()).find((t) => t.name === tool);
      const pinned = parsed.pinnedTools[tool];
      const currentFp = currentSpec
        ? (currentSpec.fingerprint ?? `${currentSpec.name}:${currentSpec.effect}`)
        : undefined;
      if (!currentSpec || !pinned || currentSpec.effect !== 'read' || currentFp !== pinned.fingerprint) {
        const reason = `Tool metadata or fingerprint changed for ${tool}`;
        const rec: ScriptCallReceipt = { callIndex: calls, tool, argsDigest, outcome: 'invalid', reason };
        receipts.push(rec);
        options.onReceipt?.(rec);
        sendErrorFrame(send, callId, reason);
        terminate(reason);
        return;
      }
      const decision = await options.gate(tool, args);
      if (ac.signal.aborted) return;
      if (decision.outcome !== 'grant') {
        const reason = decision.reason ?? `Gate ${decision.outcome} for ${tool}`;
        const rec: ScriptCallReceipt = { callIndex: calls, tool, argsDigest, outcome: decision.outcome, reason };
        receipts.push(rec);
        options.onReceipt?.(rec);
        sendErrorFrame(send, callId, reason);
        terminate(reason);
        return;
      }
      try {
        const result = await options.execute(tool, args, decision.grantId, ac.signal);
        const replyLine = JSON.stringify({ id: callId, ok: true, result });
        const frameBytes = Buffer.byteLength(replyLine, 'utf8');
        if (ac.signal.aborted) {
          const rec: ScriptCallReceipt = {
            callIndex: calls,
            tool,
            argsDigest,
            outcome: 'completed_late',
            grantId: decision.grantId,
            resultBytes: frameBytes,
          };
          receipts.push(rec);
          options.onReceipt?.(rec);
          return;
        }
        if (frameBytes > limits.maxFrameBytes) {
          const reason = 'Tool reply exceeds frame budget';
          const rec: ScriptCallReceipt = {
            callIndex: calls,
            tool,
            argsDigest,
            outcome: 'error',
            grantId: decision.grantId,
            reason,
            resultBytes: frameBytes,
          };
          receipts.push(rec);
          options.onReceipt?.(rec);
          sendErrorFrame(send, callId, reason);
          terminate(reason);
          return;
        }
        aggregateBytes += frameBytes;
        if (aggregateBytes > limits.maxAggregateResultBytes) {
          const reason = 'Aggregate tool output budget exceeded';
          const rec: ScriptCallReceipt = {
            callIndex: calls,
            tool,
            argsDigest,
            outcome: 'error',
            grantId: decision.grantId,
            reason,
            resultBytes: frameBytes,
          };
          receipts.push(rec);
          options.onReceipt?.(rec);
          sendErrorFrame(send, callId, reason);
          terminate(reason);
          return;
        }
        const rec: ScriptCallReceipt = {
          callIndex: calls,
          tool,
          argsDigest,
          outcome: 'grant',
          grantId: decision.grantId,
          resultBytes: frameBytes,
        };
        receipts.push(rec);
        options.onReceipt?.(rec);
        send(replyLine);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        const rec: ScriptCallReceipt = {
          callIndex: calls,
          tool,
          argsDigest,
          outcome: ac.signal.aborted ? 'completed_late' : 'error',
          grantId: decision.grantId,
          reason,
        };
        receipts.push(rec);
        options.onReceipt?.(rec);
        if (!ac.signal.aborted) sendErrorFrame(send, callId, reason);
      }
    })();
    inFlight.add(work);
    void work.finally(() => inFlight.delete(work));
  };

  const payload = JSON.stringify({ statements: parsed.statements, limits });
  const wallTimer = setTimeout(() => terminate('Script wall-time budget exceeded'), limits.timeoutMs);
  wallTimer.unref();
  try {
    const jobResult = await runEvaJob({
      jobId: options.jobId,
      evaClass: 'eva-03',
      command: process.execPath,
      args: ['-e', EVA_SCRIPT_WORKER, payload],
      timeoutMs: limits.timeoutMs,
      maxOutputBytes: limits.maxAggregateResultBytes + limits.maxFrameBytes,
      signal: ac.signal,
      sandboxExecPath: options.sandboxExecPath,
      bwrapPath: options.bwrapPath,
      onBridgeLine: handleBridgeLine,
      maxBridgeLineBytes: limits.maxFrameBytes,
    });
    if (inFlight.size) {
      await Promise.race([Promise.allSettled([...inFlight]), new Promise((r) => setTimeout(r, 200))]);
    }
    if (termReason) {
      return { status: 'terminated', reason: termReason, calls, receipts };
    }
    if (jobResult.timedOut) {
      return { status: 'terminated', reason: 'Script wall-time budget exceeded', calls, receipts };
    }
    if (!hasResult || jobResult.exitCode !== 0) {
      return {
        status: 'terminated',
        reason: jobResult.stderr.trim() || 'Script exited without result',
        calls,
        receipts,
      };
    }
    return { status: 'completed', result: finalResult, calls, receipts };
  } finally {
    clearTimeout(wallTimer);
  }
}

export type { EvaSandboxUnavailableError };
