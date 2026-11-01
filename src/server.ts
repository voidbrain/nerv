import { createServer, type IncomingMessage } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { realpath,stat,readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import type { StoreApi } from './runtime.ts';
import {attachRpcSocket} from './socket.ts';
async function body(req: IncomingMessage): Promise<Record<string,unknown>> {
  let text=''; for await(const chunk of req) { text+=chunk; if(Buffer.byteLength(text)>8192) throw new Error('Request too large.'); }
  const value:unknown=JSON.parse(text); if(!value || typeof value!=='object' || Array.isArray(value)) throw new Error('Expected JSON object.'); return value as Record<string,unknown>;
}
export function makeServer(store: StoreApi, token: string, options: {webRoot?:string; language?:string; timeZone?:string} = {}) {
  if(token.length<24) throw new Error('NODO_TOKEN must be at least 24 characters.');
  const server = createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json'); res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff');
    const reply=(status:number,value:unknown)=>{res.writeHead(status);res.end(JSON.stringify(value));};
    const path=new URL(req.url ?? '/', 'http://localhost').pathname;
    if(!path.startsWith('/api/') && path!=='/api') {
      if(!options.webRoot || !['GET','HEAD'].includes(req.method ?? '')) {reply(404,{error:'Unknown operation.'});return;}
      try {
        const root=await realpath(options.webRoot);
        const decoded=decodeURIComponent(path);
        if(decoded.split('/').some(part=>part.startsWith('.'))){reply(404,{error:'Not found.'});return;}
        const requested=resolve(root,'.'+decoded);
        if(!requested.startsWith(root+sep)&&requested!==root){reply(404,{error:'Not found.'});return;}
        const requestedStat=await stat(requested).catch(()=>null);
        const candidate=requestedStat?.isFile()?requested:extname(path)?null:resolve(root,'index.html');
        if(!candidate){reply(404,{error:'Not found.'});return;}
        const file=await realpath(candidate);
        if(!file.startsWith(root+sep)){reply(404,{error:'Not found.'});return;}
        const types:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.json':'application/json'};
        res.setHeader('Content-Type',types[extname(file)] ?? 'application/octet-stream');
        res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
        res.writeHead(200);res.end(req.method==='HEAD'?undefined:await readFile(file));return;
      }catch{reply(404,{error:'Not found.'});return;}
    }
    const supplied=Buffer.from(req.headers.authorization ?? ''); const expected=Buffer.from(`Bearer ${token}`);
    if(supplied.length!==expected.length || !timingSafeEqual(supplied,expected)) {reply(401,{error:'Authentication required.'});return;}
    try {
      if(req.method==='GET' && path==='/api/reminders') reply(200,await store.list());
      else if(req.method==='POST' && path==='/api/reminders') {const b=await body(req);if(typeof b.title!=='string'||typeof b.due!=='string') throw new Error('Title and due are required.');reply(201,await store.add(b.title,b.due));}
      else if(req.method==='DELETE' && /^\/api\/reminders\/[a-f0-9-]+$/.test(path)) reply((await store.cancel(path.split('/').at(-1)!))?200:404,{message:'Cancellation processed.'});
      else if(req.method==='GET' && path==='/api/inbox') reply(200,await store.inbox());
      else if(req.method==='GET' && path==='/api/doctor') reply(200,{name:'Nodo',mode:'local-core',...await store.doctor(),remoteWorkers:'not implemented',providers:'not configured',language:options.language ?? 'it',timeZone:options.timeZone ?? 'Europe/Rome'});
      else reply(404,{error:'Unknown operation.'});
    } catch(e) {reply(400,{error:e instanceof Error?e.message:'Invalid request.'});}
  });
  const sockets=attachRpcSocket(server,store,token,options);
  const close=server.close.bind(server);
  server.close=(callback)=>{for(const client of sockets.clients)client.terminate();sockets.close();return close(callback);};
  server.requestTimeout=15000;server.headersTimeout=10000;server.timeout=15000;
  return server;
}
