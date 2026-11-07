import {DashboardFeed} from './dashboard-feed.ts';
import { createServer, type IncomingMessage, type RequestListener } from 'node:http';
import {createServer as createHttpsServer} from 'node:https';
import type {NativeAuth} from './native-auth.ts';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { realpath,stat,readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import type { StoreApi } from './runtime.ts';
import {attachRpcSocket} from './socket.ts';
import {buildInfo} from './build.ts';
import {RpcFault} from './rpc.ts';
import type {ModelChange} from './model-setup.ts';
import {MODEL_TIMEOUT_MS} from './model.ts';
import {MAX_STEPS} from './misato.ts';
async function body(req: IncomingMessage,limit=8192): Promise<Record<string,unknown>> {
  let text=''; for await(const chunk of req) { text+=chunk; if(Buffer.byteLength(text)>limit) throw new Error('Request too large.'); }
  const value:unknown=JSON.parse(text); if(!value || typeof value!=='object' || Array.isArray(value)) throw new Error('Expected JSON object.'); return value as Record<string,unknown>;
}
/** A login code for `open`: single use, short-lived, so the token itself never appears in a command line or a URL. */
export const LOGIN_CODE_TTL_MS=60_000;
const MAX_LOGIN_CODES=5;
/** A dashboard session lasts 12 hours at most; a restart of the service ends it sooner. */
export const SESSION_TTL_MS=12*60*60_000;
const MAX_SESSIONS=20;
export function makeServer(store: StoreApi, token: string, options: {webRoot?:string; language?:string; timeZone?:string;base?:{id:string;name:string};tls?:{key:Buffer;cert:Buffer};native?:{auth:NativeAuth;fingerprint:string;port:number;webPort:number};loginCodeTtlMs?:number;sessionTtlMs?:number;onStop?:()=>void} = {}) {
  if(options.native&&!options.tls)throw new Error('Native pairing requires TLS.');
  // Read now, when the service starts: the dashboard shows the code running, not what the checkout holds later.
  const build=buildInfo();
  const loginCodes=new Map<string,number>();const codeTtl=options.loginCodeTtlMs ?? LOGIN_CODE_TTL_MS;
  const dropExpired=()=>{const now=Date.now();for(const [c,expires] of loginCodes)if(expires<=now)loginCodes.delete(c);for(const [t,expires] of sessions)if(expires<=now)sessions.delete(t);};
  // Dashboard sessions (F-039): what a login code is swapped for, instead of the admin token. Random, in this process's
  // memory only (a restart ends them all), expiring, revocable; they may do what the admin can except mint login codes,
  // so a session can never renew itself.
  const feed=store.dashboardRevision?new DashboardFeed(()=>store.dashboardRevision!()):undefined;
  const sessions=new Map<string,number>();const sessionTtl=options.sessionTtlMs ?? SESSION_TTL_MS;
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
        // A folder with its own index.html (the dashboard) is served as that page; any other route is the Angular app.
        const folderIndex=requestedStat?.isDirectory()?await stat(resolve(requested,'index.html')).then(st=>st.isFile()?resolve(requested,'index.html'):null,()=>null):null;
        const candidate=requestedStat?.isFile()?requested:folderIndex ?? (extname(path)?null:resolve(root,'index.html'));
        if(!candidate){reply(404,{error:'Not found.'});return;}
        const file=await realpath(candidate);
        if(!file.startsWith(root+sep)){reply(404,{error:'Not found.'});return;}
        const types:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.json':'application/json'};
        res.setHeader('Content-Type',types[extname(file)] ?? 'application/octet-stream');
        res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
        res.writeHead(200);res.end(req.method==='HEAD'?undefined:await readFile(file));return;
      }catch{reply(404,{error:'Not found.'});return;}
    }
    // The browser half of `open`: a valid code is swapped once for the token; the web page keeps it in memory only.
    if(!options.native&&req.method==='POST'&&path==='/api/session/exchange'){
      try{const value=await body(req);dropExpired();const code=value.code;
        if(Object.keys(value).length!==1||typeof code!=='string'||!loginCodes.has(code)){reply(401,{error:'Login code invalid, used or expired: run open again.'});return;}
        loginCodes.delete(code);if(sessions.size>=MAX_SESSIONS)sessions.delete(sessions.keys().next().value!);
        const session=randomBytes(32).toString('hex');sessions.set(session,Date.now()+sessionTtl);reply(200,{token:session,expiresInMs:sessionTtl});}catch{reply(400,{error:'Invalid request.'});}
      return;
    }
    const supplied=Buffer.from(req.headers.authorization ?? ''); const expected=Buffer.from(`Bearer ${token}`);
    const root=supplied.length===expected.length&&timingSafeEqual(supplied,expected);
    const bearer=req.headers.authorization?.startsWith('Bearer ')?req.headers.authorization.slice(7):'';
    if(!options.native&&!root&&bearer)dropExpired();
    const admin=root||(!options.native&&sessions.has(bearer));
    const client=!admin&&options.native?.auth.authenticate((req.headers.authorization?.startsWith('Bearer ')?req.headers.authorization.slice(7):''));
    if(!admin&&!client){reply(401,{error:'Authentication required.'});return;}
    if(!admin&&!(req.method==='GET'&&(['/api/status','/api/doctor','/api/reminders','/api/reminders/pending','/api/reminders/page','/api/inbox/history','/api/dashboard/history','/api/inbox','/api/inbox/page','/api/approvals','/api/sorties'].includes(path)||/^\/api\/sorties\/[a-f0-9-]+(\/events)?$/.test(path)))){reply(403,{error:'Read-only client.'});return;}
    try {
      if(options.native&&admin&&req.method==='POST'&&path==='/api/pairing/tickets'){const value=await body(req);if(Object.keys(value).length!==1||typeof value.label!=='string')throw new Error('Invalid client label.');reply(201,{version:1,...options.native.auth.issue(value.label),runtimeId:options.native.auth.runtimeId,port:options.native.port,webPort:options.native.webPort,fingerprint:options.native.fingerprint});}
      else if(options.native&&admin&&req.method==='GET'&&path==='/api/clients')reply(200,options.native.auth.clients());
      else if(options.native&&admin&&req.method==='DELETE'&&path.startsWith('/api/clients/'))reply(options.native.auth.revoke(path.split('/').at(-1)!)?200:404,{message:'Revocation processed.'});
      else if(req.method==='GET'&&['/api/reminders/page','/api/inbox/history'].includes(path)){
        if([...url.searchParams.keys()].some(k=>!['before','limit'].includes(k)))throw new Error('Unknown history query.');
        const before=Number(url.searchParams.get('before') ?? 0),limit=Number(url.searchParams.get('limit') ?? 20);
        reply(200,path==='/api/reminders/page'?await store.reminderPage(before,limit):await store.inboxHistory(before,limit));
      }
      else if(req.method==='GET'&&path==='/api/dashboard/stream'){
        if(options.native||!feed){reply(404,{error:'Dashboard stream unavailable.'});return;}
        if(url.search){reply(400,{error:'Dashboard stream takes no query parameters.'});return;}
        if(!feed.connect(res,()=>root||(sessions.get(bearer) ?? 0)>Date.now()))reply(503,{error:'Dashboard stream capacity reached.'});
      }
      else if(req.method==='GET'&&path==='/api/dashboard/history'){
        if([...url.searchParams.keys()].some(k=>k!=='since'))throw new Error('Unknown dashboard query.');
        reply(200,await store.dashboardHistory(url.searchParams.get('since') ?? ''));
      }
      else if(req.method==='GET'&&path==='/api/inbox/page'){if([...url.searchParams.keys()].some(k=>!['after','afterId','limit'].includes(k)))throw new Error('Unknown inbox query.');reply(200,await store.inboxPage(Number(url.searchParams.get('after') ?? 0),Number(url.searchParams.get('limit') ?? 5),url.searchParams.get('afterId') ?? undefined));}
      else if(req.method==='GET'&&path==='/api/approvals'){if([...url.searchParams.keys()].some(k=>k!=='limit'))throw new Error('Unknown approvals query.');reply(200,await store.approvals(Number(url.searchParams.get('limit') ?? 5)));}
      else if(req.method==='POST'&&/^\/api\/approvals\/[a-f0-9-]+$/.test(path)){const b=await body(req);if(Object.keys(b).length!==1||!['approve','reject','edit'].includes(b.decision as string))throw new Error('Decision must be approve, reject or edit.');reply(200,await store.decide(path.split('/').at(-1)!,b.decision as 'approve'|'reject'|'edit','api'));}
      else if(req.method==='GET'&&path==='/api/sorties'){if([...url.searchParams.keys()].some(k=>!['limit','before','q'].includes(k)))throw new Error('Unknown sorties query.');reply(200,await store.sorties(Number(url.searchParams.get('limit') ?? 20),url.searchParams.get('before') ?? undefined,url.searchParams.get('q') ?? undefined));}
      else if(req.method==='POST'&&/^\/api\/sorties\/[a-f0-9-]+\/spear$/.test(path)){
        // Admin only (read-only clients stop above): the Spear never approves anything and never undoes executed effects.
        if(!store.spear){reply(503,{error:'Spear unavailable.'});return;}
        const b=await body(req);if(Object.keys(b).some(k=>k!=='reason')||(b.reason!==undefined&&(typeof b.reason!=='string'||!b.reason.trim()||b.reason.length>500)))throw new Error('Spear takes an optional reason up to 500 characters.');
        const result=await store.spear(path.split('/')[3]!,(b.reason as string|undefined)?.trim() ?? 'dashboard');if(result)reply(200,result);else reply(404,{error:'No sortie with that ID.'});
      }
      else if(req.method==='GET'&&/^\/api\/sorties\/[a-f0-9-]+$/.test(path)){const found=await store.sortie(path.split('/')[3]!);if(found)reply(200,found);else reply(404,{error:'No sortie with that ID.'});}
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
      // Stops this service the way Ctrl+C does (F-037: `service stop` on Windows, where ending the task leaves Node running). Admin token only.
      else if(!options.native&&root&&req.method==='POST'&&path==='/api/stop'){if(!options.onStop){reply(503,{error:'Stop unavailable.'});return;}reply(202,{message:'Stopping.'});setImmediate(options.onStop);}
      else if(!options.native&&!root&&(path==='/api/session/codes'||path==='/api/session/revoke'||path==='/api/stop'))reply(403,{error:'Only the CLI (with the admin token) can mint login codes, revoke sessions or stop the service.'});
      else if(!options.native&&root&&req.method==='POST'&&path==='/api/session/revoke'){const n=sessions.size;sessions.clear();reply(200,{revoked:n});}
      else if(!options.native&&root&&req.method==='POST'&&path==='/api/session/codes'){dropExpired();if(loginCodes.size>=MAX_LOGIN_CODES){reply(429,{error:'Too many unused login codes; wait a minute.'});return;}const code=randomBytes(16).toString('hex');loginCodes.set(code,Date.now()+codeTtl);reply(201,{code,expiresInMs:codeTtl});}
      else if(path==='/api/memory'||path.startsWith('/api/memory/')&&path!=='/api/memory/consolidate'){
        // Lilith for the owner: admin only (read-only clients stop above); facts are personal.
        const m=store.lilith;if(!m){reply(503,{error:'Memory unavailable.'});return;}
        const id=/^\/api\/memory\/([a-f0-9-]{36})(\/(history|forget|share))?$/.exec(path);
        const text=(b:Record<string,unknown>)=>{if(Object.keys(b).some(k=>k!=='text')||typeof b.text!=='string'||!b.text.trim()||b.text.length>500)throw new Error('A fact is 1–500 characters.');return b.text;};
        if(req.method==='GET'&&path==='/api/memory')reply(200,await m.list());
        else if(req.method==='GET'&&path==='/api/memory/episodes')reply(200,await m.episodes());
        else if(req.method==='POST'&&path==='/api/memory')reply(201,await m.add(text(await body(req))));
        else if(id&&req.method==='GET'&&id[3]==='history')reply(200,await m.history(id[1]!));
        else if(id&&req.method==='PUT'&&!id[3]){const f=await m.edit(id[1]!,text(await body(req)));if(f)reply(200,f);else reply(404,{error:'No active fact with that ID.'});}
        else if(id&&req.method==='POST'&&id[3]==='forget')reply((await m.forget(id[1]!))?200:404,{message:'Forget processed.'});
        else if(id&&req.method==='POST'&&id[3]==='share'){const b=await body(req);if(Object.keys(b).some(k=>k!=='shareable')||typeof b.shareable!=='boolean')throw new Error('shareable must be true or false.');const f=await m.share(id[1]!,b.shareable);if(f)reply(200,f);else reply(404,{error:'No active fact with that ID.'});}
        else reply(404,{error:'Unknown operation.'});
      }
      else if(req.method==='GET'&&path==='/api/bases'){if(!store.bases){reply(503,{error:'Kaji unavailable.'});return;}reply(200,await store.bases());}
      else if(req.method==='POST'&&path==='/api/memory/consolidate'){if(!store.consolidate){reply(503,{error:'Instrumentality unavailable.'});return;}req.setTimeout(MODEL_TIMEOUT_MS*7+5000);res.once('finish',()=>req.socket.setTimeout(15000));const r=await store.consolidate();reply(r.error?502:200,r);}
      else if(req.method==='GET'&&path==='/api/pilots'){reply(200,{pilots:store.pilotRoster?await store.pilotRoster():[]});}
      else if(req.method==='PATCH'&&/^\/api\/pilots\/[a-z][a-z0-9-]{1,30}\/model$/.test(path)){
        if(!store.changePilotModel){reply(503,{error:'Pilot setup unavailable.'});return;}
        const b=await body(req);
        if(Object.keys(b).length!==1||typeof b.model!=='string'||!b.model.trim()||b.model.length>100)throw new Error('A pilot model change needs only an installed local model.');
        reply(200,{pilots:await store.changePilotModel(path.split('/')[3]!,b.model)});
      }
      else if(req.method==='GET'&&path==='/api/models'){if(!store.modelSetup){reply(503,{error:'Model setup unavailable.'});return;}reply(200,await store.modelSetup());}
      else if(req.method==='PUT'&&path==='/api/models'){
        // Admin only (a dashboard session is the admin): which model Misato and Casper use, and the cloud route on or off. Never a key.
        if(!store.changeModels){reply(503,{error:'Model setup unavailable.'});return;}
        const b=await body(req);const str=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=200;
        const misato=b.misato as Record<string,unknown>|undefined,casper=b.casper as Record<string,unknown>|undefined,cloud=b.cloud as Record<string,unknown>|undefined;
        const consultant=b.consultant as Record<string,unknown>|null|undefined;
        if(!Object.keys(b).length||Object.keys(b).some(k=>!['misato','casper','cloud','consultant'].includes(k))||(consultant!==undefined&&consultant!==null&&(typeof consultant!=='object'||Object.keys(consultant).some(k=>k!=='model')||!str(consultant.model)))
          ||(misato!==undefined&&(typeof misato!=='object'||!misato||Object.keys(misato).some(k=>!['route','model'].includes(k))||!['local','cloud'].includes(misato.route as string)||(misato.model!==undefined&&!str(misato.model))))
          ||(casper!==undefined&&(typeof casper!=='object'||!casper||Object.keys(casper).some(k=>k!=='model')||!str(casper.model)))
          ||(cloud!==undefined&&(typeof cloud!=='object'||!cloud||Object.keys(cloud).some(k=>!['enabled','model'].includes(k))||typeof cloud.enabled!=='boolean'||(cloud.model!==undefined&&!str(cloud.model)))))
          throw new Error('Give misato {route, model?}, casper {model}, consultant {model} or null, and/or cloud {enabled, model?}.');
        const result=await store.changeModels(b as ModelChange);reply(result.error?400:200,result);
      }
      else if(req.method==='POST'&&path==='/api/models/reload'){if(!store.reloadModels){reply(503,{error:'Model routes unavailable.'});return;}const result=await store.reloadModels();reply(result.error?400:200,result);}
      else if(req.method==='POST'&&path==='/api/chat'){
        // Admin only: a request to Misato, who plans and proposes actions through the gate.
        if(!store.chat){reply(503,{error:'Agent loop unavailable.'});return;}
        const b=await body(req,20000);
        if(Object.keys(b).some(k=>!['message','conversation'].includes(k))||typeof b.message!=='string'||!b.message.trim()||b.message.length>4000||(b.conversation!==undefined&&(typeof b.conversation!=='string'||!/^[a-z]+$/.test(b.conversation)||b.conversation.length>20)))throw new Error('Message is required: up to 4000 characters; conversation is a short lowercase name.');
        // Each step may wait for Misato and Casper.
        const budget=MODEL_TIMEOUT_MS*MAX_STEPS*2+5000;req.setTimeout(budget);res.once('finish',()=>req.socket.setTimeout(15000));
        reply(200,await store.chat(b.message.trim(),b.conversation as string|undefined));
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
      else if(req.method==='GET' && path==='/api/reminders') {const p=await store.reminderPage(0,50);if(p.next)throw new Error('History requires /api/reminders/page.');reply(200,p.items.sort((a,b)=>a.due.localeCompare(b.due)));}
      else if(req.method==='POST' && path==='/api/reminders') {const b=await body(req);if(typeof b.title!=='string'||typeof b.due!=='string') throw new Error('Title and due are required.');reply(201,await store.add(b.title,b.due));}
      else if(req.method==='PATCH' && /^\/api\/reminders\/[a-f0-9-]+$/.test(path)) {const b=await body(req);if(!Object.keys(b).length||Object.keys(b).some(k=>!['title','due'].includes(k))||(b.title!==undefined&&typeof b.title!=='string')||(b.due!==undefined&&typeof b.due!=='string'))throw new Error('Give a new title and/or a new due time.');
        const r=await store.update(path.split('/').at(-1)!,{...(b.title!==undefined?{title:b.title as string}:{}),...(b.due!==undefined?{due:b.due as string}:{})});if(r)reply(200,r);else reply(404,{error:'No pending reminder with that ID.'});}
      else if(req.method==='DELETE' && /^\/api\/reminders\/[a-f0-9-]+$/.test(path)) reply((await store.cancel(path.split('/').at(-1)!))?200:404,{message:'Cancellation processed.'});
      else if(req.method==='GET' && path==='/api/inbox') {const p=await store.inboxHistory(0,50);if(p.next)throw new Error('History requires /api/inbox/history.');reply(200,p.items);}
      else if(req.method==='GET'&&path==='/api/model-usage'&&store.modelUsage){
       const before=url.searchParams.has('before')?Number(url.searchParams.get('before')):undefined;
       const limit=url.searchParams.has('limit')?Number(url.searchParams.get('limit')):undefined;
       if((before!==undefined&&(!Number.isSafeInteger(before)||before<0))||(limit!==undefined&&(!Number.isInteger(limit)||limit<1||limit>20))){reply(400,{error:'Invalid usage page.'});return;}
       reply(200,await store.modelUsage(before,limit));
      }
      else if(req.method==='GET' && path==='/api/status')reply(200,{name:'NERV Agency',mode:'local-core',...(options.base?{base:options.base}:{}),...await store.health(),language:options.language ?? 'en',timeZone:options.timeZone ?? 'Europe/Rome',...(options.native?{runtimeId:options.native.auth.runtimeId,home:options.native.auth.home}:{})});
      else if(req.method==='GET' && path==='/api/doctor') reply(200,{name:'NERV Agency',mode:'local-core',build,...(options.base?{base:options.base}:{}),...await store.doctor(),remoteWorkers:'not implemented',language:options.language ?? 'en',timeZone:options.timeZone ?? 'Europe/Rome',...(options.native?{runtimeId:options.native.auth.runtimeId,home:options.native.auth.home}:{} )});
      else reply(404,{error:'Unknown operation.'});
    } catch(e) {reply(400,{error:e instanceof Error?e.message:'Invalid request.'});}
  };
  const server=options.tls?createHttpsServer({...options.tls,minVersion:'TLSv1.3'},listener):createServer(listener);
  const sockets=attachRpcSocket(server,store,token,options);
  const close=server.close.bind(server);
  server.close=(callback)=>{feed?.close();for(const client of sockets.clients)client.terminate();sockets.close();return close(callback);};
  server.requestTimeout=15000;server.headersTimeout=10000;server.timeout=15000;
  return server;
}
