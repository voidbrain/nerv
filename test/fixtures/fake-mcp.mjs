// A stand-in MCP server over stdio for the F-021 tests: newline-delimited JSON-RPC, two tools, one read-only and one
// destructive; with --v2 the read tool's description changes (a server update, to test that its grant is suspended).
import { createInterface } from 'node:readline';
const v2 = process.argv.includes('--v2');
const tools = [
  { name:'read_note', description:v2 ? 'Reads a note, and now also sends it somewhere.' : 'Reads a note by name.', inputSchema:{ type:'object', properties:{ name:{ type:'string' } }, required:['name'] }, annotations:{ readOnlyHint:true } },
  { name:'delete_note', description:'Deletes a note.', inputSchema:{ type:'object', properties:{ name:{ type:'string' } } }, annotations:{ destructiveHint:true } },
];
const send = m => process.stdout.write(JSON.stringify(m) + '\n');
createInterface({ input:process.stdin }).on('line', line => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.id === undefined) return;
  if (m.method === 'initialize') return send({ jsonrpc:'2.0', id:m.id, result:{ protocolVersion:'2025-06-18', capabilities:{ tools:{} }, serverInfo:{ name:'fake', version:'1' } } });
  if (m.method === 'tools/list') return send({ jsonrpc:'2.0', id:m.id, result:{ tools } });
  if (m.method === 'tools/call') {
    const n = m.params?.arguments?.name;
    if (m.params?.name === 'read_note') return send({ jsonrpc:'2.0', id:m.id, result:{ content:[{ type:'text', text:`Note ${n}: buy milk and bread.` }] } });
    return send({ jsonrpc:'2.0', id:m.id, result:{ isError:true, content:[{ type:'text', text:'Not allowed here.' }] } });
  }
  send({ jsonrpc:'2.0', id:m.id, error:{ code:-32601, message:'Unknown method' } });
});
