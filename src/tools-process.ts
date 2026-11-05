import {dispatchRpc,MAX_FRAME_BYTES,READY} from './rpc.ts';
import {readConfig} from './config.ts';
import {McpClient,fingerprint,type McpServer,type McpTool} from './mcp.ts';
// Tools boundary (F-021): the only process that runs MCP servers (outside code). The coordinator asks it to list a
// server's tools or call one already granted and gated; it never decides whether a call is allowed, and it holds no
// ledger. When EVAs exist (F-049) this is the process that moves into a sandbox.
const home=process.argv[2];
const clients=new Map<string,McpClient>();const specs=new Map<string,string>();
const servers=():McpServer[]=>{try{return home?readConfig(home).tools?.mcp ?? []:[];}catch{return [];}};
const client=(id:string):McpClient=>{
 const s=servers().find(x=>x.id===id);if(!s)throw new Error(`No MCP server ${id} in config.json.`);
 // A server whose command or arguments changed in config.json is restarted, never kept on its old definition.
 const spec=JSON.stringify([s.command,s.args]);if(specs.get(id)!==spec)forget(id);
 let c=clients.get(id);if(!c){c=new McpClient(s);clients.set(id,c);specs.set(id,spec);}return c;
};
const forget=(id:string)=>{clients.get(id)?.close();clients.delete(id);specs.delete(id);};
process.on('message',(value:unknown)=>{
 if(Buffer.byteLength(JSON.stringify(value))>MAX_FRAME_BYTES)return;
 void dispatchRpc(value,async(method,params)=>{
  if(method==='runtime.ping')return {role:'tools',pid:process.pid,servers:servers().map(s=>s.id)};
  if(method==='tools.list'){
   const out:{server:string;tools?:(McpTool&{fingerprint:string})[];error?:string}[]=[];
   for(const s of servers()){try{out.push({server:s.id,tools:(await client(s.id).listTools()).slice(0,100).map(t=>({name:t.name,...(t.description?{description:t.description.slice(0,600)}:{}),...(t.inputSchema?{inputSchema:t.inputSchema}:{}),...(t.annotations?{annotations:t.annotations}:{}),fingerprint:fingerprint(t)}))});}
    catch(e){forget(s.id);out.push({server:s.id,error:e instanceof Error?e.message:'Could not list its tools.'});}}
   return out;
  }
  if(method==='tools.call'){
   const id=params.server as string,name=params.tool as string;
   try{
    const c=client(id);const now=(await c.listTools()).find(t=>t.name===name);
    // The call goes only to the tool as it was granted: a changed description means a new grant first.
    if(!now)return {error:`${id} has no tool ${name} any more.`};
    if(fingerprint(now)!==params.fingerprint)return {error:`${id}.${name} changed since it was granted: grant it again (nerv tools grant).`};
    const r=await c.callTool(name,params.args as Record<string,unknown>);return r.isError?{error:r.text||'The tool reported an error.'}:{text:r.text};
   }catch(e){forget(id);return {error:e instanceof Error?e.message:'The MCP call failed.'};}
  }
  throw new Error('Unknown tools method.');
 }).then(reply=>{if(reply&&process.connected){if(Buffer.byteLength(JSON.stringify(reply))>MAX_FRAME_BYTES)process.send?.({jsonrpc:'2.0',id:reply.id,error:{code:-32005,message:'Response exceeds IPC bound.'}});else process.send?.(reply);}}).catch(()=>{console.error('Tools IPC failed.');});
});
function stop(){for(const c of clients.values())c.close();clients.clear();if(process.connected)process.disconnect();}
process.on('disconnect',()=>{for(const c of clients.values())c.close();process.exitCode=0;});process.once('SIGTERM',stop);process.once('SIGINT',stop);
process.send?.(READY);
