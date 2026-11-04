import { createServer, type IncomingMessage, type RequestListener } from 'node:http';
import {createServer as createHttpsServer} from 'node:https';
import type {NativeAuth} from './native-auth.ts';
import { timingSafeEqual } from 'node:crypto';
import { realpath,stat,readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import type { StoreApi } from './runtime.ts';
import {attachRpcSocket} from './socket.ts';
import {RpcFault} from './rpc.ts';
import {MODEL_TIMEOUT_MS} from './model.ts';
async function body(req: IncomingMessage,limit=8192): Promise<Record<string,unknown>> {
  let text=''; for await(const chunk of req) { text+=chunk; if(Buffer.byteLength(text)>limit) throw new Error('Request too large.'); }
  const value:unknown=JSON.parse(text); if(!value || typeof value!=='object' || Array.isArray(value)) throw new Error('Expected JSON object.'); return value as Record<string,unknown>;
}
export function makeServer(store: StoreApi, token: string, options: {webRoot?:string; language?:string; timeZone?:string;tls?:{key:Buffer;cert:Buffer};native?:{auth:NativeAuth;fingerprint:string;port:number;webPort:number}} = {}) {
  if(options.native&&!options.tls)throw new Error('Native pairing requires TLS.');
  if(token.length<24) throw new Error('NERV_TOKEN must be at least 24 characters.');
  const listener:RequestListener=async(req,res)=>{
    res.setHeader('Content-Type','application/json'); res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff');
    const reply=(status:number,value:unknown)=>{res.writeHead(status);res.end(JSON.stringify(value));};
    const url=new URL(req.url ?? '/', 'http://localhost');const path=url.pathname;
    if(options.native&&req.headers.origin){reply(403,{error:'Native clients only.'});return;}
    if(options.native&&req.method==='POST'&&path==='/api/pairing/claim'){try{const value=await body(req);if(Object.keys(value).length!==1||typeof value.ticket!=='string')throw new Error('Invalid invitation.');reply(201,options.native.auth.claim(value.ticket));}catch{reply(400,{error:'Invalid, expired or used invitation.'});}return;}
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
    const admin=supplied.length===expected.length&&timingSafeEqual(supplied,expected);
    const client=!admin&&options.native?.auth.authenticate((req.headers.authorization?.startsWith('Bearer ')?req.headers.authorization.slice(7):''));
    if(!admin&&!client){reply(401,{error:'Authentication required.'});return;}
    if(!admin&&!(req.method==='GET'&&(['/api/status','/api/doctor','/api/reminders','/api/reminders/pending','/api/inbox','/api/inbox/page','/api/approvals'].includes(path)||/^\/api\/sorties\/[a-f0-9-]+\/events$/.test(path)))){reply(403,{error:'Read-only client.'});return;}
    try {
      if(options.native&&admin&&req.method==='POST'&&path==='/api/pairing/tickets'){const value=await body(req);if(Object.keys(value).length!==1||typeof value.label!=='string')throw new Error('Invalid client label.');reply(201,{version:1,...options.native.auth.issue(value.label),runtimeId:options.native.auth.runtimeId,port:options.native.port,webPort:options.native.webPort,fingerprint:options.native.fingerprint});}
      else if(options.native&&admin&&req.method==='GET'&&path==='/api/clients')reply(200,options.native.auth.clients());
      else if(options.native&&admin&&req.method==='DELETE'&&path.startsWith('/api/clients/'))reply(options.native.auth.revoke(path.split('/').at(-1)!)?200:404,{message:'Revocation processed.'});
      else if(req.method==='GET'&&path==='/api/inbox/page'){if([...url.searchParams.keys()].some(k=>!['after','afterId','limit'].includes(k)))throw new Error('Unknown inbox query.');reply(200,await store.inboxPage(Number(url.searchParams.get('after') ?? 0),Number(url.searchParams.get('limit') ?? 5),url.searchParams.get('afterId') ?? undefined));}
      else if(req.method==='GET'&&path==='/api/approvals'){if([...url.searchParams.keys()].some(k=>k!=='limit'))throw new Error('Unknown approvals query.');reply(200,await store.approvals(Number(url.searchParams.get('limit') ?? 5)));}
      else if(req.method==='POST'&&/^\/api\/approvals\/[a-f0-9-]+$/.test(path)){const b=await body(req);if(Object.keys(b).length!==1||!['approve','reject','edit'].includes(b.decision as string))throw new Error('Decision must be approve, reject or edit.');reply(200,await store.decide(path.split('/').at(-1)!,b.decision as 'approve'|'reject'|'edit','api'));}
      else if(req.method==='GET'&&/^\/api\/sorties\/[a-f0-9-]+\/events$/.test(path)){if([...url.searchParams.keys()].some(k=>!['after','limit'].includes(k)))throw new Error('Unknown events query.');reply(200,await store.events(path.split('/')[3]!,Number(url.searchParams.get('after') ?? 0),Number(url.searchParams.get('limit') ?? 50)));}
      else if(req.method==='POST'&&path==='/api/ask'){
        // Admin only (read-only clients stop above). Privacy is explicit: local-only unless the caller says any.
        if(!store.ask){reply(503,{error:'Model routes unavailable.'});return;}
        const b=await body(req,40000);
        if(Object.keys(b).some(k=>!['prompt','system','privacy','route'].includes(k))||typeof b.prompt!=='string')throw new Error('Prompt is required.');
        req.setTimeout(MODEL_TIMEOUT_MS+5000);res.once('finish',()=>req.socket.setTimeout(15000));
        try{reply(200,await store.ask({prompt:b.prompt,privacy:(b.privacy ?? 'local-only') as 'local-only'|'any',...(b.system!==undefined?{system:b.system as string}:{}),...(b.route!==undefined?{route:b.route as 'local'|'cloud'}:{})}));}
        catch(e){if(e instanceof RpcFault&&e.code===-32602)throw new Error('Invalid ask: prompt up to 16000 characters, privacy local-only or any, route local or cloud.');if(e instanceof RpcFault&&e.code===-32010){reply(502,{error:e.message});return;}throw e;}
      }
      else if(req.method==='POST'&&path==='/api/actions'){
        // Admin only: one owner action through the per-action gate (F-017). Grant IDs never appear in the reply.
        if(!store.act){reply(503,{error:'Action gate unavailable.'});return;}
        const b=await body(req,40000);
        if(Object.keys(b).some(k=>!['request','tool','args','stage'].includes(k))||typeof b.request!=='string'||!b.request.trim()||typeof b.tool!=='string'||!b.args||typeof b.args!=='object'||Array.isArray(b.args)||(b.stage!==undefined&&!['prototype','test','production'].includes(b.stage as string)))throw new Error('Action needs request, tool and args (an object); stage is prototype, test or production.');
        req.setTimeout(MODEL_TIMEOUT_MS+5000);res.once('finish',()=>req.socket.setTimeout(15000));
        try{reply(200,await store.act({request:b.request,tool:b.tool,args:b.args as Record<string,unknown>,...(b.stage!==undefined?{stage:b.stage as 'production'}:{})}));}
        catch(e){if(e instanceof RpcFault&&e.code===-32602)throw new Error('Invalid action: request up to 4000 characters, tool up to 100, at most 50 arguments.');throw e;}
      }
      else if(req.method==='GET'&&path==='/api/reminders/pending')reply(200,await store.pendingReminders());
      else if(req.method==='GET' && path==='/api/reminders') reply(200,await store.list());
      else if(req.method==='POST' && path==='/api/reminders') {const b=await body(req);if(typeof b.title!=='string'||typeof b.due!=='string') throw new Error('Title and due are required.');reply(201,await store.add(b.title,b.due));}
      else if(req.method==='DELETE' && /^\/api\/reminders\/[a-f0-9-]+$/.test(path)) reply((await store.cancel(path.split('/').at(-1)!))?200:404,{message:'Cancellation processed.'});
      else if(req.method==='GET' && path==='/api/inbox') reply(200,await store.inbox());
      else if(req.method==='GET' && path==='/api/status')reply(200,{name:'NERV Agency',mode:'local-core',...await store.health(),language:options.language ?? 'en',timeZone:options.timeZone ?? 'Europe/Rome',...(options.native?{runtimeId:options.native.auth.runtimeId,home:options.native.auth.home}:{})});
      else if(req.method==='GET' && path==='/api/doctor') reply(200,{name:'NERV Agency',mode:'local-core',...await store.doctor(),remoteWorkers:'not implemented',language:options.language ?? 'en',timeZone:options.timeZone ?? 'Europe/Rome',...(options.native?{runtimeId:options.native.auth.runtimeId,home:options.native.auth.home}:{} )});
      else reply(404,{error:'Unknown operation.'});
    } catch(e) {reply(400,{error:e instanceof Error?e.message:'Invalid request.'});}
  };
  const server=options.tls?createHttpsServer({...options.tls,minVersion:'TLSv1.3'},listener):createServer(listener);
  const sockets=attachRpcSocket(server,store,token,options);
  const close=server.close.bind(server);
  server.close=(callback)=>{for(const client of sockets.clients)client.terminate();sockets.close();return close(callback);};
  server.requestTimeout=15000;server.headersTimeout=10000;server.timeout=15000;
  return server;
}
