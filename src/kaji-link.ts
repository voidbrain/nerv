import { createHash, randomBytes, sign, verify, type KeyObject } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { canonical, publicKeyFrom, type BaseEntry, type SignedRecord } from './kaji.ts';
/**
 * The Kaji line's live link (F-036, phase 1b). Each base listens on its enrolled address only (the Tailscale IP),
 * speaks only to enrolled bases, and signs every request and reply with its own base key. Heartbeats every 30 s give
 * each base the others' last-seen times (merged: newest wins), and a base that is behind on the registry fetches the
 * missing records and verifies each one against its own pinned root, so a compromised peer cannot add a base.
 * Tailscale encrypts the traffic; these signatures are what make a message trustworthy.
 */
export const KAJI_PORT=4320;
export const ONLINE_MS=90_000;
const SKEW_MS=120_000,NONCE_MS=10*60_000,MAX_BODY=256*1024,HEARTBEAT_MS=30_000;
/** What the link needs from the registry, implemented by the scheduler process (or directly in tests). */
export interface RegistryPort {
 bases():Promise<BaseEntry[]>;records():Promise<SignedRecord[]>;add(records:SignedRecord[]):Promise<number>;
 seen(updates:Record<string,string>):Promise<void>;lastSeen():Promise<Record<string,string>>;
 /** The owner's main base, if named (F-036 phase 2). Optional: a registry without one has no main base. */
 main?():Promise<string|undefined>;
}
/** host or host:port; the default port is KAJI_PORT. IPv4 and hostnames only for now. */
export function endpoint(address:string):{host:string;port:number} {
 const m=/^(.*?)(?::(\d{2,5}))?$/.exec(address)!;return {host:m[1]!,port:m[2]?Number(m[2]):KAJI_PORT};
}
const digest=(body:string)=>createHash('sha256').update(body).digest('base64');
const message=(kind:'req'|'res',method:string,path:string,time:string,nonce:string,body:string)=>[kind,method,path,time,nonce,digest(body)].join('\n');
export function signedHeaders(baseId:string,key:KeyObject,kind:'req'|'res',method:string,path:string,body:string,now=new Date()):Record<string,string> {
 const time=now.toISOString(),nonce=randomBytes(16).toString('hex');
 return {'x-kaji-base':baseId,'x-kaji-time':time,'x-kaji-nonce':nonce,'x-kaji-signature':sign(null,Buffer.from(message(kind,method,path,time,nonce,body)),key).toString('base64')};
}
/** Replay guard: a nonce is accepted once within its window; old ones are forgotten. */
export class Nonces {
 private seen=new Map<string,number>();
 fresh(nonce:string,now=Date.now()):boolean {for(const [n,t] of this.seen)if(t<now-NONCE_MS)this.seen.delete(n);if(this.seen.has(nonce))return false;this.seen.set(nonce,now);return true;}
}
/** Returns the sender's base id, or throws: unknown or revoked base, stale time, replayed nonce, bad signature. */
export function verifySigned(headers:Record<string,string|undefined>,kind:'req'|'res',method:string,path:string,body:string,bases:BaseEntry[],nonces:Nonces,now=Date.now()):string {
 const id=headers['x-kaji-base'],time=headers['x-kaji-time'],nonce=headers['x-kaji-nonce'],signature=headers['x-kaji-signature'];
 if(!id||!time||!nonce||!signature)throw new Error('unsigned');
 const base=bases.find(b=>b.baseId===id);if(!base||base.status!=='enrolled')throw new Error('unknown or revoked base');
 if(!Number.isFinite(Date.parse(time))||Math.abs(now-Date.parse(time))>SKEW_MS)throw new Error('stale or future time');
 if(!/^[a-f0-9]{32}$/.test(nonce)||!nonces.fresh(nonce,now))throw new Error('replayed');
 if(!verify(null,Buffer.from(message(kind,method,path,time,nonce,body)),publicKeyFrom(base.publicKey),Buffer.from(signature,'base64')))throw new Error('bad signature');
 return id;
}
/** A base's own report of its health (F-036 phase 2): online, or degraded with up to three short reasons. */
export interface BaseHealth {state:'online'|'degraded';reasons:string[]}
/** A peer's report as this base heard it, stamped with this base's clock when it arrived. */
export interface HeardHealth extends BaseHealth {at:string}
/** Keeps only a well-formed report; reasons are short display text (never instructions), at most three of 200 characters. */
export function sanitizeHealth(value:unknown):BaseHealth|undefined {
 if(!value||typeof value!=='object'||Array.isArray(value))return undefined;const h=value as Record<string,unknown>;
 if(h.state!=='online'&&h.state!=='degraded')return undefined;
 const reasons=Array.isArray(h.reasons)?h.reasons.filter((r):r is string=>typeof r==='string'&&r.trim().length>0).slice(0,3).map(r=>r.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,200)):[];
 return {state:h.state,reasons:h.state==='online'?[]:reasons};
}
/** Missed heartbeats in a row before a peer is logged unreachable: as many as fit in the online window (3 at 30 s / 90 s). */
export const missesToLog=(everyMs:number)=>Math.max(1,Math.ceil(ONLINE_MS/everyMs));
/** The actions a base offers the main base (F-036 slice 3b): action names only, at most 20. */
export function sanitizeOffers(value:unknown):string[]|undefined {
 if(!Array.isArray(value)||value.length>20||value.some(v=>typeof v!=='string'||!/^[a-z]+\.[a-z]+$/.test(v)))return undefined;
 return [...new Set(value as string[])].filter(t=>t!=='kaji.run');
}
/** One action the main base asks another base to run, by an id that base remembers (a resend returns the first result). */
export interface RunItem {id:string;request:string;tool:string;args:Record<string,unknown>}
/** The main base's answer to a dispatched request: the reply Misato gave there (its sortie and cards live there). */
export interface DispatchedReply {sortieId:string;reply?:string;error?:string;steps:unknown[];waiting:{approvalId:string;tool:string;reason:string}[];base?:{id:string;name:string}}
/** What a base relays to the main base's Aoba (F-036 phase 2): text to show, and the approval cards it carries. */
export interface Relay {text:string;cards:{id:string;label:string}[]}
const UUID=/^[a-f0-9-]{36}$/;
/** Keeps a relay that is plain text and well-formed card references; the main base builds the buttons itself. */
export function sanitizeRelay(value:unknown):Relay|undefined {
 if(!value||typeof value!=='object'||Array.isArray(value))return undefined;const v=value as Record<string,unknown>;
 if(typeof v.text!=='string'||!v.text.trim()||v.text.length>3500)return undefined;
 const cards=Array.isArray(v.cards)?v.cards:[];if(cards.length>20)return undefined;
 const ok=cards.every(c=>c&&typeof c==='object'&&UUID.test((c as {id?:unknown}).id as string)&&typeof (c as {label?:unknown}).label==='string'&&((c as {label:string}).label.length<=20));
 return ok?{text:v.text,cards:cards.map(c=>({id:(c as {id:string}).id,label:(c as {label:string}).label}))}:undefined;
}
const head=(records:SignedRecord[])=>({count:records.length,serial:records.reduce((m,r)=>Math.max(m,r.body.serial),0)});
export class KajiLink {
 readonly baseId:string;readonly key:KeyObject;readonly publicKey:string;readonly port:RegistryPort;readonly log:(line:string)=>void;
 private server?:Server;private timer?:NodeJS.Timeout;private nonces=new Nonces();private listening?:string;
 /** Per peer, whether heartbeats reach it, logged only when that changes. A peer counts as unreachable in the log only
  after enough missed heartbeats in a row to fill the online window (one slow Tailscale path or a machine waking from
  sleep is not news: the dashboard keeps it online for ONLINE_MS anyway). */
 private reachable=new Map<string,boolean>();private misses=new Map<string,number>();
 private mark(peer:string,ok:boolean,detail='',every=this.every){
  if(ok){this.misses.set(peer,0);if(this.reachable.get(peer)!==true)this.log(`Kaji: ${peer} reachable.`);this.reachable.set(peer,true);return;}
  const n=(this.misses.get(peer) ?? 0)+1;this.misses.set(peer,n);
  if(n>=missesToLog(every)&&this.reachable.get(peer)!==false){this.log(`Kaji: ${peer} unreachable${detail?` (${detail})`:''}; ${n} heartbeats missed.`);this.reachable.set(peer,false);}
 }
 private every=HEARTBEAT_MS;
 constructor(options:{baseId:string;key:KeyObject;publicKey:string;registry:RegistryPort;log?:(line:string)=>void;health?:()=>Promise<BaseHealth>;onHealth?:(baseId:string,health:HeardHealth)=>void;
  onRelay?:(from:string,relay:Relay)=>Promise<boolean>;onChat?:(from:string,message:string,conversation?:string)=>Promise<DispatchedReply>;
  offers?:()=>string[];onOffers?:(baseId:string,offers:string[])=>void;onRun?:(from:string,item:RunItem)=>Promise<unknown>;onDecide?:(approvalId:string,decision:'approve'|'reject')=>Promise<string>}) {
  this.baseId=options.baseId;this.key=options.key;this.publicKey=options.publicKey;this.port=options.registry;this.log=options.log ?? (l=>console.error(l));
  this.health=options.health;this.onHealth=options.onHealth;this.onRelay=options.onRelay;this.onDecide=options.onDecide;this.onChat=options.onChat;this.offers=options.offers;this.onOffers=options.onOffers;this.onRun=options.onRun;
 }
 private readonly offers:(()=>string[])|undefined;private readonly onOffers:((baseId:string,offers:string[])=>void)|undefined;private readonly onRun:((from:string,item:RunItem)=>Promise<unknown>)|undefined;
 private readonly onChat:((from:string,message:string,conversation?:string)=>Promise<DispatchedReply>)|undefined;
 private readonly onRelay:((from:string,relay:Relay)=>Promise<boolean>)|undefined;private readonly onDecide:((approvalId:string,decision:'approve'|'reject')=>Promise<string>)|undefined;
 private readonly health:(()=>Promise<BaseHealth>)|undefined;private readonly onHealth:((baseId:string,health:HeardHealth)=>void)|undefined;
 /** This base's health for a heartbeat; a check that fails is itself a degraded reason. Omitted when no check is wired. */
 private async own():Promise<BaseHealth|undefined> {
  if(!this.health)return undefined;
  try{return sanitizeHealth(await this.health()) ?? {state:'degraded',reasons:['health report invalid']};}catch{return {state:'degraded',reasons:['health check failed']};}
 }
 /** Offers are first-hand too: what a base says it lets the main base run there. */
 private heardOffers(from:string,value:unknown){if(value===undefined)return;const o=sanitizeOffers(value);if(o)this.onOffers?.(from,o);}
 /** Health is first-hand only: taken from the peer's own signed message, never relayed for a third base. */
 private heard(from:string,value:unknown){const h=sanitizeHealth(value);if(h)this.onHealth?.(from,{...h,at:new Date().toISOString()});}
 /** This base as the registry knows it (by its own public key), if enrolled and not revoked. */
 private async me():Promise<BaseEntry|undefined> {return (await this.port.bases()).find(b=>b.publicKey===this.publicKey&&b.status==='enrolled');}
 async start(everyMs=HEARTBEAT_MS):Promise<void> {
  const tick=async()=>{try{await this.listen();await this.heartbeat();}catch(e){this.log(`Kaji: ${e instanceof Error?e.message:'heartbeat failed'}.`);}};
  this.every=everyMs;await tick();this.timer=setInterval(()=>{void tick();},everyMs);
 }
 async stop():Promise<void> {if(this.timer)clearInterval(this.timer);await new Promise<void>(done=>this.server?this.server.close(()=>done()):done());this.server=undefined;this.listening=undefined;}
 /** Listens on the enrolled address only; retried on every tick (Tailscale may come up later, the address may change). */
 private async listen():Promise<void> {
  const me=await this.me();if(!me){if(!this.listening)this.log('Kaji: this base is not enrolled yet (kaji list); not listening.');return;}
  if(this.listening===me.address)return;
  if(this.server)await new Promise<void>(done=>this.server!.close(()=>done()));
  const {host,port}=endpoint(me.address);const server=createServer((req,res)=>{void this.serve(req,res.writeHead.bind(res),body=>res.end(body),res.setHeader.bind(res));});
  await new Promise<void>((done,fail)=>{server.once('error',fail);server.listen(port,host,()=>{server.off('error',fail);done();});});
  this.server=server;this.listening=me.address;this.log(`Kaji: listening on ${host}:${port} as ${this.baseId}.`);
 }
 private async serve(req:IncomingMessage,writeHead:(s:number,h?:Record<string,string>)=>unknown,end:(b:string)=>void,setHeader:(k:string,v:string)=>unknown):Promise<void> {
  const reply=(status:number,value:unknown)=>{const body=JSON.stringify(value);const h=signedHeaders(this.baseId,this.key,'res',req.method ?? '',req.url ?? '',body);for(const [k,v] of Object.entries(h))setHeader(k,v);writeHead(status,{'content-type':'application/json'});end(body);};
  try{
   let body='';for await(const chunk of req){body+=chunk;if(body.length>MAX_BODY)throw new Error('too large');}
   const bases=await this.port.bases();const from=verifySigned(req.headers as Record<string,string>,'req',req.method ?? '',req.url ?? '',body,bases,this.nonces);
   if(req.method==='POST'&&req.url==='/kaji/heartbeat'){
    const hb=JSON.parse(body) as {seen?:Record<string,string>;health?:unknown;offers?:unknown};const now=new Date().toISOString();
    await this.port.seen({...sanitizeSeen(hb.seen,bases),[from]:now,[this.baseId]:now});this.heard(from,hb.health);this.heardOffers(from,hb.offers);
    const health=await this.own();const offers=this.offers?.();
    reply(200,{head:head(await this.port.records()),seen:await this.port.lastSeen(),...(health?{health}:{}),...(offers?{offers}:{})});return;
   }
   if(req.method==='GET'&&req.url==='/kaji/registry'){reply(200,{records:await this.port.records()});return;}
   // F-036 phase 2. Only the main base shows what the others relay; only a decision from the main base is applied here.
   if(req.method==='POST'&&req.url==='/kaji/relay'){
    const relay=sanitizeRelay(JSON.parse(body));if(!relay){reply(400,{error:'invalid relay'});return;}
    if(await this.port.main?.()!==this.baseId||!this.onRelay){reply(409,{error:'not the main base'});return;}
    reply(200,{delivered:await this.onRelay(from,relay)});return;
   }
   // F-036 dispatch: a request asked on another base, answered by the main base's Misato.
   if(req.method==='POST'&&req.url==='/kaji/chat'){
    const c=JSON.parse(body) as {message?:unknown;conversation?:unknown};
    if(typeof c.message!=='string'||!c.message.trim()||c.message.length>4000||(c.conversation!==undefined&&(typeof c.conversation!=='string'||!/^[a-z]{1,20}$/.test(c.conversation)))){reply(400,{error:'invalid request'});return;}
    if(await this.port.main?.()!==this.baseId||!this.onChat){reply(409,{error:'not the main base'});return;}
    reply(200,await this.onChat(from,c.message,c.conversation as string|undefined));return;
   }
   // F-036 slice 3b: one action the main base asks this base to run (only the main base may ask; this base's gate decides).
   if(req.method==='POST'&&req.url==='/kaji/run'){
    const r=JSON.parse(body) as {id?:unknown;request?:unknown;tool?:unknown;args?:unknown};
    if(typeof r.id!=='string'||!UUID.test(r.id)||typeof r.request!=='string'||r.request.length>500||typeof r.tool!=='string'||!/^[a-z]+\.[a-z]+$/.test(r.tool)||!r.args||typeof r.args!=='object'||Array.isArray(r.args)){reply(400,{error:'invalid action'});return;}
    if(await this.port.main?.()!==from||!this.onRun){reply(403,{error:'only the main base runs actions here'});return;}
    reply(200,{result:await this.onRun(from,{id:r.id,request:r.request,tool:r.tool,args:r.args as Record<string,unknown>})});return;
   }
   if(req.method==='POST'&&req.url==='/kaji/decide'){
    const d=JSON.parse(body) as {approvalId?:unknown;decision?:unknown};
    if(typeof d.approvalId!=='string'||!UUID.test(d.approvalId)||(d.decision!=='approve'&&d.decision!=='reject')){reply(400,{error:'invalid decision'});return;}
    if(await this.port.main?.()!==from||!this.onDecide){reply(403,{error:'only the main base decides here'});return;}
    reply(200,{outcome:await this.onDecide(d.approvalId,d.decision)});return;
   }
   reply(404,{error:'unknown'});
  }catch(e){this.log(`Kaji: refused a request (${e instanceof Error?e.message:'invalid'}).`);reply(403,{error:'refused'});}
 }
 /** Signed request to one peer; the reply must be signed by that same peer. */
 private async call(peer:BaseEntry,method:'GET'|'POST',path:string,value?:unknown,timeoutMs=8000):Promise<unknown> {
  const body=value===undefined?'':JSON.stringify(value);const {host,port}=endpoint(peer.address);
  const res=await fetch(`http://${host}:${port}${path}`,{method,headers:{'content-type':'application/json',...signedHeaders(this.baseId,this.key,'req',method,path,body)},...(method==='POST'?{body}:{}),signal:AbortSignal.timeout(timeoutMs),redirect:'error'});
  const text=await res.text();const headers=Object.fromEntries(res.headers.entries());
  const from=verifySigned(headers,'res',method,path,text,await this.port.bases(),this.nonces);
  if(from!==peer.baseId)throw new Error(`${peer.baseId} answered as ${from}`);
  if(!res.ok)throw new Error(`${peer.baseId} refused (${res.status})`);
  return JSON.parse(text);
 }
 /** Sends a relay to the main base (F-036 phase 2); false when there is none, it is this base, or it cannot be reached. */
 async relay(relay:Relay):Promise<boolean> {
  const main=await this.port.main?.();if(!main||main===this.baseId)return false;
  const peer=(await this.port.bases()).find(b=>b.baseId===main&&b.status==='enrolled');if(!peer)return false;
  try{return ((await this.call(peer,'POST','/kaji/relay',relay)) as {delivered?:boolean}).delivered===true;}catch(e){this.log(`Kaji: relay to ${main} failed (${e instanceof Error?e.message:'error'}).`);return false;}
 }
 /** Sends a request to the main base's Misato (F-036 dispatch). undefined only when it was never sent (no main base, it is
     this base, or it cannot be reached), so the caller may answer locally; once sent, a slow or failed answer is reported,
     never run a second time here. */
 async chat(message:string,conversation:string|undefined,timeoutMs:number):Promise<DispatchedReply|undefined> {
  const main=await this.port.main?.();if(!main||main===this.baseId)return undefined;
  const peer=(await this.port.bases()).find(b=>b.baseId===main&&b.status==='enrolled');if(!peer)return undefined;
  try{return (await this.call(peer,'POST','/kaji/chat',{message,...(conversation?{conversation}:{})},timeoutMs)) as DispatchedReply;}
  catch(e){
   const text=e instanceof Error?e.message:'error';
   // Never sent: the connection itself failed. Anything later (a reset, a timeout) may have reached Misato already.
   const code=(e as {cause?:{code?:string}}).cause?.code;
   if(code&&['ECONNREFUSED','EHOSTUNREACH','ENETUNREACH','EADDRNOTAVAIL','UND_ERR_CONNECT_TIMEOUT'].includes(code))return undefined;
   return {sortieId:'',error:`${main} did not answer (${text}); it may still be working on it, so the request was not repeated here.`,steps:[],waiting:[]};
  }
 }
 /** Sends one action to a base (F-036 slice 3b). reached:false means it never got there (send again later, same id);
     refused carries that base's reason (it does not offer it, or it is not this base's to ask). */
 async run(baseId:string,item:RunItem,timeoutMs:number):Promise<{reached:boolean;result?:unknown;refused?:string}> {
  const peer=(await this.port.bases()).find(b=>b.baseId===baseId&&b.status==='enrolled');if(!peer)return {reached:true,refused:`${baseId} is not an enrolled base`};
  try{return {reached:true,result:((await this.call(peer,'POST','/kaji/run',item,timeoutMs)) as {result?:unknown}).result};}
  catch(e){const text=e instanceof Error?e.message:'error';const code=(e as {cause?:{code?:string}}).cause?.code;
   if(/refused \((400|403|409)\)/.test(text))return {reached:true,refused:text};
   return {reached:false,...(code?{refused:code}:{})};}
 }
 /** Passes the owner's tap on a relayed card back to the base that owns the card; its outcome text comes back. */
 async decide(baseId:string,approvalId:string,decision:'approve'|'reject'):Promise<string> {
  const peer=(await this.port.bases()).find(b=>b.baseId===baseId&&b.status==='enrolled');if(!peer)throw new Error(`${baseId} is not an enrolled base.`);
  return ((await this.call(peer,'POST','/kaji/decide',{approvalId,decision})) as {outcome?:string}).outcome ?? 'No outcome.';
 }
 /** One round: greet every other enrolled base, merge what they have seen, catch up on the registry if behind. */
 async heartbeat():Promise<void> {
  const me=await this.me();if(!me)return;const bases=await this.port.bases();
  await this.port.seen({[this.baseId]:new Date().toISOString()});const health=await this.own();
  for(const peer of bases.filter(b=>b.status==='enrolled'&&b.publicKey!==this.publicKey)){
   try{
    const offers=this.offers?.();
    const r=await this.call(peer,'POST','/kaji/heartbeat',{seen:await this.port.lastSeen(),...(health?{health}:{}),...(offers?{offers}:{})}) as {head:{count:number;serial:number};seen?:Record<string,string>;health?:unknown;offers?:unknown};
    await this.port.seen({...sanitizeSeen(r.seen,bases),[peer.baseId]:new Date().toISOString()});this.mark(peer.baseId,true);this.heard(peer.baseId,r.health);this.heardOffers(peer.baseId,r.offers);
    const mine=head(await this.port.records());
    if(r.head.count>mine.count||r.head.serial>mine.serial){const got=await this.call(peer,'GET','/kaji/registry') as {records:SignedRecord[]};const added=await this.port.add(got.records);if(added)this.log(`Kaji: ${added} new registry record(s) from ${peer.baseId}.`);}
   }catch(e){this.mark(peer.baseId,false,e instanceof Error?e.message:'error');}
  }
 }
}
/** Only enrolled base ids and valid, not-in-the-future times are merged from a peer's view. */
function sanitizeSeen(seen:unknown,bases:BaseEntry[]):Record<string,string> {
 const out:Record<string,string>={};if(!seen||typeof seen!=='object')return out;const ids=new Set(bases.map(b=>b.baseId));
 for(const [id,at] of Object.entries(seen as Record<string,unknown>))if(ids.has(id)&&typeof at==='string'&&Number.isFinite(Date.parse(at))&&Date.parse(at)<=Date.now()+SKEW_MS)out[id]=new Date(Date.parse(at)).toISOString();
 return out;
}
