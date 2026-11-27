import { dispatchRpc, MAX_FRAME_BYTES, READY } from './rpc.ts';
import { readConfig } from './config.ts';
import { connect, fingerprint, type McpConnection, type McpServer, type McpTool } from './mcp.ts';
// Tools boundary (F-021): the only process that runs MCP servers (outside code). The coordinator asks it to list a
// server's tools or call one already granted and gated; it never decides whether a call is allowed, and it holds no
// ledger. When EVAs exist (F-049) this is the process that moves into a sandbox.
const home = process.argv[2];
/** Room for a tool's structured answer in one reply: the frame less the text (8000 characters, up to 4 bytes each). */
const STRUCTURED_BYTES = MAX_FRAME_BYTES - 33_000;
const clients = new Map<string, McpConnection>();
const specs = new Map<string, string>();
const servers = (): McpServer[] => {
  try {
    return home ? (readConfig(home).tools?.mcp ?? []) : [];
  } catch {
    return [];
  }
};
const client = (id: string): McpConnection => {
  const s = servers().find((x) => x.id === id);
  if (!s) throw new Error(`No MCP server ${id} in config.json.`);
  // F-159: an off module is never called, whoever asks.
  if (s.off) {
    forget(id);
    throw new Error(`${id} is off: nerv modules on ${id}`);
  }
  // A server whose command, arguments or URL changed in config.json is restarted, never kept on its old definition.
  const spec = JSON.stringify(s);
  if (specs.get(id) !== spec) forget(id);
  let c = clients.get(id);
  if (!c) {
    c = connect(s);
    clients.set(id, c);
    specs.set(id, spec);
  }
  return c;
};
const forget = (id: string) => {
  clients.get(id)?.close();
  clients.delete(id);
  specs.delete(id);
};
/** Every configured server's tools, as `tools.list` returns them. */
async function listAll() {
  const out: { server: string; tools?: (McpTool & { fingerprint: string })[]; error?: string }[] = [];
  for (const s of servers()) {
    // F-159: an off module is not listed, so not contacted; a connection left open from before is closed.
    if (s.off) {
      forget(s.id);
      continue;
    }
    try {
      out.push({
        server: s.id,
        tools: (await client(s.id).listTools()).slice(0, 100).map((t) => ({
          name: t.name,
          ...(t.description ? { description: t.description.slice(0, 600) } : {}),
          ...(t.inputSchema ? { inputSchema: t.inputSchema } : {}),
          ...(t.annotations ? { annotations: t.annotations } : {}),
          fingerprint: fingerprint(t),
        })),
      });
    } catch (e) {
      forget(s.id);
      out.push({ server: s.id, error: e instanceof Error ? e.message : 'Could not list its tools.' });
    }
  }
  return out;
}
// B-100: `--list` prints one listing and exits; an EVA-03 instance has no IPC channel to the coordinator.
if (process.argv.includes('--list')) {
  void listAll().then((out) => {
    process.stdout.write(JSON.stringify(out) + '\n');
    for (const id of [...clients.keys()]) forget(id);
    process.exit(0);
  });
}
process.on('message', (value: unknown) => {
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_FRAME_BYTES) return;
  void dispatchRpc(value, async (method, params) => {
    if (method === 'runtime.ping') return { role: 'tools', pid: process.pid, servers: servers().map((s) => s.id) };
    if (method === 'tools.list') return listAll();
    if (method === 'tools.call') {
      const id = params.server as string,
        name = params.tool as string;
      try {
        const c = client(id);
        const now = (await c.listTools()).find((t) => t.name === name);
        // The call goes only to the tool as it was granted: a changed description means a new grant first.
        if (!now) return { error: `${id} has no tool ${name} any more.` };
        if (fingerprint(now) !== params.fingerprint)
          return { error: `${id}.${name} changed since it was granted: grant it again (nerv tools grant).` };
        const r = await c.callTool(name, params.args as Record<string, unknown>);
        if (r.isError) return { error: r.text || 'The tool reported an error.' };
        // The structured answer rides along only while the reply fits one IPC frame beside its text, so a large one
        // never turns a call that answered into an error.
        const fits = r.structured !== undefined && Buffer.byteLength(JSON.stringify(r.structured)) <= STRUCTURED_BYTES;
        return fits ? { text: r.text, structured: r.structured } : { text: r.text };
      } catch (e) {
        forget(id);
        return { error: e instanceof Error ? e.message : 'The MCP call failed.' };
      }
    }
    throw new Error('Unknown tools method.');
  })
    .then((reply) => {
      if (reply && process.connected) {
        if (Buffer.byteLength(JSON.stringify(reply)) > MAX_FRAME_BYTES)
          process.send?.({
            jsonrpc: '2.0',
            id: reply.id,
            error: { code: -32005, message: 'Response exceeds IPC bound.' },
          });
        else process.send?.(reply);
      }
    })
    .catch(() => {
      console.error('Tools IPC failed.');
    });
});
function stop() {
  for (const c of clients.values()) c.close();
  clients.clear();
  if (process.connected) process.disconnect();
}
process.on('disconnect', () => {
  for (const c of clients.values()) c.close();
  process.exitCode = 0;
});
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
process.send?.(READY);
